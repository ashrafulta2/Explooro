/**
 * payoutEngine.test.js — Automated test suite for Prompt 6.3:
 * Payout Engine with Maker-Checker Authorization.
 *
 * Covers:
 * 1. Immediate HELD balance locking on request, preventing double-spending.
 * 2. Withdrawal capability restriction & limits enforcement.
 * 3. Automated risk analysis (first withdrawal, high value, new account, name mismatch).
 * 4. Maker-Checker workflow: Moderator approval creates pending_admin_action; Super Admin executes.
 * 5. Successful B2C disbursement, ledger balance mutation & zero drift integrity.
 * 6. Failed B2C gateway disbursement automatically returns held funds back to available balance.
 * 7. Batch disbursement with isolated per-item failure handling.
 * 8. Fastify HTTP routes for vault withdrawals and admin payout queue.
 */

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import * as walletRepo from '../src/repositories/wallet.repository.js';
import * as ledgerService from '../src/services/ledger.service.js';
import * as payoutService from '../src/services/payout.service.js';
import financeRoutes from '../src/routes/finance.routes.js';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';

function createMockDb() {
  let nextWalletId = 1;
  let nextLedgerId = 1;
  let nextPayoutId = 1;
  let nextActionId = 1;

  const users = [
    { id: 1, ref: 'USR-SUPER1', full_name: 'Super Admin Kabir', role: 'super_admin', created_at: '2025-01-01T00:00:00Z' },
    { id: 2, ref: 'USR-MOD1', full_name: 'Moderator Rifat', role: 'moderator', created_at: '2025-01-01T00:00:00Z' },
    { id: 101, ref: 'USR-SUPP1', phone: '+8801700000101', full_name: 'Supplier Aarong', role: 'supplier', created_at: '2025-01-01T00:00:00Z' },
    { id: 201, ref: 'USR-SALER1', phone: '+8801700000201', full_name: 'Saler Jamila', role: 'saler', created_at: '2026-08-20T00:00:00Z' }, // New account (<7d)
    { id: 301, ref: 'USR-RESTRICTED', phone: '+8801700000301', full_name: 'Restricted User', role: 'saler', created_at: '2025-01-01T00:00:00Z' },
  ];

  const userProfiles = [
    { user_id: 101, full_name: 'Supplier Aarong' },
    { user_id: 201, full_name: 'Saler Jamila' },
    { user_id: 301, full_name: 'Restricted User' },
  ];

  const userRestrictions = [
    { user_id: 301, can_withdraw: 'BLOCK', max_withdrawal_per_day: null, expires_at: null },
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
      available_balance: '10000.00',
      pending_escrow_balance: '0.00',
      held_balance: '0.00',
      lifetime_earned: '10000.00',
      lifetime_withdrawn: '0.00',
      currency: 'BDT',
      version: 0,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: null,
    },
    {
      id: 20,
      user_id: 201,
      available_balance: '30000.00',
      pending_escrow_balance: '0.00',
      held_balance: '0.00',
      lifetime_earned: '30000.00',
      lifetime_withdrawn: '0.00',
      currency: 'BDT',
      version: 0,
      created_at: '2026-08-20T00:00:00Z',
      updated_at: null,
    },
    {
      id: 30,
      user_id: 301,
      available_balance: '5000.00',
      pending_escrow_balance: '0.00',
      held_balance: '0.00',
      lifetime_earned: '5000.00',
      lifetime_withdrawn: '0.00',
      currency: 'BDT',
      version: 0,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: null,
    },
  ];

  const ledgerTransactions = [
    { id: nextLedgerId++, txn_group_id: 'init-1', wallet_id: 1, entry_type: 'CREDIT', amount: '1000000.00', balance_bucket: 'AVAILABLE', category: 'DEPOSIT', reference_type: 'SYSTEM', reference_id: 1, memo: 'Initial Treasury', created_by: 1, created_at: '2025-01-01T00:00:00Z' },
    { id: nextLedgerId++, txn_group_id: 'init-10', wallet_id: 10, entry_type: 'CREDIT', amount: '10000.00', balance_bucket: 'AVAILABLE', category: 'ESCROW_RELEASE', reference_type: 'SUB_ORDER', reference_id: 101, memo: 'Initial Earnings', created_by: 1, created_at: '2025-01-01T00:00:00Z' },
    { id: nextLedgerId++, txn_group_id: 'init-20', wallet_id: 20, entry_type: 'CREDIT', amount: '30000.00', balance_bucket: 'AVAILABLE', category: 'ESCROW_RELEASE', reference_type: 'SUB_ORDER', reference_id: 201, memo: 'Initial Earnings', created_by: 1, created_at: '2026-08-20T00:00:00Z' },
    { id: nextLedgerId++, txn_group_id: 'init-30', wallet_id: 30, entry_type: 'CREDIT', amount: '5000.00', balance_bucket: 'AVAILABLE', category: 'ESCROW_RELEASE', reference_type: 'SUB_ORDER', reference_id: 301, memo: 'Initial Earnings', created_by: 1, created_at: '2025-01-01T00:00:00Z' },
  ];
  const payoutRequests = [];
  const pendingActions = [];

  const clientMock = {
    async query(sql, params = []) {
      const q = sql.trim().replace(/\s+/g, ' ');

      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        return { rows: [] };
      }

      // SELECT user_restrictions
      if (q.includes('FROM user_restrictions WHERE user_id = $1')) {
        const userId = params[0];
        const r = userRestrictions.find((x) => x.user_id === userId);
        return { rows: r ? [{ ...r }] : [] };
      }

      // SELECT users LEFT JOIN user_profiles
      if (q.includes('FROM users u') && q.includes('WHERE u.id = $1')) {
        const userId = params[0];
        const u = users.find((x) => x.id === userId);
        const up = userProfiles.find((x) => x.user_id === userId);
        if (u) {
          return { rows: [{ ...u, full_name: up?.full_name || u.full_name }] };
        }
        return { rows: [] };
      }

      // SELECT COUNT(*) FROM payout_requests WHERE user_id = $1 AND status = 'COMPLETED'
      if (q.includes('COUNT(*)') && q.includes("status = 'COMPLETED'")) {
        const userId = params[0];
        const count = payoutRequests.filter((p) => p.user_id === userId && p.status === 'COMPLETED').length;
        return { rows: [{ count }] };
      }

      // SELECT wallets WHERE user_id = $1
      if (q.includes('FROM wallets') && q.includes('WHERE user_id = $1')) {
        const userId = params[0];
        const w = wallets.find((x) => x.user_id === userId);
        return { rows: w ? [{ ...w }] : [] };
      }

      // INSERT INTO wallets
      if (q.includes('INSERT INTO wallets')) {
        const userId = params[0];
        let w = wallets.find((x) => x.user_id === userId);
        if (!w) {
          w = {
            id: nextWalletId++,
            user_id: userId,
            available_balance: '0.00',
            pending_escrow_balance: '0.00',
            held_balance: '0.00',
            lifetime_earned: '0.00',
            lifetime_withdrawn: '0.00',
            currency: 'BDT',
            version: 0,
            created_at: new Date().toISOString(),
            updated_at: null,
          };
          wallets.push(w);
        }
        return { rows: [{ ...w }] };
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

      // INSERT INTO payout_requests
      if (q.includes('INSERT INTO payout_requests')) {
        const row = {
          id: nextPayoutId++,
          ref: params[0],
          wallet_id: params[1],
          user_id: params[2],
          method: params[3],
          account_number: params[4],
          account_name: params[5],
          bank_name: params[6],
          amount: params[7],
          fee_amount: params[8],
          net_amount: params[9],
          status: 'REQUESTED',
          risk_flags_json: params[10],
          idempotency_key: params[11],
          pending_action_id: null,
          approved_by: null,
          approved_at: null,
          gateway_ref: null,
          gateway_receipt: null,
          failure_reason: null,
          processed_at: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        };
        payoutRequests.push(row);
        return { rows: [{ ...row }] };
      }

      // SELECT payout_requests FOR UPDATE
      if (q.includes('FROM payout_requests') && q.includes('WHERE id = $1')) {
        const id = params[0];
        const p = payoutRequests.find((x) => x.id === id);
        return { rows: p ? [{ ...p }] : [] };
      }

      // INSERT INTO pending_admin_actions
      if (q.includes('INSERT INTO pending_admin_actions')) {
        const row = {
          id: nextActionId++,
          ref: params[0],
          actor_id: params[1],
          action_key: 'finance.payout.approve',
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

      // UPDATE payout_requests
      if (q.includes('UPDATE payout_requests SET pending_action_id')) {
        const id = params[0];
        const actId = params[1];
        const p = payoutRequests.find((x) => x.id === id);
        if (p) p.pending_action_id = actId;
        return { rows: [] };
      }

      // UPDATE payout_requests SET status = 'COMPLETED'
      if (q.includes("UPDATE payout_requests SET status = 'COMPLETED'")) {
        const id = params[0];
        const p = payoutRequests.find((x) => x.id === id);
        if (p) {
          p.status = 'COMPLETED';
          p.gateway_ref = params[1];
          p.gateway_receipt = params[2];
          p.approved_by = params[3];
          p.approved_at = new Date().toISOString();
          p.processed_at = new Date().toISOString();
          p.updated_at = new Date().toISOString();
          return { rows: [{ ...p }] };
        }
        return { rows: [] };
      }

      // UPDATE payout_requests SET status = 'FAILED'
      if (q.includes("UPDATE payout_requests SET status = 'FAILED'")) {
        const id = params[0];
        const p = payoutRequests.find((x) => x.id === id);
        if (p) {
          p.status = 'FAILED';
          p.failure_reason = params[1];
          p.updated_at = new Date().toISOString();
          return { rows: [{ ...p }] };
        }
        return { rows: [] };
      }

      // UPDATE payout_requests SET status = 'REJECTED'
      if (q.includes("UPDATE payout_requests SET status = 'REJECTED'")) {
        const id = params[0];
        const p = payoutRequests.find((x) => x.id === id);
        if (p) {
          p.status = 'REJECTED';
          p.failure_reason = params[1];
          p.approved_by = params[2];
          p.updated_at = new Date().toISOString();
          return { rows: [{ ...p }] };
        }
        return { rows: [] };
      }

      // SELECT super_admin user
      if (q.includes("r.key = 'super_admin'")) {
        return { rows: [{ id: 1 }] };
      }

      // SELECT payout_requests queue
      if (q.includes('FROM payout_requests p JOIN users u')) {
        const list = payoutRequests.map((p) => {
          const u = users.find((x) => x.id === p.user_id);
          const up = userProfiles.find((x) => x.user_id === p.user_id);
          const w = wallets.find((x) => x.id === p.wallet_id);
          return {
            ...p,
            user_phone: u?.phone,
            user_ref: u?.ref,
            user_full_name: up?.full_name || u?.full_name,
            available_balance: w?.available_balance,
            held_balance: w?.held_balance,
          };
        });
        return { rows: list };
      }

      // Integrity checks
      if (q.includes('WITH ledger_summary AS') || (q.includes('FROM wallets w') && q.includes('total_ledger'))) {
        const walletRows = wallets.map((w) => {
          const wTxns = ledgerTransactions.filter((lt) => lt.wallet_id === w.id);
          const totalLedger = wTxns.reduce(
            (acc, lt) => acc + (lt.entry_type === 'CREDIT' ? parseFloat(lt.amount) : -parseFloat(lt.amount)),
            0
          );
          const availBal = parseFloat(w.available_balance);
          const escrowBal = parseFloat(w.pending_escrow_balance);
          const heldBal = parseFloat(w.held_balance);
          const totalBal = availBal + escrowBal + heldBal;
          return {
            wallet_id: w.id,
            user_id: w.user_id,
            available_balance: w.available_balance,
            pending_escrow_balance: w.pending_escrow_balance,
            held_balance: w.held_balance,
            total_wallet_balance: totalBal.toFixed(2),
            total_ledger: totalLedger.toFixed(2),
            total_drift: (totalBal - totalLedger).toFixed(2),
            available_drift: '0.00',
            escrow_drift: '0.00',
            held_drift: '0.00',
          };
        });
        return { rows: walletRows };
      }

      if (q.includes('FROM ledger_transactions GROUP BY txn_group_id HAVING')) {
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
      return { wallets, ledgerTransactions, payoutRequests, pendingActions };
    },
  };

  return poolMock;
}

describe('Prompt 6.3 — Payout Engine with Maker-Checker Authorization', () => {
  let db;

  before(() => {
    db = createMockDb();
  });

  test('Acceptance 1: Requesting a payout immediately locks available balance into HELD and prevents double-spending', async () => {
    const walletBefore = await walletRepo.getWalletByUserId(db, 101);
    assert.equal(walletBefore.available_balance, '10000.00');
    assert.equal(walletBefore.held_balance, '0.00');

    // Request ৳3000.00 withdrawal
    const reqResult = await payoutService.requestPayout(db, {
      userId: 101,
      method: 'BKASH',
      accountNumber: '+8801712345678',
      accountName: 'Supplier Aarong',
      amount: 3000.00,
    });

    assert.equal(reqResult.success, true);
    assert.equal(reqResult.payout.status, 'REQUESTED');
    assert.equal(reqResult.payout.amount, '3000.00');

    const walletAfter = await walletRepo.getWalletByUserId(db, 101);
    assert.equal(walletAfter.available_balance, '7000.00', 'Available balance must decrease immediately by 3000');
    assert.equal(walletAfter.held_balance, '3000.00', 'Held balance must increase by 3000');

    // Attempting another withdrawal for ৳8000 (only ৳7000 available) must throw
    await assert.rejects(
      () => payoutService.requestPayout(db, {
        userId: 101,
        method: 'BKASH',
        accountNumber: '+8801712345678',
        accountName: 'Supplier Aarong',
        amount: 8000.00,
      }),
      /INSUFFICIENT_AVAILABLE_BALANCE/,
      'Must prevent double-spending when balance is already held'
    );
  });

  test('Acceptance 2: Restricted user and threshold validation', async () => {
    // Restricted user 301
    await assert.rejects(
      () => payoutService.requestPayout(db, {
        userId: 301,
        method: 'BKASH',
        accountNumber: '+8801700000301',
        accountName: 'Restricted User',
        amount: 500.00,
      }),
      /USER_RESTRICTED/,
      'User with can_withdraw=BLOCK must be rejected'
    );

    // Below ৳100 threshold
    await assert.rejects(
      () => payoutService.requestPayout(db, {
        userId: 101,
        method: 'BKASH',
        accountNumber: '+8801712345678',
        accountName: 'Supplier Aarong',
        amount: 50.00,
      }),
      /MINIMUM_PAYOUT_THRESHOLD/,
      'Amount < 100 must be rejected'
    );
  });

  test('Acceptance 3: Automated Risk Analysis evaluates flags', async () => {
    // Saler 201: New account (<7d), large amount (৳26,000 >= ৳25k), and mismatched account name
    const reqResult = await payoutService.requestPayout(db, {
      userId: 201,
      method: 'BANK',
      accountNumber: '1029384756',
      accountName: 'Different Name Person',
      bankName: 'BRAC Bank',
      amount: 26000.00,
    });

    assert.equal(reqResult.success, true);
    const codes = reqResult.riskFlags.map((f) => f.code);
    assert.ok(codes.includes('HIGH_VALUE_DISBURSEMENT'), 'High value flag set');
    assert.ok(codes.includes('NEW_ACCOUNT'), 'New account flag set');
    assert.ok(codes.includes('NAME_MISMATCH'), 'Name mismatch flag set');
    assert.ok(codes.includes('FIRST_WITHDRAWAL'), 'First withdrawal flag set');
  });

  test('Acceptance 4: Moderator approval creates a pending action; Super Admin executes directly (Maker-Checker)', async () => {
    const raw = db.getRawData();
    const payout = raw.payoutRequests.find((p) => p.user_id === 101 && p.status === 'REQUESTED');
    assert.ok(payout, 'Found requested payout');

    // 1. Moderator approval attempt
    const modResult = await payoutService.approvePayout(db, {
      payoutId: payout.id,
      approverId: 2,
      approverRole: 'moderator',
      approverNote: 'Looks valid to me',
    });

    assert.equal(modResult.isPendingMakerChecker, true, 'Moderator approval creates pending maker-checker action');
    assert.ok(modResult.pendingAction.id > 0, 'pending_admin_actions record created');

    const walletWhilePending = await walletRepo.getWalletByUserId(db, 101);
    assert.equal(walletWhilePending.held_balance, '3000.00', 'Funds remain safely held while pending Super Admin');

    // 2. Super Admin executes approval
    const adminResult = await payoutService.approvePayout(db, {
      payoutId: payout.id,
      approverId: 1,
      approverRole: 'super_admin',
    });

    assert.equal(adminResult.success, true);
    assert.equal(adminResult.payout.status, 'COMPLETED');
    assert.ok(adminResult.payout.gateway_ref.startsWith('BKASH-B2C-'));

    const walletAfterDisburse = await walletRepo.getWalletByUserId(db, 101);
    assert.equal(walletAfterDisburse.held_balance, '0.00', 'Held balance cleared on completion');
    assert.equal(walletAfterDisburse.lifetime_withdrawn, '3000.00', 'Lifetime withdrawn increased by 3000');

    // Verify double-entry ledger integrity
    const integrity = await walletRepo.checkLedgerIntegrity(db);
    assert.equal(integrity.status, 'HEALTHY', 'Ledger status must be HEALTHY');
    assert.equal(integrity.drift_count, 0, 'Ledger drift_count must be exactly 0');
  });

  test('Acceptance 5: Failed B2C disbursement automatically returns funds from HELD back to AVAILABLE', async () => {
    // Request a payout with simulated invalid account ending in 0000
    const reqResult = await payoutService.requestPayout(db, {
      userId: 101,
      method: 'BKASH',
      accountNumber: '+8801799990000', // Mock driver triggers GATEWAY_ACCOUNT_INVALID
      accountName: 'Supplier Aarong',
      amount: 2000.00,
    });

    assert.equal(reqResult.success, true);
    const payoutId = reqResult.payout.id;

    const walletBeforeDisburse = await walletRepo.getWalletByUserId(db, 101);
    assert.equal(walletBeforeDisburse.available_balance, '5000.00');
    assert.equal(walletBeforeDisburse.held_balance, '2000.00');

    // Super Admin executes disbursement (gateway rejects it)
    const disburseResult = await payoutService.disbursePayout(db, {
      payoutId,
      executedBy: 1,
    });

    assert.equal(disburseResult.success, false);
    assert.equal(disburseResult.payout.status, 'FAILED');
    assert.ok(disburseResult.payout.failure_reason.includes('inactive or invalid'));

    // Held funds must be immediately restored to available_balance
    const walletAfterFailure = await walletRepo.getWalletByUserId(db, 101);
    assert.equal(walletAfterFailure.available_balance, '7000.00', 'Available balance restored');
    assert.equal(walletAfterFailure.held_balance, '0.00', 'Held balance cleared');

    const integrity = await walletRepo.checkLedgerIntegrity(db);
    assert.equal(integrity.status, 'HEALTHY', 'Zero ledger drift after failure reversal');
    assert.equal(integrity.drift_count, 0);
  });

  test('Acceptance 6: Batch disbursement processes multiple payouts with isolated results', async () => {
    // Create 2 new payouts for supplier 101
    const p1 = await payoutService.requestPayout(db, {
      userId: 101,
      method: 'BKASH',
      accountNumber: '+8801711111111',
      accountName: 'Supplier Aarong',
      amount: 1000.00,
    });

    const p2 = await payoutService.requestPayout(db, {
      userId: 101,
      method: 'BKASH',
      accountNumber: '+8801722220000', // Will fail due to 0000
      accountName: 'Supplier Aarong',
      amount: 1000.00,
    });

    const batchResult = await payoutService.batchDisbursePayouts(db, {
      payoutIds: [p1.payout.id, p2.payout.id],
      executedBy: 1,
    });

    assert.equal(batchResult.total, 2);
    assert.equal(batchResult.successCount, 1, 'P1 succeeds');
    assert.equal(batchResult.failureCount, 1, 'P2 fails');
    assert.equal(batchResult.successful[0].id, p1.payout.id);
    assert.equal(batchResult.failed[0].payoutId, p2.payout.id);

    const integrity = await walletRepo.checkLedgerIntegrity(db);
    assert.equal(integrity.status, 'HEALTHY', 'Zero ledger drift after batch');
    assert.equal(integrity.drift_count, 0);
  });

  test('Acceptance 7: Fastify HTTP Routes for Vault Withdrawals & Admin Payout Queue', async () => {
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

    // 1. GET /api/v1/admin/finance/payouts
    const queueRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/finance/payouts',
    });
    assert.equal(queueRes.statusCode, 200);
    const queueBody = queueRes.json();
    assert.ok(queueBody.data.payouts.length > 0, 'Contains payout requests');

    // 2. GET /api/v1/vault/payouts/me
    const myPayoutsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/vault/payouts/me',
    });
    assert.equal(myPayoutsRes.statusCode, 200);
  });
});
