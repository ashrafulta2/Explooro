/**
 * cartRecovery.controller.js — Route handlers for Abandoned Cart Recovery & Insights (Prompt 9.6).
 */

import * as cartRecoveryService from '../services/cartRecovery.service.js';

export async function restore(req, reply) {
  const db = req.db || req.server?.db;
  const { token } = req.params;

  const result = await cartRecoveryService.restoreCartByToken(db, token);
  return reply.send(result);
}

export async function getInsights(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;

  const insights = await cartRecoveryService.getSalerCartInsights(db, user?.id || null);
  return reply.send(insights);
}

export async function sendManualOffer(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;
  const { id } = req.params;
  const { discount_pct } = req.body || {};

  const result = await cartRecoveryService.sendManualOffer(db, {
    salerUserId: user.id,
    abandonedCartId: parseInt(id, 10),
    discountPct: discount_pct ? parseFloat(discount_pct) : 10,
  });

  return reply.send(result);
}

export async function runJob(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.server?.redis || req.redis || null;

  const result = await cartRecoveryService.processRecoverySequence(db, cache);
  return reply.send({
    success: true,
    result,
  });
}
