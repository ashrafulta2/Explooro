/**
 * returnProtection.service.js — A saler keeps their commission when a protected order is returned
 * (supplier attraction, step 5b).
 *
 * A return claws the saler's commission back along with everyone else's, and the saler did nothing
 * wrong. A supplier can opt in to make the saler whole. The platform stands behind that promise:
 * the treasury pays the claim, and is paid for the risk by a premium on protected orders that complete.
 *
 * Invariants:
 *   1. Cover follows the ORDER, not the supplier's current status: an order is covered if its supplier was
 *      enrolled when it was placed (enrolment is a history). Leaving the programme never strips cover from
 *      orders already sold, and joining never covers orders already sold.
 *   2. One cover per sub-order (a UNIQUE key), so a claim can be paid at most once however many times the
 *      refund path, the job or a retry reaches it.
 *   3. A claim pays back only what the clawback actually took from the saler, capped at `max_claim_amount`:
 *      min(insured commission, the saler's clawed-back escrow entry, cap). If nothing was taken, nothing is paid.
 *   4. The treasury cannot be farmed: a saler past `max_claims_per_saler_30d` paid claims in 30 days has
 *      further claims DENIED (recorded, with the reason), not paid.
 *   5. The premium is charged once, only after the supplier's money has really been released, and only if
 *      the supplier can pay it from their AVAILABLE balance. An order that is returned first never pays one.
 *      A premium the supplier could not cover is retried on the next run.
 *   6. A claim never holds up a refund. The refund path calls payClaim inside a savepoint; if it fails the
 *      refund stands and the job's claim sweep pays it later.
 *   7. Every number comes from the `supplier.return_protection` platform_settings row. The defaults below
 *      only apply while that row is absent or unreadable.
 *
 * All money arithmetic is integer paisa. The pure functions are tested without a database.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import * as repo from '../repositories/returnProtection.repository.js';
import * as scorecardRepo from '../repositories/supplierScorecard.repository.js';

const GRADES = ['A', 'B', 'C', 'D'];
const CLAIM_WINDOW_DAYS = 30;

export const DEFAULT_RULES = Object.freeze({
  enabled: true,
  premium_pct: 10,
  max_claim_amount: 5000,
  max_claims_per_saler_30d: 5,
  blocked_grades: Object.freeze(['D']),
  premium_batch: 200,
});

const toPaisa = (v) => Math.round(Number(v) * 100);
const fromPaisa = (p) => (p / 100).toFixed(2);

/** Merges a stored rules object over the defaults, field by field; a malformed field falls back. */
export function resolveRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_RULES;
  const int = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
  const dec = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback);
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    // WHY capped at 50: a premium above half the insured amount would make cover worth less than it costs.
    premium_pct: dec(r.premium_pct, 0, 50, d.premium_pct),
    max_claim_amount: dec(r.max_claim_amount, 0.01, 10000000, d.max_claim_amount),
    max_claims_per_saler_30d: int(r.max_claims_per_saler_30d, 0, 1000, d.max_claims_per_saler_30d),
    blocked_grades: Array.isArray(r.blocked_grades)
      ? [...new Set(r.blocked_grades.filter((g) => GRADES.includes(g)))]
      : [...d.blocked_grades],
    premium_batch: int(r.premium_batch, 1, 5000, d.premium_batch),
  };
}

export async function loadRules(db) {
  try {
    return resolveRules(await repo.getRulesRow(db));
  } catch {
    return resolveRules(null);
  }
}

// ---- pure rules -------------------------------------------------------------------------------------------

/** The premium for a cover: a share of the insured commission, in paisa. */
export function premiumPaisa(insuredAmount, premiumPct) {
  return Math.round((toPaisa(insuredAmount) * premiumPct) / 100);
}

/** What a claim pays, in paisa: never more than was insured, taken from the saler, or allowed per order. */
export function claimPaisa({ insured, clawedBack, maxClaim }) {
  return Math.max(0, Math.min(toPaisa(insured), toPaisa(clawedBack), toPaisa(maxClaim)));
}

// ---- helpers ----------------------------------------------------------------------------------------------

async function supplierGrade(db, supplierId) {
  try {
    return (await scorecardRepo.findOne(db, supplierId))?.grade ?? null;
  } catch {
    // WHY swallow: before migration 062 there is no table; an ungraded supplier is never blocked.
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

/**
 * Makes the cover for a sub-order if its supplier was enrolled when it was placed. Returns the cover row,
 * or null when the order is not covered. Safe to call repeatedly: the UNIQUE key keeps one cover.
 */
export async function ensureCover(client, subOrderId, rules) {
  const existing = await repo.lockCover(client, subOrderId);
  if (existing) return existing;

  const so = await repo.getSubOrderForCover(client, subOrderId);
  if (!so || !so.was_enrolled || !so.saler_id || toPaisa(so.saler_commission) <= 0) return null;

  await repo.insertCover(client, {
    subOrderId,
    supplierId: so.supplier_id,
    salerId: so.saler_id,
    insured: so.saler_commission,
    premiumPct: rules.premium_pct,
    premium: fromPaisa(premiumPaisa(so.saler_commission, rules.premium_pct)),
  });
  return repo.lockCover(client, subOrderId);
}

// ---- supplier side ----------------------------------------------------------------------------------------

export async function getSupplierView(db, supplierId) {
  const rules = await loadRules(db);
  const [enrollment, grade, stats, covers] = await Promise.all([
    repo.getOpenEnrollment(db, supplierId),
    supplierGrade(db, supplierId),
    repo.supplierStats(db, supplierId),
    repo.listCoversForSupplier(db, supplierId),
  ]);
  return {
    rules,
    grade,
    blocked: grade != null && rules.blocked_grades.includes(grade),
    enrolled: Boolean(enrollment),
    enrolled_since: enrollment?.started_at ?? null,
    stats,
    covers,
  };
}

/** Enrols or withdraws a supplier. Idempotent: repeating either is not an error and writes nothing. */
export async function setEnrollment(db, { supplierId, enrolled, actor = null }) {
  const rules = await loadRules(db);
  if (enrolled) {
    if (!rules.enabled) {
      throw new AppError('VALIDATION_FAILED', 'Return protection is not open for new enrolments right now.', 'রিটার্ন প্রোটেকশনে এখন নতুন নিবন্ধন বন্ধ আছে।');
    }
    const grade = await supplierGrade(db, supplierId);
    if (grade != null && rules.blocked_grades.includes(grade)) {
      throw new AppError(
        'SUPPLIER_GRADE_BLOCKED',
        `Suppliers graded ${grade} on the Supplier Scorecard cannot offer return protection. Improve your scorecard and try again.`,
        `সাপ্লায়ার স্কোরকার্ডে ${grade} গ্রেডের সাপ্লায়াররা রিটার্ন প্রোটেকশন দিতে পারেন না। স্কোরকার্ড উন্নত করে আবার চেষ্টা করুন।`
      );
    }
  }

  const row = enrolled ? await repo.openEnrollment(db, supplierId) : await repo.closeEnrollment(db, supplierId);
  if (row) {
    await writeAudit(db, {
      action: enrolled ? 'supplier.return_protection.enroll' : 'supplier.return_protection.withdraw',
      targetType: 'return_protection_enrollment',
      targetRef: String(row.id),
      before: { enrolled: !enrolled },
      after: { enrolled },
      actorId: actor ?? supplierId,
    });
  }
  return getSupplierView(db, supplierId);
}

// ---- saler side -------------------------------------------------------------------------------------------

export async function getSalerView(db, salerId) {
  const rules = await loadRules(db);
  const [suppliers, covers] = await Promise.all([repo.listProtectedSuppliers(db), repo.listCoversForSaler(db, salerId)]);
  return {
    rules: { max_claim_amount: rules.max_claim_amount, max_claims_per_saler_30d: rules.max_claims_per_saler_30d },
    suppliers,
    covers,
  };
}

// ---- the claim --------------------------------------------------------------------------------------------

/**
 * Pays the saler what a return clawed back from them, if the order was covered. Runs inside the caller's
 * transaction (the refund's), so the claim and the refund commit together. Returns a description of what
 * happened, or null when the order carries no cover.
 */
export async function payClaim(client, { subOrderId, returnRequestId = null, approvedBy = null }) {
  const rules = await loadRules(client);
  const cover = await ensureCover(client, subOrderId, rules);
  if (!cover || cover.status !== 'ACTIVE') return null;

  // Only what the clawback actually took: a saler whose commission was never clawed back lost nothing.
  const entry = await repo.getSalerEscrowEntry(client, subOrderId, cover.saler_id);
  if (!entry || entry.status !== 'CLAWED_BACK') {
    // WHY closed, not left ACTIVE: the order was refunded and nothing was taken from the saler, so there is
    // nothing to claim now or later; leaving it ACTIVE would have the claim sweep revisit it forever.
    await repo.markDenied(client, cover.id, 'NOT_CLAWED_BACK', returnRequestId);
    return { denied: true, reason: 'NOT_CLAWED_BACK', coverId: cover.id };
  }

  if ((await repo.countRecentClaims(client, cover.saler_id, CLAIM_WINDOW_DAYS)) >= rules.max_claims_per_saler_30d) {
    await repo.markDenied(client, cover.id, 'CLAIM_LIMIT', returnRequestId);
    return { denied: true, reason: 'CLAIM_LIMIT', coverId: cover.id };
  }

  const pay = claimPaisa({ insured: cover.insured_amount, clawedBack: entry.amount, maxClaim: rules.max_claim_amount });
  if (pay <= 0) {
    await repo.markDenied(client, cover.id, 'NOTHING_TO_PAY', returnRequestId);
    return { denied: true, reason: 'NOTHING_TO_PAY', coverId: cover.id };
  }

  const salerWallet = await walletRepo.getOrCreateWallet(client, cover.saler_id, { client });
  const treasuryWallet = await walletRepo.getOrCreateWallet(client, await treasuryUserId(client), { client });
  const txnGroupId = randomUUID();
  const key = `return_protection:${cover.id}:claim`;
  await ledgerService.recordTransactionGroup(client, {
    txnGroupId,
    entries: [
      // WHY the treasury may go below zero here: the claim is the platform's promise, and refusing to
      // pay it because the pool is momentarily empty would break that promise to the saler.
      { walletId: treasuryWallet.id, entryType: 'DEBIT', amount: fromPaisa(pay), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:out` },
      { walletId: salerWallet.id, entryType: 'CREDIT', amount: fromPaisa(pay), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:in` },
    ],
    defaultCategory: 'RETURN_PROTECTION_CLAIM',
    defaultReferenceType: 'SUB_ORDER',
    defaultReferenceId: subOrderId,
    memo: `Return protection for sub-order #${subOrderId}`,
    createdBy: approvedBy,
  });
  await repo.markClaimed(client, cover.id, { amount: fromPaisa(pay), txnGroupId, returnRequestId });
  await writeAudit(client, {
    action: 'finance.return_protection.claim',
    targetType: 'sub_order',
    targetRef: String(subOrderId),
    before: { status: 'ACTIVE' },
    after: { status: 'CLAIMED', amount: fromPaisa(pay), saler_id: cover.saler_id },
    actorId: approvedBy,
  });
  return { paid: true, amount: fromPaisa(pay), coverId: cover.id, txnGroupId };
}

// ---- the premium ------------------------------------------------------------------------------------------

/** Charges the supplier the premium for one released order. Returns 'charged', 'waived' or a skip reason. */
export async function chargePremium(db, subOrderId) {
  const rules = await loadRules(db);
  return withTransaction(db, async (client) => {
    const cover = await ensureCover(client, subOrderId, rules);
    if (!cover) return 'not_covered';
    if (cover.status !== 'ACTIVE' || cover.premium_charged_at) return 'already_settled';
    // Re-checked under the cover lock: the supplier's money must really have been released.
    if (!(await repo.isSupplierReleased(client, subOrderId))) return 'not_released';

    const premium = toPaisa(cover.premium_amount);
    if (premium <= 0) {
      await repo.markPremiumCharged(client, cover.id, null);
      return 'waived';
    }

    const supplierWallet = await walletRepo.getOrCreateWallet(client, cover.supplier_id, { client });
    const [locked] = await walletRepo.getWalletsByIdsForUpdate(client, [supplierWallet.id]);
    // WHY not charged into a negative balance: a premium is not worth overdrawing a supplier; it is retried.
    if (toPaisa(locked.available_balance) < premium) return 'insufficient_balance';

    const treasuryWallet = await walletRepo.getOrCreateWallet(client, await treasuryUserId(client), { client });
    const txnGroupId = randomUUID();
    const key = `return_protection:${cover.id}:premium`;
    await ledgerService.recordTransactionGroup(client, {
      txnGroupId,
      entries: [
        { walletId: supplierWallet.id, entryType: 'DEBIT', amount: fromPaisa(premium), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:out` },
        { walletId: treasuryWallet.id, entryType: 'CREDIT', amount: fromPaisa(premium), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:in` },
      ],
      defaultCategory: 'RETURN_PROTECTION_PREMIUM',
      defaultReferenceType: 'SUB_ORDER',
      defaultReferenceId: subOrderId,
      memo: `Return protection premium for sub-order #${subOrderId}`,
      createdBy: cover.supplier_id,
    });
    await repo.markPremiumCharged(client, cover.id, txnGroupId);
    return 'charged';
  });
}

// ---- the sweep (the hourly job) ---------------------------------------------------------------------------

/**
 * Pays claims the refund path could not, then charges premiums that have come due. Each item is its own
 * transaction, so one failure never holds up the rest.
 */
export async function settleDue(db, logger = console) {
  const rules = await loadRules(db);
  const result = { claims_paid: 0, premiums_charged: 0, skipped: 0, errors: [] };

  for (const due of await repo.listClaimsDue(db, rules.premium_batch)) {
    try {
      const paid = await withTransaction(db, (client) => payClaim(client, { subOrderId: due.sub_order_id, returnRequestId: due.return_request_id }));
      if (paid?.paid) result.claims_paid += 1;
      else result.skipped += 1;
    } catch (err) {
      result.errors.push({ subOrderId: due.sub_order_id, message: err.message });
      logger.error?.(`[returnProtection] claim failed for sub-order ${due.sub_order_id}: ${err.message}`);
    }
  }

  for (const subOrderId of await repo.listPremiumDue(db, rules.premium_batch)) {
    try {
      const outcome = await chargePremium(db, subOrderId);
      if (outcome === 'charged') result.premiums_charged += 1;
      else result.skipped += 1;
    } catch (err) {
      result.errors.push({ subOrderId, message: err.message });
      logger.error?.(`[returnProtection] premium failed for sub-order ${subOrderId}: ${err.message}`);
    }
  }
  return result;
}

/**
 * The refund path's way in. The claim runs inside a savepoint so that a failure undoes only the claim:
 * the buyer's refund must never be held up by the saler's compensation. A claim that fails here is paid
 * later by the job's claim sweep (settleDue), which finds refunded returns whose cover is still ACTIVE.
 */
export async function payClaimSafely(client, args, logger = console) {
  await client.query('SAVEPOINT return_protection_claim');
  try {
    const result = await payClaim(client, args);
    await client.query('RELEASE SAVEPOINT return_protection_claim');
    return result;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT return_protection_claim');
    logger.error?.(`[returnProtection] claim for sub-order ${args.subOrderId} deferred to the sweep: ${err.message}`);
    return null;
  }
}
