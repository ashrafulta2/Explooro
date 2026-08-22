/**
 * memory.js — In-process cache driver (Prompt 2.1).
 *
 * The required fallback for a developer with no Redis: a single-process Map with TTL sweeping and
 * a pub/sub that delivers within the process via EventEmitter. Never durable, never shared across
 * nodes — that trade-off is the entire point of this driver existing.
 */

import { EventEmitter } from 'node:events';

const SWEEP_INTERVAL_MS = 5000;

export function createMemoryCache() {
  const store = new Map(); // key -> { value, expiresAt: epoch ms | null }
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) store.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref?.();

  function isLive(entry) {
    return entry && (entry.expiresAt === null || entry.expiresAt > Date.now());
  }

  return {
    driver: 'memory',

    async get(key) {
      const entry = store.get(key);
      return isLive(entry) ? entry.value : null;
    },

    async set(key, value, ttlSeconds) {
      store.set(key, {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      });
      return 'OK';
    },

    async del(key) {
      return store.delete(key) ? 1 : 0;
    },

    async incr(key) {
      const entry = store.get(key);
      const current = isLive(entry) ? Number(entry.value) : 0;
      const next = current + 1;
      store.set(key, { value: next, expiresAt: isLive(entry) ? entry.expiresAt : null });
      return next;
    },

    async expire(key, ttlSeconds) {
      const entry = store.get(key);
      if (!isLive(entry)) return false;
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
      return true;
    },

    async ttl(key) {
      const entry = store.get(key);
      if (!isLive(entry)) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.max(0, entry.expiresAt - Date.now());
    },

    async setnx(key, value, ttlSeconds) {
      const entry = store.get(key);
      if (isLive(entry)) return false;
      store.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
      return true;
    },

    async publish(channel, message) {
      bus.emit(channel, message);
      return 0;
    },

    async subscribe(channel, handler) {
      bus.on(channel, handler);
      return () => bus.off(channel, handler);
    },

    async quit() {
      clearInterval(sweep);
      bus.removeAllListeners();
    },
  };
}
