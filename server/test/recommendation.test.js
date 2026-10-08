/**
 * recommendation.test.js — Invariants for Phase B of the personalized home feed (blended ranking,
 * migration 056).
 *
 *   1. Policy         — weights/tuning are read from platform_settings, sanitised per key, and the
 *                       shipped defaults cannot drift from what the migration seeds.
 *   2. SQL builder    — every bound parameter is used (Postgres rejects an unused one), a weight of 0
 *                       switches a signal off completely, penalties subtract, nothing is a bare integer.
 *   3. Ranking spec   — opt-out carries no personal data, a failing read costs one signal not the feed.
 *   4. Reasons        — the badge names the specific cause, and baseline quality never wins by default.
 *   5. getFeed        — the feed passes the spec through and never leaks the score's arithmetic.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as reco from '../src/services/recommendation.service.js';
import { buildBlendedRank } from '../src/repositories/recommendation.repository.js';
import * as feed from '../src/services/discoveryFeed.service.js';
import * as covisit from '../src/services/covisit.service.js';

function makeDb(routes = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      for (const r of routes) if (r.match(sql)) return r.reply(sql, params);
      return { rows: [] };
    },
  };
}

const spec = (over = {}) => ({
  weights: { ...reco.DEFAULT_WEIGHTS },
  tuning: { ...reco.DEFAULT_TUNING },
  audience: 'customer',
  categoryIds: [],
  brands: [],
  supplierIds: [],
  viewedIds: [],
  purchasedIds: [],
  district: null,
  ...over,
});

// ── 1. Policy ───────────────────────────────────────────────────────────────────────────────────
describe('Recommendation — policy', () => {
  test('shipped defaults are exactly what migration 056 seeds', () => {
    const sql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/db/migrations/056_recommendation_ranking_settings.sql'),
      'utf8'
    );
    const grab = (key) => {
      const m = sql.match(new RegExp(`'${key}',\\s*'(\\{[\\s\\S]*?\\})'::jsonb`));
      assert.ok(m, `${key} must be seeded`);
      return JSON.parse(m[1]);
    };
    // 059 (Phase E) fills in a missing `covisited` weight with `'{...}'::jsonb || value_json`, so the
    // seeded 056 weights plus that one key are the shipped defaults.
    const sql059 = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/db/migrations/059_covisitation.sql'),
      'utf8'
    );
    const patch = sql059.match(/'(\{"covisited":\s*[\d.]+\})'::jsonb\s*\|\|\s*value_json/);
    assert.ok(patch, 'migration 059 must add the covisited weight');
    assert.deepEqual({ ...JSON.parse(patch[1]), ...grab('recommendation.weights') }, reco.DEFAULT_WEIGHTS);
    assert.deepEqual(grab('recommendation.tuning'), reco.DEFAULT_TUNING);
  });

  test('every default sits inside its own limit', () => {
    for (const [k, v] of Object.entries(reco.DEFAULT_WEIGHTS)) {
      assert.ok(v >= reco.WEIGHT_LIMITS.min && v <= reco.WEIGHT_LIMITS.max, k);
    }
    for (const [k, v] of Object.entries(reco.DEFAULT_TUNING)) {
      const { min, max, integer } = reco.TUNING_LIMITS[k];
      assert.ok(v >= min && v <= max, k);
      if (integer) assert.ok(Number.isInteger(v), k);
    }
  });

  test('a bad value falls back to its default without discarding the rest of the tuning', () => {
    const w = reco.sanitizeWeights({
      trending: 4,
      quality: -1, // below the floor
      freshness: 999, // above the ceiling
      locality: 'lots', // not a number
      bestseller: null, // would read as 0 = "off" if coerced
      mystery_key: 7, // unknown keys are dropped
    });
    assert.equal(w.trending, 4, 'a valid override is kept');
    assert.equal(w.quality, reco.DEFAULT_WEIGHTS.quality);
    assert.equal(w.freshness, reco.DEFAULT_WEIGHTS.freshness);
    assert.equal(w.locality, reco.DEFAULT_WEIGHTS.locality);
    assert.equal(w.bestseller, reco.DEFAULT_WEIGHTS.bestseller, 'null must not silently switch a signal off');
    assert.equal('mystery_key' in w, false);
  });

  test('a weight of exactly 0 is honoured — that is how an admin switches a signal off', () => {
    assert.equal(reco.sanitizeWeights({ trending: 0 }).trending, 0);
  });

  test('integer-only tuning rejects fractions; garbage input yields all defaults', () => {
    assert.equal(reco.sanitizeTuning({ trend_recent_hours: 36.5 }).trend_recent_hours, 48);
    assert.equal(reco.sanitizeTuning({ trend_recent_hours: 36 }).trend_recent_hours, 36);
    assert.deepEqual(reco.sanitizeTuning('nonsense'), reco.DEFAULT_TUNING);
    assert.deepEqual(reco.sanitizeWeights([1, 2, 3]), reco.DEFAULT_WEIGHTS);
  });

  test('resolveRankingConfig reads the group, parses string JSON, and survives a missing table', async () => {
    const db = makeDb([
      {
        match: (s) => s.includes('FROM platform_settings'),
        reply: () => ({
          rows: [
            { key: 'recommendation.weights', value_json: { trending: 9 } },
            { key: 'recommendation.tuning', value_json: JSON.stringify({ bestseller_cap: 1000 }) },
          ],
        }),
      },
    ]);
    const cfg = await reco.resolveRankingConfig(db);
    assert.equal(cfg.weights.trending, 9);
    assert.equal(cfg.tuning.bestseller_cap, 1000);
    assert.equal(cfg.weights.quality, reco.DEFAULT_WEIGHTS.quality);

    const broken = { query: async () => { throw new Error('relation "platform_settings" does not exist'); } };
    assert.deepEqual(await reco.resolveRankingConfig(broken), {
      weights: reco.DEFAULT_WEIGHTS,
      tuning: reco.DEFAULT_TUNING,
      covisit: covisit.DEFAULT_COVISIT,
    });
  });
});

// ── 2. SQL builder ──────────────────────────────────────────────────────────────────────────────
describe('Recommendation — blended SQL', () => {
  const build = (s) => {
    const params = [];
    const out = buildBlendedRank(s, params);
    return { ...out, params, sql: `${out.select}\n${out.joins}` };
  };
  const placeholders = (sql) => new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));

  test('every bound parameter is referenced exactly once-or-more, none dangling (Postgres rejects an unused one)', () => {
    const { params, sql } = build(
      spec({
        categoryIds: [3],
        brands: ['Aarong'],
        supplierIds: [9],
        viewedIds: [5],
        purchasedIds: [6],
        district: 'Dhaka',
      })
    );
    const used = placeholders(sql);
    assert.equal(used.size, params.length, 'no parameter may be bound but unused');
    for (let i = 1; i <= params.length; i += 1) assert.ok(used.has(i), `$${i} is bound but never used`);
  });

  test('a signal with weight 0 binds nothing and its join disappears', () => {
    const off = { ...reco.DEFAULT_WEIGHTS, trending: 0, recent_sales: 0, affinity_category: 0 };
    const { params, sql, joins } = build(spec({ weights: off, categoryIds: [3] }));
    assert.equal(params.length, 0, 'the category set must not be bound when its weight is 0');
    assert.equal(joins.includes('product_interaction_events'), false, 'no trending join');
    assert.equal(joins.includes('order_items'), false, 'no recent-sales join');
    assert.doesNotMatch(sql, /'trending'|'recent_sales'|'affinity_category'/);
  });

  test('personal signals appear only when the actor has the data for them', () => {
    const cold = build(spec()).sql;
    for (const name of ['affinity_category', 'affinity_brand', 'affinity_supplier', 'recently_viewed', 'locality', 'already_bought_penalty']) {
      assert.equal(cold.includes(`'${name}'`), false, `${name} needs actor data`);
    }
    for (const name of ['trending', 'bestseller', 'quality', 'freshness', 'out_of_stock_penalty']) {
      assert.ok(cold.includes(`'${name}'`), `${name} is a global signal`);
    }
  });

  test('trending uses intent events only, scoped to the audience — impressions would be a feedback loop', () => {
    const { sql, params } = build(spec({ audience: 'saler' }));
    assert.match(sql, /event_type <> 'VIEW'/);
    assert.match(sql, /audience = \$1/);
    assert.deepEqual(params, ['saler']);
  });

  test('penalties are subtracted and positive-valued in settings', () => {
    const { select } = build(spec({ purchasedIds: [1] }));
    assert.match(select, /\(-5 \* \(CASE WHEN p\.stock_qty <= 0/);
    assert.match(select, /\(-3 \* \(CASE WHEN p\.id = ANY/);
    assert.match(select, /\(-2 \* \(COALESCE\(ts\.return_rate, 0\) \/ 100\)\)/);
  });

  test('quality is Bayesian: the prior count is in the denominator', () => {
    const { select } = build(spec());
    assert.match(select, /p\.rating_count \* COALESCE\(p\.rating_avg, 0\) \+ 10 \* 4\) \/ \(p\.rating_count \+ 10\)/);
  });

  test('ORDER BY is the output alias, never an expression a position-reading planner could misread', () => {
    assert.equal(build(spec()).orderBy, 'rank_score DESC');
    const empty = build(spec({ weights: Object.fromEntries(Object.keys(reco.DEFAULT_WEIGHTS).map((k) => [k, 0])) }));
    assert.match(empty.select, /\(0\)::float8 AS rank_score/);
    assert.match(empty.select, /'\{\}'::json AS rank_components/);
  });

  test('only numbers are inlined into the SQL — a hostile tuning value cannot inject', () => {
    const { sql } = build(
      spec({ tuning: { ...reco.DEFAULT_TUNING, trend_recent_hours: "1'; DROP TABLE products;--", bestseller_cap: 'x' } })
    );
    assert.doesNotMatch(sql, /DROP TABLE/);
  });
});

// ── 3. Ranking spec ─────────────────────────────────────────────────────────────────────────────
describe('Recommendation — ranking spec', () => {
  const cfg = { weights: { ...reco.DEFAULT_WEIGHTS }, tuning: { ...reco.DEFAULT_TUNING } };
  const affinity = { categoryIds: [3], brands: ['aarong'], supplierIds: [9] };

  test('an opted-out shopper gets a spec with no personal data and no per-actor query at all', async () => {
    const db = makeDb();
    const s = await reco.buildRankingSpec(db, { userId: 7, affinity, personalize: false, config: cfg });
    assert.deepEqual([s.categoryIds, s.brands, s.supplierIds, s.viewedIds, s.purchasedIds], [[], [], [], [], []]);
    assert.equal(s.district, null);
    assert.equal(db.calls.length, 0, 'nothing about the person may even be read');
  });

  test('a shopper with no identity is treated as non-personal', async () => {
    const s = await reco.buildRankingSpec(makeDb(), { affinity, config: cfg });
    assert.deepEqual(s.categoryIds, []);
  });

  test('viewed products that were bought are not re-surfaced', async () => {
    const db = makeDb([
      { match: (s) => s.includes("event_type IN ('CLICK'"), reply: () => ({ rows: [{ product_id: '5' }, { product_id: '6' }] }) },
      { match: (s) => s.includes('FROM order_items'), reply: () => ({ rows: [{ product_id: '6' }] }) },
      { match: (s) => s.includes("event_type = 'PURCHASE'"), reply: () => ({ rows: [] }) },
      { match: (s) => s.includes('FROM user_profiles'), reply: () => ({ rows: [{ district: ' Dhaka ' }] }) },
    ]);
    const s = await reco.buildRankingSpec(db, { userId: 7, affinity, config: cfg });
    assert.deepEqual(s.viewedIds, [5]);
    assert.deepEqual(s.purchasedIds, [6]);
    assert.equal(s.district, 'Dhaka');
    assert.deepEqual(s.categoryIds, [3]);
  });

  test('one failing read costs that signal only, never the feed', async () => {
    const db = {
      async query(sql) {
        if (sql.includes('FROM user_profiles')) throw new Error('boom');
        return { rows: [] };
      },
    };
    const s = await reco.buildRankingSpec(db, { userId: 7, affinity, config: cfg });
    assert.equal(s.district, null);
    assert.deepEqual(s.categoryIds, [3], 'affinity survives');
  });

  test('a signal weighted 0 is not even queried', async () => {
    const db = makeDb();
    const zero = { ...cfg, weights: { ...cfg.weights, recently_viewed: 0, already_bought_penalty: 0, locality: 0 } };
    await reco.buildRankingSpec(db, { userId: 7, affinity, config: zero });
    assert.equal(db.calls.length, 0);
  });

  test('a guest is read by session, a signed-in user by account', async () => {
    const db = makeDb();
    await reco.buildRankingSpec(db, { sessionId: 'sess-1', config: cfg });
    const viewed = db.calls.find((c) => c.sql.includes("event_type IN ('CLICK'"));
    assert.match(viewed.sql, /e\.session_id = \$1/);
    assert.equal(viewed.params[0], 'sess-1');
  });
});

// ── 4. Reasons ──────────────────────────────────────────────────────────────────────────────────
describe('Recommendation — reasons', () => {
  test('names the specific cause over baseline quality', () => {
    assert.equal(reco.reasonFromComponents({ quality: 1.9, freshness: 0.9, trending: 2 }), 'trending');
    assert.equal(reco.reasonFromComponents({ quality: 1.9, bestseller: 1.4 }), 'bestseller');
    assert.equal(reco.reasonFromComponents({ quality: 1.9, affinity_category: 3 }), 'interest');
    assert.equal(reco.reasonFromComponents({ quality: 1.9, recently_viewed: 1.5 }), 'browsed');
  });

  test('the biggest specific contributor wins', () => {
    assert.equal(reco.reasonFromComponents({ bestseller: 1.2, affinity_brand: 2 }), 'interest');
    assert.equal(reco.reasonFromComponents({ bestseller: 1.5, affinity_brand: 0.6 }), 'bestseller');
  });

  test('baseline-only placement reads as explore; too-weak placement has no reason', () => {
    assert.equal(reco.reasonFromComponents({ quality: 1.9, freshness: 0.3 }), 'explore');
    assert.equal(reco.reasonFromComponents({ quality: 0.2, trending: 0.1, bestseller: 0.3 }), null);
  });

  test('penalties and junk never produce a reason', () => {
    assert.equal(reco.reasonFromComponents({ out_of_stock_penalty: -5 }), null);
    assert.equal(reco.reasonFromComponents(null), null);
    assert.equal(reco.reasonFromComponents({ trending: 'NaN' }), null);
  });

  test('applyRankReasons strips the score arithmetic unless asked to explain, and keeps an existing reason', () => {
    const rows = () => [
      { id: 1, rank_score: 4, rank_components: { trending: 2 } },
      { id: 2, rank_score: 3, rank_components: { trending: 2 }, recommendation_reason: 'catalog' },
    ];
    const hidden = reco.applyRankReasons(rows());
    assert.equal(hidden[0].recommendation_reason, 'trending');
    assert.equal(hidden[1].recommendation_reason, 'catalog');
    assert.equal('rank_score' in hidden[0], false);
    assert.equal('rank_components' in hidden[0], false);

    const shown = reco.applyRankReasons(rows(), { explain: true });
    assert.deepEqual(shown[0].rank_components, { trending: 2 });
  });
});

// ── 5. getFeed ──────────────────────────────────────────────────────────────────────────────────
describe('Recommendation — getFeed integration', () => {
  function feedDb({ affinity = {}, capture = true } = {}) {
    const rowsOut = [
      { id: 1, ref: 'P1', slug: 'p1', title_en: 'A', title_bn: 'A', category_id: 3, supplier_id: 9, brand: 'Aarong',
        base_cost: '100.00', wholesale_margin: '0.00', default_retail_price: '150.00', price: '150.00',
        stock_qty: 5, status: 'ACTIVE', sold_count: 1, rating_avg: '4.0',
        rank_score: 4.2, rank_components: { trending: 2.2, quality: 1.5 } },
    ];
    return makeDb([
      { match: (s) => s.includes("key = 'personalization_signals'"), reply: () => ({ rows: [{ is_enabled: capture, settings_json: {} }] }) },
      { match: (s) => s.includes('e.category_id AS dim'), reply: () => ({ rows: (affinity.categoryIds || []).map((d) => ({ dim: String(d) })) }) },
      { match: (s) => s.includes('FROM products p'), reply: () => ({ rows: rowsOut }) },
    ]);
  }
  const catalogCall = (db) => db.calls.find((c) => c.sql.includes('FROM products p'));

  test('the catalog query orders by the blended score and exposes no internals in the response', async () => {
    const db = feedDb();
    const res = await feed.getFeed(db, { sessionId: 'sess-1' });
    const call = catalogCall(db);
    assert.match(call.sql, /AS rank_score/);
    assert.match(call.sql, /ORDER BY rank_score DESC/);
    assert.equal(res.products[0].recommendation_reason, 'trending', 'reason comes from the score, not sold_count');
    assert.equal('rank_components' in res.products[0], false);
    assert.equal('rank_score' in res.products[0], false);
  });

  test('opting out removes every personal signal from the query, not only the affinity boost', async () => {
    const db = feedDb({ affinity: { categoryIds: [3] } });
    await feed.getFeed(db, { userId: 7, personalize: false });
    const sql = catalogCall(db).sql;
    for (const name of ['affinity_category', 'recently_viewed', 'locality', 'already_bought_penalty']) {
      assert.equal(sql.includes(`'${name}'`), false, name);
    }
    assert.equal(db.calls.some((c) => c.sql.includes('FROM user_profiles')), false, 'district must not be read');
    assert.equal(db.calls.some((c) => c.sql.includes("event_type IN ('CLICK'")), false, 'history must not be read');
  });

  test('capture switched off by the platform degrades the same way', async () => {
    const db = feedDb({ affinity: { categoryIds: [3] }, capture: false });
    await feed.getFeed(db, { userId: 7 });
    assert.equal(catalogCall(db).sql.includes("'affinity_category'"), false);
  });
});
