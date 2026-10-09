/**
 * checkoutGatewayPayment.test.js — the rules that let checkout pay a gateway order safely.
 *
 * Checkout now calls /payments/initiate and /payments/execute for bKash, Nagad, Rocket and card
 * orders (before, nothing did, so those orders never became PAID and never locked escrow). Opening
 * that path to shoppers needs three guarantees:
 *  1. The order's own payment method picks the gateway; a request cannot swap in another driver.
 *  2. A COD order cannot be "paid" through a gateway, and nobody can execute another shopper's payment.
 *  3. With live payments on, a gateway with no driver yet fails instead of silently using the mock.
 */

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as paymentService from '../src/services/payment.service.js';
import { createPaymentGateway } from '../src/integrations/payments/index.js';

// Answers every query with the given rows, keyed by the table the SQL reads.
function fakeDb(tables) {
  return {
    async query(sql) {
      if (/FROM payment_transactions/.test(sql)) return { rows: tables.payment_transactions || [] };
      if (/COUNT\(\*\)::int AS n FROM sub_orders/.test(sql)) return { rows: [{ n: tables.payableSubOrders ?? 1 }] };
      if (/FROM sub_orders/.test(sql)) return { rows: tables.sub_orders || [] };
      if (/FROM orders/.test(sql)) return { rows: tables.orders || [] };
      if (/INSERT INTO payment_transactions/.test(sql)) return { rows: [{ id: 1, ref: 'TXN-1', status: 'INITIATED' }] };
      if (/UPDATE payment_transactions/.test(sql)) return { rows: [{ id: 1, ref: 'TXN-1', status: 'INITIATED', amount: '500.00' }] };
      return { rows: [] };
    },
  };
}

const order = (over = {}) => ({
  id: 7, ref: 'ORD-7', customer_id: 1, total_amount: '500.00', currency: 'BDT',
  payment_status: 'PENDING', payment_method: 'BKASH', ...over,
});

describe('Checkout gateway payment', () => {
  const savedDriver = process.env.PAYMENT_DRIVER;
  afterEach(() => {
    if (savedDriver === undefined) delete process.env.PAYMENT_DRIVER;
    else process.env.PAYMENT_DRIVER = savedDriver;
  });

  test('each checkout method maps to its gateway, and COD has none', () => {
    assert.equal(paymentService.gatewayForPaymentMethod('BKASH'), 'BKASH');
    assert.equal(paymentService.gatewayForPaymentMethod('nagad'), 'NAGAD');
    assert.equal(paymentService.gatewayForPaymentMethod('ROCKET'), 'ROCKET');
    assert.equal(paymentService.gatewayForPaymentMethod('CARD'), 'SSLCOMMERZ');
    assert.equal(paymentService.gatewayForPaymentMethod('COD'), null);
    assert.equal(paymentService.gatewayForPaymentMethod(undefined), null);
  });

  test('the order decides the gateway, whatever the request asks for', async () => {
    const db = fakeDb({ orders: [order({ payment_method: 'NAGAD' })] });
    const res = await paymentService.initiatePayment(db, null, { orderId: 7, userId: 1, gateway: 'MOCK' });
    assert.equal(res.gateway, 'NAGAD');
  });

  test('a COD order cannot be paid through a gateway', async () => {
    const db = fakeDb({ orders: [order({ payment_method: 'COD' })] });
    await assert.rejects(
      () => paymentService.initiatePayment(db, null, { orderId: 7, userId: 1 }),
      (err) => err.code === 'PAYMENT_METHOD_UNSUPPORTED' && err.statusCode === 422
    );
  });

  test('a fully cancelled order cannot be paid', async () => {
    const db = fakeDb({ orders: [order()], payableSubOrders: 0 });
    await assert.rejects(
      () => paymentService.initiatePayment(db, null, { orderId: 7, userId: 1 }),
      (err) => err.code === 'CONFLICT'
    );
  });

  test('an order already paid answers 409, not 500', async () => {
    const db = fakeDb({ orders: [order({ payment_status: 'PAID' })] });
    await assert.rejects(
      () => paymentService.initiatePayment(db, null, { orderId: 7, userId: 1 }),
      (err) => err.code === 'ORDER_ALREADY_PAID' && err.statusCode === 409
    );
  });

  test("a shopper cannot execute another shopper's payment", async () => {
    const db = fakeDb({ payment_transactions: [{ id: 1, ref: 'TXN-1', order_id: 7, user_id: 2, status: 'INITIATED', gateway: 'MOCK' }] });
    await assert.rejects(
      () => paymentService.executePayment(db, null, { transactionRef: 'TXN-1', actor: { id: 1, role: 'customer' } }),
      (err) => err.code === 'FORBIDDEN'
    );
  });

  test('with live payments on, a gateway without a driver fails instead of using the mock', () => {
    process.env.PAYMENT_DRIVER = 'live';
    assert.throws(() => createPaymentGateway('ROCKET'), (err) => err.code === 'PAYMENT_METHOD_UNSUPPORTED');
  });
});
