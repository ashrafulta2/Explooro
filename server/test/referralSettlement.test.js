/**
 * referralSettlement.test.js — a held referral commission can leave escrow, and only once.
 *
 * Invariants:
 *  1. The holding-period job releases ESCROW -> AVAILABLE on the beneficiary's own wallet, skips
 *     flagged referrals, and skips an earning another worker settled between scan and lock.
 *  2. Voiding returns the commission to the treasury (ESCROW debit, platform AVAILABLE credit) and
 *     every ledger group balances.
 *  3. A decision needs a flagged referral and a reason; the referral ends in the right state and an
 *     audit row records it.
 *  4. The decision routes carry the same module + permission as the rest of the governance surface.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import * as escrow from '../src/services/referralEscrow.service.js';
import * as admin from '../src/services/referralAdmin.service.js';
import referralRoutes from '../src/routes/referral.routes.js';

const BENEFICIARY_WALLET = 10;
const PLATFORM_WALLET = 1;

function makeDb({ referral = null, earnings = [], due = [] } = {}) {
  const log = { ledger: [], earningUpdates: [], referralUpdates: [], audits: [], dueSql: '' };
  const wallets = [
    { id: PLATFORM_WALLET, user_id: 1, available_balance: '1000.00', pending_escrow_balance: '0.00', held_balance: '0.00', version: 0 },
    { id: BENEFICIARY_WALLET, user_id: 5, available_balance: '0.00', pending_escrow_balance: '500.00', held_balance: '0.00', version: 0 },
  ];
  const query = async (sql, params = []) => {
    if (sql.includes('FROM referral_earnings re') && sql.includes('JOIN referrals r')) {
      log.dueSql = sql;
      return { rows: due.map((id) => ({ id })) };
    }
    if (sql.includes('FROM referral_earnings WHERE id = $1')) {
      return { rows: earnings.filter((e) => e.id === params[0]) };
    }
    if (sql.includes('FROM referral_earnings WHERE referral_id')) {
      return { rows: earnings.filter((e) => e.status === 'PENDING_ESCROW') };
    }
    if (sql.includes('FROM referrals WHERE ref = $1')) {
      return { rows: referral && referral.ref === params[0] ? [referral] : [] };
    }
    if (sql.includes('FROM roles r') && sql.includes('super_admin')) return { rows: [{ id: 1 }] };
    if (sql.includes('FROM wallets') && sql.includes('WHERE user_id = $1')) {
      return { rows: [wallets.find((w) => w.user_id === Number(params[0])) || wallets[0]] };
    }
    if (sql.includes('FROM wallets') && sql.includes('FOR UPDATE')) {
      const ids = params[0].map(Number);
      return { rows: wallets.filter((w) => ids.includes(w.id)) };
    }
    if (sql.includes('UPDATE wallets')) return { rows: [{ id: params[params.length - 1] }] };
    if (sql.includes('INSERT INTO ledger_transactions')) {
      log.ledger.push({ group: params[0], wallet: params[1], type: params[2], amount: params[3], bucket: params[4], category: params[5] });
      return { rows: [{ id: log.ledger.length }] };
    }
    if (sql.includes('UPDATE referral_earnings')) {
      log.earningUpdates.push({ sql, params });
      return { rows: [] };
    }
    if (sql.includes('UPDATE referrals')) {
      log.referralUpdates.push(params);
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      log.audits.push({ action: params[2], ref: params[4], risk: params[8] });
      return { rows: [{ id: 1 }] };
    }
    return { rows: [] };
  };
  const db = { query, log, connect: async () => ({ query, release: () => {} }) };
  return db;
}

const held = (id, amount = '250.00', status = 'PENDING_ESCROW') =>
  ({ id, referral_id: 7, commission_amount: amount, status, wallet_id: BENEFICIARY_WALLET });
const flagged = { id: 7, ref: 'REF-LINK-AAAA', status: 'FRAUD_FLAGGED', fraud_reason: 'SAME_DEVICE_FINGERPRINT' };
const actor = { id: 2, role: 'super_admin' };

function balanced(ledger) {
  const sum = (t) => ledger.filter((e) => e.type === t).reduce((s, e) => s + Number(e.amount), 0);
  return sum('DEBIT') === sum('CREDIT');
}

describe('releaseDueEarnings', () => {
  test('moves a due commission from ESCROW to AVAILABLE on the beneficiary wallet', async () => {
    const db = makeDb({ earnings: [held(1)], due: [1] });
    const out = await escrow.releaseDueEarnings(db);
    assert.equal(out.released, 1);
    assert.equal(out.totalReleased, '250.00');
    const [debit, credit] = db.log.ledger;
    assert.deepEqual([debit.type, debit.bucket, debit.wallet], ['DEBIT', 'ESCROW', BENEFICIARY_WALLET]);
    assert.deepEqual([credit.type, credit.bucket, credit.wallet], ['CREDIT', 'AVAILABLE', BENEFICIARY_WALLET]);
    assert.equal(credit.category, 'ESCROW_RELEASE');
    assert.ok(balanced(db.log.ledger));
    assert.match(db.log.earningUpdates[0].sql, /status = 'AVAILABLE'/);
  });

  test('the scan excludes flagged referrals and unripe earnings', async () => {
    const db = makeDb({ due: [] });
    await escrow.releaseDueEarnings(db);
    assert.match(db.log.dueSql, /escrow_release_at <= now\(\)/);
    assert.match(db.log.dueSql, /r\.status <> 'FRAUD_FLAGGED'/);
  });

  test('an earning settled since the scan is left alone', async () => {
    const db = makeDb({ earnings: [held(1, '250.00', 'AVAILABLE')], due: [1] });
    const out = await escrow.releaseDueEarnings(db);
    assert.equal(out.released, 0);
    assert.equal(db.log.ledger.length, 0);
  });
});

describe('resolveFlaggedReferral', () => {
  test('void returns held commission to the treasury and rejects the referral', async () => {
    const db = makeDb({ referral: flagged, earnings: [held(1, '250.00'), held(2, '100.00')] });
    const out = await admin.resolveFlaggedReferral(db, actor, flagged.ref, 'void', 'Same device as referrer');
    assert.equal(out.status, 'REJECTED');
    assert.equal(out.earnings_settled, 2);
    assert.equal(out.amount, '350.00');
    const credits = db.log.ledger.filter((e) => e.type === 'CREDIT');
    assert.ok(credits.every((e) => e.wallet === PLATFORM_WALLET && e.bucket === 'AVAILABLE' && e.category === 'REFERRAL_REVERSAL'));
    const debits = db.log.ledger.filter((e) => e.type === 'DEBIT');
    assert.ok(debits.every((e) => e.wallet === BENEFICIARY_WALLET && e.bucket === 'ESCROW'));
    assert.ok(balanced(db.log.ledger));
    assert.ok(db.log.earningUpdates.every((u) => /status = 'VOIDED'/.test(u.sql)));
  });

  test('release with held commission pays it out and qualifies the referral', async () => {
    const db = makeDb({ referral: flagged, earnings: [held(1)] });
    const out = await admin.resolveFlaggedReferral(db, actor, flagged.ref, 'release', 'Shared Wi-Fi, different people');
    assert.equal(out.status, 'QUALIFIED');
    assert.equal(out.amount, '250.00');
    assert.ok(db.log.ledger.every((e) => e.wallet === BENEFICIARY_WALLET));
  });

  test('release with nothing held puts the referral back to PENDING so the engine can pay it later', async () => {
    const db = makeDb({ referral: flagged, earnings: [] });
    const out = await admin.resolveFlaggedReferral(db, actor, flagged.ref, 'release', 'Reviewed, looks genuine');
    assert.equal(out.status, 'PENDING');
    assert.equal(out.earnings_settled, 0);
    assert.equal(db.log.ledger.length, 0);
  });

  test('every decision writes a CRITICAL audit row', async () => {
    const db = makeDb({ referral: flagged, earnings: [] });
    await admin.resolveFlaggedReferral(db, actor, flagged.ref, 'void', 'Confirmed ring');
    assert.deepEqual(db.log.audits, [{ action: 'growth.referral.void', ref: flagged.ref, risk: 'CRITICAL' }]);
  });

  test('refuses a referral that is not flagged', async () => {
    const db = makeDb({ referral: { ...flagged, status: 'QUALIFIED' } });
    await assert.rejects(
      () => admin.resolveFlaggedReferral(db, actor, flagged.ref, 'void', 'No longer flagged'),
      (e) => e.code === 'REFERRAL_NOT_FLAGGED'
    );
    assert.equal(db.log.ledger.length, 0);
  });

  test('refuses an unknown referral, a missing reason and an unknown decision', async () => {
    const db = makeDb({ referral: flagged });
    await assert.rejects(() => admin.resolveFlaggedReferral(db, actor, 'REF-LINK-NOPE', 'void', 'reason here'), (e) => e.code === 'REFERRAL_NOT_FOUND');
    await assert.rejects(() => admin.resolveFlaggedReferral(db, actor, flagged.ref, 'void', '  '), /reason/);
    await assert.rejects(() => admin.resolveFlaggedReferral(db, actor, flagged.ref, 'burn', 'reason here'), /release or void/);
    assert.equal(db.log.referralUpdates.length, 0);
  });
});

describe('referral decision routes', () => {
  test('release and void carry the governance module and permission', async () => {
    const app = Fastify();
    const guards = [];
    app.decorate('authenticate', async () => {});
    app.decorate('requireModule', (key) => { const fn = async () => {}; fn.moduleKey = key; return fn; });
    app.decorate('requirePermission', (key) => { const fn = async () => {}; fn.permissionKey = key; return fn; });
    app.addHook('onRoute', (route) => {
      const chain = [].concat(route.preHandler || []);
      guards.push({
        method: [].concat(route.method).join(','),
        url: route.url,
        modules: chain.map((f) => f.moduleKey).filter(Boolean),
        permissions: chain.map((f) => f.permissionKey).filter(Boolean),
      });
    });
    await app.register(referralRoutes);
    for (const verb of ['release', 'void']) {
      const g = guards.find((r) => r.method === 'POST' && r.url === `/admin/growth/referrals/:ref/${verb}`);
      assert.ok(g, `POST /admin/growth/referrals/:ref/${verb} must be registered`);
      assert.deepEqual(g.permissions, ['growth.referral.govern']);
      assert.deepEqual(g.modules, ['referral_engine']);
    }
  });
});
