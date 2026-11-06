/**
 * payment.api.ts — Pays for a placed order through its gateway (bKash, Nagad, Rocket, card).
 *
 * WHY this exists: checkout used to create gateway orders and stop there. Nothing called
 * /payments/initiate or /payments/execute, so a bKash order stayed PENDING forever, never became
 * PAID and never locked escrow. Checkout and the order page both pay through this one helper.
 */

import { api } from '../core/api.ts';
import { generateIdempotencyKey } from './order.api.ts';

// COD is paid in cash at the door; every other checkout method goes through a gateway.
const GATEWAY_METHODS = new Set(['BKASH', 'NAGAD', 'ROCKET', 'CARD']);

const UNPAYABLE_SUB_ORDER = new Set(['CANCELLED', 'RETURNED', 'REFUNDED']);

export interface PaymentAvailability {
  /** Online methods the server can charge now (no gateway, or the module off, leaves it out). */
  online: string[];
  /** Whether cash on delivery is on (the `cod_payment` module). */
  cod: boolean;
}

let availabilityRequest: Promise<PaymentAvailability> | null = null;

/**
 * Which ways to pay the server offers right now (GET /payments/methods, decided by
 * server/src/services/paymentMethods.service.ts from PAYMENT_DRIVER and the payment modules).
 * WHY no online method on a failed request: offering bKash the server cannot charge strands an
 * unpaid order, while hiding it for one visit costs nothing. COD stays offered, because the server
 * refuses it anyway if it is off. A failure is not cached, so the next checkout asks again.
 */
export function getPaymentAvailability(): Promise<PaymentAvailability> {
  if (!availabilityRequest) {
    availabilityRequest = api.get('/payments/methods')
      .then((res) => {
        const data = res?.data ?? res;
        const list = data?.online_methods;
        return {
          online: Array.isArray(list) ? list.map((m) => String(m).toUpperCase()).filter((m) => GATEWAY_METHODS.has(m)) : [],
          cod: data?.cod !== false,
        };
      })
      .catch(() => {
        availabilityRequest = null;
        return { online: [], cod: true };
      });
  }
  return availabilityRequest;
}

/** The order fields payment reads. */
export interface PayableOrder {
  id: number | string;
  ref?: string;
  payment_status?: string;
  payment_method?: string;
  sub_orders?: { status: string }[];
}

export function needsOnlinePayment(order: PayableOrder | null | undefined): boolean {
  if (!order || order.payment_status === 'PAID') return false;
  if (!GATEWAY_METHODS.has(String(order.payment_method || '').toUpperCase())) return false;
  const subs = order.sub_orders || [];
  return subs.length === 0 || subs.some((s) => !UNPAYABLE_SUB_ORDER.has(s.status));
}

function isOtherOrigin(url?: string | null): boolean {
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
export async function payForOrder(order: PayableOrder): Promise<{ redirected: true } | { paid: boolean }> {
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
