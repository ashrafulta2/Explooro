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

    // 5. Net out what the customer was already refunded on this sub-order item by item.
    // WHY: a warranty REFUND (processWarrantyRefund) and a partial return
    // (processPartialReturnClawback) each pay from AVAILABLE and leave escrow alone. Clawing back
    // the whole escrow here would refund those items a second time, so the customer gets the
    // remainder and each wallet that funded an earlier refund is paid back exactly what it paid.
    // Every party then ends where a plain full return leaves it.
    const { rows: priorRows } = await txClient.query(
      `WITH prior AS (
         SELECT lt.wallet_id, lt.entry_type, lt.category, lt.amount
         FROM ledger_transactions lt
         JOIN warranty_claims c ON c.id = lt.reference_id
         JOIN warranty_cards wc ON wc.id = c.warranty_card_id
         JOIN order_items oi ON oi.id = wc.order_item_id
         WHERE lt.reference_type = 'WARRANTY_CLAIM' AND oi.sub_order_id = $1
         UNION ALL
         SELECT lt.wallet_id, lt.entry_type, lt.category, lt.amount
         FROM ledger_transactions lt
         JOIN return_requests r ON r.id = lt.reference_id
         WHERE lt.reference_type = 'RETURN_REQUEST' AND r.sub_order_id = $1
       )
       SELECT wallet_id, entry_type, SUM(amount)::numeric(14,2) AS total
       FROM prior
       WHERE (entry_type = 'DEBIT' AND category = 'CLAWBACK')
          OR (entry_type = 'CREDIT' AND category = 'REFUND')
       GROUP BY wallet_id, entry_type
       ORDER BY wallet_id`,
      [subOrderId]
    );
    let priorRefundPaisa = 0;
    for (const row of priorRows) {
      const paisa = Math.round(parseFloat(String(row.total)) * 100);
      if (paisa <= 0) continue;
      if (row.entry_type === 'CREDIT') {
        priorRefundPaisa += paisa;
      } else {
        ledgerEntries.push({
          walletId: row.wallet_id,
          entryType: 'CREDIT',
          amount: (paisa / 100).toFixed(2),
          balanceBucket: 'AVAILABLE',
          category: 'ADJUSTMENT',
          referenceType: 'SUB_ORDER',
          referenceId: subOrderId,
          memo: `Repaid an earlier item refund on sub-order #${subOrderId}, now covered by the full return (${reason})`,
          createdBy: approvedBy,
        });
      }
    }
    if (priorRefundPaisa > totalClawbackPaisa) {
      throw new Error(
        `PRIOR_REFUNDS_EXCEED_ESCROW: Sub-order #${subOrderId} already refunded ৳${(priorRefundPaisa / 100).toFixed(2)}, ` +
          `more than its remaining escrow ৳${(totalClawbackPaisa / 100).toFixed(2)}.`
      );
    }
    const customerRefundPaisa = totalClawbackPaisa - priorRefundPaisa;

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
        prior_item_refunds: (priorRefundPaisa / 100).toFixed(2),
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
      priorItemRefunds: (priorRefundPaisa / 100).toFixed(2),
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
 * @param {number|string} params.orderItemId - the order item the warranty card covers
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
  orderItemId,
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

    const { rows: returnedRows } = await txClient.query(
      `SELECT 1
       FROM return_items ri
       JOIN return_requests r ON r.id = ri.return_request_id
       WHERE ri.order_item_id = $1 AND r.status = 'REFUNDED'
       LIMIT 1`,
      [orderItemId]
    );
    if (returnedRows.length > 0) {
      throw new Error(`ITEM_ALREADY_RETURNED: The item on warranty claim ${claimRef} was already returned and refunded.`);
    }
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

/**
 * Splits `targetPaisa` across `weights` in proportion, so the parts always sum to exactly
 * `targetPaisa` (largest-remainder rounding). BigInt, because weight × target can pass 2^53 paisa.
 *
 * @param {bigint[]} weights
 * @param {bigint} targetPaisa
 * @returns {bigint[]}
 */
function allocateProRata(weights, targetPaisa) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0n);
  if (totalWeight <= 0n || targetPaisa <= 0n) return weights.map(() => 0n);
  const parts = weights.map((w) => (w * targetPaisa) / totalWeight);
  let leftover = targetPaisa - parts.reduce((sum, p) => sum + p, 0n);
  const byRemainder = weights
    .map((w, i) => ({ i, rem: (w * targetPaisa) % totalWeight }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const { i } of byRemainder) {
    if (leftover <= 0n) break;
    parts[i] += 1n;
    leftover -= 1n;
  }
  return parts;
}

/**
 * Refunds a PARTIAL return: only the items listed in the request's return_items.
 *
 * Each beneficiary gives back its own share of the returned goods, pro rata to its escrow amount,
 * as a full return does. Shipping stays with the supplier, because the rest of the parcel was
 * delivered (decided 2026-10-15).
 *
 * WHY not processReturnClawback: that claws back the whole sub-order, so returning one item of
 * several refunded all of them. WHY AVAILABLE and not ESCROW: escrow_entries rows are
 * all-or-nothing, so the shares come out of AVAILABLE and net out when escrow releases; escrow rows
 * stay untouched (see processWarrantyRefund). A shortfall is recorded in negative_balance_recoveries.
 *
 * @param {import('pg').Pool} db
 * @param {Object} params - no `= {}` default, for the same reason as processReturnClawback.
 * @param {number|string} params.subOrderId
 * @param {number|string} params.returnRequestId
 * @param {string} [params.reason]
 * @param {number|string|null} [params.approvedBy]
 * @param {import('pg').PoolClient} [params.client]
 */
export async function processPartialReturnClawback(db, {
  subOrderId,
  returnRequestId,
  reason = 'Partial return approved',
  approvedBy = null,
  client = null,
}) {
  const runner = async (txClient) => {
    const { rows: subOrderRows } = await txClient.query(
      `SELECT s.id, s.shipping_amount, o.customer_id
       FROM sub_orders s
       JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1`,
      [subOrderId]
    );
    if (subOrderRows.length === 0) {
      throw new Error(`SUB_ORDER_NOT_FOUND: Sub-order #${subOrderId} does not exist.`);
    }
    const subOrder = subOrderRows[0];

    const { rows: escrowRows } = await txClient.query(
      `SELECT id, sub_order_id, wallet_id, beneficiary_role, amount, status
       FROM escrow_entries
       WHERE sub_order_id = $1
       ORDER BY id
       FOR UPDATE`,
      [subOrderId]
    );
    if (escrowRows.length === 0) {
      throw new Error(`ESCROW_NOT_FOUND: No escrow entries found for sub-order #${subOrderId}`);
    }
    if (escrowRows.some((e) => e.status === 'CLAWED_BACK')) {
      throw new Error(`ALREADY_CLAWED_BACK: Sub-order #${subOrderId} was already refunded in full.`);
    }

    // WHY: escrow is left untouched by item refunds, so nothing else stops the same unit being
    // refunded twice by a second return request or by a warranty REFUND on that item.
    const { rows: usedRows } = await txClient.query(
      `SELECT ri.order_item_id, oi.qty, ri.quantity AS this_qty,
              COALESCE((SELECT SUM(r2i.quantity)
                          FROM return_items r2i
                          JOIN return_requests r2 ON r2.id = r2i.return_request_id
                         WHERE r2i.order_item_id = ri.order_item_id
                           AND r2.status = 'REFUNDED' AND r2.id <> $1), 0)::int AS prior_qty,
              EXISTS (SELECT 1
                        FROM warranty_cards wc
                        JOIN warranty_claims c ON c.warranty_card_id = wc.id
                       WHERE wc.order_item_id = ri.order_item_id AND c.resolution = 'REFUND') AS warranty_refunded
       FROM return_items ri
       JOIN order_items oi ON oi.id = ri.order_item_id
       WHERE ri.return_request_id = $1`,
      [returnRequestId]
    );
    for (const row of usedRows) {
      if (row.warranty_refunded) {
        throw new Error(`ITEM_ALREADY_REFUNDED: Order item #${row.order_item_id} was already refunded through a warranty claim.`);
      }
      if (Number(row.prior_qty) + Number(row.this_qty) > Number(row.qty)) {
        throw new Error(`ITEM_ALREADY_RETURNED: Order item #${row.order_item_id} was already returned.`);
      }
    }

    const { rows: valueRows } = await txClient.query(
      `SELECT
         (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE sub_order_id = $1)::numeric(14,2) AS goods_total,
         (SELECT COALESCE(SUM(ri.quantity * oi.retail_price), 0)
            FROM return_items ri
            JOIN order_items oi ON oi.id = ri.order_item_id
           WHERE ri.return_request_id = $2)::numeric(14,2) AS returned_total`,
      [subOrderId, returnRequestId]
    );
    const toPaisaBig = (/** @type {unknown} */ v) => BigInt(Math.round(parseFloat(String(v ?? '0')) * 100));
    const goodsPaisa = toPaisaBig(valueRows[0]?.goods_total);
    const returnedPaisa = toPaisaBig(valueRows[0]?.returned_total);
    if (goodsPaisa <= 0n || returnedPaisa <= 0n) {
      throw new Error(`NOTHING_TO_REFUND: Return #${returnRequestId} has no refundable items.`);
    }
    if (returnedPaisa > goodsPaisa) {
      throw new Error(`RETURN_EXCEEDS_ORDER: Return #${returnRequestId} is worth more than sub-order #${subOrderId}.`);
    }

    // Each beneficiary's goods-only escrow; shipping is taken out of the supplier's row.
    const shippingPaisa = toPaisaBig(subOrder.shipping_amount);
    const weights = escrowRows.map((e) => {
      const amountPaisa = toPaisaBig(e.amount);
      const goodsOnly = e.beneficiary_role === 'SUPPLIER' ? amountPaisa - shippingPaisa : amountPaisa;
      return goodsOnly > 0n ? goodsOnly : 0n;
    });
    const goodsEscrowPaisa = weights.reduce((sum, w) => sum + w, 0n);
    // Scale by the escrowed goods value, not retail, so a discounted order refunds what was paid.
    const refundTargetPaisa = (goodsEscrowPaisa * returnedPaisa + goodsPaisa / 2n) / goodsPaisa;
    const shares = allocateProRata(weights, refundTargetPaisa);

    const customerWallet = await walletRepo.getOrCreateWallet(db, subOrder.customer_id, { client: txClient });
    const txnGroupId = randomUUID();
    /** @type {import('./ledger.service.js').LedgerEntryInput[]} */
    const ledgerEntries = [];
    const recoveryRecords = [];
    let totalPaisa = 0;
    let deficitTotalPaisa = 0;
    const referenceId = Number(returnRequestId);

    for (let i = 0; i < escrowRows.length; i++) {
      const sharePaisa = Number(shares[i]);
      if (sharePaisa <= 0) continue;
      const item = escrowRows[i];
      const wallet = await walletRepo.getWalletById(db, item.wallet_id, { client: txClient });
      const availPaisa = Math.round(parseFloat(String(wallet?.available_balance ?? '0')) * 100);
      const recoveredPaisa = Math.min(sharePaisa, Math.max(0, availPaisa));
      const deficitPaisa = sharePaisa - recoveredPaisa;

      if (deficitPaisa > 0) {
        deficitTotalPaisa += deficitPaisa;
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
            item.wallet_id,
            wallet?.user_id ?? null,
            subOrderId,
            (sharePaisa / 100).toFixed(2),
            (recoveredPaisa / 100).toFixed(2),
            (deficitPaisa / 100).toFixed(2),
            reason,
          ]
        );
        if (recRows[0]) recoveryRecords.push(recRows[0]);
      }

      totalPaisa += sharePaisa;
      ledgerEntries.push({
        walletId: item.wallet_id,
        entryType: 'DEBIT',
        amount: (sharePaisa / 100).toFixed(2),
        balanceBucket: 'AVAILABLE',
        category: 'CLAWBACK',
        referenceType: 'RETURN_REQUEST',
        referenceId,
        memo: `Partial return share (${item.beneficiary_role}): ${reason}${deficitPaisa > 0 ? ` [Deficit: ৳${(deficitPaisa / 100).toFixed(2)}]` : ''}`,
        createdBy: approvedBy,
      });
    }

    ledgerEntries.push({
      walletId: customerWallet.id,
      entryType: 'CREDIT',
      amount: (totalPaisa / 100).toFixed(2),
      balanceBucket: 'AVAILABLE',
      category: 'REFUND',
      referenceType: 'RETURN_REQUEST',
      referenceId,
      memo: `Partial refund credited to customer for sub-order #${subOrderId} (${reason})`,
      createdBy: approvedBy,
    });

    const ledgerResult = await ledgerService.recordTransactionGroup(txClient, {
      txnGroupId,
      entries: ledgerEntries,
      defaultCategory: 'CLAWBACK',
      defaultReferenceType: 'RETURN_REQUEST',
      defaultReferenceId: referenceId,
      createdBy: approvedBy,
    });

    const sharesByRole = Object.fromEntries(
      escrowRows.map((e, i) => [e.beneficiary_role, (Number(shares[i]) / 100).toFixed(2)])
    );

    await writeAudit(txClient, {
      actorId: approvedBy,
      actorRole: 'admin',
      action: 'finance.clawback.execute',
      targetType: 'sub_order',
      targetRef: String(subOrderId),
      beforeJson: { escrow_entries: escrowRows },
      afterJson: {
        partial: true,
        return_request_id: returnRequestId,
        refund_amount: (totalPaisa / 100).toFixed(2),
        shares: sharesByRole,
        unrecovered_deficit: (deficitTotalPaisa / 100).toFixed(2),
        recovery_records: recoveryRecords,
        txn_group_id: txnGroupId,
      },
      riskTier: 'HIGH',
    }).catch(() => {});

    return {
      success: true,
      partial: true,
      subOrderId,
      returnRequestId,
      totalClawbackAmount: (totalPaisa / 100).toFixed(2),
      sharesByRole,
      unrecoveredDeficit: (deficitTotalPaisa / 100).toFixed(2),
      recoveryRecords,
      txnGroupId,
      ledgerResult,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

export const executeClawback = processReturnClawback;
