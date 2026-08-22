/**
 * order.api.js — Frontend API client for Orders, Checkout & Offline Drafts (Prompt 5.4).
 *
 * Implements:
 *  - Idempotency-Key generation on every checkout attempt
 *  - Offline state caching in localStorage (explooro_checkout_draft)
 *  - Integration with backend endpoints (/orders/checkout, /orders/my-orders, /orders/:id, /orders/:id/cancel)
 */

const CHECKOUT_DRAFT_KEY = 'explooro_checkout_draft';

export function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function saveCheckoutDraft(draft) {
  try {
    localStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify({
      ...draft,
      savedAt: Date.now(),
    }));
  } catch {
    // Storage quota or private mode fallback
  }
}

export function loadCheckoutDraft() {
  try {
    const raw = localStorage.getItem(CHECKOUT_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearCheckoutDraft() {
  try {
    localStorage.removeItem(CHECKOUT_DRAFT_KEY);
  } catch {}
}

export async function placeCheckout(payload, { idempotencyKey = null } = {}) {
  const key = idempotencyKey || generateIdempotencyKey();

  const res = await fetch('/api/v1/orders/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error?.message_en || 'Checkout failed');
    error.code = data.error?.code;
    error.statusCode = res.status;
    error.details = data.error?.details;
    error.messageBn = data.error?.message_bn;
    throw error;
  }

  // Clear draft upon successful order creation
  clearCheckoutDraft();
  return data.data;
}

export async function getMyOrders({ limit = 20, cursor = null } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);

  const res = await fetch(`/api/v1/orders/my-orders?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error?.message_en || 'Failed to load orders');
    error.code = data.error?.code;
    throw error;
  }
  return data;
}

export async function getOrderById(orderIdOrRef) {
  const res = await fetch(`/api/v1/orders/${encodeURIComponent(orderIdOrRef)}`);
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error?.message_en || 'Order not found');
    error.code = data.error?.code;
    throw error;
  }
  return data.data?.order;
}

export async function cancelOrder(orderIdOrRef, reason = null) {
  const res = await fetch(`/api/v1/orders/${encodeURIComponent(orderIdOrRef)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });

  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error?.message_en || 'Failed to cancel order');
    error.code = data.error?.code;
    error.messageBn = data.error?.message_bn;
    throw error;
  }
  return data.data?.order;
}
