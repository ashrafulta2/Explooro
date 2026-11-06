/**
 * returnShipping.test.js — who pays to send a return back (migration 106), as Daraz runs it.
 *
 * 1. The supplier's fault costs the customer nothing; the customer's choice costs them the return.
 * 2. A customer is never charged more than the return refunded them.
 * 3. The rules are configuration: strict on write, forgiving on read, defaults equal the seed.
 * 4. The money moves as one balanced ADJUSTMENT group on the return, inside the refund.
 * 5. The customer and staff pages get the same answer; the refund policy text states the amounts.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as rs from '../src/services/returnShipping.service.ts';
import { renderBody } from '../src/services/legal.service.ts';
import { executeRefund, reviewReturnRequest } from '../src/services/return.service.ts';

const norm = (sql) => String(sql).trim().replace(/\s+/g, ' ');
const migration = readFileSync(new URL('../src/db/migrations/106_return_shipping_cost.sql', import.meta.url), 'utf8');
const POLICY = { supplier_fault_reasons: ['DAMAGED', 'WRONG_ITEM', 'DEFECTIVE', 'NOT_AS_DESCRIBED'], max_courier_refund: 150, pickup_fee: 100 };
const plan = (o) => rs.planSettlement({ policy: POLICY, deliveryCharge: 60, customerRefund: 1000, ...o });
const amounts = (p) => p.moves.map((m) => `${m.kind}:${m.from}>${m.to}:${m.paisa / 100}`);

describe('who pays', () => {
  test('the supplier pays for its own faults, the customer for their own choice', () => {
    for (const r of ['DAMAGED', 'WRONG_ITEM', 'DEFECTIVE', 'NOT_AS_DESCRIBED']) assert.equal(rs.defaultPayer(r, POLICY), 'SUPPLIER', r);
    for (const r of ['CHANGED_MIND', 'SIZE_MISMATCH', 'OTHER']) assert.equal(rs.defaultPayer(r, POLICY), 'CUSTOMER', r);
  });

  test('supplier fault, sent by hand: the receipt is repaid up to the limit, by the supplier', () => {
    assert.deepEqual(amounts(plan({ paidBy: 'SUPPLIER', mode: 'HAND', isFullReturn: true, customerCourierCost: 220 })),
      ['COURIER_RECEIPT_REPAID:SUPPLIER>CUSTOMER:150']);
    assert.deepEqual(amounts(plan({ paidBy: 'SUPPLIER', mode: 'HAND', isFullReturn: true, customerCourierCost: 85.5 })),
      ['COURIER_RECEIPT_REPAID:SUPPLIER>CUSTOMER:85.5']);
    assert.deepEqual(amounts(plan({ paidBy: 'SUPPLIER', mode: 'HAND', isFullReturn: true, customerCourierCost: null })), [],
      'no receipt typed, nothing repaid');
  });

  test('supplier fault, courier pickup: free to the customer, the supplier pays the platform', () => {
    const p = plan({ paidBy: 'SUPPLIER', mode: 'COURIER', isFullReturn: true });
    assert.deepEqual(amounts(p), ['PICKUP_FEE:SUPPLIER>PLATFORM:100']);
    assert.equal(p.customerNetPaisa, 0);
  });

  test('change of mind: the delivery charge is kept and a pickup costs the fee', () => {
    assert.deepEqual(amounts(plan({ paidBy: 'CUSTOMER', mode: 'HAND', isFullReturn: true })), ['DELIVERY_CHARGE_KEPT:CUSTOMER>SUPPLIER:60']);
    assert.deepEqual(amounts(plan({ paidBy: 'CUSTOMER', mode: 'COURIER', isFullReturn: true })),
      ['DELIVERY_CHARGE_KEPT:CUSTOMER>SUPPLIER:60', 'PICKUP_FEE:CUSTOMER>PLATFORM:100']);
    assert.deepEqual(amounts(plan({ paidBy: 'CUSTOMER', mode: 'COURIER', isFullReturn: false })), ['PICKUP_FEE:CUSTOMER>PLATFORM:100'],
      'a partial refund never included the delivery charge');
  });

  test('a customer is never charged more than the return refunded them', () => {
    const p = plan({ paidBy: 'CUSTOMER', mode: 'COURIER', isFullReturn: true, customerRefund: 120 });
    assert.deepEqual(amounts(p), ['DELIVERY_CHARGE_KEPT:CUSTOMER>SUPPLIER:60', 'PICKUP_FEE:CUSTOMER>PLATFORM:60']);
    assert.equal(p.customerNetPaisa, -12000);
    assert.deepEqual(amounts(plan({ paidBy: 'CUSTOMER', mode: 'COURIER', isFullReturn: true, customerRefund: 0 })), []);
  });
});

describe('the rules are configuration', () => {
  test('the defaults equal the seed row in migration 106', () => {
    const seed = JSON.parse(migration.match(/'returns\.shipping_policy',\s*'(\{[^']+\})'::jsonb/)[1]);
    assert.deepEqual(seed, { ...rs.DEFAULT_POLICY, supplier_fault_reasons: [...rs.DEFAULT_POLICY.supplier_fault_reasons] });
    const read = rs.rowToPolicy({ value_json: seed });
    assert.deepEqual(read.supplier_fault_reasons, seed.supplier_fault_reasons);
  });

  test('writes are strict: unknown reasons, fractions and out-of-range amounts are refused', () => {
    assert.deepEqual(rs.validatePolicy({ ...POLICY, supplier_fault_reasons: ['WRONG_ITEM', 'DAMAGED'] }).supplier_fault_reasons, ['DAMAGED', 'WRONG_ITEM']);
    assert.throws(() => rs.validatePolicy({ ...POLICY, supplier_fault_reasons: ['BROKEN'] }), (e) => e.details?.field === 'supplier_fault_reasons');
    assert.throws(() => rs.validatePolicy({ ...POLICY, pickup_fee: -1 }), (e) => e.details?.field === 'pickup_fee');
    assert.throws(() => rs.validatePolicy({ ...POLICY, pickup_fee: 99.5 }), (e) => e.details?.field === 'pickup_fee');
    assert.throws(() => rs.validatePolicy({ ...POLICY, max_courier_refund: 999999 }), (e) => e.details?.field === 'max_courier_refund');
  });

  test('reads are forgiving: a damaged row falls back to the defaults', () => {
    const p = rs.rowToPolicy({ value_json: { supplier_fault_reasons: 'x', pickup_fee: 'lots' } });
    assert.deepEqual(p.supplier_fault_reasons, [...rs.DEFAULT_POLICY.supplier_fault_reasons]);
    assert.equal(p.pickup_fee, rs.DEFAULT_POLICY.pickup_fee);
  });

  test('staff input: the payer and the courier receipt are checked', () => {
    assert.equal(rs.parsePayerOverride(undefined), null);
    assert.equal(rs.parsePayerOverride('SUPPLIER'), 'SUPPLIER');
    assert.throws(() => rs.parsePayerOverride('PLATFORM'), (e) => e.code === 'VALIDATION_FAILED');
    assert.equal(rs.parseCourierCost(85.5), 85.5);
    assert.equal(rs.parseCourierCost(''), null);
    for (const bad of [-1, 'abc', 1.234]) assert.throws(() => rs.parseCourierCost(bad), (e) => e.details?.field === 'customer_courier_cost', String(bad));
  });

  test('saving writes a CRITICAL audit row with a reason', async () => {
    const audits = [];
    const db = { async query(sql, p) { return norm(sql).includes('FROM platform_settings') && p?.[0] === rs.POLICY_KEY ? { rows: [{ value_json: POLICY }] } : { rows: [] }; } };
    await assert.rejects(rs.updatePolicy(db, { record: async () => {} }, { policy: POLICY, reason: 'x', userId: 1 }), (e) => e.details?.field === 'reason');
    await rs.updatePolicy(db, { async record(_db, row) { audits.push(row); } }, { policy: { ...POLICY, pickup_fee: 80 }, reason: 'Courier rate went down', userId: 1 });
    assert.equal(audits[0].action, 'platform.operations.return_shipping.update');
    assert.equal(audits[0].riskTier, 'CRITICAL');
  });
});

/** A db that runs the real ledger code: wallets per user, captured ledger rows. */
function ledgerDb({ returnRow, policy = POLICY, fullReturn = true, supplierAvailable = '0.00' }) {
  const seen = [];
  const ledger = [];
  const query = async (sql, params = []) => {
    const q = norm(sql);
    seen.push({ sql: q, params });
    if (q.includes('FROM platform_settings') && params[0] === rs.POLICY_KEY) return { rows: [{ value_json: policy }] };
    if (q.includes('FROM return_requests r') && q.includes('FOR UPDATE')) return { rows: [returnRow] };
    if (q.includes('FROM order_items oi') && q.includes('returned_qty')) {
      return { rows: [{ id: 1, qty: 2, returned_qty: fullReturn ? 2 : 1 }] };
    }
    if (q.includes('FROM wallets') && q.includes('WHERE user_id = $1')) return { rows: [{ id: 1000 + Number(params[0]), user_id: params[0] }] };
    if (q.includes('FROM wallets') && q.includes('WHERE id = $1 FOR UPDATE')) {
      return { rows: [{ id: params[0], user_id: params[0] - 1000, available_balance: supplierAvailable }] };
    }
    if (q.startsWith('INSERT INTO negative_balance_recoveries')) return { rows: [{ ref: params[0], unrecovered_deficit: params[7] }] };
    if (q.includes('FROM wallets') && q.includes('ANY($1::bigint[])')) {
      return { rows: params[0].map((id) => ({ id, user_id: id - 1000, available_balance: '0.00', pending_escrow_balance: '0.00', held_balance: '0.00' })) };
    }
    if (q.includes("WHERE r.key = 'super_admin'")) return { rows: [{ id: 1 }] };
    if (q.startsWith('INSERT INTO ledger_transactions')) {
      ledger.push({ wallet: params[1], type: params[2], amount: params[3], category: params[5], refType: params[6], refId: params[7] });
      return { rows: [{ id: ledger.length }] };
    }
    if (q.startsWith('UPDATE wallets')) return { rows: [{ id: params[0] }] };
    // The clawback itself is exercised in clawback tests; here escrow is already gone so it is a no-op.
    if (q.includes('FROM escrow_entries')) return { rows: [{ id: 9, status: 'CLAWED_BACK', amount: '0.00' }] };
    if (q.includes('FROM sub_orders s') && q.includes('JOIN orders o')) return { rows: [{ id: 501, shipping_amount: '60.00', customer_id: 3 }] };
    return { rows: [] };
  };
  return { seen, ledger, query, async connect() { return { query, release() {} }; } };
}

describe('settling at refund', () => {
  const base = { id: 5, ref: 'RET-5', status: 'INSPECTED', customer_id: 3, supplier_id: 9, sub_order_id: 501, shipping_amount: '60.00' };

  test('one balanced ADJUSTMENT group on the return, with the stored payer beating the reason', async () => {
    const db = ledgerDb({ returnRow: base });
    const record = await rs.settleReturnShipping(db, {
      returnReq: { ...base, reason_code: 'CHANGED_MIND', return_shipping_paid_by: 'SUPPLIER', reverse_carrier: 'MANUAL', customer_courier_cost: '90.00' },
      isFullReturn: true,
      customerRefund: '500.00',
      approvedBy: 1,
    });
    assert.equal(record.paid_by, 'SUPPLIER', 'staff chose the supplier at approval');
    assert.deepEqual(record.moves, [{ kind: 'COURIER_RECEIPT_REPAID', from: 'SUPPLIER', to: 'CUSTOMER', amount: '90.00' }]);
    assert.deepEqual(db.ledger.map((l) => [l.wallet, l.type, l.amount]), [[1009, 'DEBIT', '90.00'], [1003, 'CREDIT', '90.00']]);
    for (const l of db.ledger) {
      assert.equal(l.category, 'ADJUSTMENT', 'never REFUND/CLAWBACK, which the full clawback nets');
      assert.equal(l.refType, 'RETURN_REQUEST');
      assert.equal(l.refId, 5);
    }
    const saved = db.seen.find((s) => s.sql.startsWith('UPDATE return_requests SET return_shipping_paid_by'));
    assert.equal(JSON.parse(saved.params[2]).customer_net, '90.00');
  });

  test('a supplier who cannot cover it goes below zero with a recovery record, as with a clawback', async () => {
    const db = ledgerDb({ returnRow: base, supplierAvailable: '40.00' });
    const record = await rs.settleReturnShipping(db, {
      returnReq: { ...base, reason_code: 'DAMAGED', reverse_carrier: 'MANUAL', customer_courier_cost: '90.00' },
      isFullReturn: true,
      customerRefund: '500.00',
    });
    const ins = db.seen.find((s) => s.sql.startsWith('INSERT INTO negative_balance_recoveries'));
    assert.ok(ins, 'a recovery record is written');
    assert.deepEqual(ins.params.slice(1, 8), [1009, 9, 501, 5, '90.00', '40.00', '50.00']);
    assert.deepEqual(record.supplier_deficit, { ref: ins.params[0], amount: '50.00' });
    assert.deepEqual(db.ledger.map((l) => [l.wallet, l.type, l.amount]), [[1009, 'DEBIT', '90.00'], [1003, 'CREDIT', '90.00']],
      'the customer is still repaid in full');
  });

  test('a supplier who can cover it gets no recovery record', async () => {
    const db = ledgerDb({ returnRow: base, supplierAvailable: '500.00' });
    const record = await rs.settleReturnShipping(db, {
      returnReq: { ...base, reason_code: 'DAMAGED', reverse_carrier: 'MANUAL', customer_courier_cost: '90.00' },
      isFullReturn: true,
      customerRefund: '500.00',
    });
    assert.equal(record.supplier_deficit, null);
    assert.equal(db.seen.some((s) => s.sql.startsWith('INSERT INTO negative_balance_recoveries')), false);
  });

  test('a courier pickup records the charge it collected on the pickup, for reconciliation', async () => {
    const db = ledgerDb({ returnRow: base, supplierAvailable: '500.00' });
    await rs.settleReturnShipping(db, {
      returnReq: { ...base, reason_code: 'CHANGED_MIND', reverse_carrier: 'MOCK', reverse_pickup_id: 900 },
      isFullReturn: false,
      customerRefund: '500.00',
    });
    const upd = db.seen.find((s) => s.sql.startsWith('UPDATE reverse_pickups SET fee_charged'));
    assert.deepEqual(upd.params, [900, '100.00', 'CUSTOMER']);
  });

  test('nothing to move writes no ledger rows but still records the outcome', async () => {
    const db = ledgerDb({ returnRow: base });
    const record = await rs.settleReturnShipping(db, { returnReq: { ...base, reason_code: 'DAMAGED', reverse_carrier: 'MANUAL' }, isFullReturn: true, customerRefund: '500.00' });
    assert.equal(record.paid_by, 'SUPPLIER');
    assert.equal(db.ledger.length, 0);
    assert.ok(db.seen.some((s) => s.sql.startsWith('UPDATE return_requests SET return_shipping_paid_by')));
  });

  test('executeRefund settles the shipping inside the refund transaction', async () => {
    const db = ledgerDb({ returnRow: { ...base, reason_code: 'CHANGED_MIND', reverse_carrier: 'MANUAL' } });
    const res = await executeRefund(db, null, { returnRequestId: 5, approvedBy: 1, client: db });
    assert.equal(res.status, 'REFUNDED');
    assert.equal(res.shippingSettlement.paid_by, 'CUSTOMER');
    // The fake's escrow is already clawed back, so the refund is 0 and nothing may be charged.
    assert.deepEqual(res.shippingSettlement.moves, []);
  });
});

describe('approval records who pays', () => {
  const answer = (q, p) => {
    if (q.includes('FROM return_requests r')) return { rows: [{ id: 5, ref: 'RET-5', status: 'REQUESTED', reason_code: 'OTHER', sub_order_ref: 'S', supplier_id: 9 }] };
    if (q.includes('FROM platform_settings') && p[0] === 'operations.modes') return { rows: [{ value_json: { payout_mode: 'MANUAL', courier_mode: 'MANUAL' } }] };
    if (q.includes('FROM platform_settings') && p[0] === rs.POLICY_KEY) return { rows: [{ value_json: POLICY }] };
    return { rows: [] };
  };
  const fake = () => {
    const seen = [];
    const query = async (sql, p = []) => { const q = norm(sql); seen.push({ sql: q, params: p }); return answer(q, p); };
    return { seen, query, async connect() { return { query, release() {} }; } };
  };

  test('the policy decides by default and staff can override it', async () => {
    let db = fake();
    let res = await reviewReturnRequest(db, null, { returnRequestId: 5, action: 'APPROVE', reviewedBy: 1, client: db });
    assert.equal(res.returnShippingPaidBy, 'CUSTOMER', 'OTHER is the customer\'s choice by default');
    db = fake();
    res = await reviewReturnRequest(db, null, { returnRequestId: 5, action: 'APPROVE', reviewedBy: 1, shippingPaidBy: 'SUPPLIER', client: db });
    assert.equal(res.returnShippingPaidBy, 'SUPPLIER');
    const update = db.seen.find((s) => s.sql.startsWith('UPDATE return_requests'));
    assert.match(update.sql, /return_shipping_paid_by = \$3/);
    assert.equal(update.params[2], 'SUPPLIER');
  });
});

describe('the refund policy states the amounts', () => {
  test('migration 106 adds a refund policy version with both amounts as tokens, once', () => {
    assert.match(migration, /INSERT INTO legal_documents/);
    const en = migration.match(/\$en\$([\s\S]*?)\$en\$/)[1];
    const bn = migration.match(/\$bn\$([\s\S]*?)\$bn\$/)[1];
    for (const token of ['{{returns.max_courier_refund}}', '{{returns.pickup_fee}}', '{{returns.window_days}}']) {
      assert.ok(en.includes(token) && bn.includes(token), `${token} is in both languages`);
    }
    assert.match(migration, /WHERE NOT EXISTS \(\s*SELECT 1 FROM legal_documents WHERE doc_key = 'refund' AND body_en LIKE '%\{\{returns\.pickup_fee\}\}%'/);
  });

  test('the tokens render from the policy, in Bangla digits for bn', () => {
    const text = 'up to Tk {{returns.max_courier_refund}}; fee {{returns.pickup_fee}}';
    assert.equal(renderBody(text, { returnShipping: { max_courier_refund: 150, pickup_fee: 100 } }, 'en'), 'up to Tk 150; fee 100');
    assert.equal(renderBody(text, { returnShipping: { max_courier_refund: 150, pickup_fee: 100 } }, 'bn'), 'up to Tk ১৫০; fee ১০০');
    assert.equal(renderBody(text, {}, 'en'), text, 'left as written when unknown, so a preview shows it');
  });
});
