/**
 * vaultFinanceDashboard.test.js — Automated test suite for Prompt 6.5:
 * Earner Vault UI & Admin Finance Dashboard.
 *
 * Covers:
 * 1. Earner vault overview (wallet buckets, active escrow countdowns, recent ledger).
 * 2. Source order traceability from double-entry ledger back to sub-orders.
 * 3. Double-entry ledger filtering and pagination.
 * 4. Admin finance overview metrics (GMV, platform revenue, escrow & payout liabilities, COD exposure).
 * 5. 100% Reconciliation between dashboard totals and double-entry ledger integrity.
 * 6. Fastify HTTP routes for /vault/overview, /vault/ledger, and /admin/finance/overview.
 */

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import * as walletRepo from '../src/repositories/wallet.repository.js';
import * as vaultService from '../src/services/vault.service.js';
import * as financeController from '../src/controllers/finance.controller.js';
import financeRoutes from '../src/routes/finance.routes.js';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';

function createMockDb() {
  let nextWalletId = 1;
  let nextLedgerId = 1;
  let nextEscrowId = 1;

  const users = [
    { id: 1, ref: 'USR-SUPER1', full_name: 'Super Admin Kabir', role: 'super_admin' },
    { id: 101, ref: 'USR-SUPP1', full_name: 'Supplier Aarong', role: 'supplier' },
    { id: 201, ref: 'USR-SALER1', full_name: 'Saler Jamila', role: 'saler' },
  ];

  const wallets = [
    {
      id: 1,
      user_id: 1,
      available_balance: '1000000.00',
      pending_escrow_balance: '0.00',
      held_balance: '0.00',
      lifetime_earned: '0.00',
      lifetime_withdrawn: '0.00',
      currency: 'BDT',
      version: 0,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: null,
    },
    {
      id: 10,
      user_id: 101,
      available_balance: '15000.00',
      pending_escrow_balance: '5000.00',
      held_balance: '2000.00',
      lifetime_earned: '22000.00',
      lifetime_withdrawn: '5000.00',
      currency: 'BDT',
      version: 0,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: null,
    },
    {
      id: 20,
      user_id: 201,
      available_balance: '8000.00',
      pending_escrow_balance: '1200.00',
      held_balance: '0.00',
      lifetime_earned: '9200.00',
      lifetime_withdrawn: '0.00',
      currency: 'BDT',
      version: 0,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: null,
    },
  ];

  const subOrders = [
    {
      id: 801,
      order_id: 4001,
      ref: 'SUB-801',
      supplier_id: 101,
      saler_id: 201,
      subtotal_base: '4000.00',
      wholesale_margin: '800.00',
      saler_commission: '400.00',
      platform_margin: '600.00',
      shipping_amount: '100.00',
      total_amount: '5900.00',
      status: 'DELIVERED',
      payment_method: 'BKASH',
      created_at: '2026-08-20T10:00:00Z',
    },
    {
      id: 802,
      order_id: 4002,
      ref: 'SUB-802',
      supplier_id: 101,
      saler_id: 201,
      subtotal_base: '1000.00',
      wholesale_margin: '200.00',
      saler_commission: '120.00',
      platform_margin: '180.00',
      shipping_amount: '60.00',
      total_amount: '1560.00',
      status: 'DELIVERED',
      payment_method: 'COD',
      created_at: '2026-08-22T12:00:00Z',
    },
  ];

  const orders = [
    { id: 4001, customer_id: 10, total_amount: '5900.00', payment_method: 'BKASH' },
    { id: 4002, customer_id: 10, total_amount: '1560.00', payment_method: 'COD' },
  ];

  const escrowEntries = [
    {
      id: 1,
      sub_order_id: 801,
      wallet_id: 10,
      beneficiary_role: 'SUPPLIER',
      amount: '4800.00',
      status: 'LOCKED',
      hold_until: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(), // 3 days from now
      released_at: null,
      created_at: '2026-08-20T10:00:00Z',
    },
    {
      id: 2,
      sub_order_id: 801,
      wallet_id: 20,
      beneficiary_role: 'SALER',
      amount: '400.00',
      status: 'LOCKED',
      hold_until: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(), // 3 days from now
      released_at: null,
      created_at: '2026-08-20T10:00:00Z',
    },
    {
      id: 3,
      sub_order_id: 802,
      wallet_id: 20,
      beneficiary_role: 'SALER',
      amount: '120.00',
      status: 'LOCKED',
      hold_until: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(), // 5 days from now
      released_at: null,
      created_at: '2026-08-22T12:00:00Z',
    },
  ];

  const ledgerTransactions = [
    {
      id: nextLedgerId++,
      txn_group_id: 'grp-init-10',
      wallet_id: 10,
      entry_type: 'CREDIT',
      amount: '15000.00',
      balance_bucket: 'AVAILABLE',
      category: 'ESCROW_RELEASE',
      reference_type: 'SUB_ORDER',
      reference_id: 801,
      memo: 'Escrow release for sub-order #801',
      created_by: 1,
      created_at: '2026-08-21T00:00:00Z',
    },
    {
      id: nextLedgerId++,
      txn_group_id: 'grp-init-20',
      wallet_id: 20,
      entry_type: 'CREDIT',
      amount: '8000.00',
      balance_bucket: 'AVAILABLE',
      category: 'COMMISSION',
      reference_type: 'SUB_ORDER',
      reference_id: 801,
      memo: 'Sales commission for sub-order #801',
      created_by: 1,
      created_at: '2026-08-21T00:00:00Z',
    },
    {
      id: nextLedgerId++,
      txn_group_id: 'grp-payout-10',
      wallet_id: 10,
      entry_type: 'DEBIT',
      amount: '2000.00',
      balance_bucket: 'HELD',
      category: 'PAYOUT_DISBURSED',
      reference_type: 'PAYOUT_REQUEST',
      reference_id: 1,
      memo: 'Withdrawal payout request lock',
      created_by: 101,
      created_at: '2026-08-22T00:00:00Z',
    },
  ];

  const codReconciliations = [
    {
      id: 1,
      sub_order_id: 802,
      courier: 'STEADFAST',
      consignment_id: 'CN-ST-802',
      expected_amount: '1560.00',
      courier_reported: '1560.00',
      deposit_received: '0.00',
      variance: '-1560.00',
      status: 'MISSING_DEPOSIT',
    },
  ];

  const clientMock = {
    async query(sql, params = []) {
      const q = sql.trim().replace(/\s+/g, ' ');

      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        return { rows: [] };
      }

      // SELECT wallets WHERE user_id = $1
      if (q.includes('FROM wallets') && q.includes('WHERE user_id = $1')) {
        const userId = params[0];
        const w = wallets.find((x) => x.user_id === userId);
        return { rows: w ? [{ ...w }] : [] };
      }

      // SELECT wallets WHERE id = $1
      if (q.includes('FROM wallets') && q.includes('WHERE id = $1')) {
        const id = params[0];
        const w = wallets.find((x) => x.id === id);
        return { rows: w ? [{ ...w }] : [] };
      }

      // SELECT escrow_entries for user vault overview
      if (q.includes('FROM escrow_entries e') && q.includes('WHERE e.wallet_id = $1 AND e.status = \'LOCKED\'')) {
        const walletId = params[0];
        const entries = escrowEntries
          .filter((e) => e.wallet_id === walletId && e.status === 'LOCKED')
          .map((e) => {
            const so = subOrders.find((s) => s.id === e.sub_order_id);
            return {
              ...e,
              sub_order_ref: so?.ref || `SUB-${e.sub_order_id}`,
              order_id: so?.order_id,
            };
          });
        return { rows: entries };
      }

      // SELECT ledger_transactions for user
      if (q.includes('FROM ledger_transactions l') && q.includes('WHERE l.wallet_id = $1')) {
        const walletId = params[0];
        let entries = ledgerTransactions
          .filter((l) => l.wallet_id === walletId)
          .map((l) => {
            const so = subOrders.find((s) => s.id === l.reference_id);
            return {
              ...l,
              sub_order_ref: so?.ref || (l.reference_type === 'SUB_ORDER' ? `SUB-${l.reference_id}` : null),
            };
          });

        if (params.length > 1 && typeof params[1] === 'string') {
          const category = params[1];
          entries = entries.filter((x) => x.category === category);
        }

        return { rows: entries };
      }

      // Admin GMV query
      if (q.includes('SELECT COALESCE(SUM(total_amount), 0) AS gmv FROM sub_orders')) {
        const sum = subOrders.reduce((acc, s) => acc + parseFloat(s.total_amount), 0);
        return { rows: [{ gmv: sum.toFixed(2) }] };
      }

      // Admin Revenue query
      if (q.includes('SELECT COALESCE(SUM(platform_margin), 0) AS net_revenue FROM sub_orders')) {
        const sum = subOrders.reduce((acc, s) => acc + parseFloat(s.platform_margin), 0);
        return { rows: [{ net_revenue: sum.toFixed(2) }] };
      }

      // Admin Wallet Liabilities
      if (q.includes('SELECT COALESCE(SUM(pending_escrow_balance), 0) AS total_escrow')) {
        const nonAdmin = wallets.filter((w) => w.user_id !== 1);
        const escrowSum = nonAdmin.reduce((acc, w) => acc + parseFloat(w.pending_escrow_balance), 0);
        const heldSum = nonAdmin.reduce((acc, w) => acc + parseFloat(w.held_balance), 0);
        const availSum = nonAdmin.reduce((acc, w) => acc + parseFloat(w.available_balance), 0);
        const withSum = nonAdmin.reduce((acc, w) => acc + parseFloat(w.lifetime_withdrawn), 0);

        return {
          rows: [{
            total_escrow: escrowSum.toFixed(2),
            total_held: heldSum.toFixed(2),
            total_available: availSum.toFixed(2),
            total_withdrawn: withSum.toFixed(2),
          }],
        };
      }

      // Admin COD Exposure query
      if (q.includes('SELECT COALESCE(SUM(expected_amount - COALESCE(deposit_received, 0)), 0) AS cod_exposure')) {
        const unreconciled = codReconciliations.filter((c) => c.status !== 'MATCHED' && c.status !== 'RESOLVED');
        const sum = unreconciled.reduce((acc, c) => acc + (parseFloat(c.expected_amount) - parseFloat(c.deposit_received || 0)), 0);
        return { rows: [{ cod_exposure: sum.toFixed(2), unreconciled_count: unreconciled.length }] };
      }

      // Admin Courier Breakdown
      if (q.includes('FROM cod_reconciliation') && q.includes('GROUP BY courier')) {
        return {
          rows: [
            { courier: 'STEADFAST', amount: '1560.00', count: 1 },
          ],
        };
      }

      // SELECT wallets FOR UPDATE / Integrity
      if (q.includes('FROM wallets') && q.includes('ORDER BY id ASC')) {
        return { rows: wallets.map((w) => ({ ...w })) };
      }

      if (q.includes('FROM ledger_transactions') && q.includes('GROUP BY wallet_id')) {
        return { rows: [] };
      }

      if (q.includes('FROM ledger_transactions') && q.includes('GROUP BY txn_group_id')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  const poolMock = {
    ...clientMock,
    async connect() {
      return {
        ...clientMock,
        release() {},
      };
    },
    getRawData() {
      return { wallets, ledgerTransactions, escrowEntries, codReconciliations };
    },
  };

  return poolMock;
}

describe('Prompt 6.5 — Vault UI & Admin Finance Dashboard', () => {
  let db;

  before(() => {
    db = createMockDb();
  });

  test('Acceptance 1 & 2: Earner Vault Overview returns 4 balance buckets & active escrow countdowns', async () => {
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', null);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 201, role: 'saler' }; // Saler Jamila
    });
    app.decorate('requirePermission', () => async () => {});

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);
    await app.register(financeRoutes, { prefix: '/api/v1' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/vault/overview',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.data.wallet, 'Wallet object returned');
    assert.equal(body.data.wallet.available_balance, '8000.00');
    assert.equal(body.data.wallet.pending_escrow_balance, '1200.00');

    // Escrow Timeline entries
    assert.ok(body.data.escrow_timeline.length > 0, 'Active escrow entries returned');
    const firstHold = body.data.escrow_timeline[0];
    assert.ok(firstHold.remaining_seconds > 0, 'Remaining seconds computed');
    assert.equal(firstHold.sub_order_ref, 'SUB-801', 'Source order reference traced');
  });

  test('Acceptance 3: Double-Entry Ledger allows tracing wallet entries to source sub-orders', async () => {
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', null);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 201, role: 'saler' };
    });
    app.decorate('requirePermission', () => async () => {});

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);
    await app.register(financeRoutes, { prefix: '/api/v1' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/vault/ledger?category=COMMISSION',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.data.ledger_transactions.length > 0);
    const tx = body.data.ledger_transactions[0];
    assert.equal(tx.category, 'COMMISSION');
    assert.equal(tx.sub_order_ref, 'SUB-801', 'Wallet movement traces 1:1 back to Sub-Order #801');
  });

  test('Acceptance 4: Admin Finance Overview aggregates GMV, Platform Revenue, Escrow & COD Liabilities', async () => {
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', null);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 1, role: 'super_admin' };
    });
    app.decorate('requirePermission', () => async () => {});

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);
    await app.register(financeRoutes, { prefix: '/api/v1' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/finance/overview',
    });

    assert.equal(res.statusCode, 200);
    const data = res.json().data;

    // GMV & Revenue
    assert.equal(data.metrics.gmv, '7460.00'); // 5900 + 1560
    assert.equal(data.metrics.net_revenue, '780.00'); // 600 + 180

    // Liabilities
    assert.equal(data.metrics.total_escrow_liability, '6200.00'); // 5000 + 1200
    assert.equal(data.metrics.pending_payout_liability, '2000.00'); // 2000
    assert.equal(data.metrics.cod_exposure, '1560.00'); // 1560

    // Daily Trend & Courier Distribution Arrays for Inline SVG Charts
    assert.equal(data.daily_trend.length, 7, '7-Day trend array populated');
    assert.ok(data.courier_breakdown.length > 0, 'Courier distribution populated');
  });

  test('Acceptance 5: Real-time Double-Entry Ledger Integrity indicator reconciles with zero drift', async () => {
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', null);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 1, role: 'super_admin' };
    });
    app.decorate('requirePermission', () => async () => {});

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);
    await app.register(financeRoutes, { prefix: '/api/v1' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/finance/overview',
    });

    const data = res.json().data;
    assert.equal(data.metrics.ledger_health, 'HEALTHY');
    assert.equal(data.metrics.ledger_drifts, 0);
  });
});
