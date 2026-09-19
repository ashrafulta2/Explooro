/**
 * staff.controller.js — HTTP layer for Staff Management (Prompt 3.3).
 *
 * Thin by design: pull what the service needs off the request, hand it over, shape the reply. Every
 * write accepts an `Idempotency-Key` (docs/api-contract.md §5): a retried request replays the stored
 * response instead of provisioning twice, and reusing a key for a different request is refused.
 *
 * Replies are bare payloads (`{ staff, … }`), not `{ data }`-wrapped: core/api.js on the client
 * spreads the body and keeps `data` alongside, so bare shapes are what the admin pages read (the
 * same convention user.controller.js follows).
 */

import * as staffService from '../services/staff.service.js';
import { runIdempotent } from '../lib/idempotency.js';

const requestMeta = (req) => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'] ?? null,
  traceId: req.traceId ?? null,
});

const depsOf = (req) => ({
  db: req.server.db,
  cache: req.server.cache,
  emailSender: req.server.emailSender,
  config: req.server.config,
});

/** Runs a write under the request's Idempotency-Key (if it sent one) and sends the reply. */
async function idempotentWrite(req, reply, action, payload, successStatus, execute) {
  const { cache } = req.server;
  const result = await runIdempotent(
    cache,
    {
      // Scoped to the actor AND the target: the same key on two different staff members is two requests.
      scope: `staff:${req.user.id}:${action}:${req.params?.id ?? 'new'}`,
      key: req.headers['idempotency-key'],
      payload,
    },
    async () => ({ status: successStatus, body: await execute() })
  );
  if (result.replayed) reply.header('Idempotency-Replayed', 'true');
  return reply.code(result.status).send(result.body);
}

export async function listStaff(req, reply) {
  const { q, role, status, two_factor: twoFactor, page, limit } = req.query ?? {};
  const body = await staffService.listStaff(req.server.db, { q, role, status, twoFactor, page, limit });
  return reply.send(body);
}

export async function getStaff(req, reply) {
  return reply.send(await staffService.getStaff(req.server.db, req.params.id));
}

export async function provisionStaff(req, reply) {
  return idempotentWrite(req, reply, 'create', req.body, 201, () =>
    staffService.provisionStaff(depsOf(req), req.user, req.body ?? {}, requestMeta(req))
  );
}

export async function changeRole(req, reply) {
  return idempotentWrite(req, reply, 'role', req.body, 200, () =>
    staffService.changeRole(depsOf(req), req.user, req.params.id, req.body ?? {}, requestMeta(req))
  );
}

export async function changeStatus(req, reply) {
  return idempotentWrite(req, reply, 'status', req.body, 200, () =>
    staffService.changeStatus(depsOf(req), req.user, req.params.id, req.body ?? {}, requestMeta(req))
  );
}

export async function resetTwoFactor(req, reply) {
  return idempotentWrite(req, reply, 'reset2fa', req.body, 200, () =>
    staffService.resetTwoFactor(depsOf(req), req.user, req.params.id, req.body ?? {}, requestMeta(req))
  );
}

export async function resendInvite(req, reply) {
  return idempotentWrite(req, reply, 'reinvite', null, 200, () =>
    staffService.resendInvite(depsOf(req), req.user, req.params.id, requestMeta(req))
  );
}
