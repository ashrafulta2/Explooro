/**
 * payment.api.js — Pays for a placed order through its gateway (bKash, Nagad, Rocket, card).
 *
 * WHY this exists: checkout used to create gateway orders and stop there. Nothing called
 * /payments/initiate or /payments/execute, so a bKash order stayed PENDING forever, never became
 * PAID and never locked escrow. Checkout and the order page both pay through this one helper.
 */

import { api } from '../core/api.js';
import { generateIdempotencyKey } from './order.api.js';

// COD is paid in cash at the door; every other checkout method goes through a gateway.
const GATEWAY_METHODS = new Set(['BKASH', 'NAGAD', 'ROCKET', 'CARD']);

const UNPAYABLE_SUB_ORDER = new Set(['CANCELLED', 'RETURNED', 'REFUNDED']);

export function needsOnlinePayment(order) {
  if (!order || order.payment_status === 'PAID') return false;
  if (!GATEWAY_METHODS.has(String(order.payment_method || '').toUpperCase())) return false;
  const subs = order.sub_orders || [];
  return subs.length === 0 || subs.some((s) => !UNPAYABLE_SUB_ORDER.has(s.status));
}

function isOtherOrigin(url) {
  if (!url) return false;
  try {
    return new URL(url, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Starts and completes the payment for one order.
 * Returns { redirected: true } when a live gateway takes the shopper to its own page (the gateway
 * then calls the server back), or { paid: true } when the payment finished here.
 */
export async function payForOrder(order) {
  const returnUrl = `${window.location.origin}/orders/${encodeURIComponent(order.ref || order.id)}`;
  // WHY a fresh key per attempt: the server replays a known key's transaction, so reusing one
  // after a failed attempt would hand back that failed transaction instead of trying again.
  const initRes = await api.post('/payments/initiate', { orderId: order.id, returnUrl }, {
    idempotencyKey: generateIdempotencyKey(),
  });
  const init = initRes.data || initRes;

  if (isOtherOrigin(init.redirectUrl)) {
    window.location.assign(init.redirectUrl);
    return { redirected: true };
  }

  // The mock driver has no page of its own: its redirect points back here, so finish at once.
  const execRes = await api.post('/payments/execute', { transactionRef: init.transactionRef });
  const exec = execRes.data || execRes;
  return { paid: exec.status === 'PAID' };
}
