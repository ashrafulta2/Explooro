/**
 * disputeArbitration.test.js — Automated test suite for Prompt 7.3:
 * Dispute Arbitration (Three-Way) (DFD Subsystem 9.0).
 *
 * Covers:
 * 1. Acceptance 1: All three parties see only what they are permitted to see; internal notes never leak.
 * 2. Acceptance 2: A resolution above the threshold (5,000 BDT), submitted by a moderator, requires Super Admin approval (Maker-Checker HIGH tier).
 * 3. Acceptance 3: Every resolution produces balanced double-entry ledger entries (Full Refund, Partial Refund, Split Liability, Rejected).
 * 4. Acceptance 4: SLA breaches escalate automatically.
 * 5. Precedent case search for arbitration consistency.
 * 6. Fastify HTTP routes for Dispute Arbitration API.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import * as disputeService from '../src/services/dispute.service.js';
import disputeRoutes from '../src/routes/dispute.routes.js';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';

function createMockDb() {
  let nextDisputeId = 1;
  let nextMessageId = 1;
  let nextLedgerId = 1;
  let nextActionId = 1;

  const users = [
    { id: 1, ref: 'USR-SUPER1', full_name: 'Super Admin Kabir', email: 'admin@explooro.com', role: 'super_admin' },
    { id: 2, ref: 'USR-MOD1', full_name: 'Moderator Nabila', email: 'mod@explooro.com', role: 'moderator' },
    { id: 101, ref: 'USR-SUPP1', full_name: 'Supplier Aarong', email: 'aarong@explooro.com', role: 'supplier' },
    { id: 201, ref: 'USR-SALER1', full_name: 'Saler Jamila', email: 'jamila@explooro.com', role: 'saler' },
    { id: 301, ref: 'USR-CUST1', full_name: 'Customer Tanvir', email: 'tanvir@explooro.com', role: 'customer' },
    { id: 401, ref: 'USR-STRANGER', full_name: 'Stranger User', email: 'stranger@explooro.com', role: 'customer' },
  ];

  const wallets = [
    {
      id: 1,
      user_id: 1,
      available_balance: '1000000.00',
      pending_escrow_balance: '0.00',
      held_balance: '0.00',
      currency: 'BDT',
      version: 0,
    },
    {
      id: 10,
      user_id: 101,
      available_balance: '5000.00',
      pending_escrow_balance: '1800.00',
      held_balance: '0.00',
      currency: 'BDT',
      version: 0,
    },
    {
      id: 20,
      user_id: 201,
      available_balance: '2000.00',
      pending_escrow_balance: '200.00',
      held_balance: '0.00',
      currency: 'BDT',
      version: 0,
    },
    {
      id: 30,
      user_id: 301,
      available_balance: '500.00',
      pending_escrow_balance: '0.00',
      held_balance: '0.00',
      currency: 'BDT',
      version: 0,
    },
  ];

  const subOrders = [
    {
      id: 951,
      order_id: 6001,
      ref: 'SUB-951',
      supplier_id: 101,
      saler_id: 201,
      total_amount: '2000.00',
      saler_commission: '200.00',
      subtotal_base: '1800.00',
      status: 'DELIVERED',
    },
    {
      id: 952,
      order_id: 6002,
      ref: 'SUB-952',
      supplier_id: 101,
      saler_id: 201,
      total_amount: '8000.00',
      saler_commission: '800.00',
      subtotal_base: '7200.00',
      status: 'DELIVERED',
    },
  ];

  const orders = [
    { id: 6001, customer_id: 301, payment_method: 'BKASH' },
    { id: 6002, customer_id: 301, payment_method: 'BKASH' },
  ];

  const escrowEntries = [
    {
      id: 1,
      sub_order_id: 951,
      wallet_id: 10,
      beneficiary_role: 'SUPPLIER',
      amount: '1800.00',
      status: 'LOCKED',
      hold_until: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: 2,
      sub_order_id: 951,
      wallet_id: 20,
      beneficiary_role: 'SALER',
      amount: '200.00',
      status: 'LOCKED',
      hold_until: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: 3,
      sub_order_id: 952,
      wallet_id: 10,
      beneficiary_role: 'SUPPLIER',
      amount: '7200.00',
      status: 'LOCKED',
      hold_until: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: 4,
      sub_order_id: 952,
      wallet_id: 20,
      beneficiary_role: 'SALER',
      amount: '800.00',
      status: 'LOCKED',
      hold_until: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
    },
  ];

  const disputeThreads = [];
  const disputeMessages = [];
  const returnRequests = [];
  const pendingAdminActions = [];
  const ledgerTransactions = [];
  const trustScores = [
    { user_id: 101, score: 85, tier: 'VERIFIED_SUPPLIER', manual_adjustment: 0 },
    { user_id: 201, score: 80, tier: 'TOP_SALER', manual_adjustment: 0 },
    { user_id: 301, score: 90, tier: 'ELITE_PARTNER', manual_adjustment: 0 },
  ];
  const auditLogs = [];

  const mockDb = {
    query: async (text, params = []) => {
      const q = text.trim();

      // INSERT INTO dispute_threads
      if (q.startsWith('INSERT INTO dispute_threads')) {
        const row = {
          id: nextDisputeId++,
          ref: params[0],
          return_id: params[1],
          sub_order_id: params[2],
          customer_id: params[3],
          saler_id: params[4],
          supplier_id: params[5],
          disputed_amount: String(params[6]),
          reason: params[7],
          status: params[8],
          sla_due_at: params[9],
          escalated_at: params[10],
          escalation_reason: params[11],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        disputeThreads.push(row);
        return { rows: [row] };
      }

      // INSERT INTO dispute_messages
      if (q.startsWith('INSERT INTO dispute_messages')) {
        const row = {
          id: nextMessageId++,
          dispute_id: params[0],
          sender_id: params[1],
          sender_role: params[2],
          body: params[3],
          attachments_json: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4],
          is_internal_note: Boolean(params[5]),
          created_at: new Date().toISOString(),
        };
        disputeMessages.push(row);
        return { rows: [row] };
      }

      // INSERT INTO pending_admin_actions
      if (q.startsWith('INSERT INTO pending_admin_actions')) {
        const row = {
          id: nextActionId++,
          ref: params[0],
          action_key: params[1],
          risk_tier: params[2],
          actor_id: params[3],
          target_entity: params[4],
          target_id: params[5],
          payload_json: typeof params[6] === 'string' ? JSON.parse(params[6]) : params[6],
          status: params[7],
          expires_at: params[8],
          created_at: new Date().toISOString(),
        };
        pendingAdminActions.push(row);
        return { rows: [row] };
      }

      // INSERT INTO ledger_transactions
      if (q.startsWith('INSERT INTO ledger_transactions')) {
        const row = {
          id: nextLedgerId++,
          txn_group_id: params[0],
          wallet_id: params[1],
          entry_type: params[2],
          amount: String(params[3]),
          balance_bucket: params[4],
          category: params[5],
          reference_type: params[6],
          reference_id: params[7],
          idempotency_key: params[8],
          memo: params[9],
          created_by: params[10],
          created_at: new Date().toISOString(),
        };
        ledgerTransactions.push(row);
        return { rows: [row] };
      }

      // SELECT sub_orders JOIN orders
      if (q.includes('FROM sub_orders s') && q.includes('JOIN orders o')) {
        const subId = params[0];
        const sub = subOrders.find((s) => s.id === subId);
        if (!sub) return { rows: [] };
        const order = orders.find((o) => o.id === sub.order_id);
        return {
          rows: [
            {
              ...sub,
              customer_id: order.customer_id,
              payment_method: order.payment_method,
            },
          ],
        };
      }

      // SELECT FROM dispute_threads WHERE id = $1
      if (q.includes('FROM dispute_threads d') && q.includes('JOIN users c') && q.includes('WHERE d.id = $1')) {
        const dId = params[0];
        const d = disputeThreads.find((item) => item.id === dId);
        if (!d) return { rows: [] };
        const c = users.find((u) => u.id === d.customer_id);
        const sl = users.find((u) => u.id === d.saler_id);
        const sp = users.find((u) => u.id === d.supplier_id);
        const so = subOrders.find((s) => s.id === d.sub_order_id);
        return {
          rows: [
            {
              ...d,
              customer_name: c?.full_name,
              customer_email: c?.email,
              customer_phone: '+8801711223344',
              saler_name: sl?.full_name,
              saler_email: sl?.email,
              supplier_name: sp?.full_name,
              supplier_email: sp?.email,
              sub_order_ref: so?.ref,
              sub_order_status: so?.status,
              return_ref: null,
            },
          ],
        };
      }

      // Simple SELECT FROM dispute_threads WHERE id = $1
      if (q.startsWith('SELECT') && q.includes('FROM dispute_threads') && q.includes('WHERE') && q.includes('id = $1')) {
        const dId = params[0];
        const d = disputeThreads.find((item) => item.id === dId);
        if (!d) return { rows: [] };
        const so = subOrders.find((s) => s.id === d.sub_order_id);
        return {
          rows: [
            {
              ...d,
              order_id: so?.order_id,
              saler_commission: so?.saler_commission,
              subtotal_base: so?.subtotal_base,
            },
          ],
        };
      }

      // SELECT dispute messages
      if (q.includes('FROM dispute_messages m') && q.includes('JOIN users u')) {
        const dId = params[0];
        let msgs = disputeMessages.filter((m) => m.dispute_id === dId);
        if (q.includes('is_internal_note = false')) {
          msgs = msgs.filter((m) => !m.is_internal_note);
        }
        return {
          rows: msgs.map((m) => {
            const u = users.find((usr) => usr.id === m.sender_id);
            return {
              ...m,
              sender_name: u ? u.full_name : 'User',
            };
          }),
        };
      }

      // SELECT FROM dispute_threads WHERE status IN ('OPEN', ...) AND sla_due_at < now()
      if (q.includes('FROM dispute_threads') && q.includes('sla_due_at < now()')) {
        const now = Date.now();
        const breached = disputeThreads.filter((d) => {
          if (!['OPEN', 'UNDER_ARBITRATION', 'AWAITING_CUSTOMER', 'AWAITING_SELLER'].includes(d.status)) return false;
          return d.sla_due_at && new Date(d.sla_due_at).getTime() < now;
        });
        return { rows: breached };
      }

      // SELECT precedents
      if (q.includes('FROM dispute_threads d') && q.includes("WHERE d.status = 'RESOLVED'")) {
        const resolved = disputeThreads.filter((d) => d.status === 'RESOLVED');
        return { rows: resolved };
      }

      // UPDATE dispute_threads
      if (q.startsWith('UPDATE dispute_threads')) {
        const dId = params[0] || params[params.length - 1];
        const d = disputeThreads.find((item) => item.id === dId);
        if (!d) return { rows: [] };

        if (q.includes("status = 'ESCALATED'")) {
          d.status = 'ESCALATED';
          d.escalated_at = new Date().toISOString();
          d.escalation_reason = params[1];
        } else if (q.includes("status = 'AWAITING_SUPER_ADMIN'")) {
          d.status = 'AWAITING_SUPER_ADMIN';
          d.pending_action_id = params[1];
          d.resolution_notes = params[2];
        } else if (q.includes("status = 'RESOLVED'")) {
          d.status = 'RESOLVED';
          d.outcome = params[1];
          d.outcome_split_json = typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2];
          d.resolution_notes = params[3];
          d.resolved_by = params[4];
          d.resolved_at = new Date().toISOString();
        } else if (q.includes('status = $2')) {
          d.status = params[1];
        }

        d.updated_at = new Date().toISOString();
        return { rows: [d] };
      }

      // SELECT wallets WHERE user_id = $1
      if (q.includes('FROM wallets') && q.includes('user_id = $1')) {
        const uId = params[0];
        let w = wallets.find((wal) => wal.user_id === uId);
        if (!w) {
          w = {
            id: wallets.length + 1,
            user_id: uId,
            available_balance: '0.00',
            pending_escrow_balance: '0.00',
            held_balance: '0.00',
            currency: 'BDT',
            version: 0,
          };
          wallets.push(w);
        }
        return { rows: [w] };
      }

      // SELECT wallets WHERE id = ANY($1)
      if (q.includes('FROM wallets') && (q.includes('id = ANY') || q.includes('id = ANY($1::bigint[])'))) {
        const ids = params[0];
        const rows = wallets.filter((w) => ids.includes(w.id));
        return { rows };
      }

      // UPDATE wallets
      if (q.startsWith('UPDATE wallets')) {
        const wId = params[0];
        const w = wallets.find((item) => item.id === wId);
        if (w) {
          w.available_balance = (parseFloat(w.available_balance) + parseFloat(params[1])).toFixed(2);
          w.pending_escrow_balance = (parseFloat(w.pending_escrow_balance) + parseFloat(params[2])).toFixed(2);
          w.held_balance = (parseFloat(w.held_balance) + parseFloat(params[3])).toFixed(2);
          w.version = (w.version || 0) + 1;
        }
        return { rows: [w] };
      }

      // SELECT escrow_entries WHERE sub_order_id = $1
      if (q.includes('FROM escrow_entries WHERE sub_order_id = $1')) {
        const subId = params[0];
        const rows = escrowEntries.filter((e) => e.sub_order_id === subId);
        return { rows };
      }

      // UPDATE escrow_entries
      if (q.startsWith('UPDATE escrow_entries')) {
        const subId = params[0];
        const rows = escrowEntries.filter((e) => e.sub_order_id === subId);
        for (const r of rows) {
          if (q.includes("status = 'FROZEN'")) {
            r.status = 'FROZEN';
            r.freeze_reason = params[1];
          } else if (q.includes("status = 'CLAWED_BACK'")) {
            r.status = 'CLAWED_BACK';
          } else if (q.includes("status = 'LOCKED'")) {
            r.status = 'LOCKED';
            r.freeze_reason = null;
          }
        }
        return { rows };
      }

      // trust_scores
      if (q.includes('FROM trust_scores WHERE user_id = $1')) {
        const uId = params[0];
        const t = trustScores.find((ts) => ts.user_id === uId);
        return { rows: t ? [t] : [] };
      }

      if (q.startsWith('INSERT INTO trust_scores')) {
        const uId = params[0];
        let t = trustScores.find((ts) => ts.user_id === uId);
        if (!t) {
          t = { user_id: uId, score: params[1], manual_adjustment: params[8] };
          trustScores.push(t);
        } else {
          t.score = params[1];
          t.manual_adjustment = params[8];
        }
        return { rows: [t] };
      }

      // audit_logs
      if (q.startsWith('INSERT INTO audit_logs')) {
        const log = { id: auditLogs.length + 1, action: params[1] };
        auditLogs.push(log);
        return { rows: [log] };
      }

      return { rows: [] };
    },
  };

  const poolMock = {
    ...mockDb,
    async connect() {
      return {
        ...mockDb,
        release() {},
      };
    },
  };

  return {
    mockDb: poolMock,
    state: {
      users,
      wallets,
      subOrders,
      disputeThreads,
      disputeMessages,
      pendingAdminActions,
      ledgerTransactions,
      escrowEntries,
      trustScores,
      auditLogs,
    },
  };
}

describe('Prompt 7.3 — Dispute Arbitration (Three-Way)', () => {
  test('Acceptance 1: All three parties see only what they are permitted to see; internal notes never leak', async () => {
    const { mockDb, state } = createMockDb();

    // 1. Create a 3-way dispute
    const dispute = await disputeService.createDispute(mockDb, null, {
      subOrderId: 951,
      customerId: 301,
      disputedAmount: 2000,
      reason: 'DEFECTIVE_PRODUCT',
      initialMessage: 'Fabric is torn at shoulder seams.',
      attachments: ['https://cdn.explooro.com/evidence1.jpg'],
    });

    assert.equal(dispute.status, 'OPEN');
    assert.equal(parseFloat(dispute.disputed_amount), 2000);

    // 2. Customer posts a reply
    await disputeService.postMessage(mockDb, {
      disputeId: dispute.id,
      senderId: 301,
      senderRole: 'CUSTOMER',
      body: 'Here is an extra photo of the torn seam.',
      attachments: ['https://cdn.explooro.com/evidence2.jpg'],
    });

    // 3. Supplier posts a reply
    await disputeService.postMessage(mockDb, {
      disputeId: dispute.id,
      senderId: 101,
      senderRole: 'SUPPLIER',
      body: 'Item passed QC before dispatch. Could be shipping damage.',
    });

    // 4. Saler posts a reply
    await disputeService.postMessage(mockDb, {
      disputeId: dispute.id,
      senderId: 201,
      senderRole: 'SALER',
      body: 'Buyer contacted us directly on day 2.',
    });

    // 5. Moderator posts an INTERNAL NOTE (private)
    await disputeService.postMessage(mockDb, {
      disputeId: dispute.id,
      senderId: 2,
      senderRole: 'MODERATOR',
      body: 'INTERNAL NOTE: Supplier has 4 other open claims on this batch. Supplier liability likely.',
      isInternalNote: true,
    });

    // Non-staff posting internal note is blocked
    await assert.rejects(
      async () => {
        await disputeService.postMessage(mockDb, {
          disputeId: dispute.id,
          senderId: 301,
          senderRole: 'CUSTOMER',
          body: 'Trying to sneak an internal note',
          isInternalNote: true,
        });
      },
      /FORBIDDEN_INTERNAL_NOTE/
    );

    // Unrelated user viewing dispute is blocked
    await assert.rejects(
      async () => {
        await disputeService.getDisputeById(mockDb, dispute.id, {
          requestingUser: { id: 401, role: 'customer' },
        });
      },
      /UNAUTHORIZED_DISPUTE_ACCESS/
    );

    // Customer views dispute -> internal note MUST NOT be present
    const customerView = await disputeService.getDisputeById(mockDb, dispute.id, {
      requestingUser: { id: 301, role: 'customer' },
    });
    assert.equal(customerView.messages.some((m) => m.is_internal_note), false, 'Customer must not see internal notes');
    assert.equal(customerView.messages.length, 4); // Initial + Cust + Supp + Saler

    // Supplier views dispute -> internal note MUST NOT be present
    const supplierView = await disputeService.getDisputeById(mockDb, dispute.id, {
      requestingUser: { id: 101, role: 'supplier' },
    });
    assert.equal(supplierView.messages.some((m) => m.is_internal_note), false, 'Supplier must not see internal notes');

    // Moderator views dispute -> internal note MUST be present
    const moderatorView = await disputeService.getDisputeById(mockDb, dispute.id, {
      requestingUser: { id: 2, role: 'moderator' },
    });
    assert.equal(moderatorView.messages.some((m) => m.is_internal_note), true, 'Moderator must see internal notes');
    assert.equal(moderatorView.messages.length, 5);
  });

  test('Acceptance 2: A resolution above the threshold (5,000 BDT), submitted by a moderator, requires Super Admin approval', async () => {
    const { mockDb, state } = createMockDb();

    // Create a high-value dispute (8,000 BDT > 5,000 threshold)
    const highDispute = await disputeService.createDispute(mockDb, null, {
      subOrderId: 952,
      customerId: 301,
      disputedAmount: 8000,
      reason: 'DAMAGED_HIGH_VALUE',
      initialMessage: 'High value electronics parcel water damaged.',
    });

    // Moderator attempts arbitration
    const modResult = await disputeService.arbitrateDispute(mockDb, null, {
      disputeId: highDispute.id,
      outcome: 'FULL_REFUND',
      arbitratorId: 2,
      arbitratorRole: 'moderator',
      resolutionNotes: 'Water damage confirmed.',
    });

    // Maker-Checker should intercept
    assert.equal(modResult.isPendingMakerChecker, true);
    assert.ok(modResult.pendingAction.id > 0);
    assert.equal(modResult.pendingAction.action_key, 'orders.dispute.arbitrate');
    assert.equal(state.pendingAdminActions.length, 1);
    assert.equal(state.ledgerTransactions.length, 0, 'No money should move until maker-checker approved');

    // Super Admin executes arbitration directly
    const adminResult = await disputeService.arbitrateDispute(mockDb, null, {
      disputeId: highDispute.id,
      outcome: 'FULL_REFUND',
      arbitratorId: 1,
      arbitratorRole: 'super_admin',
      resolutionNotes: 'Super admin approved full refund.',
    });

    assert.equal(adminResult.success, true);
    assert.equal(adminResult.dispute.status, 'RESOLVED');
    assert.equal(state.ledgerTransactions.length >= 2, true, 'Ledger transactions executed');
  });

  test('Acceptance 3: Every resolution produces balanced double-entry ledger entries', async () => {
    const { mockDb, state } = createMockDb();

    // Dispute 1: Full Refund (2,000 BDT)
    const d1 = await disputeService.createDispute(mockDb, null, {
      subOrderId: 951,
      customerId: 301,
      disputedAmount: 2000,
      reason: 'WRONG_ITEM',
    });

    await disputeService.arbitrateDispute(mockDb, null, {
      disputeId: d1.id,
      outcome: 'FULL_REFUND',
      arbitratorId: 1,
      arbitratorRole: 'super_admin',
    });

    // Verify balance invariant: sum of credits === sum of debits
    let totalCredits = 0;
    let totalDebits = 0;
    for (const txn of state.ledgerTransactions) {
      if (txn.entry_type === 'CREDIT') totalCredits += parseFloat(txn.amount);
      if (txn.entry_type === 'DEBIT') totalDebits += parseFloat(txn.amount);
    }
    assert.equal(totalCredits, 2000.0);
    assert.equal(totalDebits, 2000.0);
    assert.equal(totalCredits, totalDebits, 'Ledger transactions must balance');

    // Customer wallet received 2000 credit
    const custWallet = state.wallets.find((w) => w.user_id === 301);
    assert.equal(custWallet.available_balance, '2500.00'); // initial 500 + 2000

    // Dispute 2: Split Liability (Partial refund 1000 to buyer, 800 from supp, 200 from saler)
    const d2 = await disputeService.createDispute(mockDb, null, {
      subOrderId: 951,
      customerId: 301,
      disputedAmount: 1000,
      reason: 'DEFECTIVE',
    });

    await disputeService.arbitrateDispute(mockDb, null, {
      disputeId: d2.id,
      outcome: 'SPLIT_LIABILITY',
      outcomeSplit: {
        buyer_refund: 1000,
        supplier_clawback: 800,
        saler_clawback: 200,
      },
      arbitratorId: 1,
      arbitratorRole: 'super_admin',
    });

    // Check all ledger transactions balance
    let allCredits = 0;
    let allDebits = 0;
    for (const txn of state.ledgerTransactions) {
      if (txn.entry_type === 'CREDIT') allCredits += parseFloat(txn.amount);
      if (txn.entry_type === 'DEBIT') allDebits += parseFloat(txn.amount);
    }
    assert.equal(allCredits, 3000.0);
    assert.equal(allDebits, 3000.0);
  });

  test('Acceptance 4: SLA breaches escalate automatically', async () => {
    const { mockDb, state } = createMockDb();

    // Create an open dispute with expired SLA in the past
    const expiredDispute = await disputeService.createDispute(mockDb, null, {
      subOrderId: 951,
      customerId: 301,
      disputedAmount: 1500,
      reason: 'UNRESPONSIVE_SELLER',
    });

    // Manually set SLA due in the past
    const thread = state.disputeThreads.find((d) => d.id === expiredDispute.id);
    thread.sla_due_at = new Date(Date.now() - 3600 * 1000).toISOString();

    // Run SLA sweep
    const sweepResult = await disputeService.checkAndEscalateBreachedSlas(mockDb, null);

    assert.equal(sweepResult.escalated_count, 1);
    assert.equal(thread.status, 'ESCALATED');
    assert.ok(thread.escalation_reason.includes('SLA_BREACH'));
  });

  test('Acceptance 5: Precedent search returns relevant historical dispute resolutions', async () => {
    const { mockDb, state } = createMockDb();

    // Insert a resolved precedent
    state.disputeThreads.push({
      id: 99,
      ref: 'DSP-PRECEDENT1',
      reason: 'FABRIC_TEAR',
      disputed_amount: '2000.00',
      outcome: 'FULL_REFUND',
      outcome_split_json: { buyer_refund: 2000, supplier_clawback: 2000 },
      resolution_notes: 'Manufacturer fabric defect confirmed.',
      status: 'RESOLVED',
      resolved_at: new Date().toISOString(),
    });

    const precedents = await disputeService.searchPrecedents(mockDb, { reason: 'FABRIC_TEAR' });
    assert.equal(precedents.length, 1);
    assert.equal(precedents[0].ref, 'DSP-PRECEDENT1');
    assert.equal(precedents[0].outcome, 'FULL_REFUND');
  });

  test('Fastify HTTP Routes for Dispute Arbitration API', async () => {
    const { mockDb } = createMockDb();

    const app = Fastify();
    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);

    // Mock auth & permissions
    app.decorate('authenticate', async (req) => {
      const role = req.headers['x-role'] || 'customer';
      const id = parseInt(req.headers['x-user-id'] || '301', 10);
      req.user = { id, role, full_name: 'Test User' };
    });

    app.decorate('requirePermission', () => async () => {});
    app.decorate('requireRestriction', () => async () => {});
    app.decorate('requireModule', () => async () => {});
    app.decorate('db', mockDb);
    app.decorate('cache', { get: async () => null, set: async () => 'OK', del: async () => 1 });

    await app.register(disputeRoutes, { prefix: '/api/v1' });

    // 1. Create dispute via POST /api/v1/disputes
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/disputes',
      headers: { 'x-user-id': '301', 'x-role': 'customer' },
      payload: {
        sub_order_id: 951,
        disputed_amount: 1500,
        reason: 'DEFECTIVE_COLOR',
        initial_message: 'Color is faded.',
      },
    });
    assert.equal(createRes.statusCode, 201);
    const createdData = createRes.json().data;
    assert.equal(createdData.reason, 'DEFECTIVE_COLOR');

    // 2. Post message via POST /api/v1/disputes/:id/messages
    const msgRes = await app.inject({
      method: 'POST',
      url: `/api/v1/disputes/${createdData.id}/messages`,
      headers: { 'x-user-id': '301', 'x-role': 'customer' },
      payload: {
        body: 'Faded color photo uploaded.',
      },
    });
    assert.equal(msgRes.statusCode, 201);

    // 3. Get timeline via GET /api/v1/disputes/:id/timeline
    const timelineRes = await app.inject({
      method: 'GET',
      url: `/api/v1/disputes/${createdData.id}/timeline`,
      headers: { 'x-user-id': '301', 'x-role': 'customer' },
    });
    assert.equal(timelineRes.statusCode, 200);
    assert.ok(timelineRes.json().data.timeline.length >= 2);

    // 4. Arbitrate via POST /api/v1/disputes/:id/arbitrate
    const arbitrateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/disputes/${createdData.id}/arbitrate`,
      headers: { 'x-user-id': '1', 'x-role': 'super_admin' },
      payload: {
        outcome: 'FULL_REFUND',
        resolution_notes: 'Faded color claim approved.',
      },
    });
    assert.equal(arbitrateRes.statusCode, 200);
    assert.equal(arbitrateRes.json().data.dispute.status, 'RESOLVED');
  });
});
