/**
 * order.controller.js — Order and checkout HTTP request controller (Prompt 5.2).
 *
 * Implements envelope formatting, idempotency headers, and error propagation per docs/api-contract.md.
 */

import * as checkoutService from '../services/checkout.service.js';
import * as orderService from '../services/order.service.js';

export async function checkout(req, reply) {
  const idempotencyKey = req.headers['idempotency-key'];

  const result = await checkoutService.executeCheckout(req.server.db, req.server.cache, {
    userId: req.user.id,
    idempotencyKey,
    recipientName: req.body?.recipient_name,
    recipientPhone: req.body?.recipient_phone,
    division: req.body?.division,
    district: req.body?.district,
    upazila: req.body?.upazila,
    addressLine: req.body?.address_line,
    paymentMethod: req.body?.payment_method || 'COD',
    couponCode: req.body?.coupon_code,
    otpCode: req.body?.otp_code,
  });

  if (result.isReplay) {
    return reply
      .header('Idempotency-Replayed', 'true')
      .status(200)
      .send({
        data: { order: result.order },
        meta: {
          idempotency: {
            code: 'IDEMPOTENCY_REPLAY',
            original_at: result.originalAt,
          },
        },
      });
  }

  return reply.status(201).send({
    data: { order: result.order },
  });
}

export async function getMyOrders(req, reply) {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
  const cursor = req.query.cursor || null;

  const result = await orderService.getMyOrders(req.server.db, req.user.id, { limit, cursor });

  return reply.send({
    data: { orders: result.orders },
    meta: {
      cursor: result.cursor,
      count: result.count,
    },
  });
}

export async function getOrder(req, reply) {
  const order = await orderService.getOrder(req.server.db, req.params.id, {
    userId: req.user.id,
    roles: req.user.roles || [],
    permissions: req.user.permissions || [],
  });

  return reply.send({
    data: { order },
  });
}

export async function cancelOrder(req, reply) {
  const order = await orderService.cancelOrder(
    req.server.db,
    req.params.id,
    {
      userId: req.user.id,
      roles: req.user.roles || [],
      permissions: req.user.permissions || [],
    },
    req.body?.reason
  );

  return reply.send({
    data: {
      order,
      message_en: 'Order cancelled successfully.',
      message_bn: 'অর্ডারটি সফলভাবে বাতিল করা হয়েছে।',
    },
  });
}
