/**
 * cache.js — Cache driver selection (Prompt 2.1).
 *
 * Every consumer (rate limiting, idempotency claims, sessions, pub/sub fan-out) talks to this one
 * interface — get, set, del, incr, expire, setnx, ttl, publish, subscribe — and never imports a
 * driver file directly. Swapping CACHE_DRIVER is then a zero-code-change operation.
 */

import { createMemoryCache } from './cache-drivers/memory.js';
import { createRedisCache } from './cache-drivers/redis.js';

export async function createCache(config, logger = console) {
  const info = (logger.info ?? logger.log ?? console.log).bind(logger);
  const warn = (logger.warn ?? logger.log ?? console.warn).bind(logger);

  if (config.cache.driver === 'redis') {
    info('[cache] driver=redis');
    return createRedisCache(config.cache.redisUrl);
  }

  warn('[cache] driver=memory — single-node only. Set CACHE_DRIVER=redis for multi-instance deployments.');
  return createMemoryCache();
}
