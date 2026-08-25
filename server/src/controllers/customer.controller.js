/**
 * customer.controller.js — Fastify controller for Customer Portal & 1-Click Upgrade (Prompt 11.3).
 */

import * as customerService from '../services/customerPortal.service.js';

export async function getDashboard(req, reply) {
  const userId = req.user?.id;
  const data = await customerService.getCustomerDashboardSummary(req.server.db, userId);
  return reply.send({ success: true, data });
}

export async function getOrders(req, reply) {
  const userId = req.user?.id;
  const { status, limit, offset } = req.query || {};
  const data = await customerService.getCustomerOrders(req.server.db, userId, { status, limit, offset });
  return reply.send({ success: true, data });
}

export async function getFollowingFeed(req, reply) {
  const userId = req.user?.id;
  const data = await customerService.getFollowingFeed(req.server.db, userId);
  return reply.send({ success: true, data });
}

export async function toggleFollowStore(req, reply) {
  const userId = req.user?.id;
  const { storeId } = req.params;
  const data = await customerService.toggleFollowStore(req.server.db, { userId, storeId });
  return reply.send({ success: true, data });
}

export async function becomeSaler(req, reply) {
  const userId = req.user?.id;
  const data = await customerService.becomeSaler(req.server.db, userId);
  return reply.send({ success: true, data });
}

export async function checkPriceDropAlerts(req, reply) {
  const userId = req.user?.id;
  const data = await customerService.checkPriceDropAlerts(req.server.db, userId);
  return reply.send({ success: true, data });
}
