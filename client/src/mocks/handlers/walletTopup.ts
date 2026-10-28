/**
 * walletTopup.ts — Mock API handlers for vault top-ups (server routes/walletTopup.routes.ts).
 *
 * Mirrors the server: the `wallet.topup` rules of migration 088, and the mock gateway, which has no
 * page of its own — POST /wallet/topups answers with a same-site redirect and POST /payments/execute
 * (orders.js, through executeMockTopUp) then marks it paid and credits the balance. The balance and
 * history live for the session only.
 */


import type { MockRoute } from '../types.ts';

const RULES = { min_amount: 50, max_amount: 25000, daily_limit: 50000, methods: ['BKASH', 'NAGAD', 'CARD'] };
const GATEWAY = { BKASH: 'BKASH', NAGAD: 'NAGAD', CARD: 'SSLCOMMERZ' };
let balance = 0;
const items = [];

const bad = (code, message_en, message_bn) => ({ status: 422, body: { error: { code, message_en, message_bn } } });

export const walletTopupHandlers = [
  {
    method: 'GET',
    path: '/wallet/topups',
    handler() {
      return { status: 200, body: { data: { balance: balance.toFixed(2), rules: RULES, items: items.slice(0, 10), total: items.length, page: 1, limit: 10 } } };
    },
  },
  {
    method: 'POST',
    path: '/wallet/topups',
    handler({ body = {} } = {}) {
      const method = String(body.method || '').toUpperCase();
      if (!RULES.methods.includes(method)) return bad('PAYMENT_METHOD_UNSUPPORTED', 'Pick bKash, Nagad or a card.', 'বিকাশ, নগদ বা কার্ড বেছে নিন।');
      const text = String(body.amount ?? '').trim();
      const amount = Number(text);
      if (!/^\d+(\.\d{1,2})?$/.test(text) || amount < RULES.min_amount || amount > RULES.max_amount) {
        return bad('VALIDATION_FAILED', `A top-up must be from ৳${RULES.min_amount} to ৳${RULES.max_amount}.`, `টাকা যোগের পরিমাণ ৳${RULES.min_amount} থেকে ৳${RULES.max_amount} এর মধ্যে হতে হবে।`);
      }
      const ref = `TOP-${Date.now().toString(36).toUpperCase()}`;
      items.unshift({ ref, gateway: GATEWAY[method], method, amount: amount.toFixed(2), status: 'INITIATED', created_at: new Date().toISOString() });
      const back = typeof body.returnUrl === 'string' && body.returnUrl.startsWith('/') ? body.returnUrl : '/wallet/top-up';
      return { status: 201, body: { data: { transactionRef: ref, status: 'INITIATED', amount: amount.toFixed(2), gateway: GATEWAY[method], method, redirectUrl: `${back}?paymentId=MOCK-${ref}&status=success` } } };
    },
  },
] satisfies MockRoute[];

/**
 * Finishes a mock top-up for POST /payments/execute (declared once, in orders.js, which asks here
 * first). Returns the response, or null when the reference is not a top-up. Credits once only.
 */
export function executeMockTopUp(transactionRef) {
  const item = items.find((i) => i.ref === transactionRef);
  if (!item) return null;
  if (item.status !== 'SUCCESS') {
    item.status = 'SUCCESS';
    balance += Number(item.amount);
  }
  return { status: 200, body: { data: { success: true, transactionRef: item.ref, orderId: null, status: 'PAID' } } };
}
