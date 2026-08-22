/**
 * requestContext.js — Per-request context (Prompt 2.1).
 *
 * Carries trace_id, the authenticated user (set later by Prompt 2.3's auth middleware), ip and
 * user-agent through an AsyncLocalStorage so services can reach it for audit logging without
 * threading it through every function signature.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const storage = new AsyncLocalStorage();

/** Reads the context for the request currently in flight, or undefined outside a request. */
export function getRequestContext() {
  return storage.getStore();
}

/** Called by the auth middleware (Prompt 2.3) once the token is verified. */
export function setContextUser(user) {
  const ctx = storage.getStore();
  if (ctx) ctx.user = user;
}

export default function requestContextPlugin(app) {
  app.decorateRequest('traceId', null);

  app.addHook('onRequest', (req, reply, done) => {
    const traceId = randomUUID();
    req.traceId = traceId;
    reply.header('X-Trace-Id', traceId);

    const context = {
      traceId,
      user: null,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    };

    storage.run(context, done);
  });
}

// Marks this plugin as not encapsulated (the fastify-plugin convention) so decorateRequest and
// the onRequest hook apply to the whole app, not a child context — hand-written to avoid adding
// the fastify-plugin dependency for one symbol.
requestContextPlugin[Symbol.for('skip-override')] = true;
