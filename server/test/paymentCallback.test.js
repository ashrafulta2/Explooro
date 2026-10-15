import test from 'node:test';
import assert from 'node:assert/strict';

import { handleGatewayReturn } from '../src/services/payment.service.ts';
import { handlePaymentCallbackHandler } from '../src/controllers/paymentWebhook.controller.ts';

// WHY: GET/POST /payments/callback/:gateway is public and every value in it is attacker-chosen. The
// old handler trusted `status=success`, looked the payment up by the wrong column, ran executePayment
// with no actor and swallowed every error. These tests pin that a URL alone can never mark a payment
// paid, that the lookup uses the gateway reference, and that the shopper sees the real state.

function makeDb(txn, { orderRef = 'ORD-1' } = {}) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM payment_transactions') && sql.includes('gateway_ref = $2')) {
        return { rows: txn && params[0] === txn.gateway && (params[1] === txn.gateway_ref || params[1] === txn.ref) ? [txn] : [] };
      }
      if (sql.includes('FROM payment_transactions WHERE id = $1')) return { rows: txn ? [txn] : [] };
      if (sql.includes('FROM orders o')) return { rows: [{ id: txn.order_id, ref: orderRef }] };
      if (sql.includes('UPDATE payment_transactions')) {
        txn.status = params.find((p) => ['FAILED', 'SUCCESS'].includes(p)) || txn.status;
        return { rows: [txn] };
      }
      return { rows: [] };
    },
  };
  return db;
}

const pending = (over = {}) => ({
  id: 7, ref: 'TXN-ABC', order_id: 42, user_id: 3, gateway: 'MOCK', gateway_ref: 'GW-123', status: 'PENDING', amount: '500.00', ...over,
});
const wroteMoney = (db) => db.calls.some((c) => /UPDATE orders|UPDATE sub_orders|INSERT INTO escrow/.test(c.sql));
const quietLog = () => ({ warns: [], warn(...a) { this.warns.push(a); } });

test('a forged status=success for a mock-driver payment does not mark anything paid', async () => {
  const db = makeDb(pending());
  const res = await handleGatewayReturn(db, null, { gateway: 'mock', reference: 'GW-123', claimedStatus: 'success' });
  assert.equal(res.found, true);
  assert.equal(res.status, 'PENDING');
  assert.equal(wroteMoney(db), false);
  assert.equal(db.calls.some((c) => c.sql.includes('UPDATE payment_transactions')), false);
});

test('the lookup uses the gateway reference and gateway, not the integer order id', async () => {
  const db = makeDb(pending());
  await handleGatewayReturn(db, null, { gateway: 'mock', reference: 'GW-123', claimedStatus: 'x' });
  const lookup = db.calls.find((c) => c.sql.includes('gateway_ref = $2'));
  assert.ok(lookup, 'looked up by gateway_ref');
  assert.deepEqual(lookup.params, ['MOCK', 'GW-123']);
  assert.equal(db.calls.some((c) => c.sql.includes('payment_transactions') && c.sql.includes('order_id = $1')), false);
});

test('unknown, empty or oversized references are reported as not found without touching money', async () => {
  const db = makeDb(pending());
  assert.deepEqual(await handleGatewayReturn(db, null, { gateway: 'mock', reference: 'NOPE', claimedStatus: 'success' }), { found: false });
  assert.deepEqual(await handleGatewayReturn(db, null, { gateway: 'mock', reference: '', claimedStatus: 'success' }), { found: false });
  assert.deepEqual(await handleGatewayReturn(db, null, { gateway: 'mock', reference: undefined }), { found: false });
  const before = db.calls.length;
  assert.deepEqual(await handleGatewayReturn(db, null, { gateway: 'mock', reference: 'x'.repeat(200) }), { found: false });
  assert.equal(db.calls.length, before, 'oversized input never reaches the database');
  assert.equal(wroteMoney(db), false);
});

test('a live driver that cannot confirm with the gateway is logged, not swallowed, and nothing is paid', async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, PAYMENT_DRIVER: process.env.PAYMENT_DRIVER };
  process.env.NODE_ENV = 'production'; // bKash driver reports isLive and has no credentials -> execute throws
  process.env.PAYMENT_DRIVER = 'live';
  try {
    const db = makeDb(pending({ gateway: 'BKASH' }));
    const log = quietLog();
    const res = await handleGatewayReturn(db, null, { gateway: 'bkash', reference: 'GW-123', claimedStatus: 'Success', log });
    assert.equal(log.warns.length, 1, 'the failure is logged');
    assert.notEqual(res.status, 'PAID');
    assert.equal(wroteMoney(db), false);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('an already-paid transaction reports PAID with its order ref', async () => {
  const db = makeDb(pending({ status: 'SUCCESS' }), { orderRef: 'ORD-77' });
  const res = await handleGatewayReturn(db, null, { gateway: 'mock', reference: 'TXN-ABC', claimedStatus: 'failed' });
  assert.deepEqual(res, { found: true, transactionRef: 'TXN-ABC', orderRef: 'ORD-77', status: 'PAID' });
});

function call(handler, { db, query = {}, body = {}, accept = 'application/json', params = { gateway: 'mock' } }) {
  const out = { redirect: null, code: null, body: null };
  const reply = {
    redirect(to) { out.redirect = to; return reply; },
    code(c) { out.code = c; return reply; },
    send(b) { out.body = b; return reply; },
  };
  const req = { params, query, body, headers: { accept }, log: quietLog(), server: { db, cache: null } };
  return handler(req, reply).then(() => out);
}

test('the browser redirect shows the real state and never echoes the URL\'s claimed status', async () => {
  const db = makeDb(pending());
  const out = await call(handlePaymentCallbackHandler, {
    db, accept: 'text/html', query: { paymentID: 'GW-123', status: 'success&admin=1' },
  });
  assert.equal(out.redirect, '/checkout?payment=pending&ref=TXN-ABC');
  assert.ok(!out.redirect.includes('admin'));
});

test('a paid transaction redirects to its order, and an unknown one to a neutral page', async () => {
  const paid = makeDb(pending({ status: 'SUCCESS' }), { orderRef: 'ORD 9/x' });
  const a = await call(handlePaymentCallbackHandler, { db: paid, accept: 'text/html', query: { paymentID: 'GW-123' } });
  assert.equal(a.redirect, `/orders/${encodeURIComponent('ORD 9/x')}`);
  const b = await call(handlePaymentCallbackHandler, { db: makeDb(pending()), accept: 'text/html', query: { paymentID: 'nope' } });
  assert.equal(b.redirect, '/checkout?payment=unknown');
});

test('the JSON form returns the real status, and an unknown payment is a 404-class error', async () => {
  const db = makeDb(pending());
  const ok = await call(handlePaymentCallbackHandler, { db, query: { paymentID: 'GW-123', status: 'success' } });
  assert.deepEqual(ok.body, { data: { gateway: 'mock', transactionRef: 'TXN-ABC', status: 'PENDING' } });
  await assert.rejects(
    () => call(handlePaymentCallbackHandler, { db, query: { paymentID: 'nope' } }),
    (err) => err.code === 'NOT_FOUND' || /not found/i.test(err.message)
  );
});
