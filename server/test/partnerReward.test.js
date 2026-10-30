/**
 * partnerReward.test.js — the monthly shop partner reward pool (migration 086, partnerReward.service.ts).
 *
 * The invariants: a payout never exceeds the pool, a factor nobody scored on hands its weight to the
 * others, the owner's factor order is enforced on write, reads fall back field by field, and a month
 * closes once, only after it ended, never before `first_month`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeShares,
  communityValue,
  resolveRules,
  validateRules,
  duePeriods,
  monthEnd,
  addMonths,
  DEFAULT_RULES,
  RULE_LIMITS,
} from '../src/services/partnerReward.service.ts';

const W = { sales: 40, social: 25, community: 20, activity: 15 };
const p = (salerId, sales, social, community, activity) => ({ salerId, values: { sales, social, community, activity } });

describe('partner reward pool — scoring', () => {
  test('points are weight x share of the factor, and the pool splits by points', () => {
    const r = computeShares([p(1, 3, 10, 0, 10), p(2, 1, 30, 0, 10)], W, 100000);
    const a = r.rows.find((x) => x.salerId === 1);
    const b = r.rows.find((x) => x.salerId === 2);
    assert.equal(a.points.sales, 30); // 40 x 3/4
    assert.equal(b.points.social, 18.75); // 25 x 30/40
    assert.equal(a.points.community, 0); // nobody posted
    assert.equal(a.points.activity, 7.5);
    // community left out: scores add up to 80, and the whole pool is still shared
    assert.equal(a.score + b.score, 80);
    assert.equal(r.paidPaisa + r.carriedPaisa, 100000);
    assert.ok(Math.abs(a.sharePct + b.sharePct - 100) < 1e-9);
  });

  test('a sale outweighs a share: more sales beats more social reach at default weights', () => {
    const r = computeShares([p(1, 10, 0, 0, 5), p(2, 0, 1000, 0, 5)], W, 10000);
    assert.equal(r.rows[0].salerId, 1);
  });

  test('payouts never exceed the pool and the leftover paisa carry over', () => {
    for (const pool of [1, 7, 100, 99999, 1234567]) {
      const r = computeShares([p(1, 1, 1, 1, 1), p(2, 1, 1, 1, 1), p(3, 1, 1, 1, 1)], W, pool);
      const paid = r.rows.reduce((s, x) => s + x.amountPaisa, 0);
      assert.ok(paid <= pool, `paid ${paid} > pool ${pool}`);
      assert.equal(paid, r.paidPaisa);
      assert.equal(r.paidPaisa + r.carriedPaisa, pool);
      assert.ok(r.carriedPaisa < 3, 'at most one paisa per partner is left over');
    }
  });

  test('nobody scored: nothing is paid and the whole pool carries over', () => {
    const r = computeShares([p(1, 0, 0, 0, 0), p(2, 0, 0, 0, 0)], W, 5000);
    assert.equal(r.paidPaisa, 0);
    assert.equal(r.carriedPaisa, 5000);
    assert.ok(r.rows.every((x) => x.amountPaisa === 0 && x.sharePct === 0));
  });

  test('an empty or negative pool pays nothing', () => {
    assert.equal(computeShares([p(1, 1, 1, 1, 1)], W, 0).paidPaisa, 0);
    assert.equal(computeShares([p(1, 1, 1, 1, 1)], W, -500).paidPaisa, 0);
  });

  test('community value: posts and the reactions they got from others, by configured points', () => {
    const pts = { post: 3, like: 1, comment: 2, save: 2 };
    assert.equal(communityValue({ posts: 2, likes: 5, comments: 1, saves: 1 }, pts), 6 + 5 + 2 + 2);
    assert.equal(communityValue(null, pts), 0);
  });
});

describe('partner reward pool — rules', () => {
  const valid = {
    weights: { sales: 40, social: 30, community: 20, activity: 10 },
    ad_revenue_share_pct: 12.5,
    community_points: { post: 3, like: 1, comment: 2, save: 2 },
    max_posts_per_day: 3,
    settle_lag_days: 7,
  };

  test('a valid edit passes and keeps only the editable fields', () => {
    const out = validateRules({ ...valid, timezone: 'UTC', first_month: '2020-01-01' });
    assert.deepEqual(Object.keys(out).sort(), ['ad_revenue_share_pct', 'community_points', 'max_posts_per_day', 'settle_lag_days', 'weights']);
  });

  test('weights must add up to 100 and keep the owner order', () => {
    assert.throws(() => validateRules({ ...valid, weights: { sales: 40, social: 30, community: 20, activity: 5 } }), (e) => e.code === 'VALIDATION_FAILED');
    assert.throws(() => validateRules({ ...valid, weights: { sales: 10, social: 40, community: 30, activity: 20 } }), /order/i);
    assert.throws(() => validateRules({ ...valid, weights: { sales: 40.5, social: 29.5, community: 20, activity: 10 } }));
  });

  test('every other field is refused out of range, never clamped', () => {
    assert.throws(() => validateRules({ ...valid, ad_revenue_share_pct: 101 }));
    assert.throws(() => validateRules({ ...valid, ad_revenue_share_pct: 10.123 }));
    assert.throws(() => validateRules({ ...valid, community_points: { ...valid.community_points, save: RULE_LIMITS.community_point.max + 1 } }));
    assert.throws(() => validateRules({ ...valid, max_posts_per_day: 0 }));
    assert.throws(() => validateRules({ ...valid, settle_lag_days: 29 }));
  });

  test('reads fall back field by field, so one bad edit never stops a month closing', () => {
    const r = resolveRules({ weights: { sales: 1, social: 2, community: 3, activity: 94 }, ad_revenue_share_pct: 30, timezone: 'Not/AZone', first_month: '2026-10-01' });
    assert.deepEqual(r.weights, DEFAULT_RULES.weights);
    assert.equal(r.ad_revenue_share_pct, 30);
    assert.equal(r.timezone, DEFAULT_RULES.timezone);
    assert.equal(r.first_month, '2026-10-01');
    assert.deepEqual(resolveRules(null).community_points, DEFAULT_RULES.community_points);
  });

  test('the defaults equal the migration 086 seed', () => {
    const sql = fs.readFileSync(path.resolve(import.meta.dirname, '../src/db/migrations/086_partner_reward_runs.sql'), 'utf8');
    const json = JSON.parse(sql.match(/'(\{"weights"[\s\S]*?\})'::jsonb/)[1]);
    assert.deepEqual(json.weights, DEFAULT_RULES.weights);
    // 091 moves the seeded ad share (20 -> 55), so the default must equal what 091 writes.
    const m091 = fs.readFileSync(path.resolve(import.meta.dirname, '../src/db/migrations/091_partner_pool_ad_share_55.sql'), 'utf8');
    assert.equal(json.ad_revenue_share_pct, Number(m091.match(/::numeric = (\d+(?:\.\d+)?);/)[1]));
    assert.equal(Number(m091.match(/'\{ad_revenue_share_pct\}', '(\d+(?:\.\d+)?)'::jsonb/)[1]), DEFAULT_RULES.ad_revenue_share_pct);
    assert.deepEqual(json.community_points, DEFAULT_RULES.community_points);
    assert.equal(json.max_posts_per_day, DEFAULT_RULES.max_posts_per_day);
    assert.equal(json.settle_lag_days, DEFAULT_RULES.settle_lag_days);
  });
});

describe('partner reward pool — calendar', () => {
  test('month helpers', () => {
    assert.equal(monthEnd('2026-02-01'), '2026-02-28');
    assert.equal(monthEnd('2028-02-01'), '2028-02-29');
    assert.equal(addMonths('2026-12-01', 1), '2027-01-01');
  });

  test('nothing closes before first_month or before the month has ended', () => {
    assert.deepEqual(duePeriods({ today: '2026-10-23', monthStart: '2026-10-01', lastClosed: null, firstMonth: '2026-10-01', lagDays: 7 }), []);
    assert.deepEqual(duePeriods({ today: '2026-10-23', monthStart: '2026-10-01', lastClosed: null, firstMonth: '2026-10-01', lagDays: 0, ignoreLag: true }), []);
    assert.deepEqual(duePeriods({ today: '2026-10-23', monthStart: '2026-10-01', lastClosed: null, firstMonth: null, lagDays: 0 }), []);
  });

  test('a month closes only after the settle delay, unless closed by hand', () => {
    const base = { monthStart: '2026-11-01', lastClosed: null, firstMonth: '2026-10-01', lagDays: 7 };
    assert.deepEqual(duePeriods({ ...base, today: '2026-11-07' }), []);
    assert.deepEqual(duePeriods({ ...base, today: '2026-11-08' }), [{ start: '2026-10-01', end: '2026-10-31' }]);
    assert.deepEqual(duePeriods({ ...base, today: '2026-11-02', ignoreLag: true }), [{ start: '2026-10-01', end: '2026-10-31' }]);
  });

  test('a closed month is never due again, and missed months catch up oldest first', () => {
    assert.deepEqual(duePeriods({ today: '2026-11-20', monthStart: '2026-11-01', lastClosed: '2026-10-01', firstMonth: '2026-10-01', lagDays: 7 }), []);
    assert.deepEqual(
      duePeriods({ today: '2027-01-20', monthStart: '2027-01-01', lastClosed: '2026-10-01', firstMonth: '2026-10-01', lagDays: 7 }).map((x) => x.start),
      ['2026-11-01', '2026-12-01']
    );
  });
});

describe('partner reward pool — wiring', () => {
  const read = (rel) => fs.readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');

  test('every route has a real preHandler guard with the module and a catalog permission', () => {
    const src = read('src/routes/partnerReward.routes.ts');
    for (const perm of ['growth.partner_reward.view', 'growth.partner_reward.update', 'growth.partner_reward.run', 'saler.dashboard.view']) {
      assert.ok(src.includes(`'${perm}'`), perm);
    }
    assert.ok(src.includes("requireModule('virtual_storefront')"));
    assert.ok(!/config:\s*\{[^}]*requirePermission/.test(src), 'a guard must never sit inside config');
    const catalog = JSON.parse(read('../docs/permission-catalog.json'));
    const keys = new Set(catalog.permissions.map((x) => x.key));
    for (const perm of ['growth.partner_reward.view', 'growth.partner_reward.update', 'growth.partner_reward.run']) assert.ok(keys.has(perm), perm);
  });

  test('the payout ledger category exists and the close writes an audit row', () => {
    assert.ok(read('src/db/migrations/086_partner_reward_runs.sql').includes("'PARTNER_REWARD'"));
    const svc = read('src/services/partnerReward.service.ts');
    assert.ok(svc.includes("action: 'growth.partner_reward.close'"));
    assert.ok(svc.includes("action: 'growth.partner_reward.update'"));
  });
});
