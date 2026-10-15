/**
 * idempotency.js — makes every state-changing route honour an `Idempotency-Key` header
 * (CLAUDE.md constraint 11, docs/api-contract.md §5).
 *
 * WHY a plugin and not per-controller code: only five controllers called runIdempotent, so a
 * retried withdrawal approval, refund, escrow release or reconcile on any of the other ~230 write
 * routes was applied twice. A client that times out and retries is the normal case on a mobile
 * network in Bangladesh, and for money endpoints "twice" is the bug.
 *
 * How it works: an `onRoute` hook appends a preHandler and an onSend to every write route. The
 * preHandler runs after the route's own authenticate / permission guards (so the actor is known) and
 * claims the key; a retry with the same key and the same request gets the stored response back with
 * `Idempotency-Replayed: true`, the same key on a different request is refused, and a retry while
 * the first is still running is a 409. onSend stores 2xx responses and releases the claim on
 * anything else, so a request that failed can be retried with the same key.
 *
 * The key is optional (a client that sends none behaves exactly as before). Scope is per actor and
 * per route, and the fingerprint covers the URL (path + query) and the body.
 *
 * Opt out with `config: { idempotency: false }` on a route.
 */

import fp from 'fastify-plugin';
import { claimIdempotency, completeIdempotency, releaseIdempotency } from '../lib/idempotency.ts';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Never cache or replay these: credentials/tokens, third-party calls we do not initiate, and
// providers that already de-duplicate by their own event id.
const EXEMPT = [
  /^\/api\/v1\/auth(\/|$)/,
  /^\/api\/v1\/payments\/(webhook|callback)(\/|$)/,
  /^\/api\/v1\/webhooks(\/|$)/,
  /^\/api\/v1\/integrations(\/|$)/,
];

// These already own their key with a stronger, database-backed guarantee (orders.idempotency_key,
// payment_transactions.idempotency_key, payout requests) or run runIdempotent in the controller.
// Layering a second cache-backed replay on top would change the replay response they already define.
const OWN_KEY = [
  /^\/api\/v1\/orders\/checkout$/,
  /^\/api\/v1\/payments\/initiate$/,
  /^\/api\/v1\/vault\/withdraw$/,
  /^\/api\/v1\/subscriptions\/subscribe$/,
];

// A replayed response is held in the cache for 24h; money endpoints answer in a few hundred bytes.
const MAX_STORED_BYTES = 256 * 1024;

export function isIdempotentRoute(url, methods, config = {}) {
  if (config.idempotency === false) return false;
  const list = Array.isArray(methods) ? methods : [methods];
  if (!list.some((m) => WRITE_METHODS.has(String(m).toUpperCase()))) return false;
  if (EXEMPT.some((re) => re.test(url))) return false;
  if (OWN_KEY.some((re) => re.test(url))) return false;
  return true;
}

function append(routeOptions, field, fn) {
  const existing = routeOptions[field];
  if (Array.isArray(existing)) routeOptions[field] = [...existing, fn];
  else if (typeof existing === 'function') routeOptions[field] = [existing, fn];
  else routeOptions[field] = [fn];
}

function isJsonLike(body) {
  return body === undefined || body === null || (typeof body === 'object' && !Buffer.isBuffer(body) && typeof body.pipe !== 'function');
}

function createHooks(routeUrl) {
  async function claim(req, reply) {
    const key = req.headers['idempotency-key'];
    if (key === undefined || key === '') return;
    // Multipart / binary uploads cannot be fingerprinted cheaply; they are not money endpoints.
    if (!isJsonLike(req.body)) return;

    const actor = req.user?.id ? `u${req.user.id}` : `ip:${req.ip}`;
    const outcome = await claimIdempotency(req.server.cache, {
      scope: `http:${actor}:${req.method}:${routeUrl}`,
      key: Array.isArray(key) ? key[0] : key,
      payload: { url: req.url, body: req.body ?? null },
    });

    if (!outcome.proceed) {
      const stored = outcome.result;
      reply.header('Idempotency-Replayed', 'true');
      if (stored.contentType) reply.header('content-type', stored.contentType);
      return reply.code(stored.status).send(stored.body);
    }
    req.idempotencyClaim = outcome.claim;
  }

  async function finish(req, reply, payload) {
    const held = req.idempotencyClaim;
    if (!held) return payload;
    req.idempotencyClaim = null;

    const ok = reply.statusCode >= 200 && reply.statusCode < 300;
    try {
      if (!ok) {
        await releaseIdempotency(req.server.cache, held);
      } else if (typeof payload === 'string' && Buffer.byteLength(payload) <= MAX_STORED_BYTES) {
        await completeIdempotency(req.server.cache, held, {
          status: reply.statusCode,
          body: payload,
          contentType: reply.getHeader('content-type') || 'application/json; charset=utf-8',
        });
      } else {
        // Too large (or not a string) to keep. Remember that it happened, so a retry cannot re-run it.
        await completeIdempotency(req.server.cache, held, {
          status: reply.statusCode,
          body: JSON.stringify({ meta: { idempotency: { code: 'IDEMPOTENCY_REPLAY', response_omitted: true } } }),
          contentType: 'application/json; charset=utf-8',
        });
      }
    } catch (err) {
      // The response is already decided; failing to remember it must not turn a success into an error.
      req.log.warn({ err: err.message }, 'idempotency: could not record the response');
    }
    return payload;
  }

  return { claim, finish };
}

async function idempotencyPlugin(app) {
  app.addHook('onRoute', (routeOptions) => {
    if (!isIdempotentRoute(routeOptions.url, routeOptions.method, routeOptions.config)) return;
    const { claim, finish } = createHooks(routeOptions.url);
    append(routeOptions, 'preHandler', claim);
    append(routeOptions, 'onSend', finish);
  });
}

export default fp(idempotencyPlugin, { name: 'idempotency' });
