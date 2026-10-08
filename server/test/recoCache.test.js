/**
 * recoCache.test.js — Invariants for Phase F of the personalized home feed (cache, migration 060).
 *
 *   1. Policy     — the cache numbers are a setting, sanitised per field; defaults cannot drift from the
 *                   migration.
 *   2. Settings   — the recommendation rows are read once per TTL; ttl 0 / disabled / a broken cache all
 *                   fall back to reading the table.
 *   3. Pool       — a ranked pool is reused for identical specs only, concurrent misses share one query,
 *                   a failing cache costs the cache and never the page.
 *   4. Privacy    — nothing about a person is in a key or a value.
 *   5. Feed       — end to end through getFeed: the second identical request does no ranking query but
 *                   still hydrates fresh rows.
 *   6. Counters   — hit rates and latency are real.
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as rc from '../src/services/recoCache.service.js';
import * as reco from '../src/services/recommendation.service.js';
import * as productService from '../src/services/product.service.js';
import * as feed from '../src/services/discoveryFeed.service.js';

const migration = fs.readFileSync(path.resolve(import.meta.dirname, '../src/db/migrations/060_recommendation_cache_metrics.sql'), 'utf8');

function makeCache({ failGet = false, failSet = false, garbage = null } = {}) {
  const store = new Map();
  const log = { gets: [], sets: [], dels: [] };
  return {
    driver: 'fake',
    store,
    log,
    async get(k) {
      log.gets.push(k);
      if (failGet) throw new Error('redis down');
      if (garbage !== null) return garbage;
      return store.has(k) ? store.get(k) : null;
    },
    async set(k, v, ttl) {
      log.sets.push({ k, v, ttl });
      if (failSet) throw new Error('redis down');
      store.set(k, v);
      return 'OK';
    },
    async del(k) {
      log.dels.push(k);
      return store.delete(k) ? 1 : 0;
    },
  };
}

function makeDb(routes = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      for (const r of routes) if (r.match(flat)) return r.reply(flat, params);
      return { rows: [] };
    },
  };
}

const settingsRoute = (rows) => ({
  match: (s) => s.includes('FROM platform_settings') && s.includes('group_key'),
  reply: () => ({ rows }),
});
const groupReads = (db) => db.calls.filter((c) => c.sql.includes('FROM platform_settings') && c.sql.includes('group_key')).length;

beforeEach(() => rc.resetStats());

// ── 1. Policy ───────────────────────────────────────────────────────────────────────────────────
describe('Feed cache — policy', () => {
  test('shipped defaults are exactly what migration 060 seeds', () => {
    const m = migration.match(/'recommendation\.cache',\s*'(\{[\s\S]*?\})'::jsonb/);
    assert.ok(m, 'recommendation.cache must be seeded');
    assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(rc.DEFAULT_CACHE)));
  });

  test('the group name matches the one the other resolvers use', () => {
    assert.equal(rc.SETTINGS_GROUP, reco.SETTINGS_GROUP);
  });

  test('every default sits inside its own limit', () => {
    for (const [k, { min, max }] of Object.entries(rc.CACHE_LIMITS)) {
      assert.ok(rc.DEFAULT_CACHE[k] >= min && rc.DEFAULT_CACHE[k] <= max, k);
    }
  });

  test('a bad value falls back to its own default and keeps the rest', () => {
    const out = rc.sanitizeCache({ pool_ttl_seconds: 2, settings_ttl_seconds: 120, enabled: false });
    assert.equal(out.pool_ttl_seconds, rc.DEFAULT_CACHE.pool_ttl_seconds, 'below the floor');
    assert.equal(out.settings_ttl_seconds, 120);
    assert.equal(out.enabled, false);
  });

  test('null, empty, fractional and non-numeric values are rejected, not read as zero', () => {
    const out = rc.sanitizeCache({ pool_ttl_seconds: null, settings_ttl_seconds: '', enabled: 'yes' });
    assert.deepEqual(out, JSON.parse(JSON.stringify(rc.DEFAULT_CACHE)));
    assert.equal(rc.sanitizeCache({ pool_ttl_seconds: 30.5 }).pool_ttl_seconds, rc.DEFAULT_CACHE.pool_ttl_seconds);
    assert.equal(rc.sanitizeCache({ pool_ttl_seconds: 'soon' }).pool_ttl_seconds, rc.DEFAULT_CACHE.pool_ttl_seconds);
  });

  test('a settings ttl of 0 is a real value: read on every request', () => {
    assert.equal(rc.sanitizeCache({ settings_ttl_seconds: 0 }).settings_ttl_seconds, 0);
  });

  test('garbage in place of an object yields the defaults', () => {
    for (const bad of [null, undefined, 'x', 5, [1]]) {
      assert.deepEqual(rc.sanitizeCache(bad), JSON.parse(JSON.stringify(rc.DEFAULT_CACHE)));
    }
  });

  test('resolveCacheConfig reads the row (JSON string too) and survives a missing table', async () => {
    const db = makeDb([settingsRoute([{ key: 'recommendation.cache', value_json: JSON.stringify({ pool_ttl_seconds: 120 }) }])]);
    assert.equal((await rc.resolveCacheConfig(db)).pool_ttl_seconds, 120);
    const broken = { query: async () => { throw new Error('relation "platform_settings" does not exist'); } };
    assert.deepEqual(await rc.resolveCacheConfig(broken), JSON.parse(JSON.stringify(rc.DEFAULT_CACHE)));
  });
});

// ── 2. Settings snapshot ────────────────────────────────────────────────────────────────────────
describe('Feed cache — settings snapshot', () => {
  const rows = [{ key: 'recommendation.weights', value_json: { trending: 9 } }];

  test('without a cache every call reads the table, as before', async () => {
    const db = makeDb([settingsRoute(rows)]);
    await rc.loadRecommendationRows(db);
    await rc.loadRecommendationRows(db);
    assert.equal(groupReads(db), 2);
    assert.equal(rc.getStats().settings.hits, 0);
  });

  test('with a cache the second call reads nothing, and the rows are the same', async () => {
    const db = makeDb([settingsRoute(rows)]);
    const cache = makeCache();
    const a = await rc.loadRecommendationRows(db, cache);
    const b = await rc.loadRecommendationRows(db, cache);
    assert.equal(groupReads(db), 1);
    assert.deepEqual(a, b);
    assert.deepEqual(rc.getStats().settings, { hits: 1, misses: 1, errors: 0, hit_rate: 0.5 });
  });

  test('the entry lives for settings_ttl_seconds from the settings themselves', async () => {
    const db = makeDb([settingsRoute([...rows, { key: 'recommendation.cache', value_json: { settings_ttl_seconds: 90 } }])]);
    const cache = makeCache();
    await rc.loadRecommendationRows(db, cache);
    assert.equal(cache.log.sets[0].ttl, 90);
  });

  test('ttl 0 or a disabled cache stores nothing, so an edit applies on the next request', async () => {
    for (const cfg of [{ settings_ttl_seconds: 0 }, { enabled: false }]) {
      const db = makeDb([settingsRoute([{ key: 'recommendation.cache', value_json: cfg }])]);
      const cache = makeCache();
      await rc.loadRecommendationRows(db, cache);
      await rc.loadRecommendationRows(db, cache);
      assert.equal(cache.log.sets.length, 0);
      assert.equal(groupReads(db), 2);
    }
  });

  test('a cache that throws or returns garbage falls back to the table and counts the error', async () => {
    const db = makeDb([settingsRoute(rows)]);
    const out = await rc.loadRecommendationRows(db, makeCache({ failGet: true, failSet: true }));
    assert.deepEqual(out, rows);
    assert.ok(rc.getStats().settings.errors >= 1);

    const db2 = makeDb([settingsRoute(rows)]);
    const out2 = await rc.loadRecommendationRows(db2, makeCache({ garbage: '{not json' }));
    assert.deepEqual(out2, rows);
    assert.equal(groupReads(db2), 1);
  });

  test('a repository failure still reaches the caller, who keeps its own defaults', async () => {
    const db = { query: async () => { throw new Error('boom'); } };
    await assert.rejects(() => rc.loadRecommendationRows(db, makeCache()), /boom/);
    assert.deepEqual((await reco.resolveRankingConfig(db, { cache: makeCache() })).weights, reco.DEFAULT_WEIGHTS);
  });

  test('the ranking, rails and diversity resolvers share one read', async () => {
    const { resolveRailsConfig } = await import('../src/services/homeRails.service.js');
    const { resolveDiversityConfig } = await import('../src/services/diversity.service.js');
    const db = makeDb([settingsRoute(rows)]);
    const cache = makeCache();
    await reco.resolveRankingConfig(db, { cache });
    await resolveRailsConfig(db, { cache });
    await resolveDiversityConfig(db, { cache });
    await rc.resolveCacheConfig(db, cache);
    assert.equal(groupReads(db), 1);
  });

  test('invalidateSettings makes the next read go to the table; a failing cache is ignored', async () => {
    const db = makeDb([settingsRoute(rows)]);
    const cache = makeCache();
    await rc.loadRecommendationRows(db, cache);
    await rc.invalidateSettings(cache);
    await rc.loadRecommendationRows(db, cache);
    assert.equal(groupReads(db), 2);
    await assert.doesNotReject(() => rc.invalidateSettings({ del: async () => { throw new Error('x'); } }));
    await assert.doesNotReject(() => rc.invalidateSettings(undefined));
  });
});

// ── 3. Pool ─────────────────────────────────────────────────────────────────────────────────────
describe('Feed cache — candidate pool', () => {
  const config = { enabled: true, pool_ttl_seconds: 45, settings_ttl_seconds: 30 };
  const rowsA = [{ id: 1, rank_score: 3 }, { id: 2, rank_score: 2 }];

  test('a miss loads and stores for pool_ttl_seconds; the next identical call is a hit', async () => {
    const cache = makeCache();
    let loads = 0;
    const load = async () => { loads += 1; return rowsA; };
    const a = await rc.cachedPool({ cache, config, key: 'k1', load });
    const b = await rc.cachedPool({ cache, config, key: 'k1', load });
    assert.equal(loads, 1);
    assert.deepEqual(a, b);
    assert.equal(cache.log.sets[0].ttl, 45);
    assert.deepEqual(rc.getStats().pool, { hits: 1, misses: 1, errors: 0, coalesced: 0, hit_rate: 0.5 });
  });

  test('different keys never share an entry', async () => {
    const cache = makeCache();
    let loads = 0;
    const load = async () => { loads += 1; return rowsA; };
    await rc.cachedPool({ cache, config, key: 'k1', load });
    await rc.cachedPool({ cache, config, key: 'k2', load });
    assert.equal(loads, 2);
  });

  test('concurrent identical misses share one query', async () => {
    const cache = makeCache();
    let loads = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const load = async () => { loads += 1; await gate; return rowsA; };
    const all = Promise.all([1, 2, 3, 4].map(() => rc.cachedPool({ cache, config, key: 'k1', load })));
    await new Promise((r) => setImmediate(r));
    release();
    const results = await all;
    assert.equal(loads, 1);
    assert.ok(results.every((r) => r.length === 2));
    assert.equal(rc.getStats().pool.coalesced, 3);
  });

  test('a failed load is not cached and does not poison the next attempt', async () => {
    const cache = makeCache();
    let n = 0;
    const load = async () => { n += 1; if (n === 1) throw new Error('db down'); return rowsA; };
    await assert.rejects(() => rc.cachedPool({ cache, config, key: 'k1', load }), /db down/);
    assert.deepEqual(await rc.cachedPool({ cache, config, key: 'k1', load }), rowsA);
  });

  test('no cache, or a disabled one, is a plain load and counts nothing', async () => {
    let loads = 0;
    const load = async () => { loads += 1; return rowsA; };
    await rc.cachedPool({ cache: undefined, config, key: 'k', load });
    await rc.cachedPool({ cache: makeCache(), config: { ...config, enabled: false }, key: 'k', load });
    assert.equal(loads, 2);
    const s = rc.getStats().pool;
    assert.equal(s.hits + s.misses, 0);
  });

  test('a cache that is down costs the cache, not the page', async () => {
    const load = async () => rowsA;
    assert.deepEqual(await rc.cachedPool({ cache: makeCache({ failGet: true }), config, key: 'k', load }), rowsA);
    assert.deepEqual(await rc.cachedPool({ cache: makeCache({ failSet: true }), config, key: 'k', load }), rowsA);
    assert.deepEqual(await rc.cachedPool({ cache: makeCache({ garbage: 'not json' }), config, key: 'k', load }), rowsA);
    assert.ok(rc.getStats().pool.errors >= 2);
  });

  test('the key follows the spec: same spec same key, any change a different key', () => {
    const base = { ranking: { weights: { trending: 2 }, categoryIds: [3], viewedIds: [5] }, limit: 120, inStock: true };
    const same = { ranking: { weights: { trending: 2 }, categoryIds: [3], viewedIds: [5] }, limit: 120, inStock: true };
    assert.equal(rc.poolKey(base), rc.poolKey(same));
    for (const changed of [
      { ...base, ranking: { ...base.ranking, weights: { trending: 3 } } },
      { ...base, ranking: { ...base.ranking, categoryIds: [4] } },
      { ...base, ranking: { ...base.ranking, viewedIds: [5, 6] } },
      { ...base, limit: 60 },
      { ...base, inStock: false },
    ]) {
      assert.notEqual(rc.poolKey(base), rc.poolKey(changed));
    }
    assert.match(rc.poolKey(base), /^reco:pool:v1:[0-9a-f]{64}$/);
  });
});

// ── 4. Privacy ──────────────────────────────────────────────────────────────────────────────────
describe('Feed cache — nothing about a person is stored', () => {
  test('a key is a hash, so neither a session id nor a user id nor a viewed product appears in it', async () => {
    const spec = await reco.buildRankingSpec(makeDb(), { sessionId: 'sid_SECRET-123', userId: undefined, config: { weights: reco.DEFAULT_WEIGHTS, tuning: reco.DEFAULT_TUNING } });
    const key = rc.poolKey({ ranking: { ...spec, sessionId: 'sid_SECRET-123' }, limit: 5 });
    assert.doesNotMatch(key, /SECRET|sid_/);
  });

  test('the stored pool is product ids and scores only', async () => {
    const cache = makeCache();
    const db = makeDb([
      {
        match: (s) => s.includes('FROM products p') && s.includes('rank_score'),
        reply: () => ({ rows: [{ id: 7, supplier_id: 9, category_id: 3, brand: 'a', created_at: '2026-10-01T00:00:00Z', rank_score: 2.5, rank_components: { quality: 1.5 } }] }),
      },
    ]);
    const ranking = await reco.buildRankingSpec(makeDb(), { sessionId: 'sid_SECRET-123', config: { weights: reco.DEFAULT_WEIGHTS, tuning: reco.DEFAULT_TUNING } });
    await productService.listCandidates(db, { ranking, limit: 5, poolCache: { cache, config: rc.DEFAULT_CACHE } });
    const stored = [...cache.store.values()].join('');
    assert.doesNotMatch(stored, /SECRET|session|user_id/);
    assert.deepEqual(Object.keys(JSON.parse([...cache.store.values()][0])[0]).sort(), ['brand', 'category_id', 'created_at', 'id', 'rank_components', 'rank_score', 'supplier_id']);
  });
});

// ── 5. Through the feed ─────────────────────────────────────────────────────────────────────────
describe('Feed cache — getFeed end to end', () => {
  const poolRow = (id) => ({ id, supplier_id: 10 + id, category_id: 3, brand: null, created_at: '2026-10-01T00:00:00Z', rank_score: 5 - id, rank_components: { quality: 1.5 } });
  const fullRow = (id) => ({ id, ref: `P${id}`, title_en: `Product ${id}`, base_cost: '100.00', wholesale_margin: '0.00', default_retail_price: '150.00', price: '150.00', stock_qty: 5, category_id: 3, supplier_id: 10 + id, status: 'ACTIVE' });

  function feedDb(stock = [1, 2, 3]) {
    return makeDb([
      settingsRoute([]),
      {
        match: (s) => s.includes('FROM products p'),
        reply: (s, params) => {
          if (s.includes('rank_score')) return { rows: [1, 2, 3].map(poolRow) };
          const ids = params.find(Array.isArray) || [];
          return { rows: stock.filter((id) => ids.includes(id)).map(fullRow) };
        },
      },
    ]);
  }
  const rankingCalls = (db) => db.calls.filter((c) => c.sql.includes('rank_score')).length;
  const hydrationCalls = (db) => db.calls.filter((c) => c.sql.includes('FROM products p') && !c.sql.includes('rank_score')).length;

  test('the second identical request runs no ranking query and still hydrates', async () => {
    const db = feedDb();
    const cache = makeCache();
    const a = await feed.getFeed(db, { sessionId: 's1', limit: 3, cache });
    const b = await feed.getFeed(db, { sessionId: 's1', limit: 3, cache });
    assert.equal(rankingCalls(db), 1);
    assert.equal(hydrationCalls(db), 2, 'price, stock and images are never served from the cache');
    assert.deepEqual(a.products.map((p) => p.id), b.products.map((p) => p.id));
  });

  test('a product that sold out while its pool was cached drops out at hydration', async () => {
    const db = feedDb([1, 2, 3]);
    const cache = makeCache();
    await feed.getFeed(db, { sessionId: 's1', limit: 3, cache });
    const later = feedDb([1, 3]); // 2 is gone
    // Share the same cache but a db where product 2 no longer hydrates.
    const res = await feed.getFeed(later, { sessionId: 's1', limit: 3, cache });
    assert.deepEqual(res.products.map((p) => p.id), [1, 3]);
    assert.equal(rankingCalls(later), 0);
  });

  test('shoppers with nothing to personalise on share one pool; one with history gets their own', async () => {
    const db = feedDb();
    const cache = makeCache();
    await feed.getFeed(db, { sessionId: 's1', limit: 3, cache }); // cold guest
    db.calls.length = 0;
    await feed.getFeed(db, { sessionId: 's2', limit: 3, personalize: false, cache }); // opted out
    await feed.getFeed(db, { sessionId: 's3', limit: 3, cache }); // another cold guest
    assert.equal(rankingCalls(db), 0, 'a non-personal spec is the same spec for everyone');

    // A shopper who recently opened product 2 ranks differently, so cannot reuse that pool.
    const warm = feedDb();
    const inner = warm.query.bind(warm);
    warm.query = async (sql, params) =>
      sql.includes("event_type IN ('CLICK'") ? { rows: [{ product_id: 2, last_at: new Date() }] } : inner(sql, params);
    await feed.getFeed(warm, { sessionId: 's4', limit: 3, cache });
    assert.equal(rankingCalls(warm), 1);
    await feed.getFeed(warm, { sessionId: 's4', limit: 3, cache });
    assert.equal(rankingCalls(warm), 1, 'the same shopper repeating the request does hit');
  });

  test('cache disabled in settings: every request ranks', async () => {
    const db = feedDb();
    db.query = ((orig) => async (sql, params) => {
      if (sql.includes('FROM platform_settings') && sql.includes('group_key')) {
        return { rows: [{ key: 'recommendation.cache', value_json: { enabled: false } }] };
      }
      return orig(sql, params);
    })(db.query.bind(db));
    const cache = makeCache();
    await feed.getFeed(db, { sessionId: 's1', limit: 3, cache });
    await feed.getFeed(db, { sessionId: 's1', limit: 3, cache });
    assert.equal(rankingCalls(db), 2);
  });

  test('without a cache the feed behaves exactly as before', async () => {
    const db = feedDb();
    await feed.getFeed(db, { sessionId: 's1', limit: 3 });
    await feed.getFeed(db, { sessionId: 's1', limit: 3 });
    assert.equal(rankingCalls(db), 2);
  });

  test('a cache that throws never breaks the feed', async () => {
    const db = feedDb();
    const res = await feed.getFeed(db, { sessionId: 's1', limit: 3, cache: makeCache({ failGet: true, failSet: true }) });
    assert.equal(res.products.length, 3);
  });
});

// ── 6. Counters ─────────────────────────────────────────────────────────────────────────────────
describe('Feed cache — counters', () => {
  test('latency is recorded per name, including for a call that throws', async () => {
    await rc.timed('x', async () => 1);
    await assert.rejects(() => rc.timed('x', async () => { throw new Error('no'); }));
    const l = rc.getStats().latency.x;
    assert.equal(l.count, 2);
    assert.ok(l.mean_ms >= 0 && l.max_ms >= l.mean_ms);
  });

  test('hit rate is null until something was looked up, then a fraction', async () => {
    assert.equal(rc.getStats().pool.hit_rate, null);
    const cache = makeCache();
    const config = rc.DEFAULT_CACHE;
    const load = async () => [];
    await rc.cachedPool({ cache, config, key: 'a', load });
    await rc.cachedPool({ cache, config, key: 'a', load });
    await rc.cachedPool({ cache, config, key: 'a', load });
    assert.equal(rc.getStats().pool.hit_rate, 0.6667);
  });

  test('feed and rails totals are timed', async () => {
    const db = makeDb([settingsRoute([])]);
    await feed.getFeed(db, { sessionId: 's', limit: 1 });
    assert.equal(rc.getStats().latency.feed.count, 1);
  });

  test('resetStats starts over, and the snapshot is a copy', () => {
    const s = rc.getStats();
    s.pool.hits = 99;
    assert.equal(rc.getStats().pool.hits, 0);
  });
});
