import { api } from '../core/api.js';

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
  const res = await api.post('/orders/checkout', payload, {
    idempotencyKey: key,
  });

  clearCheckoutDraft();
  return res.data || res;
}

export async function getMyOrders(query = {}) {
  const res = await api.get('/orders/my-orders', { query });
  return res.data || res;
}

export async function getOrderById(orderIdOrRef) {
  const res = await api.get(`/orders/${encodeURIComponent(orderIdOrRef)}`);
  const data = res.data || res;
  return data?.order || data;
}

export async function cancelOrder(orderIdOrRef, reason = null) {
  const res = await api.post(`/orders/${encodeURIComponent(orderIdOrRef)}/cancel`, { reason });
  const data = res.data || res;
  return data?.order || data;
}
