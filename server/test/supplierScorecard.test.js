/**
 * supplierScorecard.test.js — The invariants stated in supplierScorecard.service.js.
 *
 *   1. Too few orders ⇒ no grade ("New"), however good the percentages look.
 *   2. A metric with no data is left out and the weights re-scale; it is never 0 and never perfect.
 *   3. Rules come from settings; a malformed setting falls back to its default instead of breaking.
 *   Plus: the public view is a whitelist, and the catalog lookup is one batched query.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES,
  resolveRules,
  scoreMetrics,
  toPublicView,
  attachToProducts,
  refreshAll,
} from '../src/services/supplierScorecard.service.js';

const rules = resolveRules(null);
const strong = { sample_orders: 100, on_time_dispatch_pct: 98, delivery_success_pct: 97, return_rate_pct: 2, dispute_rate_pct: 0.5 };

describe('scoreMetrics', () => {
  test('a supplier below min_sample_orders is ungraded even with perfect numbers', () => {
    const r = scoreMetrics({ ...strong, sample_orders: rules.min_sample_orders - 1, on_time_dispatch_pct: 100 }, rules);
    assert.deepEqual(r, { score: null, grade: null });
  });

  test('the sample threshold is inclusive', () => {
    assert.ok(scoreMetrics({ ...strong, sample_orders: rules.min_sample_orders }, rules).grade);
  });

  test('a strong supplier earns an A, a poor one a D', () => {
    assert.equal(scoreMetrics(strong, rules).grade, 'A');
    const poor = { sample_orders: 100, on_time_dispatch_pct: 20, delivery_success_pct: 55, return_rate_pct: 30, dispute_rate_pct: 15 };
    assert.equal(scoreMetrics(poor, rules).grade, 'D');
  });

  test('return and dispute rates above their ceiling floor at zero points, not negative', () => {
    const r = scoreMetrics({ ...strong, return_rate_pct: 90, dispute_rate_pct: 90 }, rules);
    // Only the two percentage metrics contribute: (30*.98 + 30*.97) / 100 = 58.5 of 60 weight, + 0 + 0.
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.equal(r.score, Math.round(((30 * 0.98 + 30 * 0.97) / 100) * 100));
  });

  test('a missing metric is excluded and weights re-scale, so it neither helps nor hurts', () => {
    const withAll = scoreMetrics({ sample_orders: 50, on_time_dispatch_pct: 100, delivery_success_pct: 100, return_rate_pct: 0, dispute_rate_pct: 0 }, rules);
    const withoutDisputes = scoreMetrics({ sample_orders: 50, on_time_dispatch_pct: 100, delivery_success_pct: 100, return_rate_pct: 0, dispute_rate_pct: null }, rules);
    assert.equal(withAll.score, 100);
    assert.equal(withoutDisputes.score, 100, 'unknown disputes must not be punished as if they were a miss');
  });

  test('no usable metric at all ⇒ ungraded', () => {
    assert.deepEqual(scoreMetrics({ sample_orders: 50 }, rules), { score: null, grade: null });
  });

  test('grade boundaries follow the configured cutoffs', () => {
    const custom = resolveRules({ grade_cutoffs: { A: 95, B: 80, C: 60 } });
    // 92 is an A under the defaults but only a B under stricter cutoffs.
    const m = { sample_orders: 50, on_time_dispatch_pct: 95, delivery_success_pct: 97, return_rate_pct: 4, dispute_rate_pct: 1 };
    assert.equal(scoreMetrics(m, rules).grade, 'A');
    assert.equal(scoreMetrics(m, custom).grade, 'B');
  });
});

describe('resolveRules', () => {
  test('null / junk input yields the defaults', () => {
    assert.deepEqual(resolveRules(null), resolveRules(undefined));
    assert.equal(resolveRules('nope').window_days, DEFAULT_RULES.window_days);
  });

  test('a weights set that does not sum to 100 is refused', () => {
    const r = resolveRules({ weights: { on_time_dispatch: 10, delivery_success: 10, return_rate: 10, dispute_rate: 10 } });
    assert.deepEqual(r.weights, { ...DEFAULT_RULES.weights });
  });

  test('a valid custom weights set is accepted', () => {
    const w = { on_time_dispatch: 40, delivery_success: 40, return_rate: 10, dispute_rate: 10 };
    assert.deepEqual(resolveRules({ weights: w }).weights, w);
  });

  test('out-of-order cutoffs fall back to defaults', () => {
    assert.deepEqual(resolveRules({ grade_cutoffs: { A: 50, B: 70, C: 85 } }).grade_cutoffs, { ...DEFAULT_RULES.grade_cutoffs });
  });

  test('one bad field does not discard the good ones', () => {
    const r = resolveRules({ window_days: 9999, min_sample_orders: 25 });
    assert.equal(r.window_days, DEFAULT_RULES.window_days);
    assert.equal(r.min_sample_orders, 25);
  });
});

describe('toPublicView', () => {
  test('exposes only whitelisted fields', () => {
    const view = toPublicView({ supplier_id: 7, grade: 'A', score: 90, sample_orders: 40, window_days: 90, internal_note: 'secret', computed_at: 'x' });
    assert.equal(view.supplier_id, undefined);
    assert.equal(view.internal_note, undefined);
    assert.equal(view.grade, 'A');
    assert.equal(view.is_new, false);
  });

  test('no row, or an ungraded row, reads as New', () => {
    assert.equal(toPublicView(null).is_new, true);
    assert.equal(toPublicView({ grade: null, sample_orders: 2 }).is_new, true);
  });

  test('numeric strings from pg become numbers; null stays null', () => {
    const v = toPublicView({ grade: 'B', median_dispatch_hours: '12.50', on_time_dispatch_pct: null });
    assert.equal(v.median_dispatch_hours, 12.5);
    assert.equal(v.on_time_dispatch_pct, null);
  });
});

describe('attachToProducts', () => {
  test('looks every supplier up in ONE query, not one per product', async () => {
    const calls = [];
    const db = {
      async query(sql, params) {
        calls.push(sql);
        if (/FROM supplier_scorecards/.test(sql)) return { rows: [{ supplier_id: 5, grade: 'A', score: 90, sample_orders: 30 }] };
        return { rows: [] };
      },
    };
    const out = await attachToProducts(db, [{ id: 1, supplier_id: 5 }, { id: 2, supplier_id: 5 }, { id: 3, supplier_id: 9 }]);
    assert.equal(calls.filter((s) => /FROM supplier_scorecards/.test(s)).length, 1);
    assert.equal(out[0].supplier_scorecard.grade, 'A');
    assert.equal(out[2].supplier_scorecard.is_new, true, 'a supplier with no snapshot is New, not missing');
  });
});

describe('refreshAll', () => {
  test('grades measured suppliers and removes snapshots that have lost their evidence', async () => {
    const written = [];
    let deletedKeep = null;
    const db = {
      async query(sql, params) {
        if (/FROM platform_settings/.test(sql)) return { rows: [] };
        if (/WITH sample AS/.test(sql)) {
          return { rows: [
            { supplier_id: 1, sample_orders: 40, median_dispatch_hours: '10', on_time_dispatch_pct: '97', delivery_success_pct: '98', return_rate_pct: '2', dispute_rate_pct: '0' },
            { supplier_id: 2, sample_orders: 3, median_dispatch_hours: '5', on_time_dispatch_pct: '100', delivery_success_pct: '100', return_rate_pct: '0', dispute_rate_pct: '0' },
          ] };
        }
        if (/INSERT INTO supplier_scorecards/.test(sql)) { written.push(params); return { rows: [] }; }
        if (/DELETE FROM supplier_scorecards/.test(sql)) { deletedKeep = params[0]; return { rowCount: 4 }; }
        return { rows: [] };
      },
    };
    const result = await refreshAll(db);
    assert.equal(result.suppliers, 2);
    assert.equal(result.graded, 1, 'the 3-order supplier is measured but not graded');
    assert.equal(result.removed, 4);
    assert.deepEqual(deletedKeep, [1, 2]);
    assert.equal(written[0][8], 'A');
    assert.equal(written[1][8], null);
  });
});
