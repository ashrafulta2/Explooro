/**
 * teamPurchase.controller.js — Route handlers for Social Group Buying / Team Purchases (Prompt 9.5).
 */

import * as teamPurchaseService from '../services/teamPurchase.service.js';

export async function create(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.server?.redis || req.redis || null;
  const user = req.user;
  const { product_id, group_price, required_members, window_hours, shipping_address, payment_method } = req.body || {};

  const result = await teamPurchaseService.createTeamPurchase(db, cache, {
    userId: user.id,
    productId: parseInt(product_id, 10),
    groupPrice: group_price ? parseFloat(group_price) : null,
    requiredMembers: required_members ? parseInt(required_members, 10) : null,
    windowHours: window_hours ? parseInt(window_hours, 10) : null,
    shippingAddress: shipping_address || {},
    paymentMethod: payment_method || 'COD',
  });

  return reply.status(201).send(result);
}

export async function join(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.server?.redis || req.redis || null;
  const user = req.user;
  const { id } = req.params;
  const { shipping_address, payment_method } = req.body || {};

  const result = await teamPurchaseService.joinTeamPurchase(db, cache, {
    userId: user.id,
    teamId: parseInt(id, 10),
    shippingAddress: shipping_address || {},
    paymentMethod: payment_method || 'COD',
  });

  return reply.send(result);
}

export async function getDetail(req, reply) {
  const db = req.db || req.server?.db;
  const { id } = req.params;

  const team = await teamPurchaseService.getTeamPurchaseById(db, parseInt(id, 10));
  if (!team) {
    return reply.status(404).send({
      code: 'TEAM_NOT_FOUND',
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
