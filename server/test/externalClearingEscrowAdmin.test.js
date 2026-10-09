/**
 * externalClearingEscrowAdmin.test.js — the two fixes of 2026-10-09 (second round).
 *
 * 1. Money from outside the ledger (gateway payments, COD cash, payouts) goes through the
 *    EXTERNAL_CLEARING wallet, so the platform treasury shows only the platform's own money.
 * 2. The admin Escrow page reads real escrow (it showed four made-up orders), and its sweep and
 *    "Release now" are real, audited, super-admin-only actions.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vaultService from '../src/services/vault.service.js';
import * as escrowAdminService from '../src/services/escrowAdmin.service.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const src = (p) => read(`src/${p}`);

describe('1. external clearing wallet', () => {
  const migration = read('src/db/migrations/070_external_clearing_wallet.sql');

  test('migration 070 adds a system wallet that belongs to no user', () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS system_key TEXT/);
    assert.match(migration, /ALTER COLUMN user_id DROP NOT NULL/);
    // Exactly one owner: a person or a named system account, never both or neither.
    assert.match(migration, /CHECK \(\(user_id IS NULL\) <> \(system_key IS NULL\)\)/);
    assert.match(migration, /'EXTERNAL_CLEARING'/);
  });

  test('the treasury reclass is one balanced, append-only group that cannot run twice', () => {
    assert.match(migration, /clearing_reclass:070:treasury/);
    assert.match(migration, /clearing_reclass:070:clearing/);
    assert.match(migration, /IF EXISTS \(SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'clearing_reclass:070:treasury'\)/);
    assert.ok(!/UPDATE ledger_transactions|DELETE FROM ledger_transactions/.test(migration), 'the ledger is never edited');
  });

  test('gateway, COD and payout all use the clearing wallet, never the treasury', () => {
    const payment = src('services/payment.service.js');
    const shipment = src('services/shipment.service.js');
    const payout = src('services/payout.service.js');
    assert.match(payment, /resolveClearingWalletId\(client\)/);
    assert.ok(!/resolvePlatformWalletId/.test(payment));
    assert.match(shipment, /resolveClearingWalletId\(txClient\)/);
    assert.ok(!/resolvePlatformWalletId/.test(shipment));
    assert.match(payout, /walletId: clearingWalletId,\s*entryType: 'CREDIT'/);
    assert.ok(!/platformWallet\.id/.test(payout), 'a payout no longer credits the treasury');
  });

  test('the dispute subsidy is paid by the real treasury, not a hard-coded user 1', () => {
    const dispute = src('services/dispute.service.js');
    assert.ok(!/getOrCreateWallet\(db, 1,/.test(dispute));
    assert.match(dispute, /resolvePlatformWalletId\(db, txClient\)/);
  });

  test('resolveClearingWalletId returns the existing wallet without writing', async () => {
    const seen = [];
    const client = {
      async query(sql) {
        seen.push(sql);
        return /SELECT id FROM wallets WHERE system_key/.test(sql) ? { rows: [{ id: 42 }] } : { rows: [] };
      },
    };
    assert.equal(await vaultService.resolveClearingWalletId(client), 42);
    assert.equal(seen.length, 1);
    assert.ok(!seen.some((q) => /INSERT/.test(q)));
  });

  test('resolveClearingWalletId recreates the wallet if someone removed it', async () => {
    let created = false;
    const client = {
      async query(sql) {
        if (/INSERT INTO wallets/.test(sql)) { created = true; return { rows: [] }; }
        if (/SELECT id FROM wallets WHERE system_key/.test(sql)) return { rows: created ? [{ id: 7 }] : [] };
        return { rows: [] };
      },
    };
    assert.equal(await vaultService.resolveClearingWalletId(client), 7);
    assert.ok(created);
  });

  test('the finance overview reports the treasury and the outside money apart', () => {
    const c = src('controllers/finance.controller.js');
    assert.match(c, /platform_treasury_available/);
    assert.match(c, /external_collections_outstanding/);
    assert.match(c, /system_key = 'EXTERNAL_CLEARING'/);
  });
});

describe('2. admin Escrow page reads real escrow', () => {
  const row = (over = {}) => ({
    sub_order_id: '11',
    amount: '1730.00',
    supplier_amount: '1330.00',
    saler_amount: '0.00',
    platform_amount: '400.00',
    hold_until: new Date(Date.now() + 3 * 86400000).toISOString(),
    released_at: null,
    locked_at: null,
    failure_count: 0,
    last_error: null,
    status: 'LOCKED',
    sub_order_ref: 'SO-11',
    order_ref: 'ORD-11',
    payment_method: 'BKASH',
    customer_name: 'Rahim',
    supplier_name: 'Supplier A',
    saler_name: null,
    cod_status: null,
    delivered_at: null,
    total_count: '3',
    ...over,
  });

  function fakeDb(rows) {
    const seen = [];
    return {
      seen,
      async query(sql, params) {
        seen.push({ sql, params });
        if (sql.includes('WITH holdings AS')) return { rows };
        if (sql.includes('AS total_held')) {
          return { rows: [{ total_held: '5000.00', mature_amount: '1000.00', held_count: '3', mature_count: '1' }] };
        }
        if (sql.includes('AS frozen_amount')) return { rows: [{ frozen_amount: '0.00', frozen_count: '0' }] };
        if (sql.includes('FROM platform_modules')) return { rows: [{ settings_json: { return_window_days: 10 } }] };
        return { rows: [] };
      },
    };
  }

  test('rows, summary over all held escrow, return window from the module, pagination', async () => {
    const db = fakeDb([
      row(),
      row({ sub_order_id: '12', sub_order_ref: 'SO-12', hold_until: new Date(Date.now() - 1000).toISOString() }),
      row({ sub_order_id: '13', sub_order_ref: 'SO-13', payment_method: 'COD', cod_status: 'AWAITING' }),
    ]);
    const res = await escrowAdminService.listHoldings(db, { limit: 2, page: 2 });

    assert.equal(res.holdings.length, 3);
    assert.equal(res.holdings[0].amount, '1730.00');
    assert.ok(res.holdings[0].remaining_seconds > 0);
    assert.equal(res.holdings[0].is_due, false);
    assert.equal(res.holdings[1].is_due, true);
    // A COD row is not offered for release until its courier cash is reconciled.
    assert.equal(res.holdings[2].release_blocked_reason, 'COD_NOT_RECONCILED');
    assert.equal(res.holdings[0].release_blocked_reason, null);

    assert.deepEqual(res.summary, {
      total_held: '5000.00', mature_amount: '1000.00', held_count: 3, mature_count: 1, active_count: 2,
      frozen_amount: '0.00', frozen_count: 0, return_window_days: 10,
    });
    assert.deepEqual(res.pagination, { page: 2, limit: 2, total: 3, pages: 2 });

    const list = db.seen.find((q) => q.sql.includes('WITH holdings AS'));
    assert.deepEqual(list.params, ['LOCKED', null, 2, 2]);
  });

  test('the limit is capped and an unknown status is refused', async () => {
    const db = fakeDb([]);
    const res = await escrowAdminService.listHoldings(db, { limit: 5000, status: 'all', q: '  SO-1  ' });
    assert.equal(res.pagination.limit, escrowAdminService.PAGE_LIMITS.max);
    const list = db.seen.find((q) => q.sql.includes('WITH holdings AS'));
    assert.equal(list.params[0], 'ALL');
    assert.equal(list.params[1], 'SO-1');
    await assert.rejects(escrowAdminService.listHoldings(db, { status: 'PAID' }), (e) => e.code === 'VALIDATION_FAILED');
  });

  test('releasing one row early needs a reason and a held row', async () => {
    const empty = { async query() { return { rows: [] }; } };
    await assert.rejects(
      escrowAdminService.releaseOne(empty, { subOrderId: '5', reason: 'short' }),
      (e) => e.code === 'VALIDATION_FAILED'
    );
    await assert.rejects(
      escrowAdminService.releaseOne(empty, { subOrderId: '5', reason: 'Supplier needs stock money early' }),
      (e) => e.code === 'NOT_FOUND'
    );
    const released = { async query() { return { rows: [{ beneficiary_role: 'SUPPLIER', amount: '10.00', status: 'RELEASED' }] }; } };
    await assert.rejects(
      escrowAdminService.releaseOne(released, { subOrderId: '5', reason: 'Supplier needs stock money early' }),
      (e) => e.code === 'CONFLICT'
    );
  });

  test('both write endpoints are super admin only and audited', () => {
    const routes = src('routes/finance.routes.js');
    assert.match(routes, /'\/admin\/finance\/escrow\/:subOrderId\/release'[\s\S]{0,200}requirePermission\('finance\.escrow\.release_manual'\)/);
    assert.match(routes, /'\/admin\/finance\/escrow\/sweep'[\s\S]{0,200}requirePermission\('finance\.escrow\.release_manual'\)/);
    assert.match(src('services/escrowAdmin.service.js'), /action: 'finance\.escrow\.release_manual'/);
    assert.match(src('controllers/finance.controller.js'), /action: 'finance\.escrow\.sweep'/);
  });

  test('the page has no made-up rows left', () => {
    const page = read('../client/src/pages/admin/EscrowHoldingsPage.js');
    assert.ok(!/getDefaultHoldings|Anisur Rahman|Jamdani Heritage/.test(page));
    assert.match(page, /api\.post\(`\/admin\/finance\/escrow\/\$\{h\.sub_order_id\}\/release`/);
    assert.match(page, /api\.post\('\/admin\/finance\/escrow\/sweep'\)/);
  });
});
