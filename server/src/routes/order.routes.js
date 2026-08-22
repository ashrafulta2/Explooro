/**
 * order.routes.js — Fastify routes for Checkout and Orders (Prompt 5.2).
 */

import * as orderCtrl from '../controllers/order.controller.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { requireRestriction } from '../middlewares/requireRestriction.js';

export default async function orderRoutes(fastify) {
  const requirePerm = fastify.requirePermission || requirePermission;
  const requireRestr = fastify.requireRestriction || requireRestriction;

  // Checkout execution (requires auth and restriction check on buying/ordering)
  fastify.post(
    '/orders/checkout',
    {
      preHandler: [
        fastify.authenticate,
        requireRestr('can_place_order'),
      ],
      schema: {
        body: {
          type: 'object',
          required: ['recipient_name', 'recipient_phone', 'division', 'district', 'address_line'],
          properties: {
            recipient_name: { type: 'string' },
            recipient_phone: { type: 'string' },
            division: { type: 'string' },
            district: { type: 'string' },
            upazila: { type: 'string' },
            address_line: { type: 'string' },
            payment_method: { type: 'string', enum: ['BKASH', 'NAGAD', 'ROCKET', 'CARD', 'COD'] },
            coupon_code: { type: 'string' },
            otp_code: { type: 'string' },
          },
        },
      },
    },
    orderCtrl.checkout
  );

  // Customer order history
  fastify.get(
    '/orders/my-orders',
    {
      preHandler: [
        fastify.authenticate,
        requirePerm('orders.order.view_own'),
      ],
    },
    orderCtrl.getMyOrders
  );

  // Single order lookup (by ID or public ref)
  fastify.get(
    '/orders/:id',
    {
      preHandler: [fastify.authenticate],
    },
    orderCtrl.getOrder
  );

  // Order cancellation
  fastify.post(
    '/orders/:id/cancel',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
      },
    },
    orderCtrl.cancelOrder
  );
}
