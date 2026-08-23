/**
 * clawback.service.js — Return-Triggered Clawback Automation & Deficit Recovery (Prompt 6.2).
 *
 * Handles:
 * 1. Locked Escrow Clawback: Reverses pending escrow balance, zeroes saler commission, refunds buyer.
 * 2. Post-Release Clawback: Recovers funds from beneficiary available balance.
 * 3. Insufficient Balance Deficit: When sellers have already withdrawn earnings, creates a
 *    negative_balance_recoveries tracking record and allows negative available balance.
 * 4. Customer Refund: Credits customer refund through wallet available balance.
 * 5. Trust Score Adjustments & Audit Trail: Updates seller/buyer risk metrics and logs audit entries.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import * as vaultService from './vault.service.js';
import { writeAudit } from '../lib/audit.js';

/**
 * Generates a unique public ref for negative balance recovery records.
 */
function generateRecoveryRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `NBR-${code}`;
}

/**
 * Executes a full clawback for an approved return on a sub-order.
 *
 * @param {import('pg').Pool} db
 * @param {Object} params
 * @param {number} params.subOrderId
 * @param {number} [params.returnRequestId]
 * @param {string} [params.reason='Return approved']
 * @param {number} [params.approvedBy] - Staff user ID approving the return
 * @param {Object} [params.cache]
 * @param {import('pg').PoolClient} [params.client]
 */
export async function processReturnClawback(db, {
  subOrderId,
  returnRequestId = null,
  reason = 'Return approved',
  approvedBy = null,
  cache = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Fetch sub-order and customer information
    const { rows: subOrderRows } = await txClient.query(
      `SELECT s.id, s.order_id, s.supplier_id, s.saler_id, s.total_amount,
              s.saler_commission, s.subtotal_base, s.wholesale_margin, s.shipping_amount,
              o.customer_id
       FROM sub_orders s
       JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1`,
      [subOrderId]
    );

    if (subOrderRows.length === 0) {
      throw new Error(`SUB_ORDER_NOT_FOUND: Sub-order #${subOrderId} does not exist.`);
    }
    const subOrder = subOrderRows[0];

    // 2. Fetch and lock existing escrow entries
    const { rows: escrowRows } = await txClient.query(
      `SELECT id, sub_order_id, wallet_id, beneficiary_role, amount, status, hold_until
       FROM escrow_entries
       WHERE sub_order_id = $1
       FOR UPDATE`,
      [subOrderId]
    );

    if (escrowRows.length === 0) {
      throw new Error(`ESCROW_NOT_FOUND: No escrow entries found for sub-order #${subOrderId}`);
    }

    if (escrowRows.every((e) => e.status === 'CLAWED_BACK')) {
      return {
        alreadyClawedBack: true,
        success: true,
        subOrderId,
        message: 'Clawback already completed for this sub-order.',
      };
    }

    // 3. Resolve Customer Wallet
    const customerWallet = await walletRepo.getOrCreateWallet(db, subOrder.customer_id, { client: txClient });

    const isAnyReleased = escrowRows.some((e) => e.status === 'RELEASED');
    const isAllLocked = escrowRows.every((e) => e.status === 'LOCKED');

    const recoveryRecords = [];
    let totalClawbackPaisa = 0;
    let totalRecoveredPaisa = 0;
    let totalDeficitPaisa = 0;

    const txnGroupId = randomUUID();
    const ledgerEntries = [];
    const entryIdsToClawback = [];

    // 4. Process each beneficiary entry
    for (const item of escrowRows) {
      if (item.status === 'CLAWED_BACK') continue;

      const itemAmtPaisa = Math.round(parseFloat(item.amount) * 100);
      if (itemAmtPaisa <= 0) continue;

      entryIdsToClawback.push(item.id);
      totalClawbackPaisa += itemAmtPaisa;

      if (item.status === 'LOCKED') {
        // Case A: Escrow was still locked -> Debit from ESCROW bucket
        ledgerEntries.push({
          walletId: item.wallet_id,
          entryType: 'DEBIT',
          amount: item.amount,
          balanceBucket: 'ESCROW',
          category: 'CLAWBACK',
          referenceType: 'SUB_ORDER',
          referenceId: subOrderId,
          memo: `Clawback from locked escrow (${item.beneficiary_role}): ${reason}`,
          createdBy: approvedBy,
        });
        totalRecoveredPaisa += itemAmtPaisa;
      } else if (item.status === 'RELEASED') {
        // Case B: Escrow was already released -> Recover from AVAILABLE bucket
        const wallet = await walletRepo.getWalletById(db, item.wallet_id, { client: txClient });
        const availPaisa = Math.round(parseFloat(wallet.available_balance) * 100);

        let recoveredPaisa = itemAmtPaisa;
        let deficitPaisa = 0;

        if (availPaisa < itemAmtPaisa) {
          // Insufficient balance edge case: seller already withdrew funds
          recoveredPaisa = Math.max(0, availPaisa);
          deficitPaisa = itemAmtPaisa - recoveredPaisa;
          totalDeficitPaisa += deficitPaisa;

          // Record negative balance deficit recovery record
          const ref = generateRecoveryRef();
          const { rows: recRows } = await txClient.query(
            `INSERT INTO negative_balance_recoveries (
               ref, wallet_id, user_id, sub_order_id,
               total_clawback_amount, recovered_from_available, unrecovered_deficit,
               recovery_status, reason
             )
             VALUES ($1, $2, $3, $4, $5::numeric(14,2), $6::numeric(14,2), $7::numeric(14,2), 'PENDING', $8)
             RETURNING id, ref, wallet_id, total_clawback_amount, recovered_from_available, unrecovered_deficit, recovery_status`,
            [
              ref,
              item.wallet_id,
              wallet.user_id,
              subOrderId,
              (itemAmtPaisa / 100).toFixed(2),
              (recoveredPaisa / 100).toFixed(2),
              (deficitPaisa / 100).toFixed(2),
              reason,
            ]
          );
          recoveryRecords.push(recRows[0]);
        }

        totalRecoveredPaisa += recoveredPaisa;

        // Debit AVAILABLE bucket (per spec, available_balance may go negative on clawback recovery)
        ledgerEntries.push({
          walletId: item.wallet_id,
          entryType: 'DEBIT',
          amount: item.amount,
          balanceBucket: 'AVAILABLE',
          category: 'CLAWBACK',
          referenceType: 'SUB_ORDER',
          referenceId: subOrderId,
          memo: `Clawback from released balance (${item.beneficiary_role}): ${reason}${deficitPaisa > 0 ? ` [Deficit: ৳${(deficitPaisa / 100).toFixed(2)}]` : ''}`,
          createdBy: approvedBy,
        });
      }
    }

    // 5. Credit Customer Refund
    if (totalClawbackPaisa > 0) {
      ledgerEntries.push({
        walletId: customerWallet.id,
        entryType: 'CREDIT',
        amount: (totalClawbackPaisa / 100).toFixed(2),
        balanceBucket: 'AVAILABLE',
        category: 'REFUND',
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        memo: `Refund credited to customer for sub-order #${subOrderId} (${reason})`,
        createdBy: approvedBy,
      });
    }

    // 6. Record Double-Entry Group
    const ledgerResult = await ledgerService.recordTransactionGroup(txClient, {
      txnGroupId,
      entries: ledgerEntries,
      defaultCategory: 'CLAWBACK',
      defaultReferenceType: 'SUB_ORDER',
      defaultReferenceId: subOrderId,
      createdBy: approvedBy,
    });

    // 7. Update escrow entries status
    await txClient.query(
      `UPDATE escrow_entries
       SET status = 'CLAWED_BACK'
       WHERE id = ANY($1::bigint[])`,
      [entryIdsToClawback]
    );

    // 8. Update trust score return count & stats
    await txClient.query(
      `UPDATE trust_scores
       SET completed_orders = GREATEST(0, completed_orders - 1),
           updated_at = now()
       WHERE user_id = $1 OR user_id = $2`,
      [subOrder.supplier_id, subOrder.customer_id]
    ).catch(() => {});

    // 9. Write audit log
    await writeAudit(txClient, {
      actorId: approvedBy,
      actorRole: 'admin',
      action: 'finance.clawback.execute',
      targetType: 'sub_order',
      targetRef: String(subOrderId),
      beforeJson: { escrow_entries: escrowRows },
      afterJson: {
        total_clawback: (totalClawbackPaisa / 100).toFixed(2),
        unrecovered_deficit: (totalDeficitPaisa / 100).toFixed(2),
        recovery_records: recoveryRecords,
        txn_group_id: txnGroupId,
      },
      riskTier: 'HIGH',
    }).catch(() => {});

    return {
      success: true,
      subOrderId,
      returnRequestId,
      totalClawbackAmount: (totalClawbackPaisa / 100).toFixed(2),
      recoveredAmount: (totalRecoveredPaisa / 100).toFixed(2),
      unrecoveredDeficit: (totalDeficitPaisa / 100).toFixed(2),
      recoveryRecords,
      txnGroupId,
      ledgerResult,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Retrieves pending negative balance recovery records for a specific wallet or platform wide.
 */
export async function getPendingRecoveries(db, { walletId = null, limit = 50, client = null } = {}) {
  const runner = client ?? db;
  let query = `
    SELECT r.id, r.ref, r.wallet_id, r.user_id, r.sub_order_id,
           r.total_clawback_amount, r.recovered_from_available, r.unrecovered_deficit,
           r.recovery_status, r.reason, r.created_at,
           u.phone AS user_phone, u.ref AS user_ref,
           w.available_balance
    FROM negative_balance_recoveries r
    JOIN users u ON u.id = r.user_id
    JOIN wallets w ON w.id = r.wallet_id
  `;
  const params = [];

  if (walletId) {
    query += ` WHERE r.wallet_id = $1 ORDER BY r.created_at DESC LIMIT $2`;
    params.push(walletId, limit);
  } else {
    query += ` ORDER BY r.created_at DESC LIMIT $1`;
    params.push(limit);
  }

  const { rows } = await runner.query(query, params);
  return rows;
}

export const executeClawback = processReturnClawback;
