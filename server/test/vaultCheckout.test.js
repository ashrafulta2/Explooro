/**
 * vaultCheckout.test.js — paying a normal checkout from one's own vault (migration 092).
 *
 * Invariants: a vault short of the order total refuses the order before any money moves; the
 * shopper's wallet is locked before its balance is read; a refund happens once and only for a paid
 * vault order; the wiring pays inside the checkout transaction and refunds on cancel.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { vaultShortfallPaisa, payOrderFromVault, refundCancelledOrderToVault, isRefundableOnCancel } from '../src/services/vaultCheckout.service.ts';

const read = (rel) => fs.readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');

// A stand-in transaction client: answers the wallet lookups and records every statement.
function fakeClient({ available = '0.00', alreadyRefunded = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      const q = sql.trim().replace(/\s+/g, ' ');
      calls.push(q);
      if (q.includes('WHERE system_key')) return { rows: [{ id: '1' }] };
      if (q.includes('FROM wallets WHERE id = ANY')) return { rows: [{ id: '1', available_balance: '0.00' }, { id: '5', available_balance: available }] };
      if (q.includes('FROM wallets WHERE user_id')) return { rows: [{ id: '5', user_id: '7', available_balance: available }] };
      if (q.includes('FROM ledger_transactions WHERE idempotency_key')) return { rows: alreadyRefunded ? [{ 1: 1 }] : [] };
      return { rows: [] };
    },
  };
}

describe('vault shortfall', () => {
  test('is the paisa missing, and 0 when the vault covers the total', () => {
    assert.equal(vaultShortfallPaisa('100.00', 10000), 0);
    assert.equal(vaultShortfallPaisa('99.99', 10000), 1);
    assert.equal(vaultShortfallPaisa(null, 2550), 2550);
    assert.equal(vaultShortfallPaisa('500.00', 0), 0);
  });
});

describe('paying from the vault', () => {
  test('a short vault refuses the order with the shortfall, and no money or order state moves', async () => {
    const client = fakeClient({ available: '100.00' });
    await assert.rejects(
      payOrderFromVault(client, { orderId: 3, orderRef: 'ORD-3', userId: 7, totalPaisa: 25000 }),
      (e) => e.code === 'INSUFFICIENT_VAULT_BALANCE' && e.details.shortfall === '150.00'
    );
    assert.ok(client.calls.some((c) => c.includes('FOR UPDATE')), 'the wallet is locked before its balance is read');
    assert.ok(!client.calls.some((c) => c.includes('INSERT INTO ledger') || c.startsWith('UPDATE orders')));
  });

  test('a guest cannot pay from a vault', async () => {
    await assert.rejects(payOrderFromVault(fakeClient(), { orderId: 3, orderRef: 'ORD-3', userId: null, totalPaisa: 100 }), (e) => e.code === 'UNAUTHORIZED');
  });
});

describe('refunding a cancelled paid order to the vault', () => {
  const paid = { id: 3, ref: 'ORD-3', customer_id: 7, total_amount: '250.00', payment_method: 'WALLET', payment_status: 'PAID' };

  test('every order paid up front is refundable; COD and unpaid orders are not', () => {
    for (const m of ['WALLET', 'BKASH', 'NAGAD', 'ROCKET', 'CARD', 'bkash']) assert.equal(isRefundableOnCancel({ ...paid, payment_method: m }), true, m);
    assert.equal(isRefundableOnCancel({ ...paid, payment_method: 'COD' }), false);
    assert.equal(isRefundableOnCancel({ ...paid, payment_status: 'PENDING' }), false);
    assert.equal(isRefundableOnCancel({ ...paid, payment_status: 'REFUNDED' }), false);
    assert.equal(isRefundableOnCancel(null), false);
  });

  test('COD and unpaid orders move no money', async () => {
    for (const order of [{ ...paid, payment_method: 'COD' }, { ...paid, payment_status: 'PENDING' }, null]) {
      const client = fakeClient();
      assert.deepEqual(await refundCancelledOrderToVault(client, order), { refunded: false });
      assert.equal(client.calls.length, 0);
    }
  });

  test('a refund already made is not made again', async () => {
    const client = fakeClient({ alreadyRefunded: true });
    assert.deepEqual(await refundCancelledOrderToVault(client, paid), { refunded: false, reason: 'ALREADY_REFUNDED' });
    assert.ok(!client.calls.some((c) => c.startsWith('UPDATE orders')));
  });
});

describe('vault checkout wiring', () => {
  test('checkout pays inside its transaction, before the commit', () => {
    const src = read('src/services/checkout.service.ts');
    const pay = src.indexOf('await payOrderFromVault(client');
    assert.ok(pay > 0 && pay < src.indexOf("await client.query('COMMIT')"));
  });

  test('the route accepts WALLET and cancel refunds a paid vault order', () => {
    assert.ok(read('src/routes/order.routes.ts').includes("'COD', 'WALLET']"));
    const cancel = read('src/services/order.service.ts');
    assert.ok(cancel.includes('if (isRefundableOnCancel(order))') && cancel.includes('await refundCancelledOrderToVault(client, order'));
  });

  test('the shopper is charged and refunded the order total, through the clearing wallet, in their own categories', () => {
    const src = read('src/services/vaultCheckout.service.ts');
    assert.ok(src.includes("defaultCategory: 'VAULT_PAYMENT'") && src.includes("defaultCategory: 'VAULT_REFUND'"));
    assert.ok(src.includes('refundBuyerWalletId: clearingId') && src.includes('buyerWalletId: clearingId'));
    const sql = read('src/db/migrations/092_vault_checkout.sql');
    assert.ok(sql.includes("'VAULT_PAYMENT'") && sql.includes("'VAULT_REFUND'") && sql.includes("'WALLET_TOPUP'"));
  });
});

describe('a payment that completes after the order was cancelled', () => {
  test('confirms only PLACED parcels, and sends the money to the vault when none is left', () => {
    const src = read('src/services/payment.service.ts');
    assert.ok(src.includes("WHERE order_id = $1 AND status = 'PLACED';"), 'a cancelled parcel is never revived');
    assert.ok(!src.includes("UPDATE sub_orders SET status = 'CONFIRMED', updated_at = now() WHERE order_id = $1;"));
    const settle = src.slice(src.indexOf('async function settlePaidOrder'));
    assert.ok(settle.indexOf('refundCancelledOrderToVault') < settle.indexOf('lockEscrowForPaidOrder(db, order)'));
    assert.equal(src.split('await settlePaidOrder(db, ').length - 1, 2, 'both the first confirm and a replay settle');
  });
});
