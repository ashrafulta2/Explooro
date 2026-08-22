/**
 * order.service.js — Order management and cancellation service (Prompt 5.2).
 *
 * Implements:
 *  - Order lookup with role-aware security check (view_own vs view_all)
 *  - Customer order list with cursor pagination
 *  - Order cancellation with cancellation window check, status verification, and inventory restoration
 */

import { AppError } from '../plugins/errorHandler.js';
import * as orderRepo from '../repositories/order.repository.js';
import * as couponRepo from '../repositories/coupon.repository.js';
import * as trustScoreService from './trustScore.service.js';

export const CANCELLATION_CONFIG = {
  WINDOW_MINUTES: 30,
};

export async function getMyOrders(db, userId, { limit = 20, cursor = null } = {}) {
  return orderRepo.listUserOrders(db, userId, { limit, cursor });
}

export async function getOrder(db, refOrId, userContext) {
  const isNumeric = /^\d+$/.test(String(refOrId));
  const allowAny = userContext.roles?.some((r) => ['super_admin', 'admin', 'moderator'].includes(r))
    || userContext.permissions?.includes('orders.order.view_all');

  let order = null;
  if (isNumeric) {
    order = await orderRepo.findOrderById(db, Number(refOrId), {
      userId: userContext.userId,
      allowAny,
    });
  } else {
    order = await orderRepo.findOrderByRef(db, refOrId, {
      userId: userContext.userId,
      allowAny,
    });
  }

  if (!order) {
    throw new AppError(
      'NOT_FOUND',
      'Order not found.',
      'অর্ডারটি পাওয়া যায়নি।'
    );
  }

  return order;
}

export async function cancelOrder(pool, refOrId, userContext, reason = null) {
  const isNumeric = /^\d+$/.test(String(refOrId));
  const isStaff = userContext.roles?.some((r) => ['super_admin', 'admin'].includes(r))
    || userContext.permissions?.includes('orders.order.cancel');

  let order = null;
  if (isNumeric) {
    order = await orderRepo.findOrderById(pool, Number(refOrId), {
      userId: userContext.userId,
      allowAny: isStaff,
    });
  } else {
    order = await orderRepo.findOrderByRef(pool, refOrId, {
      userId: userContext.userId,
      allowAny: isStaff,
    });
  }

  if (!order) {
    throw new AppError('NOT_FOUND', 'Order not found.', 'অর্ডারটি পাওয়া যায়নি।');
  }

  // Check if already cancelled or shipped
  const subOrders = order.sub_orders || [];
  const nonCancellable = subOrders.filter((s) => ['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].includes(s.status));

  if (nonCancellable.length === subOrders.length && subOrders.every((s) => s.status === 'CANCELLED')) {
    throw new AppError(
      'CONFLICT',
      'Order is already cancelled.',
      'অর্ডারটি ইতোমধ্যে বাতিল করা হয়েছে।'
    );
  }

  if (nonCancellable.some((s) => ['SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(s.status))) {
    throw new AppError(
      'CONFLICT',
      'Cannot cancel order because some parcels have already been shipped or delivered.',
      'অর্ডারটি বাতিল করা যাবে না কারণ কিছু পার্সেল ইতোমধ্যে পাঠানো বা ডেলিভারি করা হয়েছে।'
    );
  }

  // Check cancellation window for non-staff customers
  if (!isStaff) {
    const placedTime = new Date(order.placed_at).getTime();
    const elapsedMinutes = (Date.now() - placedTime) / (1000 * 60);

    if (elapsedMinutes > CANCELLATION_CONFIG.WINDOW_MINUTES) {
      throw new AppError(
        'CONFLICT',
        `Orders can only be cancelled within ${CANCELLATION_CONFIG.WINDOW_MINUTES} minutes of placing.`,
        `অর্ডার দেওয়ার ${CANCELLATION_CONFIG.WINDOW_MINUTES} মিনিটের মধ্যে শুধুমাত্র বাতিল করা যায়।`
      );
    }
  }

  // Execute cancellation and stock restoration inside atomic transaction
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Gather all line items across sub-orders
    const allItems = subOrders.flatMap((so) => so.items || []);

    // 2. Restore inventory and batch counts
    await orderRepo.restoreStock(client, allItems);

    // 3. If coupon was applied, decrement coupon budget and usage count
    if (order.coupon_id) {
      await couponRepo.decrementCouponUsage(client, order.coupon_id, Number(order.discount_amount || 0));
    }

    // 4. Update sub-orders and root order status to CANCELLED
    await orderRepo.cancelOrder(client, order.id);

    await client.query('COMMIT');

    // Re-evaluate trust score in background
    trustScoreService.calculateAndPersistTrustScore(pool, order.customer_id).catch(() => {});

    return orderRepo.findOrderById(pool, order.id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
