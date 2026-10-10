/**
 * referral.controller.js — Route handlers for Multi-Tier Referral Network (Prompt 9.3).
 */

import * as referralService from '../services/referral.service.js';
import * as referralAdminService from '../services/referralAdmin.service.js';

export async function getOverview(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;

  const overview = await referralService.getReferralNetworkOverview(db, user.id);
  return reply.send({
    overview,
  });
}

export async function getTree(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;

  const tree = await referralService.getReferralTree(db, user.id);
  return reply.send({
    tree,
  });
}

export async function getStatement(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;
  const { limit, offset } = req.query || {};

  const statement = await referralService.getReferralStatement(db, user.id, {
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({
    statement,
  });
}

export async function updateCustomSlug(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;
  const { custom_slug } = req.body || {};

  const updated = await referralService.updateCustomSlug(db, user.id, custom_slug);
  return reply.send({
    referral_code: updated,
  });
}

export async function adminGetOverview(req, reply) {
  const db = req.db || req.server?.db;
  return reply.send(await referralAdminService.getReferralAdminOverview(db));
}

export async function adminUpdateRules(req, reply) {
  const { db, cache } = req.server;
  const actor = { id: req.user.id, role: req.user.roles?.[0] ?? null };
  const rules = await referralAdminService.updateReferralRules(db, cache ?? null, actor, req.body || {});
  return reply.send({ rules });
}
