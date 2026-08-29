/**
 * customer.routes.js — Fastify routes for Customer Portal, Following Feed & 1-Click Upgrade (Prompt 11.3).
 */

import * as customerCtrl from '../controllers/customer.controller.js';
import * as addressCtrl from '../controllers/customerAddress.controller.js';

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

  // 7. Customer Saved Delivery Addresses Book
  fastify.get(
    '/customer/addresses',
    { preHandler: [fastify.authenticate] },
    addressCtrl.getAddresses
  );

  fastify.post(
    '/customer/addresses',
    { preHandler: [fastify.authenticate] },
    addressCtrl.createAddress
  );

  fastify.put(
    '/customer/addresses/:id',
    { preHandler: [fastify.authenticate] },
    addressCtrl.updateAddress
  );

  fastify.delete(
    '/customer/addresses/:id',
    { preHandler: [fastify.authenticate] },
    addressCtrl.deleteAddress
  );

  fastify.post(
    '/customer/addresses/:id/default',
    { preHandler: [fastify.authenticate] },
    addressCtrl.setDefaultAddress
  );

  fastify.patch(
    '/customer/addresses/:id/default',
    { preHandler: [fastify.authenticate] },
    addressCtrl.setDefaultAddress
  );
}
