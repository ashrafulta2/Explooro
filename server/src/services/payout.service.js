/**
 * payout.service.js — Withdrawal Disbursement Engine with Maker-Checker Authorization (Prompt 6.3).
 *
 * Implements:
 * 1. Immediate HELD balance locking on request, preventing double-spend attempts
 * 2. Maker-Checker flow: Moderator approvals create pending_admin_actions; Super Admin executes directly
 * 3. Dynamic balance re-validation at approval time
 * 4. B2C automated disbursement with atomic success ledger writes and automatic failure balance reversal
 * 5. Batch processing with per-item transaction isolation
 * 6. Automated risk analysis (first withdrawal, large amount, new account, name mismatch)
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import { defaultB2CClient } from '../integrations/payments/bkash-b2c.js';
import { writeAudit } from '../lib/audit.js';

/**
 * Generates a public payout ref (e.g. PAY-3M7V2WQ1).
 */
function generatePayoutRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `PAY-${code}`;
}

/**
 * Calculates risk flags for a withdrawal request.
 */
async function evaluatePayoutRisk(db, { userId, amount, accountName, client }) {
  const runner = client ?? db;
  const riskFlags = [];

  const amt = parseFloat(amount);
  if (amt >= 25000) {
    riskFlags.push({ code: 'HIGH_VALUE_DISBURSEMENT', message: 'Withdrawal amount exceeds ৳25,000 threshold' });
  }

  // Check user creation date & profile name
  const { rows: userRows } = await runner.query(
    `SELECT u.id, u.created_at, up.full_name
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );

  if (userRows.length > 0) {
    const user = userRows[0];
    const createdDaysAgo = (Date.now() - new Date(user.created_at).getTime()) / (24 * 3600 * 1000);
    if (createdDaysAgo < 7) {
      riskFlags.push({ code: 'NEW_ACCOUNT', message: 'User account was created less than 7 days ago' });
    }

    if (user.full_name && accountName) {
      const uName = user.full_name.toLowerCase().trim();
      const aName = accountName.toLowerCase().trim();
      if (!uName.includes(aName) && !aName.includes(uName)) {
        riskFlags.push({ code: 'NAME_MISMATCH', message: `Destination account name "${accountName}" does not match profile name "${user.full_name}"` });
      }
    }
  }

  // Check if this is user's first withdrawal
  const { rows: countRows } = await runner.query(
    `SELECT COUNT(*) AS count FROM payout_requests WHERE user_id = $1 AND status = 'COMPLETED'`,
    [userId]
  );
  if (parseInt(countRows[0]?.count ?? '0', 10) === 0) {
    riskFlags.push({ code: 'FIRST_WITHDRAWAL', message: 'First withdrawal request from this user account' });
  }

  return riskFlags;
}

/**
 * Initiates a payout request, immediately locking funds from available_balance -> held_balance.
 */
export async function requestPayout(db, {
  userId,
  method,
  accountNumber,
  accountName,
  bankName = null,
  amount,
  idempotencyKey = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      throw new Error('INVALID_AMOUNT: Withdrawal amount must be greater than 0.');
    }

    if (amt < 100.00) {
      throw new Error('MINIMUM_PAYOUT_THRESHOLD: Minimum withdrawal amount is ৳100.00.');
    }

    const validMethods = ['BKASH', 'NAGAD', 'ROCKET', 'BANK'];
    const normMethod = (method || '').toUpperCase();
    if (!validMethods.includes(normMethod)) {
      throw new Error(`INVALID_PAYOUT_METHOD: Payment method must be one of: ${validMethods.join(', ')}`);
    }

    if (!accountNumber || String(accountNumber).trim().length < 6) {
      throw new Error('INVALID_ACCOUNT_NUMBER: A valid account number or phone is required.');
    }

    // 1. Check user restrictions (can_withdraw)
    const { rows: restRows } = await txClient.query(
      `SELECT can_withdraw, max_withdrawal_per_day
       FROM user_restrictions
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
      [userId]
    );
    if (restRows.length > 0) {
      const r = restRows[0];
      if (r.can_withdraw === 'BLOCK') {
        throw new Error('USER_RESTRICTED: Your account is currently restricted from requesting withdrawals.');
      }
      if (r.max_withdrawal_per_day && amt > parseFloat(r.max_withdrawal_per_day)) {
        throw new Error(`WITHDRAWAL_LIMIT_EXCEEDED: Maximum withdrawal allowed per day is ৳${r.max_withdrawal_per_day}.`);
      }
    }

    // 2. Lock wallet with FOR UPDATE
    const wallet = await walletRepo.getOrCreateWallet(db, userId, { client: txClient });
    const lockedWallet = await walletRepo.getWalletByIdForUpdate(txClient, wallet.id);

    const availablePaisa = Math.round(parseFloat(lockedWallet.available_balance) * 100);
    const requestedPaisa = Math.round(amt * 100);

    if (availablePaisa < requestedPaisa) {
      throw new Error(
        `INSUFFICIENT_AVAILABLE_BALANCE: Available balance (৳${(availablePaisa / 100).toFixed(2)}) is less than requested withdrawal (৳${amt.toFixed(2)}).`
      );
    }

    // 3. Evaluate risk flags
    const riskFlags = await evaluatePayoutRisk(db, {
      userId,
      amount: amt,
      accountName,
      client: txClient,
    });

    const ref = generatePayoutRef();
    const feeAmount = '0.00';
    const netAmount = amt.toFixed(2);

    // 4. Create payout_requests record
    const { rows: payoutRows } = await txClient.query(
      `INSERT INTO payout_requests (
         ref, wallet_id, user_id, method, account_number, account_name, bank_name,
         amount, fee_amount, net_amount, status, risk_flags_json, idempotency_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric(14,2), $9::numeric(14,2), $10::numeric(14,2), 'REQUESTED', $11, $12)
       RETURNING id, ref, wallet_id, user_id, method, account_name, amount, fee_amount, net_amount, status, risk_flags_json, created_at`,
      [
        ref,
        lockedWallet.id,
        userId,
        normMethod,
        String(accountNumber).trim(),
        accountName || '',
        bankName || null,
        amt.toFixed(2),
        feeAmount,
        netAmount,
        JSON.stringify(riskFlags),
        idempotencyKey || null,
      ]
    );
    const createdPayout = payoutRows[0];

    // 5. Lock funds: Move from AVAILABLE bucket -> HELD bucket via balanced double-entry
    // DEBIT: AVAILABLE bucket (reduces available_balance)
    // CREDIT: HELD bucket (increases held_balance)
    const txnGroupId = randomUUID();
    const ledgerEntries = [
      {
        walletId: lockedWallet.id,
        entryType: 'DEBIT',
        amount: amt.toFixed(2),
        balanceBucket: 'AVAILABLE',
        category: 'PAYOUT',
        referenceType: 'PAYOUT_REQUEST',
        referenceId: createdPayout.id,
        memo: `Hold funds for withdrawal request #${createdPayout.ref}`,
        createdBy: userId,
      },
      {
        walletId: lockedWallet.id,
        entryType: 'CREDIT',
        amount: amt.toFixed(2),
        balanceBucket: 'HELD',
        category: 'PAYOUT',
        referenceType: 'PAYOUT_REQUEST',
        referenceId: createdPayout.id,
        memo: `Locked in held bucket for withdrawal request #${createdPayout.ref}`,
        createdBy: userId,
      },
    ];

    await ledgerService.recordTransactionGroup(txClient, {
      txnGroupId,
      entries: ledgerEntries,
      defaultCategory: 'PAYOUT',
      defaultReferenceType: 'PAYOUT_REQUEST',
      defaultReferenceId: createdPayout.id,
      createdBy: userId,
    });

    const updatedWallet = await walletRepo.getWalletById(db, lockedWallet.id, { client: txClient });

    return {
      success: true,
      payout: createdPayout,
      wallet: updatedWallet,
      riskFlags,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Approves a payout request.
 * - Non-Super-Admin (Moderator/Admin): Creates a pending_admin_action (Maker-Checker HIGH tier).
 * - Super Admin: Dispatches disbursement immediately.
 */
export async function approvePayout(db, {
  payoutId,
  approverId,
  approverRole = 'admin',
  approverNote = 'Approved for disbursement',
  b2cClient = defaultB2CClient,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Lock payout row
    const { rows: payoutRows } = await txClient.query(
      `SELECT id, ref, wallet_id, user_id, method, account_number, account_name, bank_name,
              amount, fee_amount, net_amount, status, risk_flags_json
       FROM payout_requests
       WHERE id = $1
       FOR UPDATE`,
      [payoutId]
    );

    if (payoutRows.length === 0) {
      throw new Error(`PAYOUT_NOT_FOUND: Payout request #${payoutId} does not exist.`);
    }

    const payout = payoutRows[0];
    if (payout.status === 'COMPLETED') {
      return { alreadyCompleted: true, success: true, payout };
    }
    if (payout.status === 'REJECTED' || payout.status === 'CANCELLED') {
      throw new Error(`INVALID_PAYOUT_STATUS: Cannot approve a payout in "${payout.status}" status.`);
    }

    // 2. Maker-Checker enforcement: If approver is NOT super_admin, create pending_admin_action
    if (approverRole !== 'super_admin') {
      const ref = `ACT-PAY-${payout.id}-${Date.now().toString(36).toUpperCase()}`;
      const { rows: actionRows } = await txClient.query(
        `INSERT INTO pending_admin_actions (
           ref, actor_id, action_key, payload_json, target_type, target_ref, risk_tier, status
         )
         VALUES ($1, $2, 'finance.payout.approve', $3, 'payout_request', $4, 'HIGH', 'PENDING')
         RETURNING id, ref, action_key, status`,
        [
          ref,
          approverId,
          JSON.stringify({ payoutId: payout.id, payoutRef: payout.ref, amount: payout.amount, approverNote }),
          payout.ref,
        ]
      );
      const pendingAction = actionRows[0];

      await txClient.query(
        `UPDATE payout_requests
         SET pending_action_id = $2,
             updated_at = now()
         WHERE id = $1`,
        [payout.id, pendingAction.id]
      );

      await writeAudit(txClient, {
        actorId: approverId,
        actorRole: approverRole,
        action: 'finance.payout.approve_request',
        targetType: 'payout_request',
        targetRef: payout.ref,
        afterJson: { pending_action_id: pendingAction.id, approver_note: approverNote },
        riskTier: 'HIGH',
      }).catch(() => {});

      return {
        isPendingMakerChecker: true,
        success: true,
        message: 'Payout approval requires Super Admin confirmation (Maker-Checker HIGH tier).',
        pendingAction,
        payout,
      };
    }

    // 3. Super Admin executes directly
    return disbursePayout(db, {
      payoutId: payout.id,
      executedBy: approverId,
      b2cClient,
      client: txClient,
    });
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Executes the B2C disbursement for an approved payout.
 */
export async function disbursePayout(db, {
  payoutId,
  executedBy = null,
  b2cClient = defaultB2CClient,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Lock payout row and user wallet
    const { rows: payoutRows } = await txClient.query(
      `SELECT id, ref, wallet_id, user_id, method, account_number, account_name, bank_name,
              amount, fee_amount, net_amount, status
       FROM payout_requests
       WHERE id = $1
       FOR UPDATE`,
      [payoutId]
    );

    if (payoutRows.length === 0) {
      throw new Error(`PAYOUT_NOT_FOUND: Payout #${payoutId} not found.`);
    }

    const payout = payoutRows[0];
    if (payout.status === 'COMPLETED') {
      return { alreadyCompleted: true, success: true, payout };
    }

    // Re-validate wallet held balance
    const wallet = await walletRepo.getWalletByIdForUpdate(txClient, payout.wallet_id);
    const heldPaisa = Math.round(parseFloat(wallet.held_balance) * 100);
    const payoutPaisa = Math.round(parseFloat(payout.amount) * 100);

    if (heldPaisa < payoutPaisa) {
      throw new Error(`INSUFFICIENT_HELD_BALANCE: Wallet held balance (৳${(heldPaisa / 100).toFixed(2)}) is less than payout amount (৳${payout.amount}).`);
    }

    // 2. Call B2C gateway
    const gatewayResult = await b2cClient.disburse({
      payoutRef: payout.ref,
      accountNumber: payout.account_number,
      accountName: payout.account_name,
      amount: payout.net_amount,
      method: payout.method,
    });

    if (gatewayResult.success) {
      // 3. SUCCESS: Deduct from HELD bucket and increment lifetime_withdrawn
      // DEBIT: HELD bucket (reduces held_balance, increases lifetime_withdrawn)
      // Offsetting CREDIT: Platform Disbursal / Settlement Account
      const { rows: adminRows } = await txClient.query(
        `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE r.key = 'super_admin'
         ORDER BY u.id ASC LIMIT 1`
      );
      const adminUserId = adminRows[0]?.id ?? 1;
      const platformWallet = await walletRepo.getOrCreateWallet(db, adminUserId, { client: txClient });

      const txnGroupId = randomUUID();
      const ledgerEntries = [
        {
          walletId: wallet.id,
          entryType: 'DEBIT',
          amount: payout.amount,
          balanceBucket: 'HELD',
          category: 'PAYOUT',
          referenceType: 'PAYOUT_REQUEST',
          referenceId: payout.id,
          memo: `Disbursement completed for payout #${payout.ref} (${gatewayResult.trxId})`,
          createdBy: executedBy,
        },
        {
          walletId: platformWallet.id,
          entryType: 'CREDIT',
          amount: payout.amount,
          balanceBucket: 'AVAILABLE',
          category: 'PAYOUT',
          referenceType: 'PAYOUT_REQUEST',
          referenceId: payout.id,
          memo: `Settlement balance for payout #${payout.ref} (${gatewayResult.trxId})`,
          createdBy: executedBy,
        },
      ];

      await ledgerService.recordTransactionGroup(txClient, {
        txnGroupId,
        entries: ledgerEntries,
        defaultCategory: 'PAYOUT',
        defaultReferenceType: 'PAYOUT_REQUEST',
        defaultReferenceId: payout.id,
        createdBy: executedBy,
      });

      // Update payout status to COMPLETED
      const { rows: updatedRows } = await txClient.query(
        `UPDATE payout_requests
         SET status = 'COMPLETED',
             gateway_ref = $2,
             gateway_receipt = $3,
             approved_by = $4,
             approved_at = now(),
             processed_at = now(),
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          payout.id,
          gatewayResult.trxId,
          JSON.stringify(gatewayResult.receipt),
          executedBy,
        ]
      );

      await writeAudit(txClient, {
        actorId: executedBy,
        actorRole: 'super_admin',
        action: 'finance.payout.disburse_success',
        targetType: 'payout_request',
        targetRef: payout.ref,
        afterJson: { gateway_ref: gatewayResult.trxId, net_amount: payout.net_amount },
        riskTier: 'CRITICAL',
      }).catch(() => {});

      return {
        success: true,
        payout: updatedRows[0],
        gatewayResult,
      };
    } else {
      // 4. FAILURE: Automatically reverse funds from HELD bucket back to AVAILABLE bucket
      const txnGroupId = randomUUID();
      const ledgerEntries = [
        {
          walletId: wallet.id,
          entryType: 'DEBIT',
          amount: payout.amount,
          balanceBucket: 'HELD',
          category: 'PAYOUT',
          referenceType: 'PAYOUT_REQUEST',
          referenceId: payout.id,
          memo: `Held release on failed disbursement for payout #${payout.ref}`,
          createdBy: executedBy,
        },
        {
          walletId: wallet.id,
          entryType: 'CREDIT',
          amount: payout.amount,
          balanceBucket: 'AVAILABLE',
          category: 'PAYOUT',
          referenceType: 'PAYOUT_REQUEST',
          referenceId: payout.id,
          memo: `Returned to available balance on failed disbursement for payout #${payout.ref}`,
          createdBy: executedBy,
        },
      ];

      await ledgerService.recordTransactionGroup(txClient, {
        txnGroupId,
        entries: ledgerEntries,
        defaultCategory: 'PAYOUT',
        defaultReferenceType: 'PAYOUT_REQUEST',
        defaultReferenceId: payout.id,
        createdBy: executedBy,
      });

      const errorMsg = gatewayResult.error?.message || 'Gateway disbursement failed';

      const { rows: updatedRows } = await txClient.query(
        `UPDATE payout_requests
         SET status = 'FAILED',
             failure_reason = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [payout.id, errorMsg]
      );

      await writeAudit(txClient, {
        actorId: executedBy,
        actorRole: 'system',
        action: 'finance.payout.disburse_failed',
        targetType: 'payout_request',
        targetRef: payout.ref,
        afterJson: { failure_reason: errorMsg },
        riskTier: 'HIGH',
      }).catch(() => {});

      return {
        success: false,
        error: gatewayResult.error,
        payout: updatedRows[0],
      };
    }
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Rejects a payout request and returns locked held funds back to available_balance.
 */
export async function rejectPayout(db, {
  payoutId,
  reason = 'Rejected by administrator',
  rejectedBy = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    const { rows: payoutRows } = await txClient.query(
      `SELECT id, ref, wallet_id, amount, status
       FROM payout_requests
       WHERE id = $1
       FOR UPDATE`,
      [payoutId]
    );

    if (payoutRows.length === 0) {
      throw new Error(`PAYOUT_NOT_FOUND: Payout #${payoutId} not found.`);
    }

    const payout = payoutRows[0];
    if (payout.status !== 'REQUESTED' && payout.status !== 'HELD') {
      throw new Error(`INVALID_PAYOUT_STATUS: Cannot reject payout with status "${payout.status}".`);
    }

    // Reverse HELD -> AVAILABLE
    const txnGroupId = randomUUID();
    const ledgerEntries = [
      {
        walletId: payout.wallet_id,
        entryType: 'DEBIT',
        amount: payout.amount,
        balanceBucket: 'HELD',
        category: 'PAYOUT',
        referenceType: 'PAYOUT_REQUEST',
        referenceId: payout.id,
        memo: `Reversed from held on rejection of payout #${payout.ref}`,
        createdBy: rejectedBy,
      },
      {
        walletId: payout.wallet_id,
        entryType: 'CREDIT',
        amount: payout.amount,
        balanceBucket: 'AVAILABLE',
        category: 'PAYOUT',
        referenceType: 'PAYOUT_REQUEST',
        referenceId: payout.id,
        memo: `Returned to available balance on rejection of payout #${payout.ref} (${reason})`,
        createdBy: rejectedBy,
      },
    ];

    await ledgerService.recordTransactionGroup(txClient, {
      txnGroupId,
      entries: ledgerEntries,
      defaultCategory: 'PAYOUT',
      defaultReferenceType: 'PAYOUT_REQUEST',
      defaultReferenceId: payout.id,
      createdBy: rejectedBy,
    });

    const { rows: updatedRows } = await txClient.query(
      `UPDATE payout_requests
       SET status = 'REJECTED',
           failure_reason = $2,
           approved_by = $3,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [payout.id, reason, rejectedBy]
    );

    await writeAudit(txClient, {
      actorId: rejectedBy,
      actorRole: 'admin',
      action: 'finance.payout.reject',
      targetType: 'payout_request',
      targetRef: payout.ref,
      afterJson: { reason },
      riskTier: 'MEDIUM',
    }).catch(() => {});

    return {
      success: true,
      payout: updatedRows[0],
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Processes a batch of approved payouts with per-item transaction isolation.
 */
export async function batchDisbursePayouts(db, {
  payoutIds = [],
  executedBy = null,
  b2cClient = defaultB2CClient,
} = {}) {
  const successful = [];
  const failed = [];

  for (const payoutId of payoutIds) {
    try {
      const result = await disbursePayout(db, {
        payoutId,
        executedBy,
        b2cClient,
      });
      if (result.success) {
        successful.push(result.payout);
      } else {
        failed.push({ payoutId, error: result.error?.message || 'Disbursement failed' });
      }
    } catch (err) {
      failed.push({ payoutId, error: err.message });
    }
  }

  return {
    total: payoutIds.length,
    successCount: successful.length,
    failureCount: failed.length,
    successful,
    failed,
  };
}

/**
 * Lists the payout requests queue with filtering, risk flags, and pagination.
 */
export async function listPayoutQueue(db, {
  status = null,
  method = null,
  userId = null,
  minAmount = null,
  maxAmount = null,
  limit = 20,
  cursor = null,
  client = null,
} = {}) {
  const runner = client ?? db;
  let query = `
    SELECT p.id, p.ref, p.wallet_id, p.user_id, p.method, p.account_number, p.account_name, p.bank_name,
           p.amount, p.fee_amount, p.net_amount, p.status, p.risk_flags_json, p.pending_action_id,
           p.approved_by, p.approved_at, p.gateway_ref, p.failure_reason, p.processed_at, p.created_at,
           u.phone AS user_phone, u.ref AS user_ref, up.full_name AS user_full_name,
           w.available_balance, w.held_balance
    FROM payout_requests p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    JOIN wallets w ON w.id = p.wallet_id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (status) {
    query += ` AND p.status = $${paramIdx++}`;
    params.push(status);
  }
  if (method) {
    query += ` AND p.method = $${paramIdx++}`;
    params.push(method);
  }
  if (userId) {
    query += ` AND p.user_id = $${paramIdx++}`;
    params.push(userId);
  }
  if (minAmount) {
    query += ` AND p.amount >= $${paramIdx++}::numeric(14,2)`;
    params.push(minAmount);
  }
  if (maxAmount) {
    query += ` AND p.amount <= $${paramIdx++}::numeric(14,2)`;
    params.push(maxAmount);
  }
  if (cursor) {
    query += ` AND p.id < $${paramIdx++}`;
    params.push(cursor);
  }

  query += ` ORDER BY p.id DESC LIMIT $${paramIdx++}`;
  params.push(limit + 1);

  const { rows } = await runner.query(query, params);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return {
    payouts: items,
    nextCursor,
    count: items.length,
  };
}
