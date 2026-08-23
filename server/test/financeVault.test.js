/**
 * financeVault.test.js — Automated test suite for Prompt 6.1:
 * Double-Entry Ledger & Escrow Engine.
 *
 * Acceptance Criteria:
 * 1. Migration 012_finance.sql defines all required tables (wallets, ledger_transactions, escrow_entries,
 *    payout_requests, cod_reconciliation, b2b_escrow_milestones) with append-only trigger and partition support.
 * 2. Attempting to write a single-sided or unbalanced ledger entry fails with UNBALANCED_TRANSACTION_GROUP.
 * 3. Calling releaseEscrow twice for the same sub-order credits exactly once (strict idempotency).
 * 4. High concurrency test: 50 simultaneous credits to one wallet ends with exact correct balance (row-locking).
 * 5. Clawback automation correctly reverses pending/released escrow, zeroes saler commission, and refunds buyer.
 * 6. After a full order lifecycle, the integrity check endpoint reports zero drift across all wallets.
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
import financeRoutes from '../src/routes/finance.routes.js';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Creates an in-memory SQL mock engine simulating PostgreSQL transaction client,
 * row locking, wallets, ledger_transactions, and escrow_entries.
 */
function createMockFinanceDb() {
  let nextWalletId = 1;
  let nextLedgerId = 1;
  let nextEscrowId = 1;

  const users = [
    { id: 1, ref: 'USR-SUPER1', full_name: 'Dev Super Admin', role: 'super_admin' },
    { id: 2, ref: 'USR-ADMIN1', full_name: 'Dev Admin', role: 'admin' },
    { id: 10, ref: 'USR-CUST1', full_name: 'Customer Rahim', role: 'customer' },
    { id: 101, ref: 'USR-SUPP1', full_name: 'Supplier Aarong', role: 'supplier' },
    { id: 201, ref: 'USR-SALER1', full_name: 'Saler Jamila', role: 'saler' },
  ];

  const wallets = [];
  const ledgerTransactions = [];
  const escrowEntries = [];
  const subOrders = [
    {
      id: 501,
      order_id: 1001,
      supplier_id: 101,
      saler_id: 201,
      subtotal_base: '1000.00',
      wholesale_margin: '200.00',
      net_retail_margin: '300.00',
      saler_commission: '120.00',
      platform_margin: '180.00',
      shipping_amount: '60.00',
      total_amount: '1560.00',
      status: 'PLACED',
    },
  ];

  const orders = [
    {
      id: 1001,
      customer_id: 10,
      total_amount: '1560.00',
    },
  ];

  // Helper to ensure wallet exists
  function getOrCreateWalletSync(userId) {
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
    return { ...w };
  }

  // Mutex for concurrency simulation
  let lockQueue = Promise.resolve();

  const clientMock = {
    async query(sql, params = []) {
      const q = sql.trim().replace(/\s+/g, ' ');

      // BEGIN / COMMIT / ROLLBACK
      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        return { rows: [] };
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

      // SELECT wallets WHERE id = ANY($1::bigint[]) (FOR UPDATE locking)
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

      // SELECT users super_admin
      if (q.includes('roles r ON r.id = ur.role_id') && q.includes("r.key = 'super_admin'")) {
        return { rows: [{ id: 1 }] };
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

      // Integrity check queries:
      // 1. Wallets summary with ledger sum
      if (q.includes('WITH ledger_summary AS') || (q.includes('FROM wallets w') && q.includes('total_ledger'))) {
        const walletRows = wallets.map((w) => {
          const wTxns = ledgerTransactions.filter((lt) => lt.wallet_id === w.id);
          const totalLedger = wTxns.reduce(
            (acc, lt) => acc + (lt.entry_type === 'CREDIT' ? parseFloat(lt.amount) : -parseFloat(lt.amount)),
            0
          );
          const availLedger = wTxns
            .filter((lt) => lt.balance_bucket === 'AVAILABLE')
            .reduce((acc, lt) => acc + (lt.entry_type === 'CREDIT' ? parseFloat(lt.amount) : -parseFloat(lt.amount)), 0);
          const escrowLedger = wTxns
            .filter((lt) => lt.balance_bucket === 'ESCROW')
            .reduce((acc, lt) => acc + (lt.entry_type === 'CREDIT' ? parseFloat(lt.amount) : -parseFloat(lt.amount)), 0);
          const heldLedger = wTxns
            .filter((lt) => lt.balance_bucket === 'HELD')
            .reduce((acc, lt) => acc + (lt.entry_type === 'CREDIT' ? parseFloat(lt.amount) : -parseFloat(lt.amount)), 0);

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
            available_ledger: availLedger.toFixed(2),
            escrow_ledger: escrowLedger.toFixed(2),
            held_ledger: heldLedger.toFixed(2),
            total_drift: (totalBal - totalLedger).toFixed(2),
            available_drift: (availBal - availLedger).toFixed(2),
            escrow_drift: (escrowBal - escrowLedger).toFixed(2),
            held_drift: (heldBal - heldLedger).toFixed(2),
          };
        });
        return { rows: walletRows };
      }

      // 2. Unbalanced groups query
      if (q.includes('FROM ledger_transactions GROUP BY txn_group_id HAVING')) {
        const groups = new Map();
        for (const lt of ledgerTransactions) {
          const sum = groups.get(lt.txn_group_id) || 0;
          groups.set(lt.txn_group_id, sum + (lt.entry_type === 'CREDIT' ? parseFloat(lt.amount) : -parseFloat(lt.amount)));
        }
        const unbalanced = [];
        for (const [gid, sum] of groups.entries()) {
          if (Math.abs(sum) > 0.0001) {
            unbalanced.push({ txn_group_id: gid, group_sum: sum.toFixed(2) });
          }
        }
        return { rows: unbalanced };
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
      return { wallets, ledgerTransactions, escrowEntries };
    },
    getOrCreateWalletSync,
  };

  return poolMock;
}

describe('Prompt 6.1 — Double-Entry Ledger & Escrow Engine', () => {
  let db;

  before(() => {
    db = createMockFinanceDb();
  });

  test('Acceptance 1: Migration 012_finance.sql defines all required schema tables and constraints', () => {
    const migrationPath = path.resolve(__dirname, '../src/db/migrations/012_finance.sql');
    assert.ok(fs.existsSync(migrationPath), '012_finance.sql must exist in migrations directory');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS wallets'), 'wallets table defined');
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS ledger_transactions'), 'ledger_transactions table defined');
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS escrow_entries'), 'escrow_entries table defined');
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS payout_requests'), 'payout_requests table defined');
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS payment_transactions'), 'payment_transactions table defined');
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS cod_reconciliation'), 'cod_reconciliation table defined');
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS b2b_escrow_milestones'), 'b2b_escrow_milestones table defined');
    assert.ok(sql.includes('PARTITION BY RANGE (created_at)'), 'ledger_transactions is range partitioned');
    assert.ok(sql.includes('trg_ledger_block_update'), 'append-only UPDATE block trigger defined');
    assert.ok(sql.includes('trg_ledger_block_delete'), 'append-only DELETE block trigger defined');
  });

  test('Acceptance 2: Attempting to write a single-sided or unbalanced ledger entry throws UNBALANCED_TRANSACTION_GROUP', async () => {
    const w1 = await walletRepo.getOrCreateWallet(db, 10);
    const w2 = await walletRepo.getOrCreateWallet(db, 101);

    // Test A: Single-sided entry (less than 2 entries)
    await assert.rejects(
      async () => {
        await ledgerService.recordTransactionGroup(db, {
          entries: [
            { walletId: w1.id, entryType: 'CREDIT', amount: '500.00', balanceBucket: 'AVAILABLE' },
          ],
        });
      },
      /DOUBLE_ENTRY_VIOLATION/
    );

    // Test B: Unbalanced entries (Debits 500 != Credits 400)
    await assert.rejects(
      async () => {
        await ledgerService.recordTransactionGroup(db, {
          entries: [
            { walletId: w1.id, entryType: 'DEBIT', amount: '500.00', balanceBucket: 'AVAILABLE' },
            { walletId: w2.id, entryType: 'CREDIT', amount: '400.00', balanceBucket: 'AVAILABLE' },
          ],
        });
      },
      /UNBALANCED_TRANSACTION_GROUP/
    );
  });

  test('Acceptance 3: Balanced double-entry transfers mutate wallet balances with zero drift', async () => {
    const w1 = await walletRepo.getOrCreateWallet(db, 10); // Customer Rahim
    const w2 = await walletRepo.getOrCreateWallet(db, 101); // Supplier Aarong

    const initW1 = parseFloat(w1.available_balance);
    const initW2 = parseFloat(w2.available_balance);

    const result = await ledgerService.recordTransactionGroup(db, {
      entries: [
        { walletId: w1.id, entryType: 'DEBIT', amount: '250.00', balanceBucket: 'AVAILABLE', category: 'ADJUSTMENT' },
        { walletId: w2.id, entryType: 'CREDIT', amount: '250.00', balanceBucket: 'AVAILABLE', category: 'SUPPLIER_PAYMENT' },
      ],
      memo: 'Direct balanced transfer',
    });

    assert.ok(result.txnGroupId, 'Must return txnGroupId');
    assert.equal(result.entries.length, 2, 'Must insert exactly 2 ledger entries');

    const updatedW1 = await walletRepo.getWalletById(db, w1.id);
    const updatedW2 = await walletRepo.getWalletById(db, w2.id);

    assert.equal(parseFloat(updatedW1.available_balance), initW1 - 250.00);
    assert.equal(parseFloat(updatedW2.available_balance), initW2 + 250.00);
  });

  test('Acceptance 4: Deposit to escrow locks funds into pending_escrow_balance across supplier, saler, and platform', async () => {
    // Sub-order 501: subtotal 1000 + margin 200 + shipping 60 = supplier 1260, saler 120, platform 180 (total 1560)
    const depositResult = await vaultService.depositToEscrow(db, {
      subOrderId: 501,
      holdDays: 7,
    });

    assert.equal(depositResult.success, true);
    assert.equal(depositResult.totalDeposited, '1560.00');
    assert.equal(depositResult.escrowEntries.length, 3, 'Must create 3 escrow entries: Supplier, Saler, Platform');

    const supplierWallet = await walletRepo.getWalletByUserId(db, 101);
    const salerWallet = await walletRepo.getWalletByUserId(db, 201);
    const platformWallet = await walletRepo.getWalletByUserId(db, 1);

    assert.equal(supplierWallet.pending_escrow_balance, '1260.00');
    assert.equal(salerWallet.pending_escrow_balance, '120.00');
    assert.equal(platformWallet.pending_escrow_balance, '180.00');
  });

  test('Acceptance 5: Calling releaseEscrow moves pending → available, credits lifetime_earned, and calling twice is idempotent', async () => {
    const supplierWalletBefore = await walletRepo.getWalletByUserId(db, 101);
    const salerWalletBefore = await walletRepo.getWalletByUserId(db, 201);

    const supAvailBefore = parseFloat(supplierWalletBefore.available_balance);
    const salerAvailBefore = parseFloat(salerWalletBefore.available_balance);

    // 1st Release call
    const releaseResult1 = await vaultService.releaseEscrow(db, {
      subOrderId: 501,
      releasedBy: 1,
    });

    assert.equal(releaseResult1.success, true);
    assert.equal(releaseResult1.releasedCount, 3);

    const supplierWalletAfter = await walletRepo.getWalletByUserId(db, 101);
    const salerWalletAfter = await walletRepo.getWalletByUserId(db, 201);

    assert.equal(supplierWalletAfter.pending_escrow_balance, '0.00');
    assert.equal(parseFloat(supplierWalletAfter.available_balance), supAvailBefore + 1260.00);
    assert.equal(salerWalletAfter.pending_escrow_balance, '0.00');
    assert.equal(parseFloat(salerWalletAfter.available_balance), salerAvailBefore + 120.00);

    // 2nd Release call — STRICT IDEMPOTENCY CHECK: MUST NOT CREDIT AGAIN!
    const releaseResult2 = await vaultService.releaseEscrow(db, {
      subOrderId: 501,
      releasedBy: 1,
    });

    assert.equal(releaseResult2.alreadyReleased, true, 'Second release call returns alreadyReleased: true');

    const supplierWalletRecheck = await walletRepo.getWalletByUserId(db, 101);
    const salerWalletRecheck = await walletRepo.getWalletByUserId(db, 201);

    assert.equal(supplierWalletRecheck.available_balance, supplierWalletAfter.available_balance, 'Balance must NOT change on replay');
    assert.equal(salerWalletRecheck.available_balance, salerWalletAfter.available_balance, 'Saler balance must NOT change on replay');
  });

  test('Acceptance 6: Clawback reverses released funds, zeroes saler commission, and refunds buyer', async () => {
    const custWalletBefore = await walletRepo.getWalletByUserId(db, 10);
    const supplierWalletBefore = await walletRepo.getWalletByUserId(db, 101);
    const salerWalletBefore = await walletRepo.getWalletByUserId(db, 201);

    const custAvailBefore = parseFloat(custWalletBefore.available_balance);
    const supAvailBefore = parseFloat(supplierWalletBefore.available_balance);
    const salerAvailBefore = parseFloat(salerWalletBefore.available_balance);

    const clawbackResult = await vaultService.executeClawback(db, {
      subOrderId: 501,
      reason: 'Customer returned defective merchandise',
      executedBy: 1,
    });

    assert.equal(clawbackResult.success, true);
    assert.equal(clawbackResult.clawedBackAmount, '1560.00');

    const custWalletAfter = await walletRepo.getWalletByUserId(db, 10);
    const supplierWalletAfter = await walletRepo.getWalletByUserId(db, 101);
    const salerWalletAfter = await walletRepo.getWalletByUserId(db, 201);

    // Buyer received refund (+1560.00)
    assert.equal(parseFloat(custWalletAfter.available_balance), custAvailBefore + 1560.00);
    // Supplier and Saler reversed (-1260.00 and -120.00)
    assert.equal(parseFloat(supplierWalletAfter.available_balance), supAvailBefore - 1260.00);
    assert.equal(parseFloat(salerWalletAfter.available_balance), salerAvailBefore - 120.00);
  });

  test('Acceptance 7: Full Concurrency Test — 50 simultaneous credit operations end with exact 100.00% balance accuracy', async () => {
    // Create new test user & wallet for concurrency
    const testUserWallet = await walletRepo.getOrCreateWallet(db, 9999);
    const fundingWallet = await walletRepo.getOrCreateWallet(db, 1);

    const initialBalance = parseFloat(testUserWallet.available_balance);

    // Run 50 concurrent transactions of ৳100.00 each
    const ops = [];
    for (let i = 0; i < 50; i++) {
      ops.push(
        ledgerService.recordTransactionGroup(db, {
          entries: [
            { walletId: fundingWallet.id, entryType: 'DEBIT', amount: '100.00', balanceBucket: 'AVAILABLE', category: 'ADJUSTMENT' },
            { walletId: testUserWallet.id, entryType: 'CREDIT', amount: '100.00', balanceBucket: 'AVAILABLE', category: 'SALE_COMMISSION' },
          ],
          memo: `Concurrent credit ${i + 1}`,
        })
      );
    }

    await Promise.all(ops);

    const finalWallet = await walletRepo.getWalletById(db, testUserWallet.id);
    const expected = (initialBalance + 50 * 100.0).toFixed(2);

    assert.equal(finalWallet.available_balance, expected, `Final balance must be exactly ৳${expected} after 50 concurrent credits`);
  });

  test('Acceptance 8: Integrity check endpoint GET /api/v1/admin/finance/integrity reports zero drift across all wallets', async () => {
    const report = await vaultService.getIntegrityReport(db);

    assert.equal(report.status, 'HEALTHY', 'Status must be HEALTHY');
    assert.equal(report.drift_count, 0, 'Must have zero drift');
    assert.equal(report.ledger_unbalanced_groups_count, 0, 'All ledger transaction groups must sum to zero');
    assert.ok(report.wallets_checked >= 4, 'Must have checked all active wallets');
  });

  test('Acceptance 9: Fastify HTTP route GET /api/v1/admin/finance/integrity works via Fastify inject', async () => {
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 1, role: 'super_admin' };
    });
    app.decorate('requirePermission', () => async () => {});

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);
    await app.register(financeRoutes, { prefix: '/api/v1' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/finance/integrity',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.data, 'Response envelope contains data');
    assert.equal(body.data.status, 'HEALTHY');
    assert.equal(body.data.drift_count, 0);
  });
});
