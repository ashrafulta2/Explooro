/**
 * search.service.js — Central search orchestration & query caching (Prompt 4.4).
 */

import { postgresSearchDriver } from './search-drivers/postgres.js';
import { meilisearchDriver } from './search-drivers/meilisearch.js';

export function getSearchDriver() {
  const driverType = (process.env.SEARCH_DRIVER || 'postgres').toLowerCase().trim();
  if (driverType === 'meilisearch') {
    return meilisearchDriver;
  }
  return postgresSearchDriver;
}

// In-memory telemetry log of zero-result queries for merchandising intelligence
export const zeroResultSearchLog = [];

/**
 * Executes a full grouped search query across products, stores, and categories.
 */
export async function executeSearch(db, cache, { query = '', filters = {}, limit = 20, offset = 0 } = {}) {
  const driver = getSearchDriver();
  const rawQuery = (query || '').trim();

  // Try cache if available
  const cacheKey = `search:${rawQuery.toLowerCase()}:${JSON.stringify(filters)}:${limit}:${offset}`;
  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        return typeof cached === 'string' ? JSON.parse(cached) : cached;
      }
    } catch {
      // Cache miss / error
    }
  }

  const results = await driver.search(db, { query: rawQuery, filters, limit, offset });

  // Telemetry: Record zero-result queries to inform catalog merchandising
  if (rawQuery && results.products.length === 0 && results.stores.length === 0) {
    zeroResultSearchLog.push({
      query: rawQuery,
      timestamp: new Date().toISOString(),
      filters,
    });
    if (zeroResultSearchLog.length > 500) zeroResultSearchLog.shift();
  }

  // Store in cache for 60 seconds
  if (cache && results) {
    try {
      await cache.set(cacheKey, JSON.stringify(results), 60);
    } catch {
      // Ignore cache write error
    }
  }

  return {
    ...results,
    driver: driver.name,
  };
}

/**
 * Fast typeahead suggest endpoint (≤ 50ms).
 */
export async function executeSuggest(db, cache, { query = '', limit = 6 } = {}) {
  const driver = getSearchDriver();
  const rawQuery = (query || '').trim();

  if (!rawQuery) {
    return { query: '', suggestions: [], categories: [] };
  }

  const cacheKey = `suggest:${rawQuery.toLowerCase()}:${limit}`;
  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        return typeof cached === 'string' ? JSON.parse(cached) : cached;
      }
    } catch {
      // Cache miss
    }
  }

  const results = await driver.suggest(db, { query: rawQuery, limit });

  if (cache && results) {
    try {
      await cache.set(cacheKey, JSON.stringify(results), 60);
    } catch {
      // Ignore cache write error
    }
  }

  return {
    ...results,
    driver: driver.name,
  };
}

/**
 * Invalidates all cached search queries upon catalog mutations.
 */
export async function invalidateSearchCache(cache) {
  if (!cache) return;
  try {
    if (typeof cache.clearPattern === 'function') {
      await cache.clearPattern('search:*');
      await cache.clearPattern('suggest:*');
    }
  } catch {
    // Ignore cache clear error
  }
}
