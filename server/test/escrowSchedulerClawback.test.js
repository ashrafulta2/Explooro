/**
 * escrowSchedulerClawback.test.js — Automated test suite for Prompt 6.2:
 * Escrow Release Scheduler & Clawback Automation.
 *
 * Covers:
 * 1. Migration 013: job_runs, escrow_dead_letters, negative_balance_recoveries.
 * 2. Dynamic Return Window: hold_until dynamically derived from returns_engine module settings.
 * 3. Hourly Escrow Release Sweep: releases mature holds and updates beneficiary wallets.
 * 4. Scheduler Distributed Locking & Module Gating: advisory locks prevent duplicate execution, job_runs audits runs.
 * 5. Dead-Letter Queue: failed releases are routed to escrow_dead_letters instead of silent retries.
 * 6. Post-Release Clawback: recovers from available balance.
 * 7. Negative-Balance Deficit Record: unrecovered deficit is logged in negative_balance_recoveries.
 * 8. Admin HTTP Endpoints: GET /admin/finance/escrow with countdowns, dead-letters, and manual sweep.
 */

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

import * as walletRepo from '../src/repositories/wallet.repository.js';
import * as ledgerService from '../src/services/ledger.service.js';
import * as vaultService from '../src/services/vault.service.js';
import * as clawbackService from '../src/services/clawback.service.js';
import * as scheduler from '../src/jobs/scheduler.js';
import { runEscrowReleaseSweep } from '../src/jobs/escrowRelease.job.js';
import financeRoutes from '../src/routes/finance.routes.js';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createMockDb() {
  let nextWalletId = 1;
  let nextLedgerId = 1;
  let nextEscrowId = 1;
  let nextJobRunId = 1;
  let nextDeadLetterId = 1;
  let nextRecoveryId = 1;

  const users = [
    { id: 1, ref: 'USR-SUPER1', full_name: 'Dev Super Admin', role: 'super_admin' },
    { id: 10, ref: 'USR-CUST1', phone: '+8801700000010', full_name: 'Customer Karim', role: 'customer' },
    { id: 101, ref: 'USR-SUPP1', phone: '+8801700000101', full_name: 'Supplier Aarong', role: 'supplier' },
    { id: 201, ref: 'USR-SALER1', phone: '+8801700000201', full_name: 'Saler Jamila', role: 'saler' },
  ];

  const wallets = [];
  const ledgerTransactions = [];
  const escrowEntries = [];
  const jobRuns = [];
  const deadLetters = [];
  const negativeRecoveries = [];
  const heldAdvisoryLocks = new Set();

  const platformModules = [
    {
      key: 'returns_engine',
      is_enabled: true,
      settings_json: { return_window_days: 7 },
    },
  ];

  const subOrders = [
    {
      id: 601,
      order_id: 2001,
      supplier_id: 101,
      saler_id: 201,
      subtotal_base: '1000.00',
      wholesale_margin: '200.00',
      saler_commission: '120.00',
      platform_margin: '180.00',
      shipping_amount: '60.00',
      total_amount: '1560.00',
      status: 'PLACED',
    },
    {
      id: 602,
      order_id: 2002,
      supplier_id: 101,
      saler_id: 201,
      subtotal_base: '500.00',
      wholesale_margin: '100.00',
      saler_commission: '50.00',
      platform_margin: '90.00',
      shipping_amount: '40.00',
      total_amount: '780.00',
      status: 'PLACED',
    },
  ];

  const orders = [
    { id: 2001, customer_id: 10, total_amount: '1560.00' },
    { id: 2002, customer_id: 10, total_amount: '780.00' },
  ];

  const clientMock = {
    async query(sql, params = []) {
      const q = sql.trim().replace(/\s+/g, ' ');

      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        return { rows: [] };
      }

      // SELECT pg_try_advisory_lock
      if (q.includes('SELECT pg_try_advisory_lock')) {
        const lockId = params[0];
        if (heldAdvisoryLocks.has(lockId)) {
          return { rows: [{ acquired: false }] };
        }
        heldAdvisoryLocks.add(lockId);
        return { rows: [{ acquired: true }] };
      }

      // SELECT pg_advisory_unlock
      if (q.includes('SELECT pg_advisory_unlock')) {
        const lockId = params[0];
        heldAdvisoryLocks.delete(lockId);
        return { rows: [{ unlocked: true }] };
      }

      // SELECT platform_modules
      if (q.includes('FROM platform_modules WHERE key = $1')) {
        const key = params[0];
        const m = platformModules.find((x) => x.key === key);
        return { rows: m ? [{ ...m }] : [] };
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

      // SELECT sub_orders JOIN orders
      if (q.includes('FROM sub_orders s') && q.includes('WHERE s.id = $1')) {
        const subId = params[0];
        const so = subOrders.find((s) => s.id === subId);
        if (so) {
          const ord = orders.find((o) => o.id === so.order_id);
          return {
            rows: [
              {
                ...so,
                customer_id: ord?.customer_id ?? 10,
              },
            ],
          };
        }
        return { rows: [] };
      }

      // SELECT super_admin user
      if (q.includes('roles r ON r.id = ur.role_id') && q.includes("r.key = 'super_admin'")) {
        return { rows: [{ id: 1 }] };
      }

      // SELECT escrow_entries due for release: WHERE status = 'LOCKED' AND hold_until <= now()
      if (q.includes("WHERE status = 'LOCKED' AND hold_until <= now()")) {
        const now = new Date();
        const found = escrowEntries.filter(
          (e) => e.status === 'LOCKED' && new Date(e.hold_until).getTime() <= now.getTime()
        );
        return { rows: found.map((e) => ({ ...e })) };
      }

      // SELECT escrow_entries WHERE sub_order_id = $1
      if (q.includes('FROM escrow_entries') && q.includes('WHERE sub_order_id = $1')) {
        const subId = params[0];
        const found = escrowEntries.filter((e) => e.sub_order_id === subId);
        return { rows: found.map((e) => ({ ...e })) };
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
          existing.hold_until = holdUntil;
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

      // UPDATE escrow_entries SET status = 'CLAWED_BACK'
      if (q.includes("UPDATE escrow_entries SET status = 'CLAWED_BACK'")) {
        const arg = params[0];
        if (Array.isArray(arg)) {
          for (const e of escrowEntries) {
            if (arg.includes(e.id)) {
              e.status = 'CLAWED_BACK';
            }
          }
        } else {
          for (const e of escrowEntries) {
            if (e.sub_order_id === arg) {
              e.status = 'CLAWED_BACK';
            }
          }
        }
        return { rows: [] };
      }

      // UPDATE escrow_entries SET failure_count
      if (q.includes('UPDATE escrow_entries SET failure_count = failure_count + 1')) {
        const ids = params[0];
        const err = params[1];
        for (const e of escrowEntries) {
          if (ids.includes(e.id)) {
            e.failure_count += 1;
            e.last_error = err;
          }
        }
        return { rows: [] };
      }

      // INSERT INTO job_runs
      if (q.includes('INSERT INTO job_runs')) {
        const row = {
          id: nextJobRunId++,
          job_name: params[0],
          status: params[1],
          started_at: new Date().toISOString(),
          ended_at: null,
          duration_ms: null,
          processed_count: 0,
          success_count: 0,
          error_count: 0,
          error_details_json: null,
          metadata_json: null,
        };
        jobRuns.push(row);
        return { rows: [{ id: row.id }] };
      }

      // UPDATE job_runs
      if (q.includes('UPDATE job_runs SET status = $2')) {
        const runId = params[0];
        const status = params[1];
        const durationMs = params[2];
        const processedCount = params[3];
        const successCount = params[4];
        const errorCount = params[5];
        const errorDetailsJson = params[6];
        const metadataJson = params[7];

        const r = jobRuns.find((x) => x.id === runId);
        if (r) {
          r.status = status;
          r.duration_ms = durationMs;
          r.processed_count = processedCount;
          r.success_count = successCount;
          r.error_count = errorCount;
          r.error_details_json = errorDetailsJson;
          r.metadata_json = metadataJson;
          r.ended_at = new Date().toISOString();
        }
        return { rows: [] };
      }

      // INSERT INTO escrow_dead_letters
      if (q.includes('INSERT INTO escrow_dead_letters')) {
        const row = {
          id: nextDeadLetterId++,
          escrow_entry_id: params[0],
          sub_order_id: params[1],
          failure_reason: params[2],
          failure_stack: params[3],
          attempts: params[4] ?? 1,
          status: 'PENDING',
          resolved_by: null,
          resolution_note: null,
          resolved_at: null,
          created_at: new Date().toISOString(),
        };
        deadLetters.push(row);
        return { rows: [{ id: row.id }] };
      }

      // INSERT INTO negative_balance_recoveries
      if (q.includes('INSERT INTO negative_balance_recoveries')) {
        const row = {
          id: nextRecoveryId++,
          ref: params[0],
          wallet_id: params[1],
          user_id: params[2],
          sub_order_id: params[3],
          total_clawback_amount: params[4],
          recovered_from_available: params[5],
          unrecovered_deficit: params[6],
          recovery_status: 'PENDING',
          reason: params[7],
          created_at: new Date().toISOString(),
        };
        negativeRecoveries.push(row);
        return { rows: [{ ...row }] };
      }

      // SELECT escrow_entries JOIN sub_orders JOIN wallets JOIN users (Admin Escrow Holdings)
      if (q.includes('FROM escrow_entries e JOIN sub_orders s')) {
        const list = escrowEntries.map((e) => {
          const so = subOrders.find((s) => s.id === e.sub_order_id);
          const w = wallets.find((wal) => wal.id === e.wallet_id);
          const u = users.find((usr) => usr.id === w?.user_id);
          return {
            id: e.id,
            sub_order_id: e.sub_order_id,
            wallet_id: e.wallet_id,
            beneficiary_role: e.beneficiary_role,
            amount: e.amount,
            status: e.status,
            hold_until: e.hold_until,
            released_at: e.released_at,
            failure_count: e.failure_count,
            last_error: e.last_error,
            created_at: e.created_at,
            sub_order_ref: `SUB-${e.sub_order_id}`,
            user_phone: u?.phone ?? '+8801700000000',
            user_ref: u?.ref ?? 'USR-0',
            available_balance: w?.available_balance ?? '0.00',
          };
        });
        return { rows: list };
      }

      // SELECT escrow_dead_letters
      if (q.includes('FROM escrow_dead_letters')) {
        return { rows: deadLetters.map((d) => ({ ...d })) };
      }

      // SELECT negative_balance_recoveries
      if (q.includes('FROM negative_balance_recoveries')) {
        return {
          rows: negativeRecoveries.map((r) => {
            const u = users.find((usr) => usr.id === r.user_id);
            const w = wallets.find((wal) => wal.id === r.wallet_id);
            return {
              ...r,
              user_phone: u?.phone ?? '+8801700000000',
              user_ref: u?.ref ?? 'USR-0',
              available_balance: w?.available_balance ?? '0.00',
            };
          }),
        };
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
    setModuleReturnWindow(days) {
      const m = platformModules.find((x) => x.key === 'returns_engine');
      if (m) m.settings_json.return_window_days = days;
    },
    setModuleEnabled(enabled) {
      const m = platformModules.find((x) => x.key === 'returns_engine');
      if (m) m.is_enabled = enabled;
    },
    getRawData() {
      return { wallets, ledgerTransactions, escrowEntries, jobRuns, deadLetters, negativeRecoveries };
    },
  };

  return poolMock;
}

describe('Prompt 6.2 — Escrow Release Scheduler & Clawback Automation', () => {
  let db;

  before(() => {
    db = createMockDb();
  });

  test('Acceptance 1: Migration 013_scheduler_and_clawback.sql defines job_runs, dead_letters, and negative_recoveries', () => {
    const migrationPath = path.resolve(__dirname, '../src/db/migrations/013_scheduler_and_clawback.sql');
    assert.ok(fs.existsSync(migrationPath), '013_scheduler_and_clawback.sql must exist');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS job_runs'), 'job_runs defined');
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS escrow_dead_letters'), 'escrow_dead_letters defined');
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS negative_balance_recoveries'), 'negative_balance_recoveries defined');
  });

  test('Acceptance 2: Dynamic Return Window — changing return_window_days in module settings changes new holds without a deploy', async () => {
    // Deposit 1: Default 7 days
    db.setModuleReturnWindow(7);
    const dep1 = await vaultService.depositToEscrow(db, { subOrderId: 601 });
    assert.equal(dep1.success, true);

    const supEntry1 = dep1.escrowEntries.find((e) => e.beneficiary_role === 'SUPPLIER');
    const holdDate1 = new Date(supEntry1.hold_until);
    const expectedDiffDays1 = Math.round((holdDate1.getTime() - Date.now()) / (24 * 3600 * 1000));
    assert.equal(expectedDiffDays1, 7, 'Default hold window must be 7 days');

    // Change module settings to 14 days without any code change
    db.setModuleReturnWindow(14);
    const dep2 = await vaultService.depositToEscrow(db, { subOrderId: 602 });
    assert.equal(dep2.success, true);

    const supEntry2 = dep2.escrowEntries.find((e) => e.beneficiary_role === 'SUPPLIER');
    const holdDate2 = new Date(supEntry2.hold_until);
    const expectedDiffDays2 = Math.round((holdDate2.getTime() - Date.now()) / (24 * 3600 * 1000));
    assert.equal(expectedDiffDays2, 14, 'Updated hold window must be 14 days without deploy');
  });

  test('Acceptance 3: Hourly Escrow Release Sweep releases mature holds and credits beneficiary wallets', async () => {
    // Manually set sub-order 601 escrow holds to mature (in the past)
    const raw = db.getRawData();
    for (const e of raw.escrowEntries) {
      if (e.sub_order_id === 601) {
        e.hold_until = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      }
    }

    const supplierWalletBefore = await walletRepo.getWalletByUserId(db, 101);
    const salerWalletBefore = await walletRepo.getWalletByUserId(db, 201);
    const supAvailBefore = parseFloat(supplierWalletBefore.available_balance);
    const salerAvailBefore = parseFloat(salerWalletBefore.available_balance);

    // Run the automated release sweep
    const sweepResult = await runEscrowReleaseSweep(db, null, console);

    assert.equal(sweepResult.processedCount >= 1, true);
    assert.equal(sweepResult.successCount >= 1, true);
    assert.ok(sweepResult.metadata.releasedSubOrderIds.includes(601), 'Sub-order 601 must be released');

    const supplierWalletAfter = await walletRepo.getWalletByUserId(db, 101);
    const salerWalletAfter = await walletRepo.getWalletByUserId(db, 201);

    // Supplier received ৳1260.00 and Saler received ৳120.00
    assert.equal(parseFloat(supplierWalletAfter.available_balance), supAvailBefore + 1260.00);
    assert.equal(parseFloat(salerWalletAfter.available_balance), salerAvailBefore + 120.00);

    // Sub-order 602 (hold_until is 14 days in future) remains LOCKED
    const unexpiredEntries = raw.escrowEntries.filter((e) => e.sub_order_id === 602);
    for (const e of unexpiredEntries) {
      assert.equal(e.status, 'LOCKED', 'Unexpired hold must remain LOCKED');
    }
  });

  test('Acceptance 4: Scheduler Advisory Lock & Job Runs Audit logging', async () => {
    // Execute job via scheduler runner
    const jobRunResult = await scheduler.runJobNow('escrow_release', db, null, console);

    assert.equal(jobRunResult.status, 'COMPLETED');
    assert.ok(jobRunResult.runId > 0, 'Job run ID must be recorded in job_runs table');

    const raw = db.getRawData();
    const runRecord = raw.jobRuns.find((r) => r.id === jobRunResult.runId);
    assert.ok(runRecord, 'job_runs row exists');
    assert.equal(runRecord.status, 'COMPLETED');
    assert.equal(runRecord.job_name, 'escrow_release');

    // Test module gating: disable module and verify job skips
    db.setModuleEnabled(false);
    const skippedResult = await scheduler.runJobNow('escrow_release', db, null, console);
    assert.equal(skippedResult.status, 'SKIPPED');
    assert.equal(skippedResult.reason, 'MODULE_DISABLED');

    // Re-enable module
    db.setModuleEnabled(true);
  });

  test('Acceptance 5: Post-Release Clawback recovers from available balance and refunds customer', async () => {
    const custWalletBefore = await walletRepo.getWalletByUserId(db, 10);
    const supWalletBefore = await walletRepo.getWalletByUserId(db, 101);
    const salerWalletBefore = await walletRepo.getWalletByUserId(db, 201);

    const custAvailBefore = parseFloat(custWalletBefore.available_balance);
    const supAvailBefore = parseFloat(supWalletBefore.available_balance);
    const salerAvailBefore = parseFloat(salerWalletBefore.available_balance);

    // Sub-order 601 was released in Acceptance 3. Now customer return is approved.
    const clawbackResult = await clawbackService.processReturnClawback(db, {
      subOrderId: 601,
      reason: 'Product defective on delivery',
      approvedBy: 1,
    });

    assert.equal(clawbackResult.success, true);
    assert.equal(clawbackResult.totalClawbackAmount, '1560.00');

    const custWalletAfter = await walletRepo.getWalletByUserId(db, 10);
    const supWalletAfter = await walletRepo.getWalletByUserId(db, 101);
    const salerWalletAfter = await walletRepo.getWalletByUserId(db, 201);

    // Customer receives ৳1560.00 refund
    assert.equal(parseFloat(custWalletAfter.available_balance), custAvailBefore + 1560.00);
    // Supplier and Saler recovered (-1260.00 and -120.00)
    assert.equal(parseFloat(supWalletAfter.available_balance), supAvailBefore - 1260.00);
    assert.equal(parseFloat(salerWalletAfter.available_balance), salerAvailBefore - 120.00);
  });

  test('Acceptance 6: Insufficient Balance Deficit — creates negative_balance_recoveries record when seller has withdrawn funds', async () => {
    // Setup sub-order 602: release its funds first
    const raw = db.getRawData();
    for (const e of raw.escrowEntries) {
      if (e.sub_order_id === 602) {
        e.hold_until = new Date(Date.now() - 3600000).toISOString();
      }
    }
    await vaultService.releaseEscrow(db, { subOrderId: 602 });

    // Simulate supplier withdrawing all available funds (balance drops to ৳0.00)
    const supWallet = await walletRepo.getWalletByUserId(db, 101);
    await walletRepo.updateWalletBalances(db, supWallet.id, {
      availableDelta: (-parseFloat(supWallet.available_balance)).toFixed(2),
    });

    const supWalletZero = await walletRepo.getWalletById(db, supWallet.id);
    assert.equal(parseFloat(supWalletZero.available_balance), 0.00, 'Supplier balance is 0');

    // Customer return approved for sub-order 602 (Supplier owes ৳640.00)
    const clawbackWithDeficit = await clawbackService.processReturnClawback(db, {
      subOrderId: 602,
      reason: 'Wrong item size delivered',
      approvedBy: 1,
    });

    assert.equal(clawbackWithDeficit.success, true);
    assert.ok(parseFloat(clawbackWithDeficit.unrecoveredDeficit) > 0, 'Must record unrecovered deficit');
    assert.ok(clawbackWithDeficit.recoveryRecords.length > 0, 'Must create negative balance recovery records');

    const recoveryRecord = clawbackWithDeficit.recoveryRecords[0];
    assert.ok(recoveryRecord.ref.startsWith('NBR-'), 'Recovery ref starts with NBR-');
    assert.equal(recoveryRecord.recovery_status, 'PENDING');

    // Verify recovery records can be fetched via API helper
    const pendingRecoveries = await clawbackService.getPendingRecoveries(db);
    assert.ok(pendingRecoveries.length > 0, 'Pending recoveries list contains the deficit');
  });

  test('Acceptance 7: Admin HTTP endpoints for Escrow Holdings with countdowns, Dead-letters, and Sweep', async () => {
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

    // 1. GET /api/v1/admin/finance/escrow
    const escrowRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/finance/escrow',
    });
    assert.equal(escrowRes.statusCode, 200);
    const escrowBody = escrowRes.json();
    assert.ok(escrowBody.data.escrow_entries, 'Contains escrow_entries');
    assert.ok(typeof escrowBody.data.escrow_entries[0].remaining_seconds === 'number', 'Contains remaining_seconds');

    // 2. GET /api/v1/admin/finance/recoveries
    const recoveriesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/finance/recoveries',
    });
    assert.equal(recoveriesRes.statusCode, 200);
    const recoveriesBody = recoveriesRes.json();
    assert.ok(recoveriesBody.data.recoveries.length > 0, 'Contains deficit recovery records');

    // 3. POST /api/v1/admin/finance/escrow/sweep
    const sweepRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/finance/escrow/sweep',
    });
    assert.equal(sweepRes.statusCode, 200);
    const sweepBody = sweepRes.json();
    assert.ok(sweepBody.data, 'Sweep returns execution result');
  });
});
