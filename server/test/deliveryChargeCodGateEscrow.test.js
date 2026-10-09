/**
 * deliveryChargeCodGateEscrow.test.js — the three fixes of 2026-10-09 (bug report "Found, not fixed").
 *
 * 1. A paid bKash/Nagad/card order locks escrow (payment.service.js used to call depositToEscrow
 *    with the wrong arguments and hid the error).
 * 2. The normal-checkout delivery charge is a setting (it was ৳60 in code).
 * 3. Team-purchase COD members pass the same trust / OTP gate as checkout, and the OTP row survives
 *    the rollback that COD_OTP_REQUIRED causes.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as deliveryChargeService from '../src/services/deliveryCharge.service.js';
import * as codGateService from '../src/services/codGate.service.js';
import { AppError } from '../src/plugins/errorHandler.js';
import { createMemoryCache } from '../src/config/cache-drivers/memory.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

/** A db that answers by matching SQL text, and records every query it saw. */
function fakeDb(name, answer = () => ({ rows: [] })) {
  const seen = [];
  return {
    name,
    seen,
    async query(sql, params = []) {
      seen.push({ sql: String(sql), params });
      return answer(String(sql), params);
    },
  };
}

describe('1. paid gateway orders lock escrow', () => {
  const paymentSrc = src('services/payment.service.js');

  test('depositToEscrow is called as (db, {...}), never (db, cache, {...})', () => {
    assert.ok(!/depositToEscrow\(db, cache/.test(paymentSrc));
    assert.match(paymentSrc, /vaultService\.depositToEscrow\(db, \{\s*subOrderId: so\.id,/);
  });

  test('the error is no longer swallowed silently', () => {
    assert.ok(!/depositToEscrow\([^)]*\)\.catch\(\(\) => \{\}\)/s.test(paymentSrc));
    assert.match(paymentSrc, /console\.error\(`\[payment\] Escrow lock failed/);
  });

  test('the platform treasury funds it, so the shopper\'s wallet is never driven negative', () => {
    assert.match(paymentSrc, /buyerWalletId: platformWalletId/);
    assert.match(src('services/shipment.service.js'), /buyerWalletId: await vaultService\.resolvePlatformWalletId/);
  });

  test('a refunded or already-escrowed sub-order is never locked again', () => {
    assert.match(paymentSrc, /NOT EXISTS \(SELECT 1 FROM escrow_entries e WHERE e\.sub_order_id = s\.id\)/);
    assert.match(paymentSrc, /o\.payment_status = 'PAID'/);
  });

  test('the payment controllers use the pool app.js actually decorates', () => {
    for (const f of ['controllers/payment.controller.js', 'controllers/paymentWebhook.controller.js']) {
      assert.ok(!/req\.server\.pg\b/.test(src(f)), `${f} reads req.server.pg, which does not exist`);
    }
  });

  test('an already-successful payment heals a missing escrow on retry', () => {
    const idempotentBranch = paymentSrc.slice(paymentSrc.indexOf("if (txn.status === 'SUCCESS') {"));
    assert.match(idempotentBranch.slice(0, 400), /lockEscrowForPaidOrder\(db, paidOrder\)/);
  });
});

describe('2. delivery charge is a setting', () => {
  test('checkout and the cart read it; no ৳60 constant is left', () => {
    const checkout = src('services/checkout.service.js');
    const cart = src('services/cart.service.js');
    assert.ok(!/toPaisa\(60(\.0)?\)/.test(checkout));
    assert.ok(!/PerParcel = 60/.test(cart));
    assert.match(checkout, /deliveryChargeService\.perParcelCharge\(client, cache, \{ fresh: true \}\)/);
    assert.match(cart, /deliveryChargeService\.perParcelCharge\(db/);
  });

  test('validatePolicy accepts the range in whole paisa and refuses the rest', () => {
    assert.deepEqual(deliveryChargeService.validatePolicy({ per_parcel_charge: 0 }), { per_parcel_charge: 0 });
    assert.deepEqual(deliveryChargeService.validatePolicy({ per_parcel_charge: 80.5 }), { per_parcel_charge: 80.5 });
    for (const bad of [-1, 5000.01, 12.345, '60', null, Number.NaN]) {
      assert.throws(() => deliveryChargeService.validatePolicy({ per_parcel_charge: bad }), (e) => e.code === 'VALIDATION_FAILED');
    }
  });

  test('getPolicy reads the stored value and falls back to the default', async () => {
    const stored = fakeDb('pool', (sql) => (sql.includes('platform_settings')
      ? { rows: [{ key: 'delivery.per_parcel_charge', value_json: 85, updated_at: null, updated_by: null }] }
      : { rows: [] }));
    assert.equal(await deliveryChargeService.perParcelCharge(stored, null), 85);

    const empty = fakeDb('pool');
    assert.equal(await deliveryChargeService.perParcelCharge(empty, null), deliveryChargeService.DEFAULT_POLICY.per_parcel_charge);

    const corrupt = fakeDb('pool', () => ({ rows: [{ key: 'delivery.per_parcel_charge', value_json: -5 }] }));
    assert.equal(await deliveryChargeService.perParcelCharge(corrupt, null), deliveryChargeService.DEFAULT_POLICY.per_parcel_charge);
  });

  test('updatePolicy writes, audits before/after and needs a reason', async () => {
    let value = 60;
    const db = fakeDb('pool', (sql, params) => {
      if (sql.includes('INSERT INTO platform_settings')) value = JSON.parse(params[1]);
      if (sql.includes('FROM platform_settings')) return { rows: [{ key: 'delivery.per_parcel_charge', value_json: value }] };
      return { rows: [] };
    });
    const audits = [];
    const audit = { record: async (_db, row) => audits.push(row) };

    await assert.rejects(
      deliveryChargeService.updatePolicy(db, null, audit, { policy: { per_parcel_charge: 70 }, reason: 'short', userId: 1 }),
      (e) => e.code === 'VALIDATION_FAILED'
    );
    const after = await deliveryChargeService.updatePolicy(db, null, audit, {
      policy: { per_parcel_charge: 75 },
      reason: 'Courier rates went up this month',
      userId: 1,
    });
    assert.equal(after.per_parcel_charge, 75);
    assert.equal(audits.length, 1);
    assert.deepEqual(audits[0].beforeJson, { per_parcel_charge: 60 });
    assert.deepEqual(audits[0].afterJson, { per_parcel_charge: 75 });
    assert.equal(audits[0].action, 'platform.delivery.update');
  });

  test('the update permission is CRITICAL (super admin only) in the catalog and the seed', () => {
    const catalog = JSON.parse(readFileSync(new URL('../../docs/permission-catalog.json', import.meta.url), 'utf8'));
    const all = (catalog.permissions || catalog).flat ? (catalog.permissions || catalog) : [];
    const update = all.find((p) => p.key === 'platform.delivery.update');
    assert.equal(update?.risk_tier, 'CRITICAL');
    assert.deepEqual(update?.default_roles, ['super_admin']);
    assert.match(src('db/seeds/001_roles_permissions.sql'), /\('super_admin', 'platform\.delivery\.update'\)/);
  });
});

describe('3. COD trust / OTP gate', () => {
  // A low-trust user: trust score 10 (below 40) means COD needs an SMS code.
  const trustRows = (sql) => {
    if (sql.includes('FROM trust_scores') || sql.includes('trust_scores')) return { rows: [{ user_id: 7, score: 10, tier: 'STARTER' }] };
    return { rows: [] };
  };

  test('no code yet: the code is sent on the POOL, then COD_OTP_REQUIRED with a masked phone', async () => {
    const pool = fakeDb('pool');
    const client = fakeDb('client', trustRows);
    const sent = [];
    await assert.rejects(
      codGateService.enforceCodGate(pool, createMemoryCache(), {
        client,
        userId: 7,
        phone: '+8801712345678',
        orderAmount: 1200,
        smsSender: async (to, msg) => sent.push({ to, msg }),
        isDevelopment: true,
        ip: '127.0.0.1',
      }),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'COD_OTP_REQUIRED');
        assert.equal(err.details.phone, '+880171****678');
        assert.match(String(err.details.otp_debug), /^\d{6}$/);
        return true;
      }
    );
    // WHY this matters: the order's transaction is rolled back by the throw. A code written on the
    // client would vanish with it and no shopper could ever confirm.
    assert.ok(pool.seen.some((q) => /INSERT INTO otp/i.test(q.sql)), 'OTP row written on the pool');
    assert.ok(!client.seen.some((q) => /INSERT INTO otp/i.test(q.sql)), 'never on the transaction client');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, '+8801712345678');
  });

  test('outside development the code is never echoed back', async () => {
    const pool = fakeDb('pool');
    await assert.rejects(
      codGateService.enforceCodGate(pool, createMemoryCache(), {
        client: fakeDb('client', trustRows), userId: 7, phone: '+8801712345678', orderAmount: 1200, smsSender: async () => {},
      }),
      (err) => err.code === 'COD_OTP_REQUIRED' && err.details.otp_debug === undefined
    );
  });

  test('a trusted, small order passes without a code', async () => {
    const pool = fakeDb('pool');
    const client = fakeDb('client', (sql) => (sql.includes('trust_scores') ? { rows: [{ user_id: 7, score: 90, tier: 'ELITE_PARTNER' }] } : { rows: [] }));
    const res = await codGateService.enforceCodGate(pool, null, { client, userId: 7, phone: '+8801712345678', orderAmount: 500 });
    assert.deepEqual(res, { isOtpVerified: false, trustScore: 90 });
    assert.equal(pool.seen.length, 0);
  });

  test('a gated COD without an account phone is refused clearly', async () => {
    await assert.rejects(
      codGateService.enforceCodGate(fakeDb('pool'), null, { client: fakeDb('client', trustRows), userId: 7, phone: null, orderAmount: 1200 }),
      (err) => err.code === 'VALIDATION_FAILED' && err.details.field === 'phone'
    );
  });

  test('checkout and team purchase both use the shared gate', () => {
    assert.match(src('services/checkout.service.js'), /codGateService\.enforceCodGate\(pool, cache, \{/);
    const team = src('services/teamPurchase.service.js');
    assert.match(team, /codGateService\.enforceCodGate\(db, cache, \{/);
    assert.match(team, /if \(paymentMethod !== 'COD'\) return/);
    assert.match(team, /isOtpVerified: Boolean\(m\.is_otp_verified\)/);
    assert.match(src('controllers/teamPurchase.controller.js'), /otpCode: req\.body\?\.otp_code/);
  });
});
