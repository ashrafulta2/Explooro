import { api } from '../core/api.ts';
import { clearCart, getCart, syncCartToServer } from './cart.ts';
import { track, flushSignals } from './signals.ts';

const CHECKOUT_DRAFT_KEY = 'explooro_checkout_draft';

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, any>;

export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function saveCheckoutDraft(draft: Params) {
  try {
    localStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify({
      ...draft,
      savedAt: Date.now(),
    }));
  } catch {
    // Storage quota or private mode fallback
  }
}

export function loadCheckoutDraft(): (Params & { savedAt: number }) | null {
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

export async function placeCheckout(payload: Params, { idempotencyKey = null }: { idempotencyKey?: string | null } = {}) {
  // Sync client-side items to server cart to guarantee server cart has the items
  await syncCartToServer();

  const key = idempotencyKey || generateIdempotencyKey();
  const res = await api.post('/orders/checkout', payload, {
    idempotencyKey: key,
  });

  // PURCHASE is the strongest signal there is. Read the lines BEFORE clearCart() empties them, and
  // only after the order is confirmed — a failed checkout throws above and records nothing.
  for (const item of getCart()?.items ?? []) {
    track('PURCHASE', { id: item.product_id });
  }
  flushSignals();

  clearCheckoutDraft();
  clearCart();
  return res.data || res;
}

export async function getMyOrders(query: Params = {}) {
  const res = await api.get('/orders/my-orders', { query });
  return res.data || res;
}

export async function getOrderById(orderIdOrRef: number | string) {
  const res = await api.get(`/orders/${encodeURIComponent(orderIdOrRef)}`);
  const data = res.data || res;
  return data?.order || data;
}

export async function cancelOrder(orderIdOrRef: number | string, reason: string | null = null) {
  const res = await api.post(`/orders/${encodeURIComponent(orderIdOrRef)}/cancel`, { reason });
  const data = res.data || res;
  return data?.order || data;
}
