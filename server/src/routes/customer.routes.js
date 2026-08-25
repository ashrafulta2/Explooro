/**
 * customer.routes.js — Fastify routes for Customer Portal, Following Feed & 1-Click Upgrade (Prompt 11.3).
 */

import * as customerCtrl from '../controllers/customer.controller.js';

export default async function customerRoutes(fastify) {
  // 1. Customer Dashboard Overview
  fastify.get(
    '/customer/dashboard',
    { preHandler: [fastify.authenticate] },
    customerCtrl.getDashboard
  );

  // 2. Orders with Visual Tracking
  fastify.get(
    '/customer/orders',
    { preHandler: [fastify.authenticate] },
    customerCtrl.getOrders
  );

  // 3. Following Sellers Feed
  fastify.get(
    '/customer/following-feed',
    { preHandler: [fastify.authenticate] },
    customerCtrl.getFollowingFeed
  );

  // 4. Toggle Follow Store
  fastify.post(
    '/customer/follow/:storeId',
    { preHandler: [fastify.authenticate] },
    customerCtrl.toggleFollowStore
  );

  // 5. 1-Click Saler Upgrade
  fastify.post(
    '/customer/become-saler',
    { preHandler: [fastify.authenticate] },
    customerCtrl.becomeSaler
  );

  // 6. Wishlist Price-Drop Sweep & Alerts
  fastify.post(
    '/customer/wishlist/check-price-drops',
    { preHandler: [fastify.authenticate] },
    customerCtrl.checkPriceDropAlerts
  );
}
