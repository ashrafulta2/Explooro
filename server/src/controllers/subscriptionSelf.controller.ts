/**
 * subscriptionSelf.controller.ts — a merchant's own Shop Partner Pro subscription (thin HTTP layer).
 * The admin side lives in finance.controller.js; the rules live in subscriptionBilling.service.ts.
 */

import * as billing from '../services/subscriptionBilling.service.ts';
import { runIdempotent } from '../lib/idempotency.ts';

const actorOf = (req) => ({ id: req.user.id, role: req.user.role, roles: req.user.roles || (req.user.role ? [req.user.role] : []) });

export async function getMine(req, reply) {
  const actor = actorOf(req);
  const data = await billing.getMySubscription(req.server.db, actor.id, { roles: actor.roles });
  return reply.send({ data });
}

export async function subscribe(req, reply) {
  const actor = actorOf(req);
  const body = req.body || {};
  const result = await runIdempotent(
    req.server.cache,
    { scope: `subscription:${actor.id}:subscribe`, key: req.headers['idempotency-key'], payload: body },
    async () => ({
      status: 201,
      body: { data: await billing.subscribe(req.server.db, actor, { planId: body.plan_id, autoRenew: body.auto_renew }) },
    })
  );
  if (result.replayed) reply.header('Idempotency-Replayed', 'true');
  return reply.code(result.status).send(result.body);
}

export async function cancel(req, reply) {
  return reply.send({ data: await billing.cancel(req.server.db, actorOf(req)) });
}

export async function resume(req, reply) {
  return reply.send({ data: await billing.resume(req.server.db, actorOf(req)) });
}
