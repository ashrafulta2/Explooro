/**
 * idempotency.js — replay-safe writes on top of the cache adapter (docs/api-contract.md §5).
 *
 * A client that retries a POST after a dropped connection must not provision a second staff member
 * or send a second invitation. With an `Idempotency-Key`, the first request claims the key, runs,
 * and stores its response; a retry with the same key and the same payload gets that stored response
 * back, and a retry with a DIFFERENT payload is refused — reusing a key for something else is a
 * client bug worth surfacing rather than silently returning the wrong answer.
 *
 * Backed by the cache (`setnx`), so it works under CACHE_DRIVER=memory with no Redis, like rate
 * limiting does. The claim is per-actor: two admins can legitimately pick the same key.
 *
 * Failures release the claim, so a request that threw (validation, conflict, a 5xx) can be retried
 * with the same key after the client fixes it. Only a completed request is remembered.
 */

import { createHash } from 'node:crypto';
import { AppError } from '../plugins/errorHandler.js';

const STATE_PENDING = 'PENDING';
const STATE_DONE = 'DONE';
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const PENDING_TTL_SECONDS = 60;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function fingerprintOf(payload) {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

/**
 * First half of the protocol, split out so a Fastify hook (middlewares/idempotency.js) can claim in
 * preHandler and finish in onSend. `runIdempotent` below is the same two halves around one call.
 *
 * @returns {Promise<{proceed:true, claim:object|null} | {proceed:false, result:object}>}
 *   `claim` is null when the request carried no key; otherwise hand it to completeIdempotency or
 *   releaseIdempotency. A replay comes back as `proceed:false` with the stored result.
 */
export async function claimIdempotency(cache, { scope, key, payload }) {
  if (key === undefined || key === null || key === '') return { proceed: true, claim: null };
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Idempotency-Key must be 8–128 characters: letters, digits, and . _ : -',
      'Idempotency-Key ৮–১২৮ অক্ষরের হতে হবে: অক্ষর, সংখ্যা এবং . _ : -',
      { field: 'Idempotency-Key' }
    );
  }

  const cacheKey = `idem:${scope}:${key}`;
  const fingerprint = fingerprintOf(payload);

  const existing = await cache.get(cacheKey);
  if (existing) return { proceed: false, result: replayOrRefuse(existing, fingerprint) };

  const claimed = await cache.setnx(cacheKey, JSON.stringify({ state: STATE_PENDING, fingerprint }), PENDING_TTL_SECONDS);
  if (!claimed) {
    // Lost the race to a concurrent request carrying the same key.
    const winner = await cache.get(cacheKey);
    if (winner) return { proceed: false, result: replayOrRefuse(winner, fingerprint) };
  }
  return { proceed: true, claim: { cacheKey, fingerprint } };
}

/** Remembers a completed request so a retry with the same key gets this result back. */
export async function completeIdempotency(cache, claim, result, ttlSeconds = DEFAULT_TTL_SECONDS) {
  await cache.set(claim.cacheKey, JSON.stringify({ state: STATE_DONE, fingerprint: claim.fingerprint, result }), ttlSeconds);
}

/** Frees the key after a failure, so the client can retry once it has fixed the cause. */
export async function releaseIdempotency(cache, claim) {
  await cache.del(claim.cacheKey);
}

/**
 * @param {object} cache       the cache adapter (get / setnx / set / del)
 * @param {object} opts
 * @param {string} opts.scope       namespace, e.g. `staff:12:create`
 * @param {string|undefined} opts.key   the Idempotency-Key header (optional)
 * @param {*} opts.payload          what the request means; a key reused with another payload is refused
 * @param {() => Promise<{status:number, body:object}>} execute
 * @returns {Promise<{status:number, body:object, replayed:boolean}>}
 */
export async function runIdempotent(cache, { scope, key, payload, ttlSeconds = DEFAULT_TTL_SECONDS }, execute) {
  const first = await claimIdempotency(cache, { scope, key, payload });
  if (!first.proceed) return first.result;
  if (!first.claim) return { ...(await execute()), replayed: false };

  try {
    const result = await execute();
    await completeIdempotency(cache, first.claim, result, ttlSeconds);
    return { ...result, replayed: false };
  } catch (err) {
    await releaseIdempotency(cache, first.claim);
    throw err;
  }
}

function replayOrRefuse(raw, fingerprint) {
  const entry = JSON.parse(raw);
  if (entry.fingerprint !== fingerprint) {
    throw new AppError(
      'IDEMPOTENCY_MISMATCH',
      'This Idempotency-Key was already used with a different request.',
      'এই Idempotency-Key আগে অন্য একটি অনুরোধে ব্যবহার করা হয়েছে।'
    );
  }
  if (entry.state === STATE_PENDING) {
    throw new AppError(
      'CONFLICT',
      'The original request with this Idempotency-Key is still being processed.',
      'এই Idempotency-Key দিয়ে পাঠানো মূল অনুরোধটি এখনো প্রক্রিয়াধীন।',
      { reason: 'IDEMPOTENT_REQUEST_IN_PROGRESS' }
    );
  }
  return { ...entry.result, replayed: true };
}
