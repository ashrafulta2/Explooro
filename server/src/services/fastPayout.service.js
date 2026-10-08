/**
 * fastPayout.service.js — Early release of escrowed earnings, for a fee (supplier attraction, step 5a).
 *
 * Escrow holds a supplier's and a saler's money until the return window ends. Someone who would rather
 * have it now can ask for it, and the platform keeps a share set by the supplier's scorecard grade.
 *
 * Invariants:
 *   1. The fee is taken from the entry being released and nowhere else: one balanced ledger group,
 *      user ESCROW debit = user AVAILABLE credit (net) + treasury AVAILABLE credit (fee). The profit split
 *      is untouched.
 *   2. An entry is released early at most once. The escrow row is locked first and must still be LOCKED,
 *      and `fast_payouts.escrow_entry_id` is UNIQUE, so a double click or a racing release job pays nothing
 *      twice. The ordinary release (vault.releaseEscrow) only touches LOCKED entries, so it skips this one.
 *   3. Only money that has a reason to be safe is released early: the goods are DELIVERED, a COD order's
 *      cash is reconciled, and no return or dispute is open on the order. A later return still claws back
 *      from the released balance exactly as it does after a normal release.
 *   4. A person's exposure is capped. `max_outstanding` limits the sum of their early releases whose
 *      original hold has not ended, counted under their wallet lock so two requests cannot both slip under it.
 *   5. Every number comes from the `supplier.fast_payout` platform_settings row. The defaults below only
 *      apply while that row is absent or unreadable.
 *
 * All money arithmetic is integer paisa. The pure functions are tested without a database.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import * as repo from '../repositories/fastPayout.repository.js';
import * as scorecardRepo from '../repositories/supplierScorecard.repository.js';

const GRADES = ['A', 'B', 'C', 'D'];
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RULES = Object.freeze({
  fee_pct_by_grade: Object.freeze({ A: 1, B: 1.5, C: 2.5 }),
  ungraded_fee_pct: 2,
  min_amount: 100,
  max_per_request: 50000,
  max_outstanding: 100000,
  min_days_saved: 2,
  blocked_grades: Object.freeze(['D']),
});

const toPaisa = (v) => Math.round(Number(v) * 100);
const fromPaisa = (p) => (p / 100).toFixed(2);

/**
 * Merges a stored rules object over the defaults, field by field. A malformed field falls back to its
 * default rather than failing: one bad edit must not stop everyone from reaching their money.
 */
export function resolveRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_RULES;
  const dec = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback);

  const fees = {};
  const stored = r.fee_pct_by_grade && typeof r.fee_pct_by_grade === 'object' ? r.fee_pct_by_grade : null;
  for (const g of GRADES) {
    // WHY capped at 50: above that the earner would receive less of their own money than the platform keeps.
    const v = stored ? dec(stored[g], 0, 50, null) : null;
    if (v !== null) fees[g] = v;
    else if (!stored && d.fee_pct_by_grade[g] !== undefined) fees[g] = d.fee_pct_by_grade[g];
  }

  const out = {
    fee_pct_by_grade: fees,
    ungraded_fee_pct: dec(r.ungraded_fee_pct, 0, 50, d.ungraded_fee_pct),
    min_amount: dec(r.min_amount, 0.01, 10000000, d.min_amount),
    max_per_request: dec(r.max_per_request, 0.01, 10000000, d.max_per_request),
    max_outstanding: dec(r.max_outstanding, 0.01, 100000000, d.max_outstanding),
    min_days_saved: Number.isInteger(r.min_days_saved) && r.min_days_saved >= 0 && r.min_days_saved <= 60 ? r.min_days_saved : d.min_days_saved,
    blocked_grades: Array.isArray(r.blocked_grades)
      ? [...new Set(r.blocked_grades.filter((g) => GRADES.includes(g)))]
      : [...d.blocked_grades],
  };
  // A stored min above the stored max would make every amount illegal; fall back to the pair of defaults.
  if (out.min_amount > out.max_per_request) {
    out.min_amount = d.min_amount;
    out.max_per_request = d.max_per_request;
  }
  return out;
}

export async function loadRules(db) {
  try {
    return resolveRules(await repo.getRulesRow(db));
  } catch {
    return resolveRules(null);
  }
}

// ---- pure rules -------------------------------------------------------------------------------------------

/** The fee percentage for a grade, or null when that grade may not take an early payout. */
export function feePctFor(grade, rules) {
  if (grade == null) return rules.ungraded_fee_pct;
  if (rules.blocked_grades.includes(grade)) return null;
  const pct = rules.fee_pct_by_grade[grade];
  return pct === undefined ? null : pct;
}

/** Splits an amount into fee and net. fee + net === gross, always, to the paisa. */
export function splitFastPayout({ amount, feePct }) {
  const grossPaisa = toPaisa(amount);
  const feePaisa = Math.round((grossPaisa * feePct) / 100);
  return {
    grossPaisa,
    feePaisa,
    netPaisa: grossPaisa - feePaisa,
    gross: fromPaisa(grossPaisa),
    fee: fromPaisa(feePaisa),
    net: fromPaisa(grossPaisa - feePaisa),
  };
}

const REASON_TEXT = {
  NOT_LOCKED: ['This amount is no longer held in escrow.', 'এই টাকা আর এসক্রোতে আটকে নেই।'],
  NOT_DELIVERED: ['The order has not been delivered yet.', 'অর্ডারটি এখনো ডেলিভার হয়নি।'],
  COD_UNRECONCILED: ['The courier has not handed over the cash for this order yet.', 'এই অর্ডারের ক্যাশ কুরিয়ার এখনো জমা দেয়নি।'],
  OPEN_CLAIM: ['A return or dispute is open on this order.', 'এই অর্ডারে একটি রিটার্ন বা বিরোধ চলছে।'],
  GRADE_BLOCKED: ['Early payout is not available for this supplier’s scorecard grade.', 'এই সাপ্লায়ারের স্কোরকার্ড গ্রেডে ফাস্ট পেআউট পাওয়া যায় না।'],
  TOO_SMALL: ['This amount is below the minimum for an early payout.', 'ফাস্ট পেআউটের ন্যূনতম পরিমাণের চেয়ে কম।'],
  TOO_LARGE: ['This amount is above the maximum for one early payout.', 'এক ফাস্ট পেআউটের সর্বোচ্চ পরিমাণের চেয়ে বেশি।'],
  TOO_SOON: ['This money is due to be released soon anyway.', 'এই টাকা এমনিতেই শিগগির ছাড়া হবে।'],
  EXPOSURE_LIMIT: ['You have reached your limit of early payouts that are still in their return window.', 'রিটার্নের সময়সীমার মধ্যে থাকা ফাস্ট পেআউটের সীমায় পৌঁছে গেছেন।'],
};

/**
 * Judges one escrow entry. Returns what it would cost if allowed, or the first reason it is not.
 * `entry` carries the joined facts from the repository; `outstandingPaisa` is what the person already
 * has out early. The order of the checks is the order a person should fix them in.
 */
export function evaluateEntry({ entry, grade, rules, outstandingPaisa, now = new Date() }) {
  const base = {
    entry_id: entry.entry_id,
    amount: fromPaisa(toPaisa(entry.amount)),
    grade,
    fee_pct: null,
    fee: null,
    net: null,
    days_saved: 0,
    eligible: false,
    reason: null,
  };
  const refuse = (reason) => ({ ...base, reason });

  if (entry.status !== 'LOCKED') return refuse('NOT_LOCKED');
  if (entry.sub_order_status !== 'DELIVERED') return refuse('NOT_DELIVERED');
  if (entry.payment_method === 'COD' && !['MATCHED', 'RESOLVED'].includes(entry.cod_status)) return refuse('COD_UNRECONCILED');
  if (entry.has_open_return || entry.has_open_dispute) return refuse('OPEN_CLAIM');

  const feePct = feePctFor(grade, rules);
  if (feePct === null) return refuse('GRADE_BLOCKED');

  const amountPaisa = toPaisa(entry.amount);
  if (amountPaisa < toPaisa(rules.min_amount)) return refuse('TOO_SMALL');
  if (amountPaisa > toPaisa(rules.max_per_request)) return refuse('TOO_LARGE');

  const daysSaved = Math.max(0, Math.floor((new Date(entry.hold_until).getTime() - now.getTime()) / DAY_MS));
  if (daysSaved < rules.min_days_saved) return refuse('TOO_SOON');
  if (outstandingPaisa + amountPaisa > toPaisa(rules.max_outstanding)) return refuse('EXPOSURE_LIMIT');

  const split = splitFastPayout({ amount: entry.amount, feePct });
  // WHY: an entry whose fee would swallow it entirely has nothing left to pay out.
  if (split.netPaisa <= 0) return refuse('TOO_SMALL');
  return { ...base, eligible: true, fee_pct: feePct, fee: split.fee, net: split.net, days_saved: daysSaved };
}

// ---- helpers ----------------------------------------------------------------------------------------------

async function gradeOf(db, supplierId) {
  try {
    return (await scorecardRepo.findOne(db, supplierId))?.grade ?? null;
  } catch {
    // WHY swallow: before migration 062 there is no table; an ungraded supplier gets the ungraded rate.
    return null;
  }
}

async function treasuryUserId(client) {
  const { rows } = await client.query(
    `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.key = 'super_admin'
      ORDER BY u.id ASC LIMIT 1`
  );
  return rows[0]?.id ?? 1;
}

// ---- views ------------------------------------------------------------------------------------------------

/** Everything the Fast Payout page needs: each locked entry with its quote or reason, and the history. */
export async function getView(db, userId) {
  const rules = await loadRules(db);
  const [entries, outstanding, history] = await Promise.all([
    repo.listLockedEntries(db, userId),
    repo.outstandingAmount(db, userId),
    repo.listHistory(db, userId),
  ]);

  const grades = new Map();
  for (const supplierId of new Set(entries.map((e) => String(e.supplier_id)))) {
    grades.set(supplierId, await gradeOf(db, supplierId));
  }

  // WHY a running total: judging each entry against the same starting exposure would let a page of
  // entries each look allowed while together they exceed the limit. The server still re-checks on request.
  let running = toPaisa(outstanding);
  const items = entries.map((entry) => {
    const grade = grades.get(String(entry.supplier_id)) ?? null;
    const ev = evaluateEntry({ entry, grade, rules, outstandingPaisa: running });
    if (ev.eligible) running += toPaisa(entry.amount);
    return {
      ...ev,
      sub_order_id: entry.sub_order_id,
      sub_order_ref: entry.sub_order_ref,
      role: entry.beneficiary_role,
      hold_until: entry.hold_until,
    };
  });

  return {
    rules,
    outstanding: fromPaisa(toPaisa(outstanding)),
    headroom: fromPaisa(Math.max(0, toPaisa(rules.max_outstanding) - toPaisa(outstanding))),
    entries: items,
    history,
  };
}

// ---- the request ------------------------------------------------------------------------------------------

/**
 * Releases one escrow entry early. One transaction: the entry lock, the checks, the ledger group, the
 * status change and the record either all happen or none do.
 */
export async function requestFastPayout(db, { userId, entryId }) {
  const rules = await loadRules(db);
  const id = Number(entryId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('VALIDATION_FAILED', 'Choose which amount to release.', 'কোন টাকাটি ছাড়তে চান তা বেছে নিন।');
  }

  return withTransaction(db, async (client) => {
    const entry = await repo.lockEntry(client, id);
    // WHY NOT_FOUND for someone else's entry: do not reveal that another person's escrow entry exists.
    if (!entry || String(entry.user_id) !== String(userId)) {
      throw new AppError('NOT_FOUND', 'That amount was not found.', 'টাকার এই এন্ট্রিটি পাওয়া যায়নি।');
    }

    // The wallet lock serialises this person's requests, so the exposure below cannot be raced.
    await walletRepo.getWalletsByIdsForUpdate(client, [entry.wallet_id]);

    const grade = await gradeOf(client, entry.supplier_id);
    const outstanding = toPaisa(await repo.outstandingAmount(client, userId));
    const ev = evaluateEntry({ entry, grade, rules, outstandingPaisa: outstanding });
    if (!ev.eligible) {
      const [en, bn] = REASON_TEXT[ev.reason] || REASON_TEXT.NOT_LOCKED;
      throw new AppError('FAST_PAYOUT_NOT_ELIGIBLE', en, bn);
    }

    const split = splitFastPayout({ amount: entry.amount, feePct: ev.fee_pct });
    const txnGroupId = randomUUID();
    const key = `fast_payout:${entry.entry_id}`;
    const entries = [
      { walletId: entry.wallet_id, entryType: 'DEBIT', amount: split.gross, balanceBucket: 'ESCROW', category: 'ESCROW_RELEASE', idempotencyKey: `${key}:out` },
      { walletId: entry.wallet_id, entryType: 'CREDIT', amount: split.net, balanceBucket: 'AVAILABLE', category: 'ESCROW_RELEASE', idempotencyKey: `${key}:net` },
    ];
    if (split.feePaisa > 0) {
      const treasury = await walletRepo.getOrCreateWallet(client, await treasuryUserId(client), { client });
      entries.push({ walletId: treasury.id, entryType: 'CREDIT', amount: split.fee, balanceBucket: 'AVAILABLE', category: 'FAST_PAYOUT_FEE', idempotencyKey: `${key}:fee` });
    }
    await ledgerService.recordTransactionGroup(client, {
      txnGroupId,
      entries,
      defaultCategory: 'ESCROW_RELEASE',
      defaultReferenceType: 'SUB_ORDER',
      defaultReferenceId: entry.sub_order_id,
      memo: `Fast payout of escrow entry #${entry.entry_id}`,
      createdBy: userId,
    });

    await repo.markReleased(client, entry.entry_id);
    const record = await repo.insertFastPayout(client, {
      entryId: entry.entry_id, subOrderId: entry.sub_order_id, userId, walletId: entry.wallet_id,
      role: entry.beneficiary_role, gross: split.gross, feePct: ev.fee_pct, fee: split.fee, net: split.net,
      grade, holdUntil: entry.hold_until, daysSaved: ev.days_saved, txnGroupId,
    });

    await writeAudit(client, {
      action: 'finance.fast_payout.request',
      targetType: 'escrow_entry',
      targetRef: String(entry.entry_id),
      before: { status: 'LOCKED', amount: split.gross },
      after: { status: 'RELEASED', fee: split.fee, net: split.net, fee_pct: ev.fee_pct, grade },
      actorId: userId,
    });
    return record;
  });
}
