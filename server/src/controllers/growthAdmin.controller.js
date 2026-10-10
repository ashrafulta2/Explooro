/**
 * growthAdmin.controller.js — handlers for the Phase 9 admin read models and policy writes.
 */

import * as growthAdminService from '../services/growthAdmin.service.js';
import * as auditService from '../services/audit.service.js';

const actorOf = (req) => ({ id: req.user.id, role: req.user.roles?.[0] ?? null });

export async function getAdsOverview(req, reply) {
  const { db } = req.server;
  return reply.send(await growthAdminService.getAdsOverview(db));
}

export async function getQuestsOverview(req, reply) {
  const { db } = req.server;
  return reply.send(await growthAdminService.getQuestsOverview(db));
}

export async function updateQuest(req, reply) {
  const { db } = req.server;
  const quest = await growthAdminService.updateQuest(db, actorOf(req), req.params.id, req.body || {}, auditService);
  return reply.send({ quest });
}

export async function updateCoinPolicy(req, reply) {
  const { db, cache } = req.server;
  const coin_policy = await growthAdminService.updateCoinPolicy(db, cache ?? null, actorOf(req), req.body || {});
  return reply.send({ coin_policy });
}
