/**
 * homeRails.test.js — Invariants for Phase C of the personalized home feed (the home page rails,
 * migration 057).
 *
 *   1. Layout      — the rail list is a setting: the shipped default equals the migration, a bad
 *                    field falls back to that rail's own default, unknown/duplicate rails are dropped.
 *   2. Profiles    — a rail listens to its own signals only; penalties always stay on.
 *   3. getRails    — a rail must earn its name, a product appears in only one rail, a thin rail is
 *                    hidden, opted-out shoppers get no personal rail, a failing rail costs one rail.
 *   4. Catalog     — the productIds filter binds an array and an empty array matches nothing.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as rails from '../src/services/homeRails.service.js';
import * as reco from '../src/services/recommendation.service.js';
import * as diversityService from '../src/services/diversity.service.js';
import * as productRepo from '../src/repositories/product.repository.js';

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

const NOW = Date.parse('2026-10-08T00:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

function product(id, components = {}, over = {}) {
  return {
    id, ref: `P${id}`, slug: `p${id}`, title_en: `Product ${id}`, title_bn: `Product ${id}`,
    category_id: 3, supplier_id: 9, brand: 'Aarong',
    base_cost: '100.00', wholesale_margin: '0.00', default_retail_price: '150.00', price: '150.00',
    stock_qty: 5, status: 'ACTIVE', sold_count: 1, rating_avg: '4.0', created_at: daysAgo(3),
    rank_score: 3, rank_components: { quality: 1.5, ...components },
    ...over,
  };
}

/**
 * A db whose settings row carries `config` and whose catalog answers with whatever `catalog(sql)`
 * returns, so a test can give each rail its own candidates by looking at the SQL it sent.
 *
 * A rail now costs two product queries: the thin ranked candidate query (its SQL carries
 * `rank_score`) and the hydration of the winners by id (an `p.id = ANY` filter with no score). The
 * fake answers the second one the way Postgres would, by keeping only the rows asked for.
 *
 * `diversity` is the recommendation.diversity row's value (absent = the shipped defaults).
 */
function railsDb({ config, catalog, capture = true, district = null, viewed = [], diversity = null } = {}) {
  return makeDb([
    {
      match: (s) => s.includes('FROM platform_settings'),
      reply: () => ({
        rows: [
          ...(config ? [{ key: rails.RAILS_KEY, value_json: config }] : []),
          ...(diversity ? [{ key: 'recommendation.diversity', value_json: diversity }] : []),
        ],
      }),
    },
    { match: (s) => s.includes("key = 'personalization_signals'"), reply: () => ({ rows: [{ is_enabled: capture, settings_json: {} }] }) },
    { match: (s) => s.includes('FROM user_profiles'), reply: () => ({ rows: district ? [{ district }] : [] }) },
    {
      match: (s) => s.includes("event_type IN ('CLICK'"),
      reply: () => ({ rows: viewed.map((id, i) => ({ product_id: id, last_at: daysAgo(i) })) }),
    },
    {
      match: (s) => s.includes('FROM products p'),
      reply: (sql, params) => {
        const flat = sql.replace(/\s+/g, ' ');
        let rows = catalog(flat, params);
        if (!flat.includes('rank_score') && flat.includes('p.id = ANY')) {
          const ids = params.find(Array.isArray) || [];
          rows = rows.filter((r) => ids.includes(r.id));
        }
        return { rows };
      },
    },
  ]);
}

const cfg = (railList, min_items = 2) => ({ min_items, rails: railList });
const railCall = (db, needle) => db.calls.find((c) => c.sql.includes('FROM products p') && c.sql.includes(needle));

// ── 1. Layout ───────────────────────────────────────────────────────────────────────────────────
describe('Home rails — layout policy', () => {
  test('shipped defaults are exactly what migration 057 seeds', () => {
    const sql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/db/migrations/057_home_rails_settings.sql'),
      'utf8'
    );
    const m = sql.match(/'recommendation\.rails',\s*'(\{[\s\S]*?\})'::jsonb/);
    assert.ok(m, 'recommendation.rails must be seeded');
    assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(rails.DEFAULT_RAILS_CONFIG)));
  });

  test('every default rail is a known rail and sits inside its limits', () => {
    for (const r of rails.DEFAULT_RAILS_CONFIG.rails) {
      assert.ok(rails.RAIL_KEYS.includes(r.key), r.key);
      assert.ok(r.limit >= rails.RAIL_LIMITS.limit.min && r.limit <= rails.RAIL_LIMITS.limit.max, r.key);
    }
  });

  test('unknown and repeated rails are dropped, order is kept', () => {
    const out = rails.sanitizeRailsConfig({
      min_items: 3,
      rails: [
        { key: 'trending', limit: 8 },
        { key: 'nonsense', limit: 8 },
        { key: 'for_you' },
        { key: 'trending', limit: 20 },
      ],
    });
    assert.deepEqual(out.rails.map((r) => r.key), ['trending', 'for_you']);
    assert.equal(out.rails[0].limit, 8, 'the first mention wins');
  });

  test('a bad field falls back to that rail\'s own default and keeps the rest', () => {
    const out = rails.sanitizeRailsConfig({
      min_items: 'lots',
      rails: [{ key: 'trending', limit: 9999, enabled: 'yes' }, { key: 'for_you', limit: 5, enabled: false }],
    });
    assert.equal(out.min_items, rails.DEFAULT_RAILS_CONFIG.min_items);
    assert.equal(out.rails[0].limit, 12);
    assert.equal(out.rails[0].enabled, true);
    assert.deepEqual(out.rails[1], { key: 'for_you', enabled: false, limit: 5 });
  });

  test('null and empty values are rejected, not read as zero', () => {
    const out = rails.sanitizeRailsConfig({ min_items: null, rails: [{ key: 'for_you', limit: null }, { key: 'trending', limit: '' }] });
    assert.equal(out.min_items, rails.DEFAULT_RAILS_CONFIG.min_items);
    assert.equal(out.rails[0].limit, 12);
    assert.equal(out.rails[1].limit, 12);
  });

  test('only new_arrivals carries a window, and a bad one falls back', () => {
    const out = rails.sanitizeRailsConfig({
      rails: [{ key: 'new_arrivals', window_days: 0 }, { key: 'trending', window_days: 5 }],
    });
    assert.equal(out.rails[0].window_days, 30);
    assert.equal('window_days' in out.rails[1], false);
  });

  test('a missing list means the shipped layout; an empty list is respected', () => {
    assert.equal(rails.sanitizeRailsConfig(null).rails.length, rails.DEFAULT_RAILS_CONFIG.rails.length);
    assert.equal(rails.sanitizeRailsConfig({ rails: 'x' }).rails.length, rails.DEFAULT_RAILS_CONFIG.rails.length);
    assert.deepEqual(rails.sanitizeRailsConfig({ rails: [] }).rails, []);
  });

  test('an unreadable settings table yields the shipped layout', async () => {
    const db = { async query() { throw new Error('relation does not exist'); } };
    const out = await rails.resolveRailsConfig(db);
    assert.equal(out.rails.length, rails.DEFAULT_RAILS_CONFIG.rails.length);
  });

  test('a JSON string value (text column / mock db) is parsed', async () => {
    const db = railsDb({ config: JSON.stringify(cfg([{ key: 'trending', enabled: true, limit: 6 }], 2)), catalog: () => [] });
    const out = await rails.resolveRailsConfig(db);
    assert.deepEqual(out.rails.map((r) => r.limit), [6]);
  });
});

// ── 2. Profiles ─────────────────────────────────────────────────────────────────────────────────
describe('Home rails — profiles', () => {
  test('a profile keeps its own signals at the admin\'s strength and zeroes the other positives', () => {
    const w = rails.profileWeights(reco.DEFAULT_WEIGHTS, ['trending', 'quality']);
    assert.equal(w.trending, reco.DEFAULT_WEIGHTS.trending);
    assert.equal(w.quality, reco.DEFAULT_WEIGHTS.quality);
    for (const off of ['affinity_category', 'affinity_brand', 'affinity_supplier', 'recently_viewed', 'bestseller', 'recent_sales', 'freshness', 'trust_tier', 'locality']) {
      assert.equal(w[off], 0, off);
    }
  });

  test('penalties are never switched off by a profile', () => {
    const w = rails.profileWeights(reco.DEFAULT_WEIGHTS, ['freshness']);
    for (const p of ['out_of_stock_penalty', 'return_rate_penalty', 'already_bought_penalty']) {
      assert.equal(w[p], reco.DEFAULT_WEIGHTS[p], p);
    }
  });

  test('no signal list means the full weights, as a copy', () => {
    const w = rails.profileWeights(reco.DEFAULT_WEIGHTS, null);
    assert.deepEqual(w, reco.DEFAULT_WEIGHTS);
    assert.notEqual(w, reco.DEFAULT_WEIGHTS);
  });

  test('every profile names only signals that exist', () => {
    for (const [key, p] of Object.entries(rails.RAIL_PROFILES)) {
      for (const s of [...(p.signals || []), ...(p.require || [])]) {
        assert.ok(s in reco.DEFAULT_WEIGHTS, `${key}: ${s}`);
      }
    }
  });
});

// ── 3. getRails ─────────────────────────────────────────────────────────────────────────────────
describe('Home rails — getRails', () => {
  const trendingRows = (from, n, comp = { trending: 2 }) =>
    Array.from({ length: n }, (_, i) => product(from + i, comp));

  test('a rail has to earn its name: no trending component, no Trending rail', async () => {
    const db = railsDb({
      config: cfg([{ key: 'trending', enabled: true, limit: 6 }]),
      catalog: () => trendingRows(1, 6, { quality: 1.5 }),
    });
    const res = await rails.getRails(db, { sessionId: 's', now: NOW });
    assert.deepEqual(res.rails, []);
  });

  test('a qualifying rail is returned with no score internals', async () => {
    const db = railsDb({
      config: cfg([{ key: 'trending', enabled: true, limit: 6 }]),
      catalog: () => trendingRows(1, 6),
    });
    const res = await rails.getRails(db, { sessionId: 's', now: NOW });
    assert.equal(res.rails.length, 1);
    assert.equal(res.rails[0].key, 'trending');
    assert.equal(res.rails[0].products.length, 6);
    assert.equal('rank_components' in res.rails[0].products[0], false);
    assert.equal('rank_score' in res.rails[0].products[0], false);
    assert.equal(res.meta.count, 1);
  });

  test('a product appears in only the first rail that claims it', async () => {
    const db = railsDb({
      config: cfg([
        { key: 'trending', enabled: true, limit: 4 },
        { key: 'bestsellers', enabled: true, limit: 4 },
      ]),
      catalog: () => trendingRows(1, 8, { trending: 2, bestseller: 1 }),
    });
    const res = await rails.getRails(db, { sessionId: 's', now: NOW });
    const ids = res.rails.flatMap((r) => r.products.map((p) => p.id));
    assert.equal(new Set(ids).size, ids.length, 'no product twice');
    assert.deepEqual(res.rails[0].products.map((p) => p.id), [1, 2, 3, 4]);
    assert.deepEqual(res.rails[1].products.map((p) => p.id), [5, 6, 7, 8]);
  });

  test('a rail with fewer than min_items products is not shown, and does not claim them', async () => {
    const db = railsDb({
      config: cfg([
        { key: 'trending', enabled: true, limit: 6 },
        { key: 'bestsellers', enabled: true, limit: 6 },
      ], 3),
      catalog: (sql) => (sql.includes("'trending'") ? trendingRows(1, 2) : trendingRows(1, 5, { bestseller: 1 })),
    });
    const res = await rails.getRails(db, { sessionId: 's', now: NOW });
    assert.deepEqual(res.rails.map((r) => r.key), ['bestsellers']);
    assert.equal(res.rails[0].products.length, 5, 'the thin rail did not take products from it');
  });

  test('a disabled rail is not queried at all', async () => {
    const db = railsDb({
      config: cfg([{ key: 'trending', enabled: false, limit: 6 }, { key: 'bestsellers', enabled: true, limit: 6 }]),
      catalog: () => trendingRows(1, 6, { bestseller: 1 }),
    });
    await rails.getRails(db, { sessionId: 's', now: NOW });
    assert.equal(db.calls.filter((c) => c.sql.includes('rank_score')).length, 1, 'only bestsellers is ranked');
  });

  test('every rail disabled: no ranking work is done', async () => {
    const db = railsDb({ config: cfg([{ key: 'trending', enabled: false, limit: 6 }]), catalog: () => [] });
    const res = await rails.getRails(db, { sessionId: 's', now: NOW });
    assert.deepEqual(res, { rails: [], meta: { count: 0 } });
    assert.equal(db.calls.some((c) => c.sql.includes('FROM products p')), false);
  });

  test('only in-stock, active products are asked for', async () => {
    const db = railsDb({
      config: cfg([{ key: 'bestsellers', enabled: true, limit: 4 }]),
      catalog: () => trendingRows(1, 4, { bestseller: 1 }),
    });
    await rails.getRails(db, { sessionId: 's', now: NOW });
    const call = railCall(db, 'FROM products p');
    assert.match(call.sql, /p\.stock_qty > 0/);
    assert.ok(call.params.includes('ACTIVE'));
  });

  test('a rail only listens to its own signals in the SQL it sends', async () => {
    const db = railsDb({
      config: cfg([{ key: 'trending', enabled: true, limit: 4 }]),
      catalog: () => trendingRows(1, 4),
      viewed: [1, 2],
    });
    await rails.getRails(db, { sessionId: 's', now: NOW });
    const sql = railCall(db, 'rank_score').sql;
    assert.ok(sql.includes("'trending'"));
    for (const off of ['affinity_category', 'bestseller', 'freshness', 'locality']) {
      assert.equal(sql.includes(`'${off}'`), false, off);
    }
  });

  test('new_arrivals drops listings older than its window', async () => {
    const db = railsDb({
      config: cfg([{ key: 'new_arrivals', enabled: true, limit: 6, window_days: 30 }]),
      catalog: () => [
        ...Array.from({ length: 3 }, (_, i) => product(i + 1, { freshness: 0.9 }, { created_at: daysAgo(5) })),
        ...Array.from({ length: 3 }, (_, i) => product(i + 10, { freshness: 0.4 }, { created_at: daysAgo(90) })),
      ],
    });
    const res = await rails.getRails(db, { sessionId: 's', now: NOW });
    assert.deepEqual(res.rails[0].products.map((p) => p.id), [1, 2, 3]);
  });

  test('continue_browsing needs history: none, no rail and no catalog query', async () => {
    const db = railsDb({ config: cfg([{ key: 'continue_browsing', enabled: true, limit: 6 }]), catalog: () => [] });
    const res = await rails.getRails(db, { sessionId: 's', now: NOW });
    assert.deepEqual(res.rails, []);
    assert.equal(db.calls.some((c) => c.sql.includes('FROM products p')), false);
  });

  test('continue_browsing asks for exactly the viewed ids, most recent first', async () => {
    const db = railsDb({
      config: cfg([{ key: 'continue_browsing', enabled: true, limit: 6 }]),
      viewed: [30, 10, 20],
      catalog: () => [product(10), product(20), product(30)],
    });
    const res = await rails.getRails(db, { sessionId: 's', now: NOW });
    const call = railCall(db, 'p.id = ANY');
    assert.ok(call, 'filters by id');
    assert.deepEqual(call.params.find((p) => Array.isArray(p)), [30, 10, 20]);
    assert.deepEqual(res.rails[0].products.map((p) => p.id), [30, 10, 20]);
    assert.equal(res.rails[0].personalized, true);
  });

  test('near_you needs a district: a guest never gets it', async () => {
    const db = railsDb({ config: cfg([{ key: 'near_you', enabled: true, limit: 6 }]), catalog: () => trendingRows(1, 6, { locality: 1 }) });
    const res = await rails.getRails(db, { sessionId: 's', now: NOW });
    assert.deepEqual(res.rails, []);
  });

  test('near_you with a district is returned and marked personal', async () => {
    const db = railsDb({
      config: cfg([{ key: 'near_you', enabled: true, limit: 6 }]),
      district: 'Sylhet',
      catalog: () => trendingRows(1, 6, { locality: 1 }),
    });
    const res = await rails.getRails(db, { userId: 7, now: NOW });
    assert.equal(res.rails[0].key, 'near_you');
    assert.equal(res.rails[0].personalized, true);
  });

  test('for_you says whether it is personal: false for a cold guest, true with history', async () => {
    const cold = railsDb({ config: cfg([{ key: 'for_you', enabled: true, limit: 4 }]), catalog: () => trendingRows(1, 4) });
    assert.equal((await rails.getRails(cold, { sessionId: 's', now: NOW })).rails[0].personalized, false);

    const warm = railsDb({
      config: cfg([{ key: 'for_you', enabled: true, limit: 4 }]),
      catalog: () => trendingRows(1, 4),
      viewed: [5, 6],
    });
    assert.equal((await rails.getRails(warm, { sessionId: 's', now: NOW })).rails[0].personalized, true);
  });

  test('an opted-out shopper gets no personal rail and nothing about them is read', async () => {
    const db = railsDb({
      config: cfg([
        { key: 'continue_browsing', enabled: true, limit: 4 },
        { key: 'near_you', enabled: true, limit: 4 },
        { key: 'for_you', enabled: true, limit: 4 },
      ]),
      district: 'Sylhet',
      viewed: [1, 2, 3],
      catalog: () => trendingRows(1, 4, { locality: 1 }),
    });
    const res = await rails.getRails(db, { userId: 7, personalize: false, now: NOW });
    assert.deepEqual(res.rails.map((r) => r.key), ['for_you']);
    assert.equal(res.rails[0].personalized, false);
    assert.equal(db.calls.some((c) => c.sql.includes('FROM user_profiles')), false);
    assert.equal(db.calls.some((c) => c.sql.includes("event_type IN ('CLICK'")), false);
  });

  test('capture switched off by the platform degrades the same way', async () => {
    const db = railsDb({
      config: cfg([{ key: 'continue_browsing', enabled: true, limit: 4 }, { key: 'for_you', enabled: true, limit: 4 }]),
      capture: false,
      viewed: [1, 2, 3, 4],
      catalog: () => trendingRows(1, 4),
    });
    const res = await rails.getRails(db, { userId: 7, now: NOW });
    assert.deepEqual(res.rails.map((r) => r.key), ['for_you']);
  });

  test('one failing rail costs that rail, not the page', async () => {
    let n = 0;
    const db = railsDb({
      config: cfg([{ key: 'trending', enabled: true, limit: 4 }, { key: 'bestsellers', enabled: true, limit: 4 }]),
      catalog: (sql) => {
        n += 1;
        if (sql.includes("'trending'")) throw new Error('boom');
        return trendingRows(1, 4, { bestseller: 1 });
      },
    });
    const res = await rails.getRails(db, { sessionId: 's', now: NOW });
    assert.ok(n >= 2);
    assert.deepEqual(res.rails.map((r) => r.key), ['bestsellers']);
  });

  test('the fetch size is bounded however large the settings are', async () => {
    const db = railsDb({
      config: cfg(rails.RAIL_KEYS.map((key) => ({ key, enabled: true, limit: 30 }))),
      district: 'Sylhet',
      viewed: [1],
      catalog: () => [],
    });
    await rails.getRails(db, { userId: 7, now: NOW });
    const ranked = db.calls.filter((x) => x.sql.includes('rank_score'));
    assert.ok(ranked.length >= 4, 'the ranked rails were actually queried');
    for (const c of ranked) {
      const limit = c.params[c.params.length - 2];
      assert.ok(limit <= diversityService.DIVERSITY_LIMITS.pool_size.max, `limit ${limit}`);
    }
  });

  test('with diversity off the fetch is the old bound', async () => {
    const db = railsDb({
      config: cfg(rails.RAIL_KEYS.map((key) => ({ key, enabled: true, limit: 30 }))),
      diversity: { enabled: false },
      district: 'Sylhet',
      viewed: [1],
      catalog: () => [],
    });
    await rails.getRails(db, { userId: 7, now: NOW });
    const ranked = db.calls.filter((x) => x.sql.includes('rank_score'));
    assert.ok(ranked.length >= 4);
    for (const c of ranked) assert.ok(c.params[c.params.length - 2] <= 60, `limit ${c.params[c.params.length - 2]}`);
  });
});

// ── 4. Catalog filter ───────────────────────────────────────────────────────────────────────────
describe('Home rails — catalog productIds filter', () => {
  test('binds the ids as one array parameter', async () => {
    const db = makeDb();
    await productRepo.listProducts(db, { productIds: [4, 5], sortBy: 'newest', limit: 2 });
    const call = db.calls[0];
    assert.match(call.sql, /p\.id = ANY\(\$\d+::bigint\[\]\)/);
    assert.ok(call.params.some((p) => Array.isArray(p) && p.join() === '4,5'));
  });

  test('without the filter nothing changes', async () => {
    const db = makeDb();
    await productRepo.listProducts(db, { sortBy: 'newest', limit: 2 });
    assert.equal(db.calls[0].sql.includes('p.id = ANY'), false);
  });
});
