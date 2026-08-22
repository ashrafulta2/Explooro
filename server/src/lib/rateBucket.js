/**
 * rateBucket.js — Compound rate-limit buckets (Prompt 2.3).
 *
 * docs/api-contract.md §6 requires TWO independent buckets on the same endpoint — e.g.
 * "3/hour per phone, 10/hour per IP" on send-otp, "10/min per IP, 5/min per account" on login.
 * @fastify/rate-limit (wired in Prompt 2.1) enforces one bucket per route, so a request must clear
 * every bucket checked with this helper before the handler runs. Backed by the same cache adapter,
 * so it works under CACHE_DRIVER=memory with no Redis.
 */

import { AppError } from '../plugins/errorHandler.js';

/** Throws RATE_LIMITED (429) if `key` has already been hit `max` times within `windowSeconds`. */
export async function checkBucket(cache, key, max, windowSeconds) {
  const current = await cache.incr(`ratebucket:${key}`);
  if (current === 1) {
    await cache.expire(`ratebucket:${key}`, windowSeconds);
  }
  if (current > max) {
    const ttlMs = await cache.ttl(`ratebucket:${key}`);
    const retryAfterS = Math.max(1, Math.ceil((ttlMs >= 0 ? ttlMs : windowSeconds * 1000) / 1000));
    throw new AppError(
      'RATE_LIMITED',
      'Too many attempts. Please try again later.',
      'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
      { retry_after_s: retryAfterS }
    );
  }
}
