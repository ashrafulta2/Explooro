/**
 * supplierScorecard.service.js — The measured reputation of a supplier, shown to salers.
 *
 * Invariants:
 *   1. A supplier with fewer than `min_sample_orders` orders in the window has NO grade (grade and
 *      score are null). Being new is not the same as being bad, and a fluke 100% on three orders must
 *      not outrank a proven 95% on three hundred.
 *   2. A missing metric (no denominator) is left out of the score and the remaining weights are
 *      re-scaled to 100. It is never counted as 0 or as perfect.
 *   3. Every number that decides a grade comes from the `supplier.scorecard` platform_settings row.
 *      The defaults below only apply while that row is absent or unreadable.
 *
 * Scoring is a pure function (`scoreMetrics`) so the rule can be tested without a database.
 */

import * as repo from '../repositories/supplierScorecard.repository.js';

export const DEFAULT_RULES = Object.freeze({
  window_days: 90,
  min_sample_orders: 10,
  dispatch_sla_hours: 48,
  weights: Object.freeze({ on_time_dispatch: 30, delivery_success: 30, return_rate: 20, dispute_rate: 20 }),
  grade_cutoffs: Object.freeze({ A: 85, B: 70, C: 50 }),
  penalty_ceilings: Object.freeze({ return_rate: 20, dispute_rate: 10 }),
});

const num = (v) => (v === null || v === undefined ? null : Number(v));
const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Merges a stored rules object over the defaults, field by field. A malformed field falls back to
 * its default instead of failing the whole job: one bad admin edit must not stop every scorecard
 * from refreshing. (The settings editor is where bad input is refused; this is the safety net.)
 */
export function resolveRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_RULES;
  const int = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);

  let weights = { ...d.weights };
  if (r.weights && typeof r.weights === 'object') {
    const candidate = {};
    for (const k of Object.keys(d.weights)) candidate[k] = Number(r.weights[k]);
    const sum = Object.values(candidate).reduce((a, b) => a + b, 0);
    // WHY refuse a set that does not sum to 100: the score is a percentage of the weights, so a set
    // summing to 80 would cap every supplier at 80 and quietly push everyone down a grade.
    if (Object.values(candidate).every((n) => Number.isFinite(n) && n >= 0) && Math.round(sum) === 100) weights = candidate;
  }

  let cutoffs = { ...d.grade_cutoffs };
  const c = r.grade_cutoffs;
  if (c && Number.isFinite(c.A) && Number.isFinite(c.B) && Number.isFinite(c.C) && c.A > c.B && c.B > c.C && c.C >= 0 && c.A <= 100) {
    cutoffs = { A: c.A, B: c.B, C: c.C };
  }

  const ceilings = { ...d.penalty_ceilings };
  for (const k of Object.keys(ceilings)) {
    const v = Number(r.penalty_ceilings?.[k]);
    if (isPositive(v) && v <= 100) ceilings[k] = v;
  }

  return {
    window_days: int(r.window_days, 7, 365, d.window_days),
    min_sample_orders: int(r.min_sample_orders, 1, 10000, d.min_sample_orders),
    dispatch_sla_hours: int(r.dispatch_sla_hours, 1, 720, d.dispatch_sla_hours),
    weights,
    grade_cutoffs: cutoffs,
    penalty_ceilings: ceilings,
  };
}

export async function loadRules(db) {
  try {
    return resolveRules(await repo.getRulesRow(db));
  } catch {
    return resolveRules(null);
  }
}

/** 0..1 where 1 is best. A rate above its ceiling floors at 0. */
function lowerIsBetter(ratePct, ceilingPct) {
  return Math.max(0, Math.min(1, 1 - ratePct / ceilingPct));
}

/**
 * Pure. Turns measured metrics into { score, grade }, or { score: null, grade: null } when there is
 * not enough data to judge (invariant 1) or no usable metric at all (invariant 2).
 */
export function scoreMetrics(metrics, rules) {
  if (!metrics || metrics.sample_orders < rules.min_sample_orders) return { score: null, grade: null };

  const parts = [
    ['on_time_dispatch', num(metrics.on_time_dispatch_pct), (v) => v / 100],
    ['delivery_success', num(metrics.delivery_success_pct), (v) => v / 100],
    ['return_rate', num(metrics.return_rate_pct), (v) => lowerIsBetter(v, rules.penalty_ceilings.return_rate)],
    ['dispute_rate', num(metrics.dispute_rate_pct), (v) => lowerIsBetter(v, rules.penalty_ceilings.dispute_rate)],
  ].filter(([, v]) => v !== null);

  const weightSum = parts.reduce((sum, [k]) => sum + rules.weights[k], 0);
  if (parts.length === 0 || weightSum === 0) return { score: null, grade: null };

  const earned = parts.reduce((sum, [k, v, fn]) => sum + rules.weights[k] * fn(v), 0);
  const score = Math.round((earned / weightSum) * 100);

  const { A, B, C } = rules.grade_cutoffs;
  const grade = score >= A ? 'A' : score >= B ? 'B' : score >= C ? 'C' : 'D';
  return { score, grade };
}

/**
 * Rebuilds every supplier's snapshot from live orders. Returns what it did for job_runs.
 * Suppliers with no orders left in the window lose their row, so a stale grade cannot outlive the
 * evidence for it.
 */
export async function refreshAll(db) {
  const rules = await loadRules(db);
  const measured = await repo.measureSuppliers(db, { windowDays: rules.window_days, slaHours: rules.dispatch_sla_hours });

  let graded = 0;
  for (const m of measured) {
    const { score, grade } = scoreMetrics(m, rules);
    if (grade) graded += 1;
    await repo.upsertScorecard(db, {
      supplier_id: m.supplier_id,
      window_days: rules.window_days,
      sample_orders: m.sample_orders,
      median_dispatch_hours: m.median_dispatch_hours,
      on_time_dispatch_pct: m.on_time_dispatch_pct,
      delivery_success_pct: m.delivery_success_pct,
      return_rate_pct: m.return_rate_pct,
      dispute_rate_pct: m.dispute_rate_pct,
      grade,
      score,
    });
  }
  const removed = await repo.deleteExcept(db, measured.map((m) => m.supplier_id));
  return { suppliers: measured.length, graded, removed, rules };
}

/**
 * What a saler may see. WHY a whitelist and not `...row`: the row is internal, and a column added
 * later must not leak to the public catalog by default.
 */
export function toPublicView(row, rules = DEFAULT_RULES) {
  if (!row) return { grade: null, is_new: true, min_sample_orders: rules.min_sample_orders };
  const graded = row.grade !== null && row.grade !== undefined;
  return {
    grade: row.grade ?? null,
    score: row.score ?? null,
    is_new: !graded,
    sample_orders: row.sample_orders,
    window_days: row.window_days,
    median_dispatch_hours: num(row.median_dispatch_hours),
    on_time_dispatch_pct: num(row.on_time_dispatch_pct),
    delivery_success_pct: num(row.delivery_success_pct),
    return_rate_pct: num(row.return_rate_pct),
    dispute_rate_pct: num(row.dispute_rate_pct),
    computed_at: row.computed_at,
  };
}

/** Adds `supplier_scorecard` to each catalog item with one batched lookup (no N+1). */
export async function attachToProducts(db, products) {
  const ids = [...new Set(products.map((p) => p.supplier_id).filter(Boolean))];
  if (!ids.length) return products;
  const [rows, rules] = await Promise.all([repo.findByIds(db, ids), loadRules(db)]);
  const byId = new Map(rows.map((r) => [String(r.supplier_id), r]));
  return products.map((p) => ({ ...p, supplier_scorecard: toPublicView(byId.get(String(p.supplier_id)), rules) }));
}

/** The supplier's own view: public numbers plus the rules, so they can see what they are judged on. */
export async function getOwnScorecard(db, supplierId) {
  const [row, rules] = await Promise.all([repo.findOne(db, supplierId), loadRules(db)]);
  return {
    scorecard: toPublicView(row, rules),
    rules: {
      window_days: rules.window_days,
      min_sample_orders: rules.min_sample_orders,
      dispatch_sla_hours: rules.dispatch_sla_hours,
      weights: rules.weights,
      grade_cutoffs: rules.grade_cutoffs,
      penalty_ceilings: rules.penalty_ceilings,
    },
  };
}
