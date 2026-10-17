/**
 * partnerScore.service.ts — the Partner Score: how much and how well a shop partner promotes.
 *
 * Earning by promotion, Phase B. Attribution (attribution.service.ts) decides WHICH partner a sale
 * belongs to; this decides how good a promoter each partner is, from the sales credited to them:
 * how much they deliver, how few of their buyers return or cancel, how many buyers come back, how
 * many are new to Explooro, and how well their links convert.
 *
 * Invariants (the same ones supplierScorecard.service.ts keeps):
 *   1. Fewer than `min_sample_orders` parcels in the window: no score, no band, multiplier 1.00
 *      ("New"). Three lucky orders must not outrank three hundred steady ones.
 *   2. A metric with no denominator is left out and the remaining weights re-scale to 100. It is
 *      never counted as 0 or as perfect.
 *   3. Every number comes from the `partner.score_rules` setting; the defaults below only apply
 *      while that row is absent or a field in it is malformed.
 *
 * The score moves no money in this phase. `multiplier` is stored for the earning engine (Phase C)
 * and shown to the partner so they can see what they are building towards.
 *
 * Scoring is a pure function (`scoreMetrics`) so the rule can be tested without a database.
 */

import * as repo from '../repositories/partnerScore.repository.ts';

// Order matters: it is the order the partner's breakdown lists them in.
export const METRICS = Object.freeze(['delivered_volume', 'return_rate', 'repeat_customers', 'new_customers', 'link_conversion', 'cancel_rate']);
const HIGHER_IS_BETTER = Object.freeze(['delivered_volume', 'repeat_customers', 'new_customers', 'link_conversion']);
const LOWER_IS_BETTER = Object.freeze(['return_rate', 'cancel_rate']);

// Where each metric's measured value lives on a measured/stored row.
const COLUMN = Object.freeze({
  delivered_volume: 'delivered_volume',
  return_rate: 'return_rate_pct',
  repeat_customers: 'repeat_customer_pct',
  new_customers: 'new_customer_pct',
  link_conversion: 'link_conversion_pct',
  cancel_rate: 'cancel_rate_pct',
});

// WHY multipliers may not go below 1 or above 2: the multiplier only ever adds to a partner's base
// earning. A weak promoter is answered by a low score and no bonus, never by being paid less than
// the base for a sale they did bring; and 2x caps how much platform margin one setting can give away.
export const MULTIPLIER_LIMITS = Object.freeze({ min: 1, max: 2 });

// Mirrors the migration 079 seed; only the fallback for a missing or malformed setting.
export const DEFAULT_RULES = Object.freeze({
  window_days: 60,
  min_sample_orders: 5,
  weights: Object.freeze({ delivered_volume: 35, return_rate: 20, repeat_customers: 15, new_customers: 15, link_conversion: 10, cancel_rate: 5 }),
  targets: Object.freeze({ delivered_volume: 100000, repeat_customers: 30, new_customers: 50, link_conversion: 5 }),
  penalty_ceilings: Object.freeze({ return_rate: 20, cancel_rate: 20 }),
  bands: Object.freeze([
    Object.freeze({ key: 'STARTER', min_score: 0, multiplier: 1.0 }),
    Object.freeze({ key: 'RISING', min_score: 40, multiplier: 1.05 }),
    Object.freeze({ key: 'PRO', min_score: 60, multiplier: 1.1 }),
    Object.freeze({ key: 'STAR', min_score: 80, multiplier: 1.2 }),
  ]),
});

const num = (v) => (v === null || v === undefined ? null : Number(v));
const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

function resolveBands(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_RULES.bands.map((b) => ({ ...b }));
  const bands = raw.map((b) => ({ key: String(b?.key || ''), min_score: Number(b?.min_score), multiplier: Number(b?.multiplier) }));
  const valid = bands.every((b, i) =>
    /^[A-Z_]{2,20}$/.test(b.key)
    && Number.isInteger(b.min_score) && b.min_score >= 0 && b.min_score <= 100
    && Number.isFinite(b.multiplier) && b.multiplier >= MULTIPLIER_LIMITS.min && b.multiplier <= MULTIPLIER_LIMITS.max
    && (i === 0 ? b.min_score === 0 : b.min_score > bands[i - 1].min_score && b.multiplier >= bands[i - 1].multiplier));
  // WHY all or nothing: a half-valid ladder (a gap, a band paying less than the one below) would
  // put partners in the wrong place; the shipped ladder is the safe answer until the edit is fixed.
  return valid ? bands : DEFAULT_RULES.bands.map((b) => ({ ...b }));
}

/**
 * Merges a stored rules object over the defaults, field by field. A malformed field falls back to
 * its default instead of failing the whole job: one bad edit must not stop every score refreshing.
 */
export function resolveRules(raw) {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_RULES;
  const int = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);

  let weights: Record<string, number> = { ...d.weights };
  if (r.weights && typeof r.weights === 'object') {
    const candidate: Record<string, number> = {};
    for (const k of METRICS) candidate[k] = Number(r.weights[k]);
    const sum = Object.values(candidate).reduce((a, b) => a + b, 0);
    // WHY refuse a set that does not sum to 100: the score is a percentage of the weights, so a set
    // summing to 80 would cap every partner at 80 and push everyone down a band.
    if (Object.values(candidate).every((n) => Number.isFinite(n) && n >= 0) && Math.round(sum) === 100) weights = candidate;
  }

  const targets: Record<string, number> = { ...d.targets };
  for (const k of Object.keys(targets)) {
    const v = Number(r.targets?.[k]);
    if (isPositive(v) && (k === 'delivered_volume' || v <= 100)) targets[k] = v;
  }

  const ceilings: Record<string, number> = { ...d.penalty_ceilings };
  for (const k of Object.keys(ceilings)) {
    const v = Number(r.penalty_ceilings?.[k]);
    if (isPositive(v) && v <= 100) ceilings[k] = v;
  }

  return {
    window_days: int(r.window_days, 7, 365, d.window_days),
    min_sample_orders: int(r.min_sample_orders, 1, 10000, d.min_sample_orders),
    weights,
    targets,
    penalty_ceilings: ceilings,
    bands: resolveBands(r.bands),
  };
}

export async function loadRules(db) {
  try {
    return resolveRules(await repo.getRulesRow(db));
  } catch {
    return resolveRules(null);
  }
}

/** 0..1, 1 is best. */
function fraction(metric, value, rules) {
  if (HIGHER_IS_BETTER.includes(metric)) return Math.max(0, Math.min(1, value / rules.targets[metric]));
  return Math.max(0, Math.min(1, 1 - value / rules.penalty_ceilings[metric]));
}

/** The highest band whose floor the score reaches. Bands are ascending and start at 0. */
export function bandFor(score, bands) {
  let band = bands[0];
  for (const b of bands) if (score >= b.min_score) band = b;
  return band;
}

/**
 * Pure. Measured metrics in, { score, band, multiplier, components } out. `components` carries,
 * per metric used, the points it could earn (its re-scaled weight) and the points it did earn,
 * which is what the partner's "why" breakdown shows.
 */
export function scoreMetrics(metrics, rules) {
  const unscored = { score: null, band: null, multiplier: MULTIPLIER_LIMITS.min, components: {} };
  if (!metrics || Number(metrics.sample_orders) < rules.min_sample_orders) return unscored;

  const used = METRICS
    .map((k) => [k, num(metrics[COLUMN[k]])] as [string, number | null])
    .filter(([k, v]) => v !== null && Number.isFinite(v) && rules.weights[k] > 0);
  const weightSum = used.reduce((sum, [k]) => sum + rules.weights[k], 0);
  if (used.length === 0 || weightSum === 0) return unscored;

  const components: Record<string, { max: number; earned: number }> = {};
  let earned = 0;
  for (const [k, v] of used) {
    const max = (rules.weights[k] / weightSum) * 100;
    const got = max * fraction(k, v, rules);
    earned += got;
    components[k] = { max: Math.round(max * 10) / 10, earned: Math.round(got * 10) / 10 };
  }
  const score = Math.round(earned);
  const band = bandFor(score, rules.bands);
  return { score, band: band.key, multiplier: band.multiplier, components };
}

/**
 * Rebuilds every partner's snapshot from live orders. Returns what it did for job_runs. Partners
 * with no parcels left in the window lose their row, so a stale score cannot outlive its evidence.
 */
export async function refreshAll(db) {
  const rules = await loadRules(db);
  const measured = await repo.measurePartners(db, { windowDays: rules.window_days });

  let scored = 0;
  for (const m of measured) {
    const result = scoreMetrics(m, rules);
    if (result.score !== null) scored += 1;
    await repo.upsertScore(db, {
      saler_id: m.saler_id,
      window_days: rules.window_days,
      sample_orders: m.sample_orders,
      delivered_volume: m.delivered_volume,
      return_rate_pct: m.return_rate_pct,
      cancel_rate_pct: m.cancel_rate_pct,
      repeat_customer_pct: m.repeat_customer_pct,
      new_customer_pct: m.new_customer_pct,
      link_conversion_pct: m.link_conversion_pct,
      score: result.score,
      band: result.band,
      multiplier: result.multiplier.toFixed(2),
      components: result.components,
    });
  }
  const removed = await repo.deleteExcept(db, measured.map((m) => m.saler_id));
  return { partners: measured.length, scored, removed, rules };
}

/**
 * The metric with the most points still to win, so the partner is told one concrete thing to work
 * on rather than six numbers. Null when every metric is at full marks (or nothing is scored).
 */
export function biggestGap(components) {
  let best = null;
  for (const [metric, c] of Object.entries(components || {}) as [string, { max: number; earned: number }][]) {
    const gap = c.max - c.earned;
    if (gap > 0.5 && (!best || gap > best.points)) best = { metric, points: Math.round(gap * 10) / 10 };
  }
  return best;
}

/**
 * The partner's own view. WHY a whitelist and not `...row`: the row is internal, and a column added
 * later must not reach the partner by default.
 */
export function toOwnView(row, rules) {
  const bands = rules.bands.map((b) => ({ key: b.key, min_score: b.min_score, multiplier: b.multiplier }));
  const base = {
    window_days: rules.window_days,
    min_sample_orders: rules.min_sample_orders,
    weights: rules.weights,
    bands,
  };
  if (!row) return { ...base, is_new: true, sample_orders: 0, score: null, band: null, multiplier: MULTIPLIER_LIMITS.min, metrics: null, components: {}, next_band: null, focus: null, computed_at: null };

  const score = row.score ?? null;
  const next = score === null ? null : bands.find((b) => b.min_score > score) || null;
  const components = row.components_json || {};
  return {
    ...base,
    is_new: score === null,
    sample_orders: row.sample_orders,
    score,
    band: row.band ?? null,
    multiplier: Number(row.multiplier),
    metrics: {
      delivered_volume: num(row.delivered_volume),
      return_rate_pct: num(row.return_rate_pct),
      cancel_rate_pct: num(row.cancel_rate_pct),
      repeat_customer_pct: num(row.repeat_customer_pct),
      new_customer_pct: num(row.new_customer_pct),
      link_conversion_pct: num(row.link_conversion_pct),
    },
    components,
    next_band: next && { key: next.key, min_score: next.min_score, multiplier: next.multiplier, points_needed: next.min_score - score },
    focus: biggestGap(components),
    computed_at: row.computed_at,
  };
}

export async function getOwnScore(db, salerId) {
  const [row, rules] = await Promise.all([repo.findOne(db, salerId), loadRules(db)]);
  return toOwnView(row, rules);
}
