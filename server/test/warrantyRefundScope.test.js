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
import * as clawbackService from '../src/services/clawback.service.js';
import * as returnService from '../src/services/return.service.js';

const CUSTOMER_ID = 10;
const SUPPLIER_ID = 101;
const SALER_ID = 201;
const PLATFORM_ID = 1;
const SUB_ORDER_ID = 701;
const RETURN_ID = 3001;

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
  let returnedTotal = '200.00';
  let coverage = [];
  let usedItems = [];
  let returnedQty = 0;
  let claimStatus = 'SUBMITTED';
  let itemQty = 1;
  let itemLineTotal = CLAIMED_ITEM.line_total;
  let nextClaimId = 5001;

  const handle = async (sql, params = []) => {
    // double-refund guards
    if (sql.includes('prior_qty') && sql.includes('warranty_units')) {
      return { rows: usedItems };
    }
    // processWarrantyRefund: units of this item already refunded (returns + earlier warranty claims)
    if (sql.includes('returned_qty') && sql.includes('warranty_units')) {
      const claimIds = new Set(
        ledgerRows
          .filter((r) => r.reference_type === 'WARRANTY_CLAIM' && r.category === 'REFUND' && r.entry_type === 'CREDIT')
          .map((r) => r.reference_id)
      );
      return { rows: [{ returned_qty: returnedQty, warranty_units: claimIds.size }] };
    }
    // processPartialReturnClawback: goods value of the sub-order and of the returned items
    if (sql.includes('goods_total') && sql.includes('returned_total')) {
      return { rows: [{ goods_total: '1200.00', returned_total: returnedTotal }] };
    }

    // return.service executeRefund
    if (sql.includes('FROM return_requests r') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: RETURN_ID, ref: 'RET-TEST0001', sub_order_id: SUB_ORDER_ID, status: 'INSPECTED', refund_amount: returnedTotal }] };
    }
    if (sql.includes('LEFT JOIN return_items ri')) {
      return { rows: coverage };
    }

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
          ref: `CLM-${params[0]}`,
          status: claimStatus,
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
          line_total: itemLineTotal,
          qty: itemQty,
          retail_price: CLAIMED_ITEM.retail_price,
          sub_order_id: SUB_ORDER_ID,
          order_item_id: CLAIMED_ITEM.id,
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

    // processReturnClawback: item refunds (warranty claims, partial returns) already on this sub-order
    if (sql.includes('FROM ledger_transactions lt') && sql.includes('WARRANTY_CLAIM')) {
      const totals = new Map();
      for (const r of ledgerRows) {
        if (!['WARRANTY_CLAIM', 'RETURN_REQUEST'].includes(r.reference_type)) continue;
        const counts = (r.entry_type === 'DEBIT' && r.category === 'CLAWBACK') || (r.entry_type === 'CREDIT' && r.category === 'REFUND');
        if (!counts) continue;
        const key = `${r.wallet_id}|${r.entry_type}`;
        totals.set(key, (totals.get(key) || 0) + toPaisa(r.amount));
      }
      return {
        rows: [...totals].map(([key, paisa]) => {
          const [walletId, entryType] = key.split('|');
          return { wallet_id: Number(walletId), entry_type: entryType, total: (paisa / 100).toFixed(2) };
        }),
      };
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
        reference_type: params[6],
        reference_id: params[7],
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
    setReturn(total, rows) { returnedTotal = total; coverage = rows; },
    setUsedItems(rows) { usedItems = rows; },
    markItemReturned(units = 1) { returnedQty = units; },
    setClaimStatus(value) { claimStatus = value; },
    setItem(qty, lineTotal) { itemQty = qty; itemLineTotal = lineTotal; },
    nextClaim() { return nextClaimId++; },
  };
}

function toPaisa(amount) {
  return Math.round(parseFloat(amount) * 100);
}

async function approveRefund(db, claimId = 5001) {
  return warrantyService.reviewWarrantyClaim(db, {
    claimId,
    action: 'APPROVE',
    resolution: 'REFUND',
    isStaffOverride: true,
    staffUserId: 900,
  });
}

async function supplierProposesRefund(db) {
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

describe('A return after a warranty refund does not refund the item twice', () => {
  const ESCROW_TOTAL_PAISA = 126000;

  async function returnWholeSubOrder(db) {
    return clawbackService.processReturnClawback(db, { subOrderId: SUB_ORDER_ID, reason: 'Return approved' });
  }

  test('the customer receives the sub-order total once in all', async () => {
    const { db, ledgerRows } = createScenarioDb();

    await approveRefund(db);
    const result = await returnWholeSubOrder(db);

    assert.equal(result.priorItemRefunds, '200.00');
    assert.equal(result.customerRefundAmount, '1060.00');
    assert.equal(sumPaisa(ledgerRows, 10, 'CREDIT'), ESCROW_TOTAL_PAISA, 'not ৳1,460 (the cable twice)');
  });

  test('every party ends where a plain return would leave it', async () => {
    const { db, ledgerRows } = createScenarioDb();

    await approveRefund(db);
    await returnWholeSubOrder(db);

    const net = (walletId) => sumPaisa(ledgerRows, walletId, 'CREDIT') - sumPaisa(ledgerRows, walletId, 'DEBIT');
    assert.equal(net(101), -101000, 'supplier loses only its escrow, its warranty payment is repaid');
    assert.equal(net(201), -9000, 'shop partner loses only its escrow');
    assert.equal(net(1), -16000, 'platform loses only its escrow');
  });

  test('a return with no earlier warranty refund is unchanged', async () => {
    const { db, ledgerRows } = createScenarioDb();

    const result = await returnWholeSubOrder(db);

    assert.equal(result.priorItemRefunds, '0.00');
    assert.equal(sumPaisa(ledgerRows, 10, 'CREDIT'), ESCROW_TOTAL_PAISA);
    assert.equal(sumPaisa(ledgerRows, 101, 'CREDIT'), 0, 'no repayment entry for the supplier');
  });
});

describe('A partial return refunds only the returned items', () => {
  const net = (ledgerRows, walletId) => sumPaisa(ledgerRows, walletId, 'CREDIT') - sumPaisa(ledgerRows, walletId, 'DEBIT');

  async function returnCable(db) {
    return clawbackService.processPartialReturnClawback(db, { subOrderId: SUB_ORDER_ID, returnRequestId: RETURN_ID });
  }

  test('the customer gets the returned item only, not the whole sub-order or shipping', async () => {
    const { db, ledgerRows } = createScenarioDb();

    const result = await returnCable(db);

    assert.equal(result.totalClawbackAmount, '200.00');
    assert.equal(sumPaisa(ledgerRows, 10, 'CREDIT'), 20000, 'not ৳1,260');
  });

  test('each party gives back its own pro-rata share, summing exactly to the refund', async () => {
    const { db, ledgerRows } = createScenarioDb();

    const result = await returnCable(db);

    // goods-only escrow: supplier 950 (1010 minus ৳60 shipping), shop partner 90, platform 160 = 1200
    assert.deepEqual(result.sharesByRole, { SUPPLIER: '158.33', SALER: '15.00', PLATFORM: '26.67' });
    assert.equal(net(ledgerRows, 101) + net(ledgerRows, 201) + net(ledgerRows, 1), -20000);
  });

  test('escrow rows are left as they were', async () => {
    const { db, escrowEntries } = createScenarioDb();

    await returnCable(db);

    assert.ok(escrowEntries.every((e) => e.status === 'LOCKED'));
  });

  test('a full return afterwards refunds the rest once, and each party ends as after one full return', async () => {
    const { db, ledgerRows } = createScenarioDb();

    await returnCable(db);
    const result = await clawbackService.processReturnClawback(db, { subOrderId: SUB_ORDER_ID });

    assert.equal(result.customerRefundAmount, '1060.00');
    assert.equal(sumPaisa(ledgerRows, 10, 'CREDIT'), 126000);
    assert.equal(net(ledgerRows, 101), -101000);
    assert.equal(net(ledgerRows, 201), -9000);
    assert.equal(net(ledgerRows, 1), -16000);
  });

  test('a partial return after the sub-order was fully refunded is refused', async () => {
    const { db, escrowEntries } = createScenarioDb();
    for (const e of escrowEntries) e.status = 'CLAWED_BACK';

    await assert.rejects(returnCable(db), /ALREADY_CLAWED_BACK/);
  });

  test('executeRefund takes the partial path when a unit is left behind', async () => {
    const { db, ledgerRows, setReturn } = createScenarioDb();
    setReturn('200.00', [
      { id: 901, qty: 1, returned_qty: 0 },
      { id: 902, qty: 1, returned_qty: 1 },
    ]);

    const result = await returnService.executeRefund(db, null, { returnRequestId: RETURN_ID, client: db });

    assert.equal(result.clawbackResult.partial, true);
    assert.equal(sumPaisa(ledgerRows, 10, 'CREDIT'), 20000);
  });

  test('executeRefund keeps the full path when every unit comes back', async () => {
    const { db, ledgerRows, setReturn } = createScenarioDb();
    setReturn('1200.00', [
      { id: 901, qty: 1, returned_qty: 1 },
      { id: 902, qty: 1, returned_qty: 1 },
    ]);

    const result = await returnService.executeRefund(db, null, { returnRequestId: RETURN_ID, client: db });

    assert.notEqual(result.clawbackResult.partial, true);
    assert.equal(sumPaisa(ledgerRows, 10, 'CREDIT'), 126000, 'a full return still refunds shipping');
  });
});

describe('The same item cannot be refunded twice', () => {
  test('a second return of an item already returned is refused', async () => {
    const { db, ledgerRows, setUsedItems } = createScenarioDb();
    setUsedItems([{ order_item_id: 902, qty: 1, this_qty: 1, prior_qty: 1, warranty_units: 0 }]);

    await assert.rejects(
      clawbackService.processPartialReturnClawback(db, { subOrderId: SUB_ORDER_ID, returnRequestId: RETURN_ID }),
      /ITEM_ALREADY_RETURNED/
    );
    assert.equal(ledgerRows.length, 0);
  });

  test('returning an item already refunded by warranty is refused', async () => {
    const { db, setUsedItems } = createScenarioDb();
    setUsedItems([{ order_item_id: 902, qty: 1, this_qty: 1, prior_qty: 0, warranty_units: 1 }]);

    await assert.rejects(
      clawbackService.processPartialReturnClawback(db, { subOrderId: SUB_ORDER_ID, returnRequestId: RETURN_ID }),
      /ITEM_ALREADY_REFUNDED/
    );
  });

  test('a warranty refund on an item already returned is refused', async () => {
    const { db, ledgerRows, claimUpdates, markItemReturned } = createScenarioDb();
    markItemReturned();

    await assert.rejects(approveRefund(db), /ITEM_ALREADY_RETURNED/);
    assert.equal(ledgerRows.length, 0);
    assert.equal(claimUpdates.length, 0);
  });

  test('returning the remaining units of a partly returned item is allowed', async () => {
    const { db, setUsedItems } = createScenarioDb();
    setUsedItems([{ order_item_id: 902, qty: 3, this_qty: 1, prior_qty: 2, warranty_units: 0 }]);

    const result = await clawbackService.processPartialReturnClawback(db, { subOrderId: SUB_ORDER_ID, returnRequestId: RETURN_ID });
    assert.equal(result.success, true);
  });
});

describe('A supplier cannot refund on their own', () => {
  test('a supplier REFUND is escalated to the admin queue and moves no money', async () => {
    const { db, ledgerRows, claimUpdates } = createScenarioDb();

    const result = await supplierProposesRefund(db);

    assert.equal(result.status, 'ESCALATED');
    assert.equal(result.pendingApproval, true);
    assert.equal(ledgerRows.length, 0);
    assert.equal(claimUpdates.length, 1);
  });

  test('an admin approving the escalated claim pays the refund', async () => {
    const { db, ledgerRows, setClaimStatus, setClaimResolution } = createScenarioDb();
    setClaimStatus('ESCALATED');
    setClaimResolution('REFUND');

    const result = await approveRefund(db);

    assert.equal(result.status, 'APPROVED');
    assert.equal(sumPaisa(ledgerRows, 10, 'CREDIT'), 20000);
  });

  test('the supplier cannot change a claim while it waits for an admin', async () => {
    const { db, setClaimStatus } = createScenarioDb();
    setClaimStatus('ESCALATED');

    await assert.rejects(supplierProposesRefund(db), /CLAIM_AWAITING_ADMIN/);
  });
});

describe('One warranty claim refunds one unit', () => {
  test('qty 2: each claim refunds one unit, a third is refused', async () => {
    const { db, ledgerRows, setItem, nextClaim } = createScenarioDb();
    setItem(2, '400.00');

    const first = await approveRefund(db, nextClaim());
    const second = await approveRefund(db, nextClaim());

    assert.equal(first.refundAmount, '200.00');
    assert.equal(second.refundAmount, '200.00');
    await assert.rejects(approveRefund(db, nextClaim()), /ITEM_ALREADY_REFUNDED/);
    assert.equal(sumPaisa(ledgerRows, 10, 'CREDIT'), 40000, 'never more than the line total');
  });

  test('the last unit takes the rounding remainder', async () => {
    const { db, setItem, nextClaim } = createScenarioDb();
    setItem(3, '1000.00');

    const amounts = [];
    for (let i = 0; i < 3; i++) amounts.push((await approveRefund(db, nextClaim())).refundAmount);

    assert.deepEqual(amounts, ['333.33', '333.33', '333.34']);
  });

  test('units already returned count against the warranty', async () => {
    const { db, setItem, markItemReturned, nextClaim } = createScenarioDb();
    setItem(2, '400.00');
    markItemReturned(1);

    const result = await approveRefund(db, nextClaim());
    assert.equal(result.refundAmount, '200.00');
    await assert.rejects(approveRefund(db, nextClaim()), /ITEM_ALREADY_REFUNDED/);
  });
});

