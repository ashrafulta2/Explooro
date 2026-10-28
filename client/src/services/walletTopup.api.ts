/**
 * walletTopup.api.ts — adding money to one's own vault (server routes/walletTopup.routes.ts).
 *
 * A top-up is opened here and paid exactly like an order: a live gateway takes the payer to its own
 * page and confirms the server through its webhook; the mock driver (development) has no page, so the
 * payment is finished at once through the authenticated POST /payments/execute.
 */

import { api } from '../core/api.ts';
import { generateIdempotencyKey } from './order.api.ts';

const unwrap = (res: any) => res?.data ?? res;

export interface TopUpOptions {
  amount: number | string;
  method: 'BKASH' | 'NAGAD' | 'CARD';
  returnPath?: string;
}

/** The rules the server enforces on a top-up amount. */
export interface TopUpRules {
  min_amount: number;
  max_amount: number;
  daily_limit?: number;
  methods?: string[];
}

/** `{ balance, rules: { min_amount, max_amount, daily_limit, methods }, items, total, page, limit }` */
export async function getTopUps({ page = 1 }: { page?: number } = {}) {
  return unwrap(await api.get('/wallet/topups', { query: { page } }));
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
 * Pure. Whether an amount is one the rules allow; returns a locale key for the problem, or null.
 * The server checks the same rules; this only saves a round trip for an obvious typo.
 */
export function amountProblem(value: unknown, rules?: TopUpRules | null): string | null {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) <= 0) return 'topup.err_format';
  const n = Number(text);
  if (rules && (n < rules.min_amount || n > rules.max_amount)) return 'topup.err_range';
  return null;
}

/**
 * Opens a top-up and pays it. Resolves `{ redirected: true }` when a live gateway takes over, or
 * `{ paid: boolean, transactionRef }` when it finished here.
 */
export async function topUp({ amount, method, returnPath = '/wallet/top-up' }: TopUpOptions) {
  // WHY a fresh key per attempt: the server replays a known key's transaction, so reusing one after a
  // failed attempt would hand back that failed top-up instead of trying again.
  const init = unwrap(await api.post('/wallet/topups', { amount, method, returnUrl: returnPath }, { idempotencyKey: generateIdempotencyKey() }));
  if (isOtherOrigin(init.redirectUrl)) {
    window.location.assign(init.redirectUrl);
    return { redirected: true };
  }
  const exec = unwrap(await api.post('/payments/execute', { transactionRef: init.transactionRef }));
  return { paid: exec.status === 'PAID', transactionRef: init.transactionRef };
}
