/**
 * volumeIncentive.service.js — A supplier-funded monthly rebate for the salers who sell the most.
 *
 * How it works: a supplier publishes tiers ("sell 50,000 of mine in a month -> 1% back"). When a
 * month closes, and `settle_lag_days` later so returns have landed, the job pays each qualifying
 * saler from the SUPPLIER's wallet. The platform keeps `platform_fee_pct` of every rebate - that is
 * how it earns from this, without touching the order's own profit split.
 *
 * Invariants:
 *   1. A programme is versioned, never edited in place. A change takes effect on the first day of
 *      the NEXT month, so no saler is moved onto worse tiers part-way through a month. (A supplier's
 *      very first programme may start this month: that can only help salers.)
 *   2. A payout is judged against the tiers in force at the START of its month, and those tiers are
 *      snapshotted on the payout row.
 *   3. One payout per supplier x saler x month (unique key), amounts fixed when it is created. Running
 *      the job twice pays nothing twice; a late return after creation does not re-price it.
 *   4. The money moves as ONE balanced ledger group - supplier DEBIT = saler CREDIT + treasury
 *      CREDIT - with the supplier's wallet locked, and never leaves it negative. A supplier who
 *      cannot cover it leaves the payout UNFUNDED; it is retried for `funding_retry_days`, then LAPSED.
 *   5. Every number comes from the `supplier.volume_incentive` platform_settings row. The defaults
 *      below only apply while that row is absent or unreadable.
 *
 * All money arithmetic is integer paisa. The pure functions (`validateTiers`, `pickTier`,
 * `computeRebate`, `duePeriods`) are tested without a database.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import * as repo from '../repositories/volumeIncentive.repository.js';
import * as scorecardRepo from '../repositories/supplierScorecard.repository.js';

const GRADES = ['A', 'B', 'C', 'D'];
const CATCH_UP_MONTHS = 3;

export const DEFAULT_RULES = Object.freeze({
  max_rebate_pct: 5,
  max_tiers: 4,
  min_threshold: 5000,
  platform_fee_pct: 10,
  settle_lag_days: 7,
  funding_retry_days: 7,
  blocked_grades: Object.freeze(['D']),
  timezone: 'Asia/Dhaka',
});

const toPaisa = (v) => Math.round(Number(v) * 100);
const fromPaisa = (p) => (p / 100).toFixed(2);

/**
 * Merges a stored rules object over the defaults, field by field. A malformed field falls back to
 * its default rather than failing: one bad edit must not stop every rebate from being paid.
 */
export function resolveRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_RULES;
  const int = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
  const dec = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback);

  return {
    max_rebate_pct: dec(r.max_rebate_pct, 0.01, 50, d.max_rebate_pct),
    max_tiers: int(r.max_tiers, 1, 10, d.max_tiers),
    min_threshold: dec(r.min_threshold, 1, 100000000, d.min_threshold),
    // WHY capped at 50: above that the saler would receive less than the platform keeps, and the
    // incentive would stop being one.
    platform_fee_pct: dec(r.platform_fee_pct, 0, 50, d.platform_fee_pct),
    settle_lag_days: int(r.settle_lag_days, 0, 60, d.settle_lag_days),
    funding_retry_days: int(r.funding_retry_days, 0, 60, d.funding_retry_days),
    blocked_grades: Array.isArray(r.blocked_grades)
      ? [...new Set(r.blocked_grades.filter((g) => GRADES.includes(g)))]
      : [...d.blocked_grades],
    timezone: typeof r.timezone === 'string' && r.timezone.trim() ? r.timezone.trim() : d.timezone,
  };
}

export async function loadRules(db) {
  try {
    return resolveRules(await repo.getRulesRow(db));
  } catch {
    return resolveRules(null);
  }
}

function invalid(en, bn) {
  return new AppError('VALIDATION_FAILED', en, bn);
}

/**
 * Pure. Checks a supplier's tiers against the platform rules and returns them normalised and sorted.
 * Strict: out-of-range input is refused, never clamped, so what a supplier saves is what salers see.
 */
export function validateTiers(input, rules) {
  if (!Array.isArray(input) || input.length === 0) {
    throw invalid('Add at least one tier.', 'কমপক্ষে একটি টিয়ার যোগ করুন।');
  }
  if (input.length > rules.max_tiers) {
    throw invalid(`A programme can have at most ${rules.max_tiers} tiers.`, `একটি প্রোগ্রামে সর্বোচ্চ ${rules.max_tiers}টি টিয়ার থাকতে পারে।`);
  }

  const tiers = input.map((t) => ({ min_volume: Number(t?.min_volume), rebate_pct: Number(t?.rebate_pct) }));
  for (const t of tiers) {
    if (!Number.isFinite(t.min_volume) || !Number.isFinite(t.rebate_pct)) {
      throw invalid('Every tier needs a monthly volume and a rebate percentage.', 'প্রতিটি টিয়ারে মাসিক ভলিউম ও রিবেট শতাংশ দিতে হবে।');
    }
    if (t.min_volume < rules.min_threshold) {
      throw invalid(
        `A tier must start at ৳${rules.min_threshold} a month or more.`,
        `টিয়ার মাসে ৳${rules.min_threshold} বা তার বেশি থেকে শুরু হতে হবে।`
      );
    }
    if (t.rebate_pct <= 0 || t.rebate_pct > rules.max_rebate_pct) {
      throw invalid(
        `A rebate must be above 0% and at most ${rules.max_rebate_pct}%.`,
        `রিবেট ০% এর বেশি এবং সর্বোচ্চ ${rules.max_rebate_pct}% হতে হবে।`
      );
    }
    // WHY two decimals: paisa precision is the ledger's; a finer percentage would round differently
    // for the supplier's preview and the actual payout.
    if (Math.abs(t.rebate_pct * 100 - Math.round(t.rebate_pct * 100)) > 1e-6) {
      throw invalid('Use at most two decimal places for a percentage.', 'শতাংশে সর্বোচ্চ দুই দশমিক ঘর ব্যবহার করুন।');
    }
    if (Math.abs(t.min_volume * 100 - Math.round(t.min_volume * 100)) > 1e-6) {
      throw invalid('Use at most two decimal places for a volume.', 'ভলিউমে সর্বোচ্চ দুই দশমিক ঘর ব্যবহার করুন।');
    }
  }

  tiers.sort((a, b) => a.min_volume - b.min_volume);
  for (let i = 1; i < tiers.length; i++) {
    // WHY both must rise: a higher volume paying a lower rebate would punish the saler who sold more.
    if (tiers[i].min_volume <= tiers[i - 1].min_volume || tiers[i].rebate_pct <= tiers[i - 1].rebate_pct) {
      throw invalid(
        'Each higher tier needs both a larger volume and a larger rebate.',
        'প্রতিটি উঁচু টিয়ারে ভলিউম ও রিবেট দুটোই আগেরটির চেয়ে বেশি হতে হবে।'
      );
    }
  }
  return tiers;
}

/** Pure. The highest tier a volume reaches, or null. Tiers are read as stored, in any order. */
export function pickTier(volume, tiers) {
  const v = Number(volume);
  if (!Array.isArray(tiers) || !Number.isFinite(v)) return null;
  let best = null;
  for (const t of tiers) {
    if (v >= Number(t.min_volume) && (!best || Number(t.min_volume) > Number(best.min_volume))) best = t;
  }
  return best;
}

/** Pure. The tier after the one reached (the saler's next goal), or null at the top. */
export function nextTier(volume, tiers) {
  const v = Number(volume);
  const above = (tiers || []).filter((t) => Number(t.min_volume) > v).sort((a, b) => a.min_volume - b.min_volume);
  return above[0] || null;
}

/**
 * Pure. Splits a rebate into what the saler receives and what the platform keeps, in integer paisa so
 * the two always add back to the gross. Rounds the platform's share, so the saler never gets less
 * than gross - fee by a rounding quirk.
 */
export function computeRebate({ volume, rebatePct, platformFeePct }) {
  const gross = Math.round((toPaisa(volume) * Number(rebatePct)) / 100);
  const fee = Math.round((gross * Number(platformFeePct)) / 100);
  return { gross: fromPaisa(gross), fee: fromPaisa(fee), net: fromPaisa(gross - fee), grossPaisa: gross, feePaisa: fee, netPaisa: gross - fee };
}

// ---- calendar (all 'YYYY-MM-DD' strings; the SQL layer supplies "today" in the platform timezone) --------

const ymd = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Pure. First day of the month `delta` months from the month containing `monthStart`. */
export function addMonths(monthStart, delta) {
  const [y, m] = monthStart.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return ymd(Math.floor(idx / 12), (idx % 12) + 1, 1);
}

/** Pure. Last day (inclusive) of the month starting at `monthStart`. */
export function monthEnd(monthStart) {
  const next = addMonths(monthStart, 1);
  const t = new Date(`${next}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const t = new Date(`${dateStr}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * Pure. The recent months that are ready to settle: a month is due once `settle_lag_days` have passed
 * after its last day. Looks back `CATCH_UP_MONTHS` so a job that was off for a while still catches up;
 * the unique payout key means re-visiting an already-settled month is harmless.
 */
export function duePeriods({ today, monthStart }, rules) {
  const out = [];
  for (let back = CATCH_UP_MONTHS; back >= 1; back--) {
    const start = addMonths(monthStart, -back);
    const end = monthEnd(start);
    if (today >= addDays(end, 1 + rules.settle_lag_days)) out.push({ start, end });
  }
  return out;
}

// ---- supplier side ----------------------------------------------------------------------------------------

async function supplierGrade(db, supplierId) {
  try {
    return (await scorecardRepo.findOne(db, supplierId))?.grade ?? null;
  } catch {
    // WHY swallow: before migration 062 there is no table; an ungraded supplier is never blocked.
    return null;
  }
}

/** A supplier's programme as they manage it: what is live now, what is queued, and what it has cost. */
export async function getSupplierView(db, supplierId) {
  const rules = await loadRules(db);
  const cal = await repo.getLocalCalendar(db, rules.timezone);
  const versions = await repo.listVersions(db, supplierId);
  const current = versions.find((v) => v.valid_from <= cal.today) || null;
  const upcoming = versions.filter((v) => v.valid_from > cal.today).sort((a, b) => a.valid_from.localeCompare(b.valid_from))[0] || null;

  // What this month is on course to cost, so the supplier can keep enough in their wallet.
  let projected = { qualifying_salers: 0, projected_rebate: '0.00', gross_volume: '0.00' };
  if (current?.is_active) {
    const rows = await repo.volumeBySaler(db, {
      supplierIds: [supplierId], periodStart: cal.month_start, periodEnd: monthEnd(cal.month_start), timezone: rules.timezone,
    });
    let grossPaisa = 0;
    let qualifying = 0;
    let volumePaisa = 0;
    for (const row of rows) {
      volumePaisa += toPaisa(row.volume);
      const tier = pickTier(row.volume, current.tiers_json);
      if (!tier) continue;
      qualifying += 1;
      grossPaisa += computeRebate({ volume: row.volume, rebatePct: tier.rebate_pct, platformFeePct: rules.platform_fee_pct }).grossPaisa;
    }
    projected = { qualifying_salers: qualifying, projected_rebate: fromPaisa(grossPaisa), gross_volume: fromPaisa(volumePaisa) };
  }

  return {
    rules: publicRules(rules),
    current,
    upcoming,
    projected,
    payouts: await repo.listPayoutsForSupplier(db, supplierId),
    grade: await supplierGrade(db, supplierId),
  };
}

/** The rules a supplier needs to fill in the form - never the whole settings row. */
function publicRules(rules) {
  return {
    max_rebate_pct: rules.max_rebate_pct,
    max_tiers: rules.max_tiers,
    min_threshold: rules.min_threshold,
    platform_fee_pct: rules.platform_fee_pct,
    settle_lag_days: rules.settle_lag_days,
  };
}

/**
 * Saves a supplier's programme as a new version. Throws on invalid tiers or a blocked grade.
 * @returns {Promise<object>} the version written (its `valid_from` says when salers will see it)
 */
export async function saveProgram(db, { supplierId, isActive, tiers, actor = null }) {
  const rules = await loadRules(db);

  const grade = await supplierGrade(db, supplierId);
  // WHY only when switching ON: a blocked supplier must still be able to pause what they already run.
  if (isActive && grade != null && rules.blocked_grades.includes(grade)) {
    throw new AppError(
      'SUPPLIER_GRADE_BLOCKED',
      `Suppliers graded ${grade} on the Supplier Scorecard cannot run a volume incentive. Improve your scorecard and try again.`,
      `সাপ্লায়ার স্কোরকার্ডে ${grade} গ্রেডের সাপ্লায়াররা ভলিউম ইনসেনটিভ চালাতে পারেন না। স্কোরকার্ড উন্নত করে আবার চেষ্টা করুন।`
    );
  }

  // A paused programme keeps its tiers only for the record; it still has to be well-formed.
  const clean = isActive || (Array.isArray(tiers) && tiers.length) ? validateTiers(tiers, rules) : [];

  const cal = await repo.getLocalCalendar(db, rules.timezone);
  const versions = await repo.listVersions(db, supplierId);
  // WHY this month only for a first programme: it can only help salers. Any later change waits for
  // the next month, so nobody is moved onto worse tiers while a month is running.
  const validFrom = versions.length === 0 ? cal.month_start : addMonths(cal.month_start, 1);

  const before = versions[0] || null;
  const saved = await repo.upsertVersion(db, { supplierId, validFrom, isActive: Boolean(isActive), tiers: clean, createdBy: actor ?? supplierId });
  await writeAudit(db, {
    action: 'supplier.volume_incentive.save',
    targetType: 'volume_incentive_program',
    targetRef: String(saved.id),
    before: before ? { valid_from: before.valid_from, is_active: before.is_active, tiers: before.tiers_json } : null,
    after: { valid_from: saved.valid_from, is_active: saved.is_active, tiers: saved.tiers_json },
    actorId: actor ?? supplierId,
  });
  return saved;
}

// ---- saler side -------------------------------------------------------------------------------------------

/** A saler's standing against every supplier they sold for this month, plus what they have been paid. */
export async function getSalerView(db, salerId) {
  const rules = await loadRules(db);
  const cal = await repo.getLocalCalendar(db, rules.timezone);
  const end = monthEnd(cal.month_start);
  const volumes = await repo.volumeForSaler(db, { salerId, periodStart: cal.month_start, periodEnd: end, timezone: rules.timezone });
  const versions = await repo.versionsInForce(db, cal.today, volumes.map((v) => v.supplier_id));
  const byId = new Map(versions.map((v) => [String(v.supplier_id), v]));

  const names = volumes.length
    ? (await db.query(
        `SELECT user_id, COALESCE(NULLIF(display_name, ''), NULLIF(full_name, ''), 'Supplier') AS name
           FROM user_profiles WHERE user_id = ANY($1::bigint[])`,
        [volumes.map((v) => v.supplier_id)]
      )).rows
    : [];
  const nameOf = new Map(names.map((n) => [String(n.user_id), n.name]));

  const programs = [];
  for (const row of volumes) {
    const version = byId.get(String(row.supplier_id));
    if (!version?.is_active) continue;
    const tier = pickTier(row.volume, version.tiers_json);
    const next = nextTier(row.volume, version.tiers_json);
    programs.push({
      supplier_id: row.supplier_id,
      supplier_name: nameOf.get(String(row.supplier_id)) || 'Supplier',
      volume: Number(row.volume).toFixed(2),
      tiers: version.tiers_json,
      current_tier: tier,
      next_tier: next,
      remaining_to_next: next ? (Number(next.min_volume) - Number(row.volume)).toFixed(2) : null,
      // What it would pay if the month closed now, after the platform's share.
      on_course: tier ? computeRebate({ volume: row.volume, rebatePct: tier.rebate_pct, platformFeePct: rules.platform_fee_pct }).net : '0.00',
    });
  }
  programs.sort((a, b) => Number(b.volume) - Number(a.volume));

  return { period: { start: cal.month_start, end }, programs, payouts: await repo.listPayoutsForSaler(db, salerId) };
}

// ---- settlement (the monthly job) -------------------------------------------------------------------------

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
 * Pays one payout inside its own transaction. Never throws for a short balance: it reports
 * `UNFUNDED` so the sweep can retry later, and one supplier cannot hold up the rest.
 * @returns {Promise<'PAID'|'ALREADY_SETTLED'|'UNFUNDED'|'LAPSED'>}
 */
export async function payOne(db, payoutId, rules, today) {
  return withTransaction(db, async (client) => {
    const payout = await repo.lockPayout(client, payoutId);
    if (!payout || payout.status !== 'UNFUNDED') return 'ALREADY_SETTLED';

    const supplierWallet = await walletRepo.getOrCreateWallet(client, payout.supplier_id, { client });
    const salerWallet = await walletRepo.getOrCreateWallet(client, payout.saler_id, { client });
    const treasuryWallet = await walletRepo.getOrCreateWallet(client, await treasuryUserId(client), { client });

    const [locked] = await walletRepo.getWalletsByIdsForUpdate(client, [supplierWallet.id]);
    const grossPaisa = toPaisa(payout.gross_amount);
    if (toPaisa(locked.available_balance) < grossPaisa) {
      const periodEnd = typeof payout.period_end === 'string' ? payout.period_end : payout.period_end.toISOString().slice(0, 10);
      const lapseOn = addDays(periodEnd, 1 + rules.settle_lag_days + rules.funding_retry_days);
      if (today > lapseOn) {
        await repo.markLapsed(client, payout.id);
        return 'LAPSED';
      }
      return 'UNFUNDED';
    }

    const txnGroupId = randomUUID();
    const feePaisa = toPaisa(payout.platform_fee);
    const entries = [
      { walletId: supplierWallet.id, entryType: 'DEBIT', amount: payout.gross_amount, balanceBucket: 'AVAILABLE', idempotencyKey: `volume_incentive:${payout.id}:debit` },
      { walletId: salerWallet.id, entryType: 'CREDIT', amount: payout.net_amount, balanceBucket: 'AVAILABLE', idempotencyKey: `volume_incentive:${payout.id}:saler` },
    ];
    if (feePaisa > 0) {
      entries.push({ walletId: treasuryWallet.id, entryType: 'CREDIT', amount: payout.platform_fee, balanceBucket: 'AVAILABLE', idempotencyKey: `volume_incentive:${payout.id}:fee` });
    }
    await ledgerService.recordTransactionGroup(client, {
      txnGroupId,
      entries,
      defaultCategory: 'VOLUME_INCENTIVE',
      defaultReferenceType: 'volume_incentive_payouts',
      defaultReferenceId: payout.id,
      memo: `Volume incentive ${payout.rebate_pct}% on ৳${payout.volume} sold in ${String(payout.period_start).slice(0, 7)}`,
    });
    await repo.markPaid(client, payout.id, txnGroupId);
    return 'PAID';
  });
}

/**
 * Creates the payout rows for every month that is now due, then tries to pay everything still open
 * (this month's new rows and any earlier UNFUNDED ones). Safe to run as often as the scheduler likes.
 */
export async function settleDue(db, logger = console) {
  const rules = await loadRules(db);
  const cal = await repo.getLocalCalendar(db, rules.timezone);
  const result = { created: 0, paid: 0, unfunded: 0, lapsed: 0, errors: [] };

  for (const period of duePeriods({ today: cal.today, monthStart: cal.month_start }, rules)) {
    const versions = (await repo.versionsInForce(db, period.start)).filter((v) => v.is_active && v.tiers_json?.length);
    if (!versions.length) continue;
    const tiersBySupplier = new Map(versions.map((v) => [String(v.supplier_id), v.tiers_json]));

    const volumes = await repo.volumeBySaler(db, {
      supplierIds: versions.map((v) => v.supplier_id), periodStart: period.start, periodEnd: period.end, timezone: rules.timezone,
    });
    for (const row of volumes) {
      const tiers = tiersBySupplier.get(String(row.supplier_id));
      const tier = pickTier(row.volume, tiers);
      if (!tier) continue;
      const money = computeRebate({ volume: row.volume, rebatePct: tier.rebate_pct, platformFeePct: rules.platform_fee_pct });
      if (money.netPaisa <= 0) continue;
      const made = await repo.insertPayoutIfAbsent(db, {
        supplierId: row.supplier_id, salerId: row.saler_id, periodStart: period.start, periodEnd: period.end,
        volume: Number(row.volume).toFixed(2), rebatePct: tier.rebate_pct,
        gross: money.gross, fee: money.fee, net: money.net, tiers,
      });
      if (made) result.created += 1;
    }
  }

  for (const open of await repo.listOpenPayouts(db)) {
    try {
      const outcome = await payOne(db, open.id, rules, cal.today);
      if (outcome === 'PAID') result.paid += 1;
      else if (outcome === 'UNFUNDED') result.unfunded += 1;
      else if (outcome === 'LAPSED') result.lapsed += 1;
    } catch (err) {
      // WHY keep going: a failure on one payout must not stop the others being paid.
      result.errors.push({ payoutId: open.id, message: err.message });
      logger.error?.(`[volumeIncentive] payout #${open.id} failed: ${err.message}`);
    }
  }
  return result;
}
