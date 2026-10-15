/**
 * warrantyRefundScope.test.js — a warranty REFUND must be scoped to the claimed order item.
 *
 * A warranty card belongs to ONE order item (030_warranty.sql: warranty_cards.order_item_id is
 * UNIQUE). The REFUND branch used to claw back the whole sub-order (৳1,260 for a ৳200 cable) and
 * swallow any failure. Decided 2026-10-15 (docs/warranty-refund-scope.md, Option B): the customer
 * gets the claimed item's line_total, the supplier pays all of it, and escrow is left alone.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as warrantyService from '../src/services/warranty.service.js';

const CUSTOMER_ID = 10;
const SUPPLIER_ID = 101;
const SALER_ID = 201;
const PLATFORM_ID = 1;
const SUB_ORDER_ID = 701;

// Sub-order with two items. Only the cable (item 902, line total ৳200) has a warranty claim.
// Escrow is held per sub-order, not per item: supplier 1010 (base+wholesale+shipping 60),
// shop partner 90, platform 160 = ৳1,260, the whole sub-order.
const ITEMS = [
  { id: 901, title: 'Walton 43-inch Smart TV', qty: 1, base_price: '800.00', retail_price: '1000.00', line_total: '1000.00' },
  { id: 902, title: 'HDMI Cable 2m', qty: 1, base_price: '150.00', retail_price: '200.00', line_total: '200.00' },
];
const CLAIMED_ITEM = ITEMS[1];

function createScenarioDb() {
  const wallets = [
    { id: 1, user_id: PLATFORM_ID },
    { id: 10, user_id: CUSTOMER_ID },
    { id: 101, user_id: SUPPLIER_ID },
    { id: 201, user_id: SALER_ID },
  ].map((w) => ({
    ...w,
    available_balance: '0.00',
    pending_escrow_balance: '0.00',
    held_balance: '0.00',
    lifetime_earned: '0.00',
    lifetime_withdrawn: '0.00',
    currency: 'BDT',
    version: 0,
  }));

  const escrowEntries = [
    { id: 1, sub_order_id: SUB_ORDER_ID, wallet_id: 101, beneficiary_role: 'SUPPLIER', amount: '1010.00', status: 'LOCKED', hold_until: null },
    { id: 2, sub_order_id: SUB_ORDER_ID, wallet_id: 201, beneficiary_role: 'SALER', amount: '90.00', status: 'LOCKED', hold_until: null },
    { id: 3, sub_order_id: SUB_ORDER_ID, wallet_id: 1, beneficiary_role: 'PLATFORM', amount: '160.00', status: 'LOCKED', hold_until: null },
  ];

  const ledgerRows = [];
  const recoveries = [];
  const claimUpdates = [];
  let claimResolution = null;
  let failLedger = false;

  const handle = async (sql, params = []) => {
    // notification.service recipient lookup + insert (same answers as warrantyClaimsEngine.test.js)
    if (sql.includes('u.locale') && sql.includes('LEFT JOIN user_profiles up ON up.user_id = u.id')) {
      return { rows: [{ id: params[0], full_name: 'Test User', phone: null, email: null, locale: 'en' }] };
    }
    if (sql.includes('INSERT INTO notifications')) {
      return { rows: [{ id: 1, ref: params[0], user_id: params[1] }] };
    }

    // reviewWarrantyClaim: claim + card + the claimed order item
    if (sql.includes('FROM warranty_claims c') && sql.includes('JOIN warranty_cards wc')) {
      return {
        rows: [{
          id: params[0],
          ref: 'CLM-TEST0001',
          status: 'SUBMITTED',
          warranty_card_id: 55,
          supplier_id: SUPPLIER_ID,
          customer_id: CUSTOMER_ID,
          serial_number: 'SN-1',
          card_ref: 'WAR-TEST0001',
          title_en: CLAIMED_ITEM.title,
          title_bn: CLAIMED_ITEM.title,
          product_id: 77,
          sub_order_ref: 'SO-701',
          recipient_name: 'Customer Karim',
          recipient_phone: '+8801700000010',
          delivery_address_json: {},
          line_total: CLAIMED_ITEM.line_total,
          retail_price: CLAIMED_ITEM.retail_price,
          sub_order_id: SUB_ORDER_ID,
          resolution: claimResolution,
        }],
      };
    }

    if (sql.includes('UPDATE warranty_claims')) {
      claimUpdates.push(params);
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO negative_balance_recoveries')) {
      recoveries.push({ wallet_id: params[1], total: params[4], recovered: params[5], deficit: params[6] });
      return { rows: [{ id: recoveries.length, ref: params[0] }] };
    }

    // processReturnClawback: sub-order header
    if (sql.includes('FROM sub_orders s') && sql.includes('WHERE s.id = $1')) {
      return {
        rows: [{
          id: SUB_ORDER_ID,
          order_id: 3001,
          supplier_id: SUPPLIER_ID,
          saler_id: SALER_ID,
          total_amount: '1260.00',
          saler_commission: '90.00',
          subtotal_base: '950.00',
          wholesale_margin: '0.00',
          shipping_amount: '60.00',
          customer_id: CUSTOMER_ID,
        }],
      };
    }

    if (sql.includes('FROM order_items') && sql.includes('sub_order_id')) {
      return { rows: ITEMS.map((i) => ({ ...i, sub_order_id: SUB_ORDER_ID })) };
    }

    if (sql.includes('FROM escrow_entries') && sql.includes('WHERE sub_order_id = $1')) {
      return { rows: escrowEntries.filter((e) => e.sub_order_id === params[0]).map((e) => ({ ...e })) };
    }

    if (sql.includes('UPDATE escrow_entries') && sql.includes('CLAWED_BACK')) {
      const ids = params[0].map(Number);
      for (const e of escrowEntries) if (ids.includes(e.id)) e.status = 'CLAWED_BACK';
      return { rows: [] };
    }

    if (sql.includes('FROM wallets') && sql.includes('WHERE user_id = $1')) {
      return { rows: wallets.filter((w) => w.user_id === params[0]) };
    }
    if (sql.includes('FROM wallets') && sql.includes('ANY($1::bigint[])')) {
      return { rows: wallets.filter((w) => params[0].includes(w.id)) };
    }
    if (sql.includes('FROM wallets') && sql.includes('WHERE id = $1')) {
      return { rows: wallets.filter((w) => w.id === Number(params[0])) };
    }

    if (sql.includes('INSERT INTO ledger_transactions')) {
      if (failLedger) throw new Error('DB_DOWN: ledger insert failed');
      const row = {
        id: ledgerRows.length + 1,
        txn_group_id: params[0],
        wallet_id: params[1],
        entry_type: params[2],
        amount: params[3],
        balance_bucket: params[4],
        category: params[5],
      };
      ledgerRows.push(row);
      return { rows: [row] };
    }

    if (sql.includes('UPDATE wallets')) {
      return { rows: wallets.filter((w) => w.id === Number(params[0])) };
    }

    return { rows: [] };
  };

  const db = {
    query: handle,
    async connect() {
      return { query: handle, release() {} };
    },
  };

  return {
    db,
    wallets,
    escrowEntries,
    ledgerRows,
    recoveries,
    claimUpdates,
    setClaimResolution(value) { claimResolution = value; },
    failLedgerInserts() { failLedger = true; },
  };
}

function toPaisa(amount) {
  return Math.round(parseFloat(amount) * 100);
}

async function approveRefund(db) {
  return warrantyService.reviewWarrantyClaim(db, {
    claimId: 5001,
    supplierId: SUPPLIER_ID,
    action: 'APPROVE',
    resolution: 'REFUND',
  });
}

function sumPaisa(rows, walletId, entryType) {
  return rows
    .filter((r) => Number(r.wallet_id) === walletId && r.entry_type === entryType)
    .reduce((sum, r) => sum + toPaisa(r.amount), 0);
}

describe('Warranty REFUND is scoped to the claimed order item', () => {
  test('customer is refunded exactly the claimed item line total', async () => {
    const { db, ledgerRows } = createScenarioDb();

    const result = await approveRefund(db);
    assert.equal(result.status, 'APPROVED');
    assert.equal(result.refundAmount, '200.00');

    const refundPaisa = ledgerRows
      .filter((r) => r.wallet_id === 10 && r.entry_type === 'CREDIT' && r.category === 'REFUND')
      .reduce((sum, r) => sum + toPaisa(r.amount), 0);
    assert.equal(refundPaisa, toPaisa(CLAIMED_ITEM.line_total), 'not the whole ৳1,260 sub-order');
  });

  test('the supplier pays the whole refund; shop partner and platform are untouched', async () => {
    const { db, ledgerRows } = createScenarioDb();

    await approveRefund(db);

    assert.equal(sumPaisa(ledgerRows, 101, 'DEBIT'), 20000);
    assert.equal(sumPaisa(ledgerRows, 201, 'DEBIT'), 0, 'shop partner must keep its commission');
    assert.equal(sumPaisa(ledgerRows, 1, 'DEBIT'), 0, 'platform must keep its margin');
    assert.equal(sumPaisa(ledgerRows, 10, 'CREDIT'), sumPaisa(ledgerRows, 101, 'DEBIT'), 'double entry balances');
  });

  test('escrow is not clawed back, so other items stay refundable', async () => {
    const { db, escrowEntries } = createScenarioDb();

    await approveRefund(db);

    assert.ok(escrowEntries.every((e) => e.status === 'LOCKED'));
  });

  test('a supplier without enough balance gets a recorded deficit', async () => {
    const { db, wallets, recoveries } = createScenarioDb();
    wallets.find((w) => w.id === 101).available_balance = '50.00';

    const result = await approveRefund(db);

    assert.equal(result.refundAmount, '200.00');
    assert.equal(recoveries.length, 1);
    assert.deepEqual(recoveries[0], { wallet_id: 101, total: '200.00', recovered: '50.00', deficit: '150.00' });
  });

  test('no deficit is recorded when the supplier can cover the refund', async () => {
    const { db, wallets, recoveries } = createScenarioDb();
    wallets.find((w) => w.id === 101).available_balance = '500.00';

    await approveRefund(db);

    assert.equal(recoveries.length, 0);
  });

  test('a failed refund throws and the claim is not marked APPROVED', async () => {
    const { db, claimUpdates, failLedgerInserts } = createScenarioDb();
    failLedgerInserts();

    await assert.rejects(approveRefund(db), /DB_DOWN/);
    assert.equal(claimUpdates.length, 0);
  });

  test('a claim that was already refunded cannot be refunded again', async () => {
    const { db, ledgerRows, setClaimResolution } = createScenarioDb();
    setClaimResolution('REFUND');

    await assert.rejects(approveRefund(db), /CLAIM_ALREADY_REFUNDED/);
    assert.equal(ledgerRows.length, 0);
  });
});
