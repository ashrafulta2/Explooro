/**
 * walletTopup.test.js — adding money to a vault (migration 088, walletTopup.service.ts).
 *
 * Invariants: an amount outside the rules or the 24-hour limit is refused before any gateway is
 * called; a confirmed top-up is credited once, from the external clearing wallet; nothing but a
 * confirmed TOPUP transaction is ever credited; the payment pipeline routes TOPUP to the credit.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateRequest, resolveRules, creditTopUp, DEFAULT_RULES, GATEWAY_BY_METHOD } from '../src/services/walletTopup.service.ts';

const read = (rel) => fs.readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');
const rules = resolveRules(null);

describe('top-up rules', () => {
  test('a valid request maps the method to its gateway and the amount to paisa', () => {
    assert.deepEqual(validateRequest({ amount: '100.50', method: 'bkash' }, rules), { paisa: 10050, gateway: 'BKASH', method: 'BKASH' });
    assert.equal(validateRequest({ amount: 500, method: 'CARD' }, rules).gateway, 'SSLCOMMERZ');
    // 10.10 must pass: the decimals check is textual, not floating-point arithmetic.
    assert.equal(validateRequest({ amount: 60.1, method: 'NAGAD' }, rules).paisa, 6010);
  });

  test('amounts outside the rules, malformed amounts and unknown methods are refused', () => {
    assert.throws(() => validateRequest({ amount: 49, method: 'BKASH' }, rules), (e) => e.code === 'VALIDATION_FAILED');
    assert.throws(() => validateRequest({ amount: 25001, method: 'BKASH' }, rules), (e) => e.code === 'VALIDATION_FAILED');
    assert.throws(() => validateRequest({ amount: '10.123', method: 'BKASH' }, rules), (e) => e.code === 'VALIDATION_FAILED');
    assert.throws(() => validateRequest({ amount: '-100', method: 'BKASH' }, rules), (e) => e.code === 'VALIDATION_FAILED');
    assert.throws(() => validateRequest({ amount: 100, method: 'MOCK' }, rules), (e) => e.code === 'PAYMENT_METHOD_UNSUPPORTED');
    assert.throws(() => validateRequest({ amount: 100, method: 'ROCKET' }, rules), (e) => e.code === 'PAYMENT_METHOD_UNSUPPORTED');
  });

  test('the 24-hour limit counts what is already started or added', () => {
    const almost = (rules.daily_limit - 100) * 100;
    assert.equal(validateRequest({ amount: 100, method: 'BKASH' }, rules, almost).paisa, 10000);
    assert.throws(() => validateRequest({ amount: 101, method: 'BKASH' }, rules, almost), (e) => e.code === 'TOPUP_DAILY_LIMIT');
  });

  test('reads fall back field by field; the defaults equal the migration seed', () => {
    const r = resolveRules({ min_amount: -5, max_amount: 1000, methods: ['NAGAD', 'PAYPAL'] });
    assert.equal(r.min_amount, DEFAULT_RULES.min_amount);
    assert.equal(r.max_amount, 1000);
    assert.deepEqual(r.methods, ['NAGAD']);
    const seed = JSON.parse(read('src/db/migrations/088_wallet_topup.sql').match(/'(\{"min_amount"[^']*\})'::jsonb/)[1]);
    assert.deepEqual(seed, { ...DEFAULT_RULES, methods: [...DEFAULT_RULES.methods] });
    for (const m of seed.methods) assert.ok(m in GATEWAY_BY_METHOD, m);
  });
});

describe('crediting a confirmed top-up', () => {
  // A stand-in pool whose one client records every query; enough to watch the credit decisions.
  function fakeDb(txn, { alreadyCredited = false } = {}) {
    const calls = [];
    const client = {
      async query(sql, params) {
        const q = sql.trim().replace(/\s+/g, ' ');
        calls.push(q);
        if (q.startsWith('SELECT * FROM payment_transactions')) return { rows: txn ? [txn] : [] };
        if (q.includes('FROM ledger_transactions WHERE idempotency_key')) return { rows: alreadyCredited ? [{ 1: 1 }] : [] };
        return { rows: [] };
      },
      release() {},
    };
    return { db: { connect: async () => client, query: client.query }, calls };
  }

  test('a transaction that is not a confirmed TOPUP is never credited', async () => {
    for (const txn of [null, { ref: 'T1', intent: 'SALE', status: 'SUCCESS' }, { ref: 'T2', intent: 'TOPUP', status: 'INITIATED' }]) {
      const { db, calls } = fakeDb(txn);
      const r = await creditTopUp(db, 'T');
      assert.equal(r.credited, false);
      assert.ok(!calls.some((c) => c.includes('INSERT INTO ledger_transactions')));
    }
  });

  test('a top-up already credited is not credited again (webhook + execute racing, replays)', async () => {
    const { db, calls } = fakeDb({ id: 9, ref: 'TOP-1', intent: 'TOPUP', status: 'SUCCESS', user_id: 7, amount: '100.00' }, { alreadyCredited: true });
    const r = await creditTopUp(db, 'TOP-1');
    assert.deepEqual(r, { credited: false, reason: 'ALREADY_CREDITED' });
    assert.ok(calls.some((c) => c.includes('FOR UPDATE')), 'the transaction row is locked before checking');
  });
});

describe('top-up wiring', () => {
  test('the payment pipeline credits TOPUP on confirm and on replay, and webhooks find it by gateway ref', () => {
    const svc = read('src/services/payment.service.ts');
    assert.equal((svc.match(/if \(txn\.intent === 'TOPUP'\) await creditTopUp/g) || []).length, 2);
    assert.ok(svc.includes('findPaymentTransactionByGatewayReference(db, normGateway, String(paymentRef))'));
  });

  test('the credit comes from the external clearing wallet, in its own ledger category', () => {
    const src = read('src/services/walletTopup.service.ts');
    assert.ok(src.includes('resolveClearingWalletId'));
    assert.ok(src.includes("defaultCategory: 'WALLET_TOPUP'"));
    assert.ok(read('src/db/migrations/088_wallet_topup.sql').includes("'WALLET_TOPUP'"));
  });

  test('routes are guarded; the return address is a path on this site only', () => {
    const routes = read('src/routes/walletTopup.routes.ts');
    assert.ok(routes.includes("app.requirePermission('finance.wallet.topup')"));
    assert.ok(routes.includes("requireRestriction('can_place_order')"));
    const ctrl = read('src/controllers/walletTopup.controller.ts');
    assert.ok(ctrl.includes('safeInternalPath(body.returnUrl)'));
    assert.ok(ctrl.includes('publicWebUrl'));
    const catalog = JSON.parse(read('../docs/permission-catalog.json'));
    const perm = catalog.permissions.find((p) => p.key === 'finance.wallet.topup');
    assert.deepEqual(perm.default_roles.sort(), ['customer', 'saler', 'supplier']);
  });
});
