/**
 * diversity.test.js — Invariants for Phase D of the personalized home feed (candidate pool +
 * diversity re-rank, migration 058).
 *
 *   1. Policy      — the shipped defaults equal the migration, a bad field falls back to its own
 *                    default, null/'' are not read as zero, exploration can be switched off with 0.
 *   2. diversify   — a re-order and nothing else: every candidate appears exactly once, the top
 *                    candidate stays first, a cap spreads a dominant supplier out, and a pool that
 *                    cannot satisfy a cap is left in score order instead of being shortened.
 *   3. Exploration — every Nth slot goes to a product unrelated to the shopper's profile, and does so
 *                    only when the shopper has a profile and a candidate that respects the caps.
 *   4. getFeed     — the page is cut from the diversified pool (so pages never overlap or skip),
 *                    only the page is hydrated, and diversity off restores the SQL OFFSET path.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as diversity from '../src/services/diversity.service.js';
import * as feed from '../src/services/discoveryFeed.service.js';

const CFG = { ...diversity.DEFAULT_DIVERSITY, explore_every: 0 };

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

let nextId = 1;
const row = (supplier, over = {}) => ({
  id: nextId++,
  supplier_id: supplier,
  category_id: over.category_id ?? 1000 + nextId, // distinct by default so only the supplier cap bites
  brand: over.brand ?? `brand-${nextId}`,
  rank_components: over.rank_components ?? {},
  ...over,
});
const ids = (list) => list.map((r) => r.id);

/** The largest number of picks from one supplier inside any run of `window` consecutive picks. */
function worstWindow(list, window, dim = 'supplier_id') {
  let worst = 0;
  for (let i = 0; i < list.length; i++) {
    const counts = new Map();
    for (const r of list.slice(i, i + window)) counts.set(r[dim], (counts.get(r[dim]) || 0) + 1);
    worst = Math.max(worst, ...counts.values());
  }
  return worst;
}

// ── 1. Policy ───────────────────────────────────────────────────────────────────────────────────
describe('Diversity — policy', () => {
  test('shipped defaults are exactly what migration 058 seeds', () => {
    const sql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/db/migrations/058_recommendation_diversity_settings.sql'),
      'utf8'
    );
    const m = sql.match(/'recommendation\.diversity',\s*'(\{[\s\S]*?\})'::jsonb/);
    assert.ok(m, 'recommendation.diversity must be seeded');
    assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(diversity.DEFAULT_DIVERSITY)));
  });

  test('every default sits inside its own limits', () => {
    for (const [key, { min, max, allowZero }] of Object.entries(diversity.DIVERSITY_LIMITS)) {
      const v = diversity.DEFAULT_DIVERSITY[key];
      assert.ok((allowZero && v === 0) || (v >= min && v <= max), key);
    }
  });

  test('a missing or malformed value means the defaults', () => {
    for (const raw of [undefined, null, 'x', 5, []]) {
      assert.deepEqual(diversity.sanitizeDiversity(raw), diversity.DEFAULT_DIVERSITY);
    }
  });

  test('a bad field falls back to its own default and keeps the rest', () => {
    const out = diversity.sanitizeDiversity({ window: 9999, max_per_supplier: 1, pool_size: 'lots', enabled: 'yes', explore_every: 1.5 });
    assert.equal(out.window, diversity.DEFAULT_DIVERSITY.window);
    assert.equal(out.max_per_supplier, 1, 'the usable field is kept');
    assert.equal(out.pool_size, diversity.DEFAULT_DIVERSITY.pool_size);
    assert.equal(out.enabled, true);
    assert.equal(out.explore_every, diversity.DEFAULT_DIVERSITY.explore_every);
  });

  test('null and empty values are rejected, not read as zero', () => {
    const out = diversity.sanitizeDiversity({ max_per_supplier: null, max_per_category: '', explore_every: null });
    assert.equal(out.max_per_supplier, diversity.DEFAULT_DIVERSITY.max_per_supplier);
    assert.equal(out.max_per_category, diversity.DEFAULT_DIVERSITY.max_per_category);
    assert.equal(out.explore_every, diversity.DEFAULT_DIVERSITY.explore_every);
  });

  test('exploration can be switched off with 0, but 1 (every slot) is out of range', () => {
    assert.equal(diversity.sanitizeDiversity({ explore_every: 0 }).explore_every, 0);
    assert.equal(diversity.sanitizeDiversity({ explore_every: 1 }).explore_every, diversity.DEFAULT_DIVERSITY.explore_every);
  });

  test('a zero cap is out of range (it would forbid every product)', () => {
    assert.equal(diversity.sanitizeDiversity({ max_per_supplier: 0 }).max_per_supplier, diversity.DEFAULT_DIVERSITY.max_per_supplier);
  });

  test('enabled=false is respected', () => {
    assert.equal(diversity.sanitizeDiversity({ enabled: false }).enabled, false);
  });

  test('an unreadable settings table yields the defaults', async () => {
    const db = { async query() { throw new Error('relation does not exist'); } };
    assert.deepEqual(await diversity.resolveDiversityConfig(db), diversity.DEFAULT_DIVERSITY);
  });

  test('a JSON string value (text column / mock db) is parsed', async () => {
    const db = makeDb([
      {
        match: (s) => s.includes('FROM platform_settings'),
        reply: () => ({ rows: [{ key: diversity.DIVERSITY_KEY, value_json: JSON.stringify({ window: 4 }) }] }),
      },
    ]);
    assert.equal((await diversity.resolveDiversityConfig(db)).window, 4);
  });
});

// ── 2. diversify ────────────────────────────────────────────────────────────────────────────────
describe('Diversity — re-rank', () => {
  test('disabled means score order, as a copy', () => {
    const list = [row(1), row(1), row(1)];
    const out = diversity.diversify(list, { ...CFG, enabled: false });
    assert.deepEqual(ids(out), ids(list));
    assert.notEqual(out, list);
  });

  test('empty and single-item lists pass through', () => {
    assert.deepEqual(diversity.diversify([], CFG), []);
    const one = [row(1)];
    assert.deepEqual(ids(diversity.diversify(one, CFG)), ids(one));
    assert.deepEqual(diversity.diversify(null, CFG), []);
  });

  test('the input is not mutated', () => {
    const list = [row(1), row(1), row(1), row(2), row(3)];
    const before = ids(list);
    diversity.diversify(list, CFG);
    assert.deepEqual(ids(list), before);
  });

  test('a supplier that owns the top of the pool is spread out', () => {
    // Four suppliers: with only three, a cap of 2 per 6 is saturated by the three of them alone.
    const list = [
      ...Array.from({ length: 8 }, () => row(1)),
      ...Array.from({ length: 4 }, () => row(2)),
      ...Array.from({ length: 4 }, () => row(3)),
      ...Array.from({ length: 4 }, () => row(4)),
    ];
    const out = diversity.diversify(list, CFG);
    assert.equal(worstWindow(out.slice(0, 14), 6), 2, 'no supplier more than twice in any 6 while others exist');
    assert.equal(out[0].id, list[0].id, 'the best product still leads');
  });

  test('nothing is dropped or duplicated', () => {
    // A deterministic spread of suppliers, categories and brands, including nulls.
    const list = Array.from({ length: 80 }, (_, i) =>
      row((i * 7) % 5, { category_id: (i * 3) % 4, brand: i % 9 === 0 ? null : `b${i % 6}` })
    );
    const out = diversity.diversify(list, { ...diversity.DEFAULT_DIVERSITY });
    assert.equal(out.length, list.length);
    assert.deepEqual(ids(out).sort((a, b) => a - b), ids(list).sort((a, b) => a - b));
  });

  test('a held-back product keeps its order among its own supplier', () => {
    const list = [row(1), row(1), row(1), row(1), row(2), row(3)];
    const out = diversity.diversify(list, CFG);
    const fromOne = out.filter((r) => r.supplier_id === 1);
    assert.deepEqual(ids(fromOne), ids(list.filter((r) => r.supplier_id === 1)));
  });

  test('a pool the caps cannot satisfy is left in score order, not shortened', () => {
    const list = Array.from({ length: 10 }, () => row(1));
    const out = diversity.diversify(list, CFG);
    assert.deepEqual(ids(out), ids(list));
  });

  test('the category cap works on its own dimension', () => {
    const list = [
      ...Array.from({ length: 6 }, (_, i) => row(100 + i, { category_id: 7, brand: `x${i}` })),
      ...Array.from({ length: 6 }, (_, i) => row(200 + i, { category_id: 8, brand: `y${i}` })),
    ];
    const out = diversity.diversify(list, { ...CFG, max_per_supplier: 30, max_per_brand: 30 });
    assert.ok(worstWindow(out, 6, 'category_id') <= 3);
  });

  test('the brand cap works, and a product with no brand is never capped', () => {
    const branded = Array.from({ length: 6 }, (_, i) => row(100 + i, { brand: 'Aarong' }));
    const unbranded = Array.from({ length: 6 }, (_, i) => row(200 + i, { brand: null }));
    const cfg = { ...CFG, max_per_supplier: 30, max_per_category: 30, max_per_brand: 1, window: 4 };
    const out = diversity.diversify([...branded, ...unbranded], cfg);
    assert.ok(worstWindow(out.filter((r) => r.brand), 4, 'brand') <= 6, 'sanity');
    // Within any 4 picks at most one Aarong — the unbranded ones fill the gaps.
    for (let i = 0; i + 4 <= out.length; i++) {
      const aarong = out.slice(i, i + 4).filter((r) => r.brand === 'Aarong').length;
      const spare = out.slice(i + 4).some((r) => r.brand !== 'Aarong');
      if (spare) assert.ok(aarong <= 1, `window at ${i}`);
    }
    assert.equal(out.length, 12);
  });

  test('supplier ids compare as the same supplier whether number or string', () => {
    const list = [row(5), row('5'), row(5), row(6)];
    const out = diversity.diversify(list, { ...CFG, window: 3, max_per_supplier: 1 });
    assert.equal(out[1].supplier_id, 6, 'the string "5" is not a different supplier');
  });
});

// ── 3. Exploration ──────────────────────────────────────────────────────────────────────────────
describe('Diversity — exploration', () => {
  const personal = (supplier, over = {}) => row(supplier, { rank_components: { affinity_category: 3 }, ...over });
  const stranger = (supplier, over = {}) => row(supplier, { rank_components: { quality: 1.5 }, ...over });
  const EXPLORE = { ...diversity.DEFAULT_DIVERSITY, explore_every: 3, max_per_supplier: 30, max_per_category: 30, max_per_brand: 30 };

  test('every Nth slot is a product unrelated to the shopper\'s profile', () => {
    const list = [...Array.from({ length: 6 }, (_, i) => personal(i)), ...Array.from({ length: 3 }, (_, i) => stranger(50 + i))];
    const out = diversity.diversify(list, EXPLORE);
    assert.ok(!out[2].rank_components.affinity_category, 'slot 3 is exploration');
    assert.ok(!out[5].rank_components.affinity_category, 'slot 6 is exploration');
    assert.ok(out[0].rank_components.affinity_category, 'slots before it are the shopper\'s own');
  });

  test('without a profile there is nothing to explore away from: plain score order', () => {
    const list = Array.from({ length: 9 }, (_, i) => stranger(i));
    assert.deepEqual(ids(diversity.diversify(list, EXPLORE)), ids(list));
  });

  test('explore_every 0 switches exploration off', () => {
    const list = [...Array.from({ length: 6 }, (_, i) => personal(i)), ...Array.from({ length: 3 }, (_, i) => stranger(50 + i))];
    assert.deepEqual(ids(diversity.diversify(list, { ...EXPLORE, explore_every: 0 })), ids(list));
  });

  test('with no unrelated product left, the slot goes to the best remaining one', () => {
    const list = Array.from({ length: 6 }, (_, i) => personal(i));
    const out = diversity.diversify(list, EXPLORE);
    assert.deepEqual(ids(out), ids(list));
  });

  test('an exploration pick still respects the caps', () => {
    const list = [
      personal(1), personal(2), personal(3), personal(4),
      stranger(9), stranger(9), stranger(9), stranger(8),
    ];
    // Slot 3 would be supplier 9's first stranger; slot 6 may not be a third supplier-9 product in a window of 3.
    const out = diversity.diversify(list, { ...EXPLORE, window: 3, max_per_supplier: 1 });
    assert.equal(worstWindow(out.slice(0, 5), 3), 1);
  });

  test('exploration never drops or duplicates a candidate', () => {
    const list = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? stranger(i % 7) : personal(i % 5)));
    const out = diversity.diversify(list, { ...diversity.DEFAULT_DIVERSITY });
    assert.deepEqual(ids(out).sort((a, b) => a - b), ids(list).sort((a, b) => a - b));
  });
});

// ── 4. getFeed ──────────────────────────────────────────────────────────────────────────────────
describe('Diversity — getFeed uses the diversified pool', () => {
  /**
   * A catalog where supplier 1 owns the 12 best products. The fake answers the thin pool query (the
   * one carrying rank_score) with the top LIMIT rows, and the hydration query (a p.id = ANY filter)
   * with exactly the ids asked for — the way Postgres would — so a test can tell which one ran.
   */
  function feedDb({ diversityRow = null, total = 30 } = {}) {
    const catalog = Array.from({ length: total }, (_, i) => ({
      id: i + 1,
      ref: `PRD-${i + 1}`,
      title_en: `Product ${i + 1}`,
      supplier_id: i < 12 ? 1 : 2 + (i % 5),
      category_id: 100 + i,
      brand: `brand-${i}`,
      created_at: '2026-10-01T00:00:00Z',
      base_cost: '100.00',
      wholesale_margin: '0.00',
      default_retail_price: '150.00',
      price: '150.00',
      stock_qty: 5,
      status: 'ACTIVE',
      rank_score: 100 - i,
      rank_components: { quality: 1 },
    }));
    return makeDb([
      {
        match: (s) => s.includes('FROM platform_settings'),
        reply: () => ({ rows: diversityRow ? [{ key: diversity.DIVERSITY_KEY, value_json: diversityRow }] : [] }),
      },
      { match: (s) => s.includes("FROM platform_modules WHERE key = 'discovery_feed'"), reply: () => ({ rows: [{ settings_json: { page_size: 6 } }] }) },
      { match: (s) => s.includes("key = 'personalization_signals'"), reply: () => ({ rows: [{ is_enabled: true, settings_json: {} }] }) },
      {
        match: (s) => s.includes('FROM products p'),
        reply: (sql, params) => {
          const flat = sql.replace(/\s+/g, ' ');
          if (flat.includes('rank_score')) {
            const limit = params[params.length - 2];
            const offset = params[params.length - 1];
            return { rows: catalog.slice(offset, offset + limit).map(({ id, supplier_id, category_id, brand, created_at, rank_score, rank_components }) => ({ id, supplier_id, category_id, brand, created_at, rank_score, rank_components })) };
          }
          const wanted = params.find(Array.isArray) || [];
          return { rows: catalog.filter((r) => wanted.includes(r.id)) };
        },
      },
    ]);
  }

  test('the first page is not one supplier, though one supplier owns the top of the score', async () => {
    const res = await feed.getFeed(feedDb(), { userId: 7 });
    assert.equal(res.products.length, 6);
    assert.ok(worstWindow(res.products, 6) <= 2);
  });

  test('pages are cut from one order: no overlap, no skip, and has_more is exact', async () => {
    const db = feedDb();
    const seen = [];
    let offset = 0;
    for (let guard = 0; guard < 10; guard++) {
      const res = await feed.getFeed(db, { userId: 7, offset });
      seen.push(...res.products.map((p) => p.id));
      if (!res.meta.has_more) {
        assert.equal(res.meta.next_offset, null);
        break;
      }
      assert.equal(res.meta.next_offset, offset + 6);
      offset = res.meta.next_offset;
    }
    assert.equal(seen.length, 30);
    assert.equal(new Set(seen).size, 30, 'every product exactly once across the pages');
  });

  test('the pool query is thin and the page alone is hydrated', async () => {
    const db = feedDb();
    await feed.getFeed(db, { userId: 7 });
    const products = db.calls.filter((c) => c.sql.includes('FROM products p'));
    assert.equal(products.length, 2, 'one pool query, one hydration');
    const [pool, hydrate] = products;
    assert.ok(pool.sql.includes('rank_score'));
    assert.equal(pool.sql.includes('primary_image_key'), false, 'no image subquery over the pool');
    assert.equal(pool.sql.includes('variants'), false, 'no variant aggregation over the pool');
    assert.equal(pool.params[pool.params.length - 2], diversity.DEFAULT_DIVERSITY.pool_size);
    assert.equal(pool.params[pool.params.length - 1], 0, 'the pool is always cut from the top');
    assert.ok(hydrate.sql.includes('variants'), 'the page keeps its inline variants');
    assert.equal(hydrate.params.find(Array.isArray).length, 6, 'only the page is loaded in full');
  });

  test('the score\'s arithmetic never leaks into the response', async () => {
    const res = await feed.getFeed(feedDb(), { userId: 7 });
    for (const p of res.products) {
      assert.equal('rank_score' in p, false);
      assert.equal('rank_components' in p, false);
    }
  });

  test('a recommendation reason still comes from the components that lifted the product', async () => {
    const db = feedDb();
    const res = await feed.getFeed(db, { userId: 7 });
    assert.ok(res.products.every((p) => typeof p.recommendation_reason === 'string' && p.recommendation_reason));
  });

  test('diversity off restores the single SQL page with OFFSET', async () => {
    const db = feedDb({ diversityRow: { enabled: false } });
    await feed.getFeed(db, { userId: 7, offset: 6 });
    const products = db.calls.filter((c) => c.sql.includes('FROM products p'));
    assert.equal(products.length, 1);
    assert.equal(products[0].params[products[0].params.length - 1], 6, 'OFFSET is applied by SQL');
    assert.equal(products[0].params[products[0].params.length - 2], 7, 'limit + 1');
  });

  test('a feed deeper than the pool ends at the pool', async () => {
    const db = feedDb({ diversityRow: { pool_size: 20 }, total: 60 });
    const res = await feed.getFeed(db, { userId: 7, offset: 18, limit: 6 });
    assert.equal(res.meta.has_more, false);
    assert.equal(res.products.length, 2);
  });

  test('a product that disappears between the pool query and hydration is skipped, not an error', async () => {
    const db = feedDb();
    const original = db.query.bind(db);
    db.query = async (sql, params) => {
      const out = await original(sql, params);
      if (!sql.includes('rank_score') && sql.includes('FROM products p')) return { rows: out.rows.slice(1) };
      return out;
    };
    const res = await feed.getFeed(db, { userId: 7 });
    assert.equal(res.products.length, 5);
  });
});
