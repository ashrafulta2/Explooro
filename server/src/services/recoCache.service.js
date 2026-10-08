/**
 * recoCache.service.js — Caching and operating counters for the personalized feed (Phase F).
 *
 * Two things are cached, through the one cache adapter (config/cache.js: memory or Redis), and
 * nothing else:
 *
 *   1. the `recommendation` settings rows  — every request used to read them three or four times
 *      (ranking, rails, diversity, co-visitation); now it is one read per `settings_ttl_seconds`.
 *   2. the thin candidate pool of a ranking query — ids, supplier/category/brand and the score, no
 *      pricing, image or stock. Identical for everyone who shares a ranking spec (every cold or
 *      opted-out shopper), so it is computed once per `pool_ttl_seconds` instead of once per request.
 *
 * What is deliberately NOT cached: the hydrated products. Price, stock and images are read fresh for
 * the products that make the page, so a cached pool can never show a stale price, and a product that
 * sold out since the pool was cached simply drops out at hydration (an id that is no longer listed is
 * skipped — see product.service listCatalogByIds).
 *
 * Properties the rest of the feed relies on:
 *   - FAIL OPEN. A cache that is down, slow-erroring or returns garbage costs the cache, never the
 *     page: every failure falls through to the database and is counted.
 *   - NO PERSONAL DATA IN THE CACHE. A pool key is a SHA-256 of the ranking spec, so it names no one,
 *     and the value is product ids and scores. Nothing is stored per person that is not already a hash.
 *   - SELF-INVALIDATING KEYS. The key contains the weights, tuning, the shopper's seeds and the
 *     filters, so changing any of them is a different key and can never serve a pool ranked under the
 *     old policy. The TTL only bounds how long a *catalog* change (a new listing) can go unseen.
 *   - SINGLE FLIGHT. Concurrent identical misses share one query instead of stampeding the database.
 */

import { createHash } from 'node:crypto';
import * as settingRepo from '../repositories/setting.repository.js';

export const SETTINGS_GROUP = 'recommendation';
export const CACHE_KEY = 'recommendation.cache';

// Bumped when the shape of a cached value changes, so an old process's entries are never misread.
const POOL_PREFIX = 'reco:pool:v1:';
const SETTINGS_ENTRY = 'reco:settings:v1';

/** Shipped defaults — the same numbers migration 060 seeds (test/recoCache.test.js pins the parity). */
export const DEFAULT_CACHE = Object.freeze({
  enabled: true,
  pool_ttl_seconds: 60,
  settings_ttl_seconds: 30,
});

export const CACHE_LIMITS = Object.freeze({
  // WHY a floor on the pool: below a few seconds the cache would only ever coalesce concurrent
  // requests, which single-flight already does.
  pool_ttl_seconds: { min: 5, max: 900 },
  // 0 = settings are read on every request (an admin who wants edits to apply instantly).
  settings_ttl_seconds: { min: 0, max: 300 },
});

function readJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Per-field sanitiser: a bad value falls back to its own default and never discards the rest. */
export function sanitizeCache(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_CACHE.enabled };
  for (const [key, { min, max }] of Object.entries(CACHE_LIMITS)) {
    // WHY null/'' are rejected: Number(null) is 0, which would turn an absent key into "no caching".
    const n = src[key] === null || src[key] === '' || src[key] === undefined ? NaN : Number(src[key]);
    out[key] = Number.isInteger(n) && n >= min && n <= max ? n : DEFAULT_CACHE[key];
  }
  return out;
}

export function cacheFromSettingRows(rows) {
  const row = (rows || []).find((r) => r.key === CACHE_KEY);
  return sanitizeCache(readJson(row?.value_json));
}

// ── Counters ───────────────────────────────────────────────────────────────────────────────────
// In-process and since boot: they answer "is the cache working right now" for THIS node. Across nodes
// the cache adapter's own stats (hit/miss, keys) are the shared view.

const blank = () => ({
  pool: { hits: 0, misses: 0, errors: 0, coalesced: 0 },
  settings: { hits: 0, misses: 0, errors: 0 },
  latency: {},
});
let counters = blank();

export function resetStats() {
  counters = blank();
}

/** A copy of the counters, with hit rates and mean latencies worked out. Safe to serialise. */
export function getStats() {
  const rate = (c) => {
    const total = c.hits + c.misses;
    return total ? Number((c.hits / total).toFixed(4)) : null;
  };
  const latency = {};
  for (const [name, l] of Object.entries(counters.latency)) {
    latency[name] = { count: l.count, mean_ms: Number((l.total_ms / l.count).toFixed(2)), max_ms: Number(l.max_ms.toFixed(2)) };
  }
  return {
    pool: { ...counters.pool, hit_rate: rate(counters.pool) },
    settings: { ...counters.settings, hit_rate: rate(counters.settings) },
    latency,
  };
}

/** Records how long `fn` took under `name`, whether it resolves or throws. */
export async function timed(name, fn) {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - t0;
    const l = (counters.latency[name] ||= { count: 0, total_ms: 0, max_ms: 0 });
    l.count += 1;
    l.total_ms += ms;
    if (ms > l.max_ms) l.max_ms = ms;
  }
}

// ── Settings snapshot ──────────────────────────────────────────────────────────────────────────

/**
 * The `recommendation` settings rows. With a cache, a hit costs no database read; a miss reads the
 * table and stores the rows for `settings_ttl_seconds` (taken from the rows themselves — the TTL is
 * only needed when writing, so there is no chicken-and-egg). Throws what the repository throws, so
 * each caller keeps its own "table missing, use defaults" handling.
 */
export async function loadRecommendationRows(db, cache) {
  if (cache) {
    try {
      const hit = await cache.get(SETTINGS_ENTRY);
      const rows = hit ? readJson(hit) : null;
      if (Array.isArray(rows)) {
        counters.settings.hits += 1;
        return rows;
      }
    } catch {
      counters.settings.errors += 1;
    }
  }
  counters.settings.misses += 1;
  const rows = await settingRepo.listSettingsByGroup(db, SETTINGS_GROUP);
  if (cache) {
    const cfg = cacheFromSettingRows(rows);
    if (cfg.enabled && cfg.settings_ttl_seconds > 0) {
      try {
        await cache.set(SETTINGS_ENTRY, JSON.stringify(rows), cfg.settings_ttl_seconds);
      } catch {
        counters.settings.errors += 1;
      }
    }
  }
  return rows;
}

/** The live cache policy. An unreadable table or row yields the shipped defaults, never an error. */
export async function resolveCacheConfig(db, cache) {
  let rows = [];
  try {
    rows = await loadRecommendationRows(db, cache);
  } catch {
    // Fresh clone that has not run migration 060 — the defaults are the right answer.
  }
  return cacheFromSettingRows(rows);
}

/** Drops the cached settings, so an admin's edit applies on the next request (Phase G calls this). */
export async function invalidateSettings(cache) {
  try {
    await cache?.del(SETTINGS_ENTRY);
  } catch {
    // Best-effort: the entry expires on its own.
  }
}

// ── Candidate pool ─────────────────────────────────────────────────────────────────────────────

const inflight = new Map();

/** A stable key for a ranking query: same spec + filters + size, same key. */
export function poolKey(parts) {
  return POOL_PREFIX + createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * `load()` through the cache. `cache` or a disabled config means "just load" (and counts nothing, so
 * the hit rate only describes requests that could have hit).
 */
export async function cachedPool({ cache, config, key, load }) {
  if (!cache || !config?.enabled) return load();

  try {
    const hit = await cache.get(key);
    const rows = hit ? readJson(hit) : null;
    if (Array.isArray(rows)) {
      counters.pool.hits += 1;
      return rows;
    }
  } catch {
    counters.pool.errors += 1;
  }

  if (inflight.has(key)) {
    counters.pool.coalesced += 1;
    return inflight.get(key);
  }
  counters.pool.misses += 1;
  const pending = (async () => {
    const rows = await load();
    try {
      await cache.set(key, JSON.stringify(rows), config.pool_ttl_seconds);
    } catch {
      counters.pool.errors += 1;
    }
    return rows;
  })().finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}
