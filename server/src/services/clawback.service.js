// @ts-check
/**
 * clawback.service.js — Return-Triggered Clawback Automation & Deficit Recovery (Prompt 6.2).
 *
 * Handles:
 * 1. Locked Escrow Clawback: Reverses pending escrow balance, zeroes shop partner commission, refunds buyer.
 * 2. Post-Release Clawback: Recovers funds from beneficiary available balance.
 * 3. Insufficient Balance Deficit: When shop partners have already withdrawn earnings, creates a
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
 * @param {Object} params - WHY: no `= {}` default. Money code must not run with subOrderId undefined;
 *   a call without params now throws at once, and `// @ts-check` flags it before it runs.
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
}) {
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
    /** @type {import('./ledger.service.js').LedgerEntryInput[]} */
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
          // Insufficient balance edge case: shop partner already withdrew funds
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

    // 5. Net out items the customer was already refunded through a warranty claim.
    // WHY: a warranty REFUND (processWarrantyRefund) pays one item's line_total from the supplier
    // and leaves escrow alone. Clawing back the whole escrow here would refund that item a second
    // time, so the customer gets the remainder and the supplier, who funded the earlier refund, is
    // paid it back out of the clawed-back money. Every party then ends where a plain return leaves it.
    const { rows: priorRows } = await txClient.query(
      `SELECT COALESCE(SUM(lt.amount), 0)::numeric(14,2) AS refunded
       FROM ledger_transactions lt
       JOIN warranty_claims c ON c.id = lt.reference_id
       JOIN warranty_cards wc ON wc.id = c.warranty_card_id
       JOIN order_items oi ON oi.id = wc.order_item_id
       WHERE lt.reference_type = 'WARRANTY_CLAIM'
         AND lt.category = 'REFUND'
         AND lt.entry_type = 'CREDIT'
         AND oi.sub_order_id = $1`,
      [subOrderId]
    );
    const priorRefundPaisa = Math.min(
      totalClawbackPaisa,
      Math.round(parseFloat(String(priorRows[0]?.refunded ?? '0')) * 100)
    );
    const customerRefundPaisa = totalClawbackPaisa - priorRefundPaisa;

    if (priorRefundPaisa > 0) {
      const supplierWallet = await walletRepo.getOrCreateWallet(db, subOrder.supplier_id, { client: txClient });
      ledgerEntries.push({
        walletId: supplierWallet.id,
        entryType: 'CREDIT',
        amount: (priorRefundPaisa / 100).toFixed(2),
        balanceBucket: 'AVAILABLE',
        category: 'ADJUSTMENT',
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        memo: `Supplier repaid the warranty refund already given on sub-order #${subOrderId} (${reason})`,
        createdBy: approvedBy,
      });
    }

    // 6. Credit Customer Refund
    if (customerRefundPaisa > 0) {
      ledgerEntries.push({
        walletId: customerWallet.id,
        entryType: 'CREDIT',
        amount: (customerRefundPaisa / 100).toFixed(2),
        balanceBucket: 'AVAILABLE',
        category: 'REFUND',
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        memo: `Refund credited to customer for sub-order #${subOrderId} (${reason})`,
        createdBy: approvedBy,
      });
    }

    // 7. Record Double-Entry Group
    const ledgerResult = await ledgerService.recordTransactionGroup(txClient, {
      txnGroupId,
      entries: ledgerEntries,
      defaultCategory: 'CLAWBACK',
      defaultReferenceType: 'SUB_ORDER',
      defaultReferenceId: subOrderId,
      createdBy: approvedBy,
    });

    // 8. Update escrow entries status
    await txClient.query(
      `UPDATE escrow_entries
       SET status = 'CLAWED_BACK'
       WHERE id = ANY($1::bigint[])`,
      [entryIdsToClawback]
    );

    // 9. Update trust score return count & stats
    await txClient.query(
      `UPDATE trust_scores
       SET completed_orders = GREATEST(0, completed_orders - 1),
           updated_at = now()
       WHERE user_id = $1 OR user_id = $2`,
      [subOrder.supplier_id, subOrder.customer_id]
    ).catch(() => {});

    // 10. Write audit log
    await writeAudit(txClient, {
      actorId: approvedBy,
      actorRole: 'admin',
      action: 'finance.clawback.execute',
      targetType: 'sub_order',
      targetRef: String(subOrderId),
      beforeJson: { escrow_entries: escrowRows },
      afterJson: {
        total_clawback: (totalClawbackPaisa / 100).toFixed(2),
        prior_warranty_refund: (priorRefundPaisa / 100).toFixed(2),
        customer_refund: (customerRefundPaisa / 100).toFixed(2),
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
      priorWarrantyRefund: (priorRefundPaisa / 100).toFixed(2),
      customerRefundAmount: (customerRefundPaisa / 100).toFixed(2),
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

/**
 * Refunds ONE warranty claim: the customer gets the claimed order item's line total, and the
 * supplier who issued the warranty pays all of it.
 *
 * WHY not processReturnClawback: a warranty card covers one order item, but escrow is held per
 * sub-order. Clawing back the sub-order refunded every item in it (a ৳200 cable refunded ৳1,260)
 * and took the shop partner's and platform's cut for items nobody claimed. See
 * docs/warranty-refund-scope.md (Option B, chosen 2026-10-15).
 *
 * WHY the supplier's AVAILABLE bucket even while escrow is still LOCKED: escrow_entries rows are
 * all-or-nothing, so debiting ESCROW here would leave the row's full amount to be released again
 * later and push pending_escrow_balance below zero. Debiting AVAILABLE nets out when that escrow
 * releases. A shortfall is recorded in negative_balance_recoveries, the same as a post-release
 * return clawback. Escrow rows are left untouched, so other items stay refundable.
 *
 * @param {import('pg').Pool} db
 * @param {Object} params - no `= {}` default, for the same reason as processReturnClawback.
 * @param {number|string} params.claimId
 * @param {string} params.claimRef
 * @param {number|string} params.subOrderId
 * @param {number|string} params.supplierId - user id of the supplier who issued the warranty
 * @param {number|string} params.customerId
 * @param {string} params.amount - the claimed item's line_total, NUMERIC(14,2) as pg returns it
 * @param {number|string|null} params.approvedBy - who approved the claim (supplier or staff)
 * @param {string} params.actorRole
 * @param {import('pg').PoolClient} [params.client]
 */
export async function processWarrantyRefund(db, {
  claimId,
  claimRef,
  subOrderId,
  supplierId,
  customerId,
  amount,
  approvedBy,
  actorRole,
  client = null,
}) {
  const runner = async (txClient) => {
    const refundPaisa = Math.round(parseFloat(String(amount)) * 100);
    if (!Number.isFinite(refundPaisa) || refundPaisa <= 0) {
      throw new Error(`INVALID_REFUND_AMOUNT: Warranty claim ${claimRef} has no refundable line total (${amount}).`);
    }
    const refundAmount = (refundPaisa / 100).toFixed(2);
    // pg returns BIGINT ids as strings; the ledger's reference_id is numeric.
    const referenceId = Number(claimId);

    const supplierWallet = await walletRepo.getOrCreateWallet(db, supplierId, { client: txClient });
    const customerWallet = await walletRepo.getOrCreateWallet(db, customerId, { client: txClient });

    const availPaisa = Math.round(parseFloat(String(supplierWallet.available_balance)) * 100);
    const recoveredPaisa = Math.min(refundPaisa, Math.max(0, availPaisa));
    const deficitPaisa = refundPaisa - recoveredPaisa;
    const reason = `Warranty claim ${claimRef} refunded`;

    let recoveryRecord = null;
    if (deficitPaisa > 0) {
      const { rows: recRows } = await txClient.query(
        `INSERT INTO negative_balance_recoveries (
           ref, wallet_id, user_id, sub_order_id,
           total_clawback_amount, recovered_from_available, unrecovered_deficit,
           recovery_status, reason
         )
         VALUES ($1, $2, $3, $4, $5::numeric(14,2), $6::numeric(14,2), $7::numeric(14,2), 'PENDING', $8)
         RETURNING id, ref, wallet_id, total_clawback_amount, recovered_from_available, unrecovered_deficit, recovery_status`,
        [
          generateRecoveryRef(),
          supplierWallet.id,
          supplierId,
          subOrderId,
          refundAmount,
          (recoveredPaisa / 100).toFixed(2),
          (deficitPaisa / 100).toFixed(2),
          reason,
        ]
      );
      recoveryRecord = recRows[0] || null;
    }

    const txnGroupId = randomUUID();
    /** @type {import('./ledger.service.js').LedgerEntryInput[]} */
    const ledgerEntries = [
      {
        walletId: supplierWallet.id,
        entryType: 'DEBIT',
        amount: refundAmount,
        balanceBucket: 'AVAILABLE',
        category: 'CLAWBACK',
        referenceType: 'WARRANTY_CLAIM',
        referenceId,
        memo: `${reason} (supplier bears the warranty)${deficitPaisa > 0 ? ` [Deficit: ৳${(deficitPaisa / 100).toFixed(2)}]` : ''}`,
        createdBy: approvedBy,
      },
      {
        walletId: customerWallet.id,
        entryType: 'CREDIT',
        amount: refundAmount,
        balanceBucket: 'AVAILABLE',
        category: 'REFUND',
        referenceType: 'WARRANTY_CLAIM',
        referenceId,
        memo: `${reason} to customer`,
        createdBy: approvedBy,
      },
    ];

    const ledgerResult = await ledgerService.recordTransactionGroup(txClient, {
      txnGroupId,
      entries: ledgerEntries,
      defaultCategory: 'REFUND',
      defaultReferenceType: 'WARRANTY_CLAIM',
      defaultReferenceId: referenceId,
      createdBy: approvedBy,
    });

    await writeAudit(txClient, {
      actorId: approvedBy,
      actorRole,
      action: 'finance.clawback.execute',
      targetType: 'warranty_claim',
      targetRef: claimRef,
      beforeJson: { supplier_available_balance: supplierWallet.available_balance },
      afterJson: {
        refund_amount: refundAmount,
        sub_order_id: subOrderId,
        unrecovered_deficit: (deficitPaisa / 100).toFixed(2),
        recovery_record: recoveryRecord,
        txn_group_id: txnGroupId,
      },
      riskTier: 'HIGH',
    }).catch(() => {});

    return {
      success: true,
      claimId,
      refundAmount,
      recoveredAmount: (recoveredPaisa / 100).toFixed(2),
      unrecoveredDeficit: (deficitPaisa / 100).toFixed(2),
      recoveryRecord,
      txnGroupId,
      ledgerResult,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

export const executeClawback = processReturnClawback;
