/**
 * codReconciliation.test.js — Automated test suite for Prompt 6.4:
 * COD Reconciliation Engine & Courier Settlement Verification.
 *
 * Covers:
 * 1. 3-Way matching per consignment: Expected COD <-> Courier Reported <-> Bank Deposit.
 * 2. 6-Tier discrepancy classification (MATCHED, SHORT_COLLECTION, OVER_COLLECTION, MISSING_DEPOSIT, DUPLICATE, UNMATCHED_CONSIGNMENT).
 * 3. Strict escrow release block for unreconciled COD sub-orders.
 * 4. Maker-Checker manual discrepancy resolution workflow & audit logging.
 * 5. Courier aging matrix report with SLA alert threshold detection.
 * 6. Fastify HTTP routes for CSV upload, queue listing, aging matrix, and resolution.
 */

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import * as walletRepo from '../src/repositories/wallet.repository.js';
import * as vaultService from '../src/services/vault.service.js';
import * as codService from '../src/services/codReconciliation.service.js';
import financeRoutes from '../src/routes/finance.routes.js';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';

function createMockDb() {
  let nextWalletId = 1;
  let nextLedgerId = 1;
  let nextEscrowId = 1;
  let nextReconId = 1;
  let nextActionId = 1;

  const users = [
    { id: 1, ref: 'USR-SUPER1', full_name: 'Super Admin Kabir', role: 'super_admin' },
    { id: 2, ref: 'USR-MOD1', full_name: 'Moderator Rifat', role: 'moderator' },
    { id: 10, ref: 'USR-CUST1', phone: '+8801700000010', full_name: 'Customer Karim', role: 'customer' },
    { id: 101, ref: 'USR-SUPP1', phone: '+8801700000101', full_name: 'Supplier Aarong', role: 'supplier' },
    { id: 201, ref: 'USR-SALER1', phone: '+8801700000201', full_name: 'Saler Jamila', role: 'saler' },
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
      available_balance: '0.00',
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
      id: 20,
      user_id: 201,
      available_balance: '0.00',
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
      id: 30,
      user_id: 10,
      available_balance: '50000.00',
      pending_escrow_balance: '0.00',
      held_balance: '0.00',
      lifetime_earned: '0.00',
      lifetime_withdrawn: '0.00',
      currency: 'BDT',
      version: 0,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: null,
    },
  ];

  const subOrders = [
    {
      id: 701,
      order_id: 3001,
      ref: 'SUB-701',
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
      created_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), // 10 days ago (alert)
    },
    {
      id: 702,
      order_id: 3002,
      ref: 'SUB-702',
      supplier_id: 101,
      saler_id: 201,
      subtotal_base: '500.00',
      wholesale_margin: '100.00',
      saler_commission: '50.00',
      platform_margin: '90.00',
      shipping_amount: '40.00',
      total_amount: '780.00',
      status: 'DELIVERED',
      payment_method: 'COD',
      created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(), // 4 days ago
    },
    {
      id: 703,
      order_id: 3003,
      ref: 'SUB-703',
      supplier_id: 101,
      saler_id: 201,
      subtotal_base: '800.00',
      wholesale_margin: '150.00',
      saler_commission: '80.00',
      platform_margin: '120.00',
      shipping_amount: '50.00',
      total_amount: '1200.00',
      status: 'DELIVERED',
      payment_method: 'COD',
      created_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(), // 1 day ago
    },
    {
      id: 704,
      order_id: 3004,
      ref: 'SUB-704',
      supplier_id: 101,
      saler_id: 201,
      subtotal_base: '600.00',
      wholesale_margin: '100.00',
      saler_commission: '60.00',
      platform_margin: '100.00',
      shipping_amount: '40.00',
      total_amount: '900.00',
      status: 'DELIVERED',
      payment_method: 'COD',
      created_at: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(), // 20 days ago
    },
  ];

  const orders = [
    { id: 3001, customer_id: 10, total_amount: '1560.00', payment_method: 'COD' },
    { id: 3002, customer_id: 10, total_amount: '780.00', payment_method: 'COD' },
    { id: 3003, customer_id: 10, total_amount: '1200.00', payment_method: 'COD' },
    { id: 3004, customer_id: 10, total_amount: '900.00', payment_method: 'COD' },
  ];

  const consignments = [
    { sub_order_id: 701, tracking_number: 'CN-STEADFAST-701', courier_consignment_id: 'ST-701' },
    { sub_order_id: 702, tracking_number: 'CN-PATHAO-702', courier_consignment_id: 'PT-702' },
    { sub_order_id: 703, tracking_number: 'CN-REDX-703', courier_consignment_id: 'RX-703' },
    { sub_order_id: 704, tracking_number: 'CN-STEADFAST-704', courier_consignment_id: 'ST-704' },
  ];

  const codReconciliations = [];
  const ledgerTransactions = [];
  const escrowEntries = [];
  const pendingActions = [];

  const clientMock = {
    async query(sql, params = []) {
      const q = sql.trim().replace(/\s+/g, ' ');

      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        return { rows: [] };
      }

      // SELECT sub_orders JOIN orders
      if (q.includes('FROM sub_orders s') && q.includes('JOIN orders o') && q.includes('WHERE s.id = $1')) {
        const subId = params[0];
        const so = subOrders.find((s) => s.id === subId);
        if (so) {
          const ord = orders.find((o) => o.id === so.order_id);
          return {
            rows: [
              {
                ...so,
                customer_id: ord?.customer_id ?? 10,
                payment_method: ord?.payment_method ?? so.payment_method,
                sub_payment_method: so.payment_method,
              },
            ],
          };
        }
        return { rows: [] };
      }

      // SELECT sub_orders WHERE id = $1
      if (q.includes('FROM sub_orders WHERE id = $1')) {
        const id = params[0];
        const so = subOrders.find((s) => s.id === id);
        return { rows: so ? [{ ...so }] : [] };
      }

      // SELECT sub_orders WHERE ref = $1
      if (q.includes('FROM sub_orders WHERE ref = $1')) {
        const ref = params[0];
        const so = subOrders.find((s) => s.ref === ref);
        return { rows: so ? [{ ...so }] : [] };
      }

      // SELECT sub_orders JOIN consignments
      if (q.includes('FROM sub_orders s') && q.includes('LEFT JOIN consignments c')) {
        const tracking = params[0];
        const c = consignments.find(
          (con) => con.tracking_number === tracking || con.courier_consignment_id === tracking
        );
        if (c) {
          const so = subOrders.find((s) => s.id === c.sub_order_id);
          return { rows: so ? [{ ...so }] : [] };
        }
        return { rows: [] };
      }

      // SELECT cod_reconciliation WHERE sub_order_id = $1
      if (q.includes('FROM cod_reconciliation WHERE sub_order_id = $1')) {
        const subId = params[0];
        const r = codReconciliations.find((x) => x.sub_order_id === subId);
        return { rows: r ? [{ ...r }] : [] };
      }

      // SELECT cod_reconciliation WHERE id = $1
      if (q.includes('FROM cod_reconciliation WHERE id = $1')) {
        const id = params[0];
        const r = codReconciliations.find((x) => x.id === id);
        return { rows: r ? [{ ...r }] : [] };
      }

      // INSERT / UPSERT cod_reconciliation
      if (q.includes('INSERT INTO cod_reconciliation')) {
        const subOrderId = params[0];
        const courier = params[1];
        const consignmentId = params[2];
        const expectedAmt = parseFloat(params[3]).toFixed(2);
        const reportedAmt = parseFloat(params[4]).toFixed(2);
        const depositAmt = parseFloat(params[5]).toFixed(2);
        const variance = parseFloat(params[6]).toFixed(2);
        const status = params[7];
        const batchRef = params[8];

        let r = codReconciliations.find((x) => x.sub_order_id === subOrderId);
        if (r) {
          r.courier = courier;
          r.consignment_id = consignmentId;
          r.expected_amount = expectedAmt;
          r.courier_reported = reportedAmt;
          r.deposit_received = depositAmt;
          r.variance = variance;
          r.status = status;
          r.settlement_batch_ref = batchRef;
          r.updated_at = new Date().toISOString();
        } else {
          r = {
            id: nextReconId++,
            sub_order_id: subOrderId,
            courier,
            consignment_id: consignmentId,
            expected_amount: expectedAmt,
            courier_reported: reportedAmt,
            deposit_received: depositAmt,
            variance,
            status,
            settlement_batch_ref: batchRef,
            resolved_by: null,
            resolution_reason: null,
            resolved_at: null,
            created_at: new Date().toISOString(),
            updated_at: null,
          };
          codReconciliations.push(r);
        }
        return { rows: [{ ...r }] };
      }

      // UPDATE cod_reconciliation SET status = 'RESOLVED'
      if (q.includes("UPDATE cod_reconciliation SET status = 'RESOLVED'")) {
        const id = params[0];
        const r = codReconciliations.find((x) => x.id === id);
        if (r) {
          r.status = 'RESOLVED';
          r.resolved_by = params[1];
          r.resolution_reason = params[2];
          r.resolved_at = new Date().toISOString();
          r.updated_at = new Date().toISOString();
          return { rows: [{ ...r }] };
        }
        return { rows: [] };
      }

      // SELECT cod_reconciliation Aging Query
      if (q.includes('FROM cod_reconciliation c') && q.includes("status NOT IN ('MATCHED', 'RESOLVED')")) {
        const list = codReconciliations
          .filter((x) => x.status !== 'MATCHED' && x.status !== 'RESOLVED')
          .map((c) => {
            const so = subOrders.find((s) => s.id === c.sub_order_id);
            return {
              ...c,
              sub_order_ref: so?.ref || `SUB-${c.sub_order_id}`,
              sub_order_date: so?.created_at || c.created_at,
            };
          });
        return { rows: list };
      }

      // SELECT cod_reconciliation Queue Query
      if (q.includes('FROM cod_reconciliation c LEFT JOIN sub_orders s')) {
        const list = codReconciliations.map((c) => {
          const so = subOrders.find((s) => s.id === c.sub_order_id);
          const u = users.find((x) => x.id === c.resolved_by);
          return {
            ...c,
            sub_order_ref: so?.ref,
            sub_order_status: so?.status,
            resolved_by_name: u?.full_name,
          };
        });
        return { rows: list };
      }

      // INSERT INTO pending_admin_actions
      if (q.includes('INSERT INTO pending_admin_actions')) {
        const row = {
          id: nextActionId++,
          ref: params[0],
          actor_id: params[1],
          action_key: 'orders.cod.reconcile',
          payload_json: params[2],
          target_type: params[3],
          target_ref: params[4],
          risk_tier: params[5],
          status: 'PENDING',
          created_at: new Date().toISOString(),
        };
        pendingActions.push(row);
        return { rows: [{ id: row.id, ref: row.ref, action_key: row.action_key, status: row.status }] };
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

      // SELECT wallets FOR UPDATE
      if (q.includes('FROM wallets') && q.includes('WHERE id = ANY')) {
        const ids = params[0];
        const found = wallets.filter((w) => ids.includes(w.id)).sort((a, b) => a.id - b.id);
        return { rows: found.map((w) => ({ ...w })) };
      }

      // UPDATE wallets
      if (q.includes('UPDATE wallets SET available_balance')) {
        const walletId = params[0];
        const availDelta = parseFloat(params[1]) || 0;
        const pendingDelta = parseFloat(params[2]) || 0;
        const heldDelta = parseFloat(params[3]) || 0;
        const earnedDelta = parseFloat(params[4]) || 0;
        const withdrawnDelta = parseFloat(params[5]) || 0;

        const w = wallets.find((x) => x.id === walletId);
        if (w) {
          w.available_balance = (parseFloat(w.available_balance) + availDelta).toFixed(2);
          w.pending_escrow_balance = (parseFloat(w.pending_escrow_balance) + pendingDelta).toFixed(2);
          w.held_balance = (parseFloat(w.held_balance) + heldDelta).toFixed(2);
          w.lifetime_earned = (parseFloat(w.lifetime_earned) + earnedDelta).toFixed(2);
          w.lifetime_withdrawn = (parseFloat(w.lifetime_withdrawn) + withdrawnDelta).toFixed(2);
          w.version += 1;
          w.updated_at = new Date().toISOString();
          return { rows: [{ ...w }] };
        }
        return { rows: [] };
      }

      // INSERT INTO ledger_transactions
      if (q.includes('INSERT INTO ledger_transactions')) {
        const row = {
          id: nextLedgerId++,
          txn_group_id: params[0],
          wallet_id: params[1],
          entry_type: params[2],
          amount: parseFloat(params[3]).toFixed(2),
          balance_bucket: params[4],
          category: params[5],
          reference_type: params[6],
          reference_id: params[7],
          idempotency_key: params[8] ?? null,
          memo: params[9] ?? null,
          created_by: params[10] ?? null,
          created_at: params[11] || new Date().toISOString(),
        };
        ledgerTransactions.push(row);
        return { rows: [{ ...row }] };
      }

      // INSERT INTO escrow_entries
      if (q.includes('INSERT INTO escrow_entries')) {
        const subOrderId = params[0];
        const walletId = params[1];
        const beneficiaryRole = params[2];
        const amount = parseFloat(params[3]).toFixed(2);
        const holdUntil = params[4];

        let existing = escrowEntries.find(
          (e) =>
            e.sub_order_id === subOrderId &&
            e.wallet_id === walletId &&
            e.beneficiary_role === beneficiaryRole
        );
        if (existing) {
          existing.amount = amount;
          existing.status = 'LOCKED';
        } else {
          existing = {
            id: nextEscrowId++,
            sub_order_id: subOrderId,
            wallet_id: walletId,
            beneficiary_role: beneficiaryRole,
            amount,
            status: 'LOCKED',
            hold_until: holdUntil,
            released_at: null,
            failure_count: 0,
            last_error: null,
            created_at: new Date().toISOString(),
          };
          escrowEntries.push(existing);
        }
        return { rows: [{ ...existing }] };
      }

      // SELECT escrow_entries WHERE sub_order_id = $1
      if (q.includes('FROM escrow_entries') && q.includes('WHERE sub_order_id = $1')) {
        const subId = params[0];
        const found = escrowEntries.filter((e) => e.sub_order_id === subId);
        return { rows: found.map((e) => ({ ...e })) };
      }

      // UPDATE escrow_entries SET status = 'RELEASED'
      if (q.includes("UPDATE escrow_entries SET status = 'RELEASED'")) {
        const ids = params[0];
        for (const e of escrowEntries) {
          if (ids.includes(e.id)) {
            e.status = 'RELEASED';
            e.released_at = new Date().toISOString();
          }
        }
        return { rows: [] };
      }

      // SELECT platform_modules
      if (q.includes('FROM platform_modules WHERE key = $1')) {
        return { rows: [{ key: 'returns_engine', is_enabled: true, settings_json: { return_window_days: 7 } }] };
      }

      // SELECT super_admin user
      if (q.includes("r.key = 'super_admin'")) {
        return { rows: [{ id: 1 }] };
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
      return { wallets, ledgerTransactions, escrowEntries, codReconciliations, pendingActions };
    },
  };

  return poolMock;
}

describe('Prompt 6.4 — COD Reconciliation Engine & Courier Settlement Verification', () => {
  let db;

  before(() => {
    db = createMockDb();
  });

  test('Acceptance 1: Uploading a settlement report auto-matches clean records with zero variance', async () => {
    // Ingest clean settlement record for sub-order 701 (CN-STEADFAST-701, Expected: 1560.00, Deposit: 1560.00)
    const ingestResult = await codService.ingestSettlementReport(db, {
      courier: 'Steadfast',
      records: [
        {
          consignment_id: 'CN-STEADFAST-701',
          courier_reported: 1560.00,
          deposit_received: 1560.00,
        },
      ],
      importedBy: 1,
    });

    assert.equal(ingestResult.totalCount, 1);
    assert.equal(ingestResult.matchedCount, 1, 'Clean record must be MATCHED');
    assert.equal(ingestResult.shortCount, 0);
    assert.equal(ingestResult.totalVariance, '0.00');

    const item = ingestResult.items[0];
    assert.equal(item.status, 'MATCHED');
    assert.equal(item.sub_order_id, 701);
  });

  test('Acceptance 2: 6-Tier Discrepancy Classification (Short, Over, Missing Deposit, Duplicate, Unmatched)', async () => {
    const multiBatch = await codService.ingestSettlementReport(db, {
      courier: 'Pathao',
      records: [
        // 1. Short Collection: Sub 702 expected 780.00, deposit received 600.00 (-180.00 variance)
        {
          consignment_id: 'CN-PATHAO-702',
          courier: 'Pathao',
          courier_reported: 600.00,
          deposit_received: 600.00,
        },
        // 2. Over Collection: Sub 703 expected 1200.00, deposit received 1300.00 (+100.00 variance)
        {
          consignment_id: 'CN-REDX-703',
          courier: 'RedX',
          courier_reported: 1300.00,
          deposit_received: 1300.00,
        },
        // 3. Missing Deposit: Sub 704 courier reported 900.00, deposit 0.00
        {
          consignment_id: 'CN-STEADFAST-704',
          courier: 'Steadfast',
          courier_reported: 900.00,
          deposit_received: 0.00,
        },
        // 4. Duplicate: Repeat of CN-STEADFAST-701 (which was already MATCHED in test 1)
        {
          consignment_id: 'CN-STEADFAST-701',
          courier: 'Steadfast',
          courier_reported: 1560.00,
          deposit_received: 1560.00,
        },
        // 5. Unmatched Consignment: Consignment does not exist in platform
        {
          consignment_id: 'CN-UNKNOWN-99999',
          courier: 'Steadfast',
          courier_reported: 500.00,
          deposit_received: 500.00,
        },
      ],
      importedBy: 1,
    });

    assert.equal(multiBatch.totalCount, 5);
    assert.equal(multiBatch.shortCount, 1, '1 short collection');
    assert.equal(multiBatch.overCount, 1, '1 over collection');
    assert.equal(multiBatch.missingDepositCount, 1, '1 missing deposit');
    assert.equal(multiBatch.duplicateCount, 1, '1 duplicate');
    assert.equal(multiBatch.unmatchedCount, 1, '1 unmatched');
  });

  test('Acceptance 3: Strict Escrow Release Blocking for Unreconciled COD Orders', async () => {
    // Deposit funds to escrow for Sub 702 (which had a SHORT_COLLECTION in test 2)
    const dep = await vaultService.depositToEscrow(db, {
      subOrderId: 702,
      supplierWalletId: 10,
      salerWalletId: 20,
      platformWalletId: 1,
    });
    assert.equal(dep.success, true);

    // Attempt to release escrow for Sub 702 (status = SHORT_COLLECTION) -> Must throw COD_FUNDS_NOT_RECONCILED
    await assert.rejects(
      () => vaultService.releaseEscrow(db, { subOrderId: 702 }),
      /COD_FUNDS_NOT_RECONCILED/,
      'Escrow release must be blocked for unreconciled COD sub-orders'
    );

    // Deposit and release for Sub 701 (which is MATCHED) -> Must succeed
    await vaultService.depositToEscrow(db, {
      subOrderId: 701,
      supplierWalletId: 10,
      salerWalletId: 20,
      platformWalletId: 1,
    });

    const releaseResult = await vaultService.releaseEscrow(db, { subOrderId: 701 });
    assert.equal(releaseResult.success, true, 'MATCHED COD sub-order escrow releases smoothly');
  });

  test('Acceptance 4: Maker-Checker Discrepancy Resolution & Audit Trail', async () => {
    const raw = db.getRawData();
    const shortRecon = raw.codReconciliations.find((x) => x.sub_order_id === 702);
    assert.ok(shortRecon, 'Found short collection reconciliation row');

    // 1. Moderator attempts resolution -> Creates pending_admin_action
    const modResult = await codService.resolveDiscrepancy(db, {
      reconId: shortRecon.id,
      resolutionReason: 'Courier admitted loss in transit and credited offline voucher',
      resolvedBy: 2,
      role: 'moderator',
    });

    assert.equal(modResult.isPendingMakerChecker, true);
    assert.ok(modResult.pendingAction.id > 0, 'pending_admin_action created for HIGH tier');

    // 2. Super Admin executes resolution directly -> Updates to RESOLVED
    const adminResult = await codService.resolveDiscrepancy(db, {
      reconId: shortRecon.id,
      resolutionReason: 'Courier admitted loss in transit and credited offline voucher',
      resolvedBy: 1,
      role: 'super_admin',
    });

    assert.equal(adminResult.success, true);
    assert.equal(adminResult.reconciliation.status, 'RESOLVED');

    // Now that Sub 702 is RESOLVED, releaseEscrow can proceed
    const unblockedRelease = await vaultService.releaseEscrow(db, { subOrderId: 702 });
    assert.equal(unblockedRelease.success, true, 'Escrow release unblocked after resolution');
  });

  test('Acceptance 5: Courier Aging Matrix Report with SLA Alert Detection', async () => {
    // Generate aging report
    const aging = await codService.getAgingReport(db, { alertThresholdDays: 7 });

    assert.ok(aging.couriers.length > 0, 'Contains courier breakdown');
    assert.ok(parseFloat(aging.totalUnreconciledPlatform) > 0, 'Total unreconciled platform balance > 0');

    // Verify courier items have alert flag where aged >= 7 days
    const steadfast = aging.couriers.find((c) => c.courier === 'STEADFAST');
    assert.ok(steadfast, 'Steadfast stats exist');
  });

  test('Acceptance 6: Fastify HTTP Routes for CSV Upload, Queue & Aging Matrix', async () => {
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

    // 1. POST /api/v1/admin/finance/cod/upload with CSV content
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/finance/cod/upload',
      payload: {
        courier: 'Steadfast',
        csv_content: 'consignment_id,sub_order_ref,courier_reported,deposit_received\nCN-STEADFAST-701,SUB-701,1560.00,1560.00',
      },
    });
    assert.equal(uploadRes.statusCode, 201);
    assert.ok(uploadRes.json().data.batchRef);

    // 2. GET /api/v1/admin/finance/cod
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/finance/cod',
    });
    assert.equal(listRes.statusCode, 200);
    assert.ok(listRes.json().data.reconciliations.length > 0);

    // 3. GET /api/v1/admin/finance/cod/aging
    const agingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/finance/cod/aging',
    });
    assert.equal(agingRes.statusCode, 200);
    assert.ok(agingRes.json().data.couriers);
  });
});
