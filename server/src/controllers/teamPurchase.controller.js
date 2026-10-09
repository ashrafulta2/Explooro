/**
 * teamPurchase.controller.js — Route handlers for Social Group Buying / Team Purchases (Prompt 9.5).
 */

import * as teamPurchaseService from '../services/teamPurchase.service.js';
import { writeAudit } from '../lib/audit.js';

function toInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export async function quote(req, reply) {
  const db = req.db || req.server?.db;
  const result = await teamPurchaseService.getQuote(db, {
    productId: toInt(req.query?.product_id),
    userId: req.user?.id ?? null,
  });
  return reply.send(result);
}

export async function listOpen(req, reply) {
  const db = req.db || req.server?.db;
  const limit = Math.min(Math.max(toInt(req.query?.limit) ?? 20, 1), 50);
  const teams = await teamPurchaseService.listOpenTeams(db, {
    productId: toInt(req.query?.product_id),
    limit,
  });
  return reply.send({ team_purchases: teams });
}

export async function create(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.server?.cache ?? null;
  const user = req.user;
  // WHY group_price and window_hours are not read: the service computes both from settings. The
  // client used to send its own group_price, so a shopper could start a team at any price.
  const { product_id, required_members, recipient_name, address_line, payment_method } = req.body || {};

  const result = await teamPurchaseService.createTeamPurchase(db, cache, {
    userId: user.id,
    productId: toInt(product_id),
    requiredMembers: required_members == null ? null : toInt(required_members),
    recipientName: recipient_name,
    addressLine: address_line,
    paymentMethod: payment_method || 'COD',
  });

  return reply.status(201).send(result);
}

export async function join(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.server?.cache ?? null;
  const user = req.user;
  const { recipient_name, address_line, payment_method } = req.body || {};

  const result = await teamPurchaseService.joinTeamPurchase(db, cache, {
    userId: user.id,
    teamId: toInt(req.params.id),
    recipientName: recipient_name,
    addressLine: address_line,
    paymentMethod: payment_method || 'COD',
  });

  return reply.send(result);
}

export async function getDetail(req, reply) {
  const db = req.db || req.server?.db;
  const { id } = req.params;

  const team = await teamPurchaseService.getTeamPurchaseById(db, toInt(id));
  if (!team) {
    return reply.status(404).send({
      code: 'NOT_FOUND',
      message: 'Team purchase not found.',
    });
  }

  return reply.send({
    team,
  });
}

export async function getMyTeams(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;

  const teams = await teamPurchaseService.getUserTeamPurchases(db, user.id);
  return reply.send({
    team_purchases: teams,
  });
}

// ---- admin (/admin/growth/group-buy) ------------------------------------------------------------------

export async function adminOverview(req, reply) {
  const db = req.server.db;
  const limit = Math.min(Math.max(toInt(req.query?.limit) ?? 50, 1), 100);
  const offset = Math.max(toInt(req.query?.offset) ?? 0, 0);
  return reply.send(await teamPurchaseService.getAdminOverview(db, { limit, offset }));
}

export async function adminUpdateSettings(req, reply) {
  const { db, cache } = req.server;
  const actor = { id: req.user.id, role: req.user.roles?.[0] ?? null };
  // The module service writes the audit_logs row (before/after settings_json).
  const settings = await teamPurchaseService.updateSettings(db, cache ?? null, actor, req.body || {});
  return reply.send({ settings });
}

export async function adminRunExpirySweep(req, reply) {
  const { db, cache } = req.server;
  const result = await teamPurchaseService.expireIncompleteTeams(db, cache ?? null);
  await writeAudit(db, {
    actorId: req.user.id,
    actorRole: req.user.roles?.[0] ?? null,
    action: 'team_purchase.expiry_sweep',
    targetType: 'team_purchases',
    targetRef: 'expired',
    beforeJson: null,
    afterJson: result,
    riskTier: 'HIGH',
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
    traceId: req.traceId ?? null,
  });
  return reply.send(result);
}
