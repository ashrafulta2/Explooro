/**
 * partnerScore.test.js — the Partner Score rewards how much and how well a shop partner promotes,
 * and never judges a partner on too little evidence (partnerScore.service.ts).
 *
 * Scoring is a pure function, so these tests need no database. The two source-reading tests guard
 * what a unit test cannot see: that the SQL measures what the service assumes, and that the code
 * defaults still equal the migration seed.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RULES, MULTIPLIER_LIMITS, bandFor, biggestGap, resolveRules, scoreMetrics, toOwnView,
} from '../src/services/partnerScore.service.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rules = resolveRules(null);

const strong = {
  sample_orders: 40, delivered_volume: 100000, return_rate_pct: 0, cancel_rate_pct: 0,
  repeat_customer_pct: 30, new_customer_pct: 50, link_conversion_pct: 5,
};

describe('scoring', () => {
  test('a partner at every target and ceiling scores 100 and lands in the top band', () => {
    const r = scoreMetrics(strong, rules);
    assert.equal(r.score, 100);
    assert.equal(r.band, 'STAR');
    assert.equal(r.multiplier, 1.2);
  });

  test('a partner who delivers nothing and loses every order scores 0 in the first band', () => {
    const r = scoreMetrics({ ...strong, delivered_volume: 0, return_rate_pct: 20, cancel_rate_pct: 20, repeat_customer_pct: 0, new_customer_pct: 0, link_conversion_pct: 0 }, rules);
    assert.equal(r.score, 0);
    assert.equal(r.band, 'STARTER');
    assert.equal(r.multiplier, 1);
  });

  test('too few orders means no score, no band and no boost, however good the numbers', () => {
    const r = scoreMetrics({ ...strong, sample_orders: rules.min_sample_orders - 1 }, rules);
    assert.deepEqual([r.score, r.band, r.multiplier], [null, null, 1]);
    assert.equal(scoreMetrics(null, rules).score, null);
  });

  test('a metric with no data is left out and the others re-scale, never counted as 0 or perfect', () => {
    // No buyers repeated and no links exist: those two are unknown, the other four are perfect.
    const r = scoreMetrics({ ...strong, repeat_customer_pct: null, link_conversion_pct: null, new_customer_pct: null }, rules);
    assert.equal(r.score, 100, 'unknown metrics do not drag a perfect partner down');
    assert.deepEqual(Object.keys(r.components).sort(), ['cancel_rate', 'delivered_volume', 'return_rate']);
    const maxSum = Object.values(r.components).reduce((s, c) => s + c.max, 0);
    assert.ok(Math.abs(maxSum - 100) < 0.5, 'the remaining weights re-scale to 100');
  });

  test('more returns lower the score and more volume raises it, in proportion', () => {
    const base = scoreMetrics({ ...strong, return_rate_pct: 0 }, rules).score;
    const returned = scoreMetrics({ ...strong, return_rate_pct: 10 }, rules).score;
    const half = scoreMetrics({ ...strong, delivered_volume: 50000 }, rules).score;
    assert.equal(base - returned, 10, 'half the ceiling costs half of the 20 return points');
    assert.ok(Math.abs(base - half - 17.5) <= 1, 'half the volume target costs about half of the 35 volume points');
  });

  test('a partner cannot earn extra by overshooting a target, or lose more than a metric is worth', () => {
    const over = scoreMetrics({ ...strong, delivered_volume: 10_000_000, repeat_customer_pct: 100 }, rules);
    assert.equal(over.score, 100);
    const worse = scoreMetrics({ ...strong, return_rate_pct: 100 }, rules);
    assert.equal(worse.components.return_rate.earned, 0);
  });

  test('the breakdown names where the most points are left and nothing when there are none', () => {
    const r = scoreMetrics({ ...strong, repeat_customer_pct: 0 }, rules);
    assert.deepEqual(biggestGap(r.components), { metric: 'repeat_customers', points: 15 });
    assert.equal(biggestGap(scoreMetrics(strong, rules).components), null);
    assert.equal(biggestGap({}), null);
  });
});

describe('bands and rules', () => {
  test('a score takes the highest band whose floor it reaches', () => {
    assert.equal(bandFor(0, rules.bands).key, 'STARTER');
    assert.equal(bandFor(39, rules.bands).key, 'STARTER');
    assert.equal(bandFor(40, rules.bands).key, 'RISING');
    assert.equal(bandFor(80, rules.bands).key, 'STAR');
  });

  test('a malformed ladder falls back whole: gaps, bands paying less than the one below, multipliers out of range', () => {
    const shipped = resolveRules(null).bands;
    const bad = [
      [{ key: 'A', min_score: 10, multiplier: 1 }],                                          // must start at 0
      [{ key: 'A', min_score: 0, multiplier: 1.2 }, { key: 'B', min_score: 50, multiplier: 1.1 }], // pays less than below
      [{ key: 'A', min_score: 0, multiplier: 0.9 }],                                         // below the base earning
      [{ key: 'A', min_score: 0, multiplier: MULTIPLIER_LIMITS.max + 0.5 }],                 // gives away too much
      [{ key: 'A', min_score: 0, multiplier: 1 }, { key: 'B', min_score: 0, multiplier: 1.1 }], // not ascending
      [],
    ];
    for (const raw of bad) assert.deepEqual(resolveRules({ bands: raw }).bands, shipped);
    const good = [{ key: 'LOW', min_score: 0, multiplier: 1 }, { key: 'HIGH', min_score: 70, multiplier: 1.5 }];
    assert.deepEqual(resolveRules({ bands: good }).bands, good);
  });

  test('weights that do not sum to 100 are refused so nobody is capped below the top band', () => {
    const w = { delivered_volume: 30, return_rate: 20, repeat_customers: 15, new_customers: 15, link_conversion: 10, cancel_rate: 5 }; // 95
    assert.deepEqual(resolveRules({ weights: w }).weights, DEFAULT_RULES.weights);
    assert.equal(resolveRules({ weights: { ...w, delivered_volume: 35 } }).weights.delivered_volume, 35);
  });

  test('a bad field falls back on its own without discarding the rest', () => {
    const r = resolveRules({ window_days: 3, min_sample_orders: 12, targets: { delivered_volume: -5, repeat_customers: 20 } });
    assert.equal(r.window_days, DEFAULT_RULES.window_days, 'window below 7 is refused');
    assert.equal(r.min_sample_orders, 12);
    assert.equal(r.targets.delivered_volume, DEFAULT_RULES.targets.delivered_volume);
    assert.equal(r.targets.repeat_customers, 20);
  });

  test('the code defaults equal what migration 079 seeds', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../src/db/migrations/079_partner_scores.sql'), 'utf8');
    const seeded = JSON.parse(sql.match(/'(\{\s*"window_days"[\s\S]*?\})'::jsonb/)[1]);
    assert.deepEqual(resolveRules(seeded), JSON.parse(JSON.stringify(DEFAULT_RULES)));
  });
});

describe('what the partner is shown', () => {
  const row = {
    saler_id: 7, sample_orders: 38, delivered_volume: '64000.00', return_rate_pct: '6.00', cancel_rate_pct: '4.00',
    repeat_customer_pct: null, new_customer_pct: '40.00', link_conversion_pct: null,
    score: 52, band: 'RISING', multiplier: '1.05', computed_at: new Date(),
    components_json: { delivered_volume: { max: 40, earned: 25 }, return_rate: { max: 30, earned: 22 } },
  };

  test('a partner with no row is New, never scored', () => {
    const v = toOwnView(null, rules);
    assert.equal(v.is_new, true);
    assert.equal(v.score, null);
    assert.equal(v.multiplier, 1);
  });

  test('the view tells them the next band and the single thing to work on', () => {
    const v = toOwnView(row, rules);
    assert.equal(v.is_new, false);
    assert.deepEqual(v.next_band, { key: 'PRO', min_score: 60, multiplier: 1.1, points_needed: 8 });
    assert.equal(v.focus.metric, 'delivered_volume');
    assert.equal(v.multiplier, 1.05);
  });

  test('the view is a whitelist: no internal column such as saler_id reaches the partner', () => {
    const v = toOwnView({ ...row, internal_note: 'x' }, rules);
    assert.equal('saler_id' in v, false);
    assert.equal('internal_note' in v, false);
    assert.equal(v.metrics.repeat_customer_pct, null, 'unknown stays null rather than 0');
  });
});

describe('the measuring SQL', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../src/repositories/partnerScore.repository.ts'), 'utf8');

  test('it only counts parcels credited to a partner who is not the supplier, inside the window', () => {
    assert.match(sql, /s\.saler_id IS NOT NULL/);
    assert.match(sql, /s\.saler_id <> s\.supplier_id/);
    assert.match(sql, /s\.created_at >= now\(\) - make_interval\(days => \$1::int\)/);
  });

  // The comments explain the traps and so name them; only the executable SQL is checked.
  const code = sql.replace(/^\s*--.*$/gm, '');

  test('every rate has a NULLIF denominator so "no data" stays NULL', () => {
    // Five rates are measured: return, cancel, repeat buyers, new buyers, link conversion.
    assert.equal((code.match(/NULLIF\(/g) || []).length, 5);
  });

  test('link conversion never reads 100% for a partner with no clicks', () => {
    // Postgres LEAST skips NULLs, so LEAST(100, rate) turned "no clicks" into a perfect score.
    assert.doesNotMatch(code, /LEAST\(100,/);
    assert.match(code, /LEAST\(COUNT\(DISTINCT f\.order_id\)/);
  });
});
