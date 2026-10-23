/**
 * partnerReward.service.ts — the monthly shop partner reward pool (Phase B; migrations 085 and 086).
 *
 * A shop partner is an advertiser, not a shopkeeper. They earn nothing per sale; every month the
 * PARTNER_REWARD_POOL wallet is shared out to them by score:
 *
 *   pool    = what partner-brought sales escrowed to it (released by now)
 *           + `ad_revenue_share_pct` of the month's ad revenue (moved from the treasury at close)
 *   points  = for each factor f:  weight_f x (partner's value_f / every partner's value_f)
 *   score   = sum of points; a factor nobody scored on is left out, so its weight goes to the others
 *   payout  = floor(pool x score / sum of scores), in paisa; the leftover paisa stay in the pool
 *
 * The factors, in the owner's order of weight (2026-10-23): store sales > social shares > community
 * posts > activity. Every number is the `partner_reward.rules` setting; bounds are RULE_LIMITS below.
 *
 * WHY shares and not fixed taka per action: the pool is a fixed sum, so a partner's pay must be their
 * part of what all partners did. A month where everyone shares more pays the same total, divided by
 * who did the most, which is what makes it a ranking and not an open-ended bonus.
 */

import { randomUUID } from 'node:crypto';
import { AppError } from '../plugins/errorHandler.ts';
import { withTransaction } from '../config/db.ts';
import * as repo from '../repositories/partnerReward.repository.ts';
import * as settingRepo from '../repositories/setting.repository.ts';
import * as walletRepo from '../repositories/wallet.repository.ts';
import * as ledgerService from './ledger.service.ts';
import { resolvePartnerPoolWalletId, resolvePlatformWalletId } from './vault.service.ts';
import { writeAudit } from '../lib/audit.ts';

export const FACTORS = Object.freeze(['sales', 'social', 'community', 'activity'] as const);
type Factor = (typeof FACTORS)[number];

export const MIN_REASON_LENGTH = 10;

/** The one place the bounds live; the admin page draws its inputs from what the API returns. */
export const RULE_LIMITS = Object.freeze({
  weight: { min: 0, max: 100, total: 100 },
  ad_revenue_share_pct: { min: 0, max: 100 },
  community_point: { min: 0, max: 20 },
  max_posts_per_day: { min: 1, max: 50 },
  settle_lag_days: { min: 0, max: 28 },
});

export const DEFAULT_RULES = Object.freeze({
  weights: Object.freeze({ sales: 40, social: 25, community: 20, activity: 15 }),
  ad_revenue_share_pct: 20,
  community_points: Object.freeze({ post: 3, like: 1, comment: 2, save: 2 }),
  max_posts_per_day: 3,
  settle_lag_days: 7,
  timezone: 'Asia/Dhaka',
  first_month: null as string | null,
});

const COMMUNITY_KEYS = ['post', 'like', 'comment', 'save'] as const;
const toPaisa = (v) => Math.round(Number(v) * 100);
const fromPaisa = (p) => (p / 100).toFixed(2);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function weightsValid(w) {
  if (!w || typeof w !== 'object') return false;
  const L = RULE_LIMITS.weight;
  if (!FACTORS.every((f) => isInt(w[f], L.min, L.max))) return false;
  if (FACTORS.reduce((s, f) => s + w[f], 0) !== L.total) return false;
  // The owner's order: a sale is worth at least a share, a share at least a post, a post at least a day.
  return w.sales >= w.social && w.social >= w.community && w.community >= w.activity;
}

function validTimezone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Forgiving read: a malformed field falls back to its default, field by field, so one bad edit can
 * never stop a month from closing. Writes go through validateRules, which refuses instead.
 */
export function resolveRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_RULES;
  const L = RULE_LIMITS;
  const cp = r.community_points && typeof r.community_points === 'object' ? r.community_points : {};
  return {
    weights: weightsValid(r.weights) ? { ...r.weights } : { ...d.weights },
    ad_revenue_share_pct: isNum(r.ad_revenue_share_pct, L.ad_revenue_share_pct.min, L.ad_revenue_share_pct.max)
      ? r.ad_revenue_share_pct
      : d.ad_revenue_share_pct,
    community_points: Object.fromEntries(
      COMMUNITY_KEYS.map((k) => [k, isInt(cp[k], L.community_point.min, L.community_point.max) ? cp[k] : d.community_points[k]])
    ),
    max_posts_per_day: isInt(r.max_posts_per_day, L.max_posts_per_day.min, L.max_posts_per_day.max) ? r.max_posts_per_day : d.max_posts_per_day,
    settle_lag_days: isInt(r.settle_lag_days, L.settle_lag_days.min, L.settle_lag_days.max) ? r.settle_lag_days : d.settle_lag_days,
    timezone: validTimezone(r.timezone) ? r.timezone.trim() : d.timezone,
    first_month: typeof r.first_month === 'string' && /^\d{4}-\d{2}-01$/.test(r.first_month) ? r.first_month : d.first_month,
  };
}

/** Strict write check: anything out of bounds is refused, never clamped. Returns the editable fields. */
export function validateRules(input: Record<string, any> = {}) {
  const fail = (field, en, bn) => {
    throw new AppError('VALIDATION_FAILED', en, bn, { field });
  };
  const L = RULE_LIMITS;
  const w = input.weights;
  if (!w || typeof w !== 'object' || !FACTORS.every((f) => isInt(w[f], L.weight.min, L.weight.max))) {
    fail('weights', 'Each weight must be a whole number from 0 to 100.', 'প্রতিটি weight 0 থেকে 100 এর মধ্যে পূর্ণ সংখ্যা হতে হবে।');
  }
  if (FACTORS.reduce((s, f) => s + w[f], 0) !== L.weight.total) {
    fail('weights', 'The four weights must add up to 100.', 'চারটি weight এর যোগফল 100 হতে হবে।');
  }
  if (!(w.sales >= w.social && w.social >= w.community && w.community >= w.activity)) {
    fail('weights', 'Keep the order: store sales ≥ social shares ≥ community posts ≥ activity.',
      'ক্রম ঠিক রাখুন: store sale ≥ social share ≥ community post ≥ activity।');
  }
  if (!isNum(input.ad_revenue_share_pct, L.ad_revenue_share_pct.min, L.ad_revenue_share_pct.max)
      || Math.round(input.ad_revenue_share_pct * 100) !== input.ad_revenue_share_pct * 100) {
    fail('ad_revenue_share_pct', 'The ad revenue share must be from 0 to 100, with at most two decimals.',
      'বিজ্ঞাপন আয়ের অংশ 0 থেকে 100 এর মধ্যে হতে হবে, সর্বোচ্চ দুই দশমিক ঘর।');
  }
  const cp = input.community_points;
  if (!cp || typeof cp !== 'object' || !COMMUNITY_KEYS.every((k) => isInt(cp[k], L.community_point.min, L.community_point.max))) {
    fail('community_points', `Community points must be whole numbers from ${L.community_point.min} to ${L.community_point.max}.`,
      `Community point ${L.community_point.min} থেকে ${L.community_point.max} এর মধ্যে পূর্ণ সংখ্যা হতে হবে।`);
  }
  if (!isInt(input.max_posts_per_day, L.max_posts_per_day.min, L.max_posts_per_day.max)) {
    fail('max_posts_per_day', `Posts counted per day must be from ${L.max_posts_per_day.min} to ${L.max_posts_per_day.max}.`,
      `দিনে গোনা post ${L.max_posts_per_day.min} থেকে ${L.max_posts_per_day.max} এর মধ্যে হতে হবে।`);
  }
  if (!isInt(input.settle_lag_days, L.settle_lag_days.min, L.settle_lag_days.max)) {
    fail('settle_lag_days', `The closing delay must be from ${L.settle_lag_days.min} to ${L.settle_lag_days.max} days.`,
      `মাস বন্ধের অপেক্ষা ${L.settle_lag_days.min} থেকে ${L.settle_lag_days.max} দিনের মধ্যে হতে হবে।`);
  }
  return {
    weights: Object.fromEntries(FACTORS.map((f) => [f, w[f]])),
    ad_revenue_share_pct: input.ad_revenue_share_pct,
    community_points: Object.fromEntries(COMMUNITY_KEYS.map((k) => [k, cp[k]])),
    max_posts_per_day: input.max_posts_per_day,
    settle_lag_days: input.settle_lag_days,
  };
}

export async function loadRules(db) {
  const row = await repo.getRulesRow(db);
  return resolveRules(row?.value_json);
}

// ---- pure scoring ---------------------------------------------------------------------------------------

/** Pure. A partner's community value from raw counts and the configured points. */
export function communityValue(c, points) {
  if (!c) return 0;
  return c.posts * points.post + c.likes * points.like + c.comments * points.comment + c.saves * points.save;
}

/**
 * Pure. Scores partners and splits `poolPaisa` between them.
 *
 * @param {Array<{ salerId: number, values: Record<Factor, number> }>} partners
 * @param {Record<Factor, number>} weights
 * @param {number} poolPaisa
 * @returns {{ rows: Array<{ salerId, values, points, score, sharePct, amountPaisa }>, totals, paidPaisa, carriedPaisa }}
 */
export function computeShares(partners, weights, poolPaisa) {
  const totals = Object.fromEntries(FACTORS.map((f) => [f, partners.reduce((s, p) => s + Math.max(0, Number(p.values[f]) || 0), 0)]));
  const scored = partners.map((p) => {
    const points = Object.fromEntries(FACTORS.map((f) => {
      const v = Math.max(0, Number(p.values[f]) || 0);
      return [f, totals[f] > 0 ? (weights[f] * v) / totals[f] : 0];
    }));
    const score = FACTORS.reduce((s, f) => s + points[f], 0);
    return { salerId: p.salerId, values: p.values, points, score };
  });
  const scoreSum = scored.reduce((s, r) => s + r.score, 0);
  const pool = Math.max(0, Math.floor(poolPaisa));

  let rows = scored.map((r) => ({
    ...r,
    sharePct: scoreSum > 0 ? (r.score / scoreSum) * 100 : 0,
    // WHY the small epsilon: 1/3 x 3 in floating point can land a hair under a whole paisa and lose it.
    amountPaisa: scoreSum > 0 ? Math.floor((pool * r.score) / scoreSum + 1e-9) : 0,
  }));
  // Floors can never sum above the pool in exact arithmetic; this guard makes it true in floats too.
  let paid = rows.reduce((s, r) => s + r.amountPaisa, 0);
  while (paid > pool) {
    const top = rows.reduce((a, b) => (b.amountPaisa > a.amountPaisa ? b : a));
    top.amountPaisa -= 1;
    paid -= 1;
  }
  rows = rows.sort((a, b) => b.score - a.score || a.salerId - b.salerId);
  return { rows, totals, paidPaisa: paid, carriedPaisa: pool - paid };
}

// ---- calendar -------------------------------------------------------------------------------------------

const ymd = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Pure. First day of the month `delta` months from the month containing `monthStart`. */
export function addMonths(monthStart: string, delta: number) {
  const [y, m] = monthStart.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return ymd(Math.floor(idx / 12), (idx % 12) + 1, 1);
}

/** Pure. Last day (inclusive) of the month starting at `monthStart`. */
export function monthEnd(monthStart: string) {
  const t = new Date(`${addMonths(monthStart, 1)}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number) {
  const t = new Date(`${dateStr}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * Pure. The months to close now, oldest first: every ended month after the last closed one (or from
 * `first_month` when none is closed yet), once `settle_lag_days` have passed since it ended. A manual
 * close (`ignoreLag`) skips the wait but still only closes months that have ended.
 */
export function duePeriods({ today, monthStart, lastClosed, firstMonth, lagDays, ignoreLag = false }) {
  if (!firstMonth) return [];
  let start = lastClosed ? addMonths(lastClosed, 1) : firstMonth;
  if (start < firstMonth) start = firstMonth;
  const out = [];
  while (start < monthStart) {
    const end = monthEnd(start);
    if (!ignoreLag && today < addDays(end, 1 + lagDays)) break;
    out.push({ start, end });
    start = addMonths(start, 1);
  }
  return out;
}

// ---- measuring ------------------------------------------------------------------------------------------

/** Every eligible partner's four values for a period, plus the raw counts behind them. */
export async function measure(db, period, rules) {
  const p = { ...period, timezone: rules.timezone };
  // WHY one after another: at close this runs on the transaction's single client, which cannot run
  // queries side by side (pg queues them anyway and warns that it will stop doing so).
  const ids = await repo.listEligiblePartners(db);
  const sales = await repo.salesByPartner(db, p);
  const social = await repo.socialByPartner(db, p);
  const community = await repo.communityByPartner(db, p, rules.max_posts_per_day);
  const activity = await repo.activityByPartner(db, p);
  return ids.map((salerId) => {
    const c = community.get(salerId) ?? { posts: 0, likes: 0, comments: 0, saves: 0 };
    return {
      salerId,
      values: {
        sales: sales.get(salerId) ?? 0,
        social: social.get(salerId) ?? 0,
        community: communityValue(c, rules.community_points),
        activity: activity.get(salerId) ?? 0,
      },
      raw: { community: c },
    };
  });
}

// ---- closing a month ------------------------------------------------------------------------------------

/**
 * Closes one month: moves the ad share in, scores, pays, records. All of it in one transaction under
 * an advisory lock, and a month that already has a run is skipped, so the job and a manual close can
 * never pay a month twice.
 */
export async function closeMonth(db, { start, end }, rules, { triggeredBy = null }: { triggeredBy?: number | null } = {}) {
  return withTransaction(db, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('partner_reward_close'))`);
    if (await repo.findRunByPeriod(client, start)) return { start, skipped: true };

    const runId = await repo.insertRun(client, { periodStart: start, periodEnd: end, rules, triggeredBy });
    const poolWalletId = await resolvePartnerPoolWalletId(client);
    const treasuryWalletId = await resolvePlatformWalletId(client, client);
    const period = { start, end, timezone: rules.timezone };

    // 1. The ad share, treasury -> pool.
    const adRevenue = await repo.adRevenue(client, treasuryWalletId, period);
    const adSharePaisa = Math.floor((toPaisa(adRevenue) * rules.ad_revenue_share_pct) / 100);
    if (adSharePaisa > 0) {
      await ledgerService.recordTransactionGroup(client, {
        txnGroupId: randomUUID(),
        defaultCategory: 'PARTNER_REWARD',
        defaultReferenceType: 'partner_reward_runs',
        defaultReferenceId: runId,
        memo: `Ad revenue share for the partner reward pool, ${start}`,
        entries: [
          { walletId: treasuryWalletId, entryType: 'DEBIT', amount: fromPaisa(adSharePaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `partner_reward:${start}:ad_share:debit` },
          { walletId: poolWalletId, entryType: 'CREDIT', amount: fromPaisa(adSharePaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `partner_reward:${start}:ad_share:credit` },
        ],
      });
    }

    // 2. What the pool can pay: its released balance. Escrowed shares wait for next month.
    // WHY max(0): a clawback after an earlier payout can leave the pool below zero; it then pays nothing
    // until sales refill it, rather than paying partners with money it does not have.
    const pool = await walletRepo.getWalletByIdForUpdate(client, poolWalletId);
    const poolPaisa = Math.max(0, toPaisa(pool?.available_balance ?? 0));

    // 3. Score and split.
    const measured = await measure(client, { start, end }, rules);
    const { rows, totals, paidPaisa, carriedPaisa } = computeShares(measured, rules.weights, poolPaisa);
    const paying = rows.filter((r) => r.score > 0);
    const rawById = new Map(measured.map((m) => [m.salerId, m.raw]));

    // 4. One balanced group: the pool pays every partner.
    let txnGroupId = null;
    const credited = paying.filter((r) => r.amountPaisa > 0);
    if (credited.length) {
      txnGroupId = randomUUID();
      const entries: import('./ledger.service.ts').LedgerEntryInput[] = [
        { walletId: poolWalletId, entryType: 'DEBIT', amount: fromPaisa(paidPaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `partner_reward:${start}:pool` },
      ];
      for (const r of credited) {
        const w = await walletRepo.getOrCreateWallet(client, r.salerId, { client });
        entries.push({ walletId: w.id, entryType: 'CREDIT', amount: fromPaisa(r.amountPaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `partner_reward:${start}:saler:${r.salerId}` });
      }
      await ledgerService.recordTransactionGroup(client, {
        txnGroupId,
        defaultCategory: 'PARTNER_REWARD',
        defaultReferenceType: 'partner_reward_runs',
        defaultReferenceId: runId,
        memo: `Shop partner reward pool, ${start}`,
        entries,
      });
    }

    await repo.insertPayouts(client, runId, paying.map((r) => ({
      salerId: r.salerId,
      metrics: { ...r.values, community_counts: rawById.get(r.salerId)?.community },
      points: Object.fromEntries(FACTORS.map((f) => [f, Number(r.points[f].toFixed(4))])),
      score: Number(r.score.toFixed(4)),
      sharePct: Number(r.sharePct.toFixed(4)),
      amount: fromPaisa(r.amountPaisa),
    })));

    const summary = {
      adRevenue: adRevenue.toFixed(2),
      adShare: fromPaisa(adSharePaisa),
      poolAmount: fromPaisa(poolPaisa),
      paidAmount: fromPaisa(paidPaisa),
      carriedAmount: fromPaisa(carriedPaisa),
      partnersScored: paying.length,
      totals,
      txnGroupId,
    };
    await repo.finishRun(client, runId, summary);

    await writeAudit(client, {
      action: 'growth.partner_reward.close',
      actorId: triggeredBy,
      targetType: 'partner_reward_runs',
      targetRef: start,
      before: null,
      after: { period_start: start, ...summary },
      riskTier: 'CRITICAL',
    });
    return { start, skipped: false, runId, ...summary };
  });
}

/** Closes every due month. Used by the job (waits `settle_lag_days`) and the admin button (does not). */
export async function closeDueMonths(db, { triggeredBy = null, ignoreLag = false }: { triggeredBy?: number | null; ignoreLag?: boolean } = {}) {
  const rules = await loadRules(db);
  const cal = await repo.getLocalCalendar(db, rules.timezone);
  const last = await repo.latestRun(db);
  const periods = duePeriods({
    today: cal.today,
    monthStart: cal.month_start,
    lastClosed: last?.period_start_ymd ?? null,
    firstMonth: rules.first_month,
    lagDays: rules.settle_lag_days,
    ignoreLag,
  });
  const results = [];
  for (const period of periods) results.push(await closeMonth(db, period, rules, { triggeredBy }));
  return { rules, periods, results };
}

// ---- views ----------------------------------------------------------------------------------------------

/**
 * The month so far: the same scoring as a close, over today's numbers, against the pool as it would
 * stand if the month closed now (released balance + this month's ad share so far). An estimate only:
 * the rest of the month and every other partner move it.
 */
export async function estimateCurrentMonth(db, rules) {
  const cal = await repo.getLocalCalendar(db, rules.timezone);
  const period = { start: cal.month_start, end: cal.today };
  const poolWalletId = await resolvePartnerPoolWalletId(db);
  const treasuryWalletId = await resolvePlatformWalletId(db, db);
  const [balances, adRevenue, measured] = await Promise.all([
    repo.getPoolBalances(db, poolWalletId),
    repo.adRevenue(db, treasuryWalletId, { ...period, timezone: rules.timezone }),
    measure(db, period, rules),
  ]);
  const adSharePaisa = Math.floor((toPaisa(adRevenue) * rules.ad_revenue_share_pct) / 100);
  const poolPaisa = Math.max(0, toPaisa(balances.available)) + adSharePaisa;
  const shares = computeShares(measured, rules.weights, poolPaisa);
  return {
    period: { start: cal.month_start, end: monthEnd(cal.month_start), today: cal.today },
    closes_on: addDays(monthEnd(cal.month_start), 1 + rules.settle_lag_days),
    pool: {
      available: balances.available.toFixed(2),
      pending: balances.pending.toFixed(2),
      ad_revenue: adRevenue.toFixed(2),
      ad_share: fromPaisa(adSharePaisa),
      estimated: fromPaisa(poolPaisa),
    },
    shares,
    rawById: new Map(measured.map((m) => [m.salerId, m.raw])),
  };
}

const roundPoints = (points) => Object.fromEntries(FACTORS.map((f) => [f, Number((points[f] || 0).toFixed(2))]));

/** GET /saler/partner-reward: the caller's own estimate and history. Never another partner's numbers. */
export async function getOwnView(db, salerId) {
  const rules = await loadRules(db);
  const est = await estimateCurrentMonth(db, rules);
  const mine = est.shares.rows.find((r) => r.salerId === Number(salerId));
  const scoredCount = est.shares.rows.filter((r) => r.score > 0).length;
  const history = await repo.listPayoutsForSaler(db, salerId, 6);
  return {
    period: est.period,
    closes_on: est.closes_on,
    weights: rules.weights,
    pool_estimate: est.pool.estimated,
    partners_scored: scoredCount,
    values: mine?.values ?? { sales: 0, social: 0, community: 0, activity: 0 },
    community_counts: est.rawById.get(Number(salerId))?.community ?? { posts: 0, likes: 0, comments: 0, saves: 0 },
    points: roundPoints(mine?.points ?? {}),
    score: Number((mine?.score ?? 0).toFixed(2)),
    share_pct: Number((mine?.sharePct ?? 0).toFixed(2)),
    estimated_amount: fromPaisa(mine?.amountPaisa ?? 0),
    history: history.map((h) => ({ period_start: h.period_start, amount: h.amount, share_pct: Number(h.share_pct) })),
  };
}

/** GET /admin/growth/partner-rewards. */
export async function getAdminView(db, { page = 1, limit = 12 } = {}) {
  const row = await repo.getRulesRow(db);
  const rules = resolveRules(row?.value_json);
  const est = await estimateCurrentMonth(db, rules);
  const top = est.shares.rows.filter((r) => r.score > 0).slice(0, 10);
  const names = await repo.partnerNames(db, top.map((r) => r.salerId));
  const safeLimit = Math.min(Math.max(Number(limit) || 12, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const runs = await repo.listRuns(db, { limit: safeLimit, offset: (safePage - 1) * safeLimit });
  const cal = await repo.getLocalCalendar(db, rules.timezone);
  const last = await repo.latestRun(db);
  const closable = duePeriods({
    today: cal.today, monthStart: cal.month_start, lastClosed: last?.period_start_ymd ?? null,
    firstMonth: rules.first_month, lagDays: rules.settle_lag_days, ignoreLag: true,
  });
  return {
    policy: { ...rules, updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null },
    limits: RULE_LIMITS,
    preview: {
      period: est.period,
      closes_on: est.closes_on,
      pool: est.pool,
      partners_scored: est.shares.rows.filter((r) => r.score > 0).length,
      totals: est.shares.totals,
      top: top.map((r) => ({
        saler_id: r.salerId,
        name: names.get(r.salerId) ?? null,
        values: r.values,
        points: roundPoints(r.points),
        score: Number(r.score.toFixed(2)),
        share_pct: Number(r.sharePct.toFixed(2)),
        estimated_amount: fromPaisa(r.amountPaisa),
      })),
    },
    closable_periods: closable.map((p) => p.start),
    runs: { items: runs.items, total: runs.total, page: safePage, limit: safeLimit },
  };
}

export async function getRunPayouts(db, runId, { page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const res = await repo.listRunPayouts(db, runId, { limit: safeLimit, offset: (safePage - 1) * safeLimit });
  return { items: res.items, total: res.total, page: safePage, limit: safeLimit };
}

/** PUT /admin/growth/partner-rewards: strict, reasoned, audited; `first_month` and `timezone` are kept. */
export async function updateRules(db, { input, reason, userId = null, actorRole = null, expectedUpdatedAt = null, reqContext = {} as any }) {
  const next = validateRules(input);
  if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
    throw new AppError('VALIDATION_FAILED',
      `Give a reason of at least ${MIN_REASON_LENGTH} characters for this change.`,
      `এই পরিবর্তনের জন্য অন্তত ${MIN_REASON_LENGTH} অক্ষরের একটি কারণ লিখুন।`,
      { field: 'reason' });
  }
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT value_json, updated_at FROM platform_settings WHERE key = $1 FOR UPDATE`,
      [repo.RULES_KEY]
    );
    const before = resolveRules(rows[0]?.value_json);
    // WHY the stale check: two admins editing at once would otherwise have the second silently undo the first.
    if (expectedUpdatedAt && rows[0]?.updated_at && new Date(rows[0].updated_at).toISOString() !== new Date(expectedUpdatedAt).toISOString()) {
      throw new AppError('PRECONDITION_CHANGED',
        'Someone changed these rules after you opened the page. Reload and try again.',
        'আপনি page খোলার পরে কেউ এই নিয়ম বদলেছেন। Reload করে আবার চেষ্টা করুন।');
    }
    const after = { ...before, ...next };
    const saved = await settingRepo.upsertSetting(client, {
      key: repo.RULES_KEY,
      valueJson: after,
      valueType: 'OBJECT',
      labelEn: 'Shop partner reward pool rules',
      labelBn: 'শপ পার্টনার রিওয়ার্ড পুলের নিয়ম',
      groupKey: 'growth',
      updatedBy: userId,
    });
    await writeAudit(client, {
      action: 'growth.partner_reward.update',
      actorId: userId,
      actorRole,
      targetType: 'platform_settings',
      targetRef: repo.RULES_KEY,
      before,
      after,
      meta: { reason: reason.trim() },
      riskTier: 'CRITICAL',
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
    return { ...resolveRules(saved?.value_json ?? after), updated_at: saved?.updated_at ?? null };
  });
}
