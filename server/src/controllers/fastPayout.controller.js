/**
 * fastPayout.controller.js — Handlers for early escrow release (supplier attraction, step 5a).
 * Thin on purpose: the rules, the fee and the money all live in the service. The same two handlers serve
 * the supplier's page and the saler's page; the person is always the signed-in user, never a parameter.
 */

import * as service from '../services/fastPayout.service.js';

export async function getFastPayout(req, reply) {
  return reply.send({ data: await service.getView(req.server.db, req.user.id) });
}

export async function requestFastPayout(req, reply) {
  const body = req.body || {};
  const record = await service.requestFastPayout(req.server.db, { userId: req.user.id, entryId: body.escrow_entry_id });
  return reply.send({ data: record });
}
