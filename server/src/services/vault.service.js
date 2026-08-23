/**
 * vault.service.js — Vault, Escrow Engine & Clawback Automation (Prompt 6.1).
 *
 * Implements:
 * - depositToEscrow(subOrderId, breakdown): locks funds into pending_escrow_balance
 * - releaseEscrow(subOrderId): moves pending → available for supplier, saler, and platform
 * - executeClawback(subOrderId, reason): reverses pending/available, zeroes saler commission, credits refund
 * - Strict double-entry invariant verification and row-level FOR UPDATE locking
 * - Strict idempotency keyed by (subOrderId, operation) to eliminate double-crediting
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';

/**
 * Deposits sub-order funds into escrow, locking them into pending_escrow_balance.
 *
 * @param {import('pg').Pool} db
 * @param {Object} params
 * @param {number} params.subOrderId
 * @param {Object} [params.breakdown] - Explicit breakdown (supplierAmount, salerCommission, platformMargin)
 * @param {number} [params.buyerWalletId] - Buyer's wallet ID (or customer user ID)
 * @param {number} [params.supplierWalletId] - Supplier's wallet ID
 * @param {number} [params.salerWalletId] - Saler's wallet ID (if applicable)
 * @param {number} [params.platformWalletId] - Platform system wallet ID
 * @param {number} [params.holdDays=7] - Escrow return window hold in days
 * @param {string} [params.idempotencyKey]
 * @param {number} [params.createdBy]
 * @param {import('pg').PoolClient} [params.client]
 */
export async function depositToEscrow(db, {
  subOrderId,
  breakdown = null,
  buyerWalletId = null,
  supplierWalletId = null,
  salerWalletId = null,
  platformWalletId = null,
  holdDays = null,
  idempotencyKey = null,
  createdBy = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Check existing escrow entries for idempotency
    const { rows: existingEscrows } = await txClient.query(
      `SELECT id, sub_order_id, wallet_id, beneficiary_role, amount, status, hold_until
       FROM escrow_entries
       WHERE sub_order_id = $1`,
      [subOrderId]
    );

    if (existingEscrows.length > 0) {
      const activeOrReleased = existingEscrows.filter(
        (e) => e.status === 'LOCKED' || e.status === 'RELEASED'
      );
      if (activeOrReleased.length > 0) {
        return {
          alreadyDeposited: true,
          subOrderId,
          escrowEntries: existingEscrows,
          message: 'Escrow deposit already recorded for this sub-order',
        };
      }
    }

    // 2. Fetch sub-order details if breakdown or wallets are not fully provided
    let supplierId = null;
    let salerId = null;
    let buyerId = null;
    let supplierAmt = breakdown?.supplierAmount;
    let salerAmt = breakdown?.salerCommission;
    let platformAmt = breakdown?.platformMargin;

    if (!supplierAmt || buyerWalletId == null || supplierWalletId == null) {
      const { rows: subOrderRows } = await txClient.query(
        `SELECT s.id, s.supplier_id, s.saler_id, s.subtotal_base, s.wholesale_margin,
                s.saler_commission, s.platform_margin, s.shipping_amount, s.total_amount,
                o.customer_id
         FROM sub_orders s
         JOIN orders o ON o.id = s.order_id
         WHERE s.id = $1`,
        [subOrderId]
      );

      if (subOrderRows.length === 0) {
        throw new Error(`SUB_ORDER_NOT_FOUND: Sub-order #${subOrderId} does not exist.`);
      }

      const so = subOrderRows[0];
      supplierId = so.supplier_id;
      salerId = so.saler_id;
      buyerId = so.customer_id;

      if (!supplierAmt) {
        // Supplier receives base cost + wholesale margin + shipping
        const baseCost = parseFloat(so.subtotal_base) || 0;
        const wholesaleMargin = parseFloat(so.wholesale_margin) || 0;
        const shipping = parseFloat(so.shipping_amount) || 0;
        supplierAmt = (baseCost + wholesaleMargin + shipping).toFixed(2);
      }
      if (salerAmt == null) {
        salerAmt = (parseFloat(so.saler_commission) || 0).toFixed(2);
      }
      if (platformAmt == null) {
        platformAmt = (parseFloat(so.platform_margin) || 0).toFixed(2);
      }
    }

    // 3. Resolve wallet IDs
    let resolvedBuyerWalletId = buyerWalletId;
    let resolvedSupplierWalletId = supplierWalletId;
    let resolvedSalerWalletId = salerWalletId;
    let resolvedPlatformWalletId = platformWalletId;

    if (!resolvedBuyerWalletId && buyerId) {
      const w = await walletRepo.getOrCreateWallet(db, buyerId, { client: txClient });
      resolvedBuyerWalletId = w.id;
    }
    if (!resolvedSupplierWalletId && supplierId) {
      const w = await walletRepo.getOrCreateWallet(db, supplierId, { client: txClient });
      resolvedSupplierWalletId = w.id;
    }
    if (!resolvedSalerWalletId && salerId) {
      const w = await walletRepo.getOrCreateWallet(db, salerId, { client: txClient });
      resolvedSalerWalletId = w.id;
    }
    if (!resolvedPlatformWalletId) {
      // Platform treasury wallet defaults to user ID 1 (super_admin) or dev super admin
      const { rows: adminRows } = await txClient.query(
        `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE r.key = 'super_admin'
         ORDER BY u.id ASC LIMIT 1`
      );
      const adminUserId = adminRows[0]?.id ?? 1;
      const w = await walletRepo.getOrCreateWallet(db, adminUserId, { client: txClient });
      resolvedPlatformWalletId = w.id;
    }

    const supplierPaisa = Math.round(parseFloat(supplierAmt) * 100);
    const salerPaisa = Math.round(parseFloat(salerAmt || '0') * 100);
    const platformPaisa = Math.round(parseFloat(platformAmt || '0') * 100);
    const totalPaisa = supplierPaisa + salerPaisa + platformPaisa;

    if (totalPaisa <= 0) {
      throw new Error(`INVALID_ESCROW_AMOUNT: Total deposit amount must be > 0 (got ${totalPaisa / 100})`);
    }

    // Resolve return window days from returns_engine module settings if not explicitly provided
    let resolvedHoldDays = holdDays;
    if (resolvedHoldDays == null) {
      try {
        const { rows: modRows } = await txClient.query(
          `SELECT settings_json FROM platform_modules WHERE key = $1`,
          ['returns_engine']
        );
        const moduleSettings = modRows[0]?.settings_json;
        resolvedHoldDays = typeof moduleSettings?.return_window_days === 'number'
          ? moduleSettings.return_window_days
          : parseInt(moduleSettings?.return_window_days ?? '7', 10);
      } catch {
        resolvedHoldDays = 7;
      }
    }
    if (isNaN(resolvedHoldDays) || resolvedHoldDays < 0) {
      resolvedHoldDays = 7;
    }

    const holdUntil = new Date(Date.now() + resolvedHoldDays * 24 * 60 * 60 * 1000);
    const createdEscrowEntries = [];

    // 4. Create escrow_entries rows
    if (supplierPaisa > 0) {
      const { rows } = await txClient.query(
        `INSERT INTO escrow_entries (sub_order_id, wallet_id, beneficiary_role, amount, status, hold_until)
         VALUES ($1, $2, $3, $4::numeric(14,2), 'LOCKED', $5)
         ON CONFLICT (sub_order_id, wallet_id, beneficiary_role)
         DO UPDATE SET amount = EXCLUDED.amount, status = 'LOCKED', hold_until = EXCLUDED.hold_until
         RETURNING id, sub_order_id, wallet_id, beneficiary_role, amount, status, hold_until`,
        [subOrderId, resolvedSupplierWalletId, 'SUPPLIER', (supplierPaisa / 100).toFixed(2), holdUntil]
      );
      createdEscrowEntries.push(rows[0]);
    }

    if (salerPaisa > 0 && resolvedSalerWalletId) {
      const { rows } = await txClient.query(
        `INSERT INTO escrow_entries (sub_order_id, wallet_id, beneficiary_role, amount, status, hold_until)
         VALUES ($1, $2, $3, $4::numeric(14,2), 'LOCKED', $5)
         ON CONFLICT (sub_order_id, wallet_id, beneficiary_role)
         DO UPDATE SET amount = EXCLUDED.amount, status = 'LOCKED', hold_until = EXCLUDED.hold_until
         RETURNING id, sub_order_id, wallet_id, beneficiary_role, amount, status, hold_until`,
        [subOrderId, resolvedSalerWalletId, 'SALER', (salerPaisa / 100).toFixed(2), holdUntil]
      );
      createdEscrowEntries.push(rows[0]);
    }

    if (platformPaisa > 0 && resolvedPlatformWalletId) {
      const { rows } = await txClient.query(
        `INSERT INTO escrow_entries (sub_order_id, wallet_id, beneficiary_role, amount, status, hold_until)
         VALUES ($1, $2, $3, $4::numeric(14,2), 'LOCKED', $5)
         ON CONFLICT (sub_order_id, wallet_id, beneficiary_role)
         DO UPDATE SET amount = EXCLUDED.amount, status = 'LOCKED', hold_until = EXCLUDED.hold_until
         RETURNING id, sub_order_id, wallet_id, beneficiary_role, amount, status, hold_until`,
        [subOrderId, resolvedPlatformWalletId, 'PLATFORM', (platformPaisa / 100).toFixed(2), holdUntil]
      );
      createdEscrowEntries.push(rows[0]);
    }

    // 5. Construct double-entry ledger entries:
    // DEBIT: Buyer / Funding Wallet (AVAILABLE bucket)
    // CREDIT: Beneficiary Wallets (ESCROW bucket)
    const txnGroupId = randomUUID();
    const ledgerEntries = [
      {
        walletId: resolvedBuyerWalletId,
        entryType: 'DEBIT',
        amount: (totalPaisa / 100).toFixed(2),
        balanceBucket: 'AVAILABLE',
        category: 'ESCROW_LOCK',
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:buyer_debit` : `escrow_lock:${subOrderId}:buyer`,
        memo: `Escrow deposit hold for sub-order #${subOrderId}`,
        createdBy,
      },
    ];

    if (supplierPaisa > 0) {
      ledgerEntries.push({
        walletId: resolvedSupplierWalletId,
        entryType: 'CREDIT',
        amount: (supplierPaisa / 100).toFixed(2),
        balanceBucket: 'ESCROW',
        category: 'ESCROW_LOCK',
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:sup_escrow` : `escrow_lock:${subOrderId}:sup`,
        memo: `Supplier pending escrow hold for sub-order #${subOrderId}`,
        createdBy,
      });
    }

    if (salerPaisa > 0 && resolvedSalerWalletId) {
      ledgerEntries.push({
        walletId: resolvedSalerWalletId,
        entryType: 'CREDIT',
        amount: (salerPaisa / 100).toFixed(2),
        balanceBucket: 'ESCROW',
        category: 'ESCROW_LOCK',
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:saler_escrow` : `escrow_lock:${subOrderId}:saler`,
        memo: `Saler pending commission escrow hold for sub-order #${subOrderId}`,
        createdBy,
      });
    }

    if (platformPaisa > 0 && resolvedPlatformWalletId) {
      ledgerEntries.push({
        walletId: resolvedPlatformWalletId,
        entryType: 'CREDIT',
        amount: (platformPaisa / 100).toFixed(2),
        balanceBucket: 'ESCROW',
        category: 'ESCROW_LOCK',
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:platform_escrow` : `escrow_lock:${subOrderId}:platform`,
        memo: `Platform margin escrow hold for sub-order #${subOrderId}`,
        createdBy,
      });
    }

    const ledgerResult = await ledgerService.recordTransactionGroup(txClient, {
      txnGroupId,
      entries: ledgerEntries,
      defaultCategory: 'ESCROW_LOCK',
      defaultReferenceType: 'SUB_ORDER',
      defaultReferenceId: subOrderId,
      createdBy,
    });

    return {
      success: true,
      subOrderId,
      totalDeposited: (totalPaisa / 100).toFixed(2),
      escrowEntries: createdEscrowEntries,
      txnGroupId,
      ledgerResult,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Releases held escrow funds for a sub-order, moving pending_escrow_balance → available_balance.
 * Strictly idempotent: retrying for an already-released sub-order safely returns without double-crediting.
 *
 * @param {import('pg').Pool} db
 * @param {Object} params
 * @param {number} params.subOrderId
 * @param {number} [params.releasedBy] - User ID releasing escrow
 * @param {string} [params.idempotencyKey]
 * @param {import('pg').PoolClient} [params.client]
 */
export async function releaseEscrow(db, {
  subOrderId,
  releasedBy = null,
  idempotencyKey = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Fetch and lock escrow entries for this sub-order
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

    // 1b. Check COD reconciliation requirement (Prompt 6.4: Requirement 5)
    // Only release supplier/saler escrow for a COD order once its cash is reconciled
    const { rows: orderRows } = await txClient.query(
      `SELECT o.payment_method, s.payment_method AS sub_payment_method
       FROM sub_orders s
       JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1`,
      [subOrderId]
    );
    const isCod = orderRows[0]?.payment_method === 'COD' || orderRows[0]?.sub_payment_method === 'COD';

    if (isCod) {
      const { rows: codRows } = await txClient.query(
        `SELECT status FROM cod_reconciliation WHERE sub_order_id = $1`,
        [subOrderId]
      );
      const codStatus = codRows[0]?.status;
      if (codStatus !== 'MATCHED' && codStatus !== 'RESOLVED') {
        throw new Error(
          `COD_FUNDS_NOT_RECONCILED: Cannot release escrow for COD sub-order #${subOrderId} until courier cash is reconciled (current status: ${codStatus || 'AWAITING'}).`
        );
      }
    }

    // 2. Check if already completely released (Idempotency protection)
    const lockedEntries = escrowRows.filter((e) => e.status === 'LOCKED');
    if (lockedEntries.length === 0) {
      const allReleased = escrowRows.every((e) => e.status === 'RELEASED');
      return {
        alreadyReleased: allReleased,
        success: allReleased,
        subOrderId,
        escrowEntries: escrowRows,
        message: allReleased
          ? `Escrow for sub-order #${subOrderId} was already released.`
          : `No LOCKED escrow entries eligible for release (current statuses: ${escrowRows.map((e) => e.status).join(', ')})`,
      };
    }

    // 3. For each locked entry, build balanced double-entry entries:
    // DEBIT: Beneficiary Wallet (ESCROW bucket) -> reduces pending_escrow_balance
    // CREDIT: Beneficiary Wallet (AVAILABLE bucket) -> increases available_balance & lifetime_earned
    const txnGroupId = randomUUID();
    const ledgerEntries = [];
    const entryIdsToUpdate = [];

    for (const item of lockedEntries) {
      const amount = parseFloat(item.amount);
      if (amount <= 0) continue;

      entryIdsToUpdate.push(item.id);
      const category =
        item.beneficiary_role === 'SALER'
          ? 'SALE_COMMISSION'
          : item.beneficiary_role === 'SUPPLIER'
            ? 'SUPPLIER_PAYMENT'
            : 'ESCROW_RELEASE';

      // Debit ESCROW bucket
      ledgerEntries.push({
        walletId: item.wallet_id,
        entryType: 'DEBIT',
        amount: item.amount,
        balanceBucket: 'ESCROW',
        category: 'ESCROW_RELEASE',
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        idempotencyKey: idempotencyKey
          ? `${idempotencyKey}:${item.id}:escrow_debit`
          : `escrow_release:${subOrderId}:${item.id}:escrow_debit`,
        memo: `Release from escrow hold for sub-order #${subOrderId} (${item.beneficiary_role})`,
        createdBy: releasedBy,
      });

      // Credit AVAILABLE bucket
      ledgerEntries.push({
        walletId: item.wallet_id,
        entryType: 'CREDIT',
        amount: item.amount,
        balanceBucket: 'AVAILABLE',
        category,
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        idempotencyKey: idempotencyKey
          ? `${idempotencyKey}:${item.id}:avail_credit`
          : `escrow_release:${subOrderId}:${item.id}:avail_credit`,
        memo: `Funds credited to available balance from escrow for sub-order #${subOrderId} (${item.beneficiary_role})`,
        createdBy: releasedBy,
      });
    }

    if (ledgerEntries.length === 0) {
      return {
        success: true,
        subOrderId,
        message: 'Zero amount to release in locked escrow entries.',
      };
    }

    // 4. Record the double-entry transaction group
    const ledgerResult = await ledgerService.recordTransactionGroup(txClient, {
      txnGroupId,
      entries: ledgerEntries,
      defaultCategory: 'ESCROW_RELEASE',
      defaultReferenceType: 'SUB_ORDER',
      defaultReferenceId: subOrderId,
      createdBy: releasedBy,
    });

    // 5. Update escrow_entries status to RELEASED
    await txClient.query(
      `UPDATE escrow_entries
       SET status = 'RELEASED',
           released_at = now()
       WHERE id = ANY($1::bigint[])`,
      [entryIdsToUpdate]
    );

    return {
      success: true,
      subOrderId,
      releasedCount: entryIdsToUpdate.length,
      releasedEntries: lockedEntries,
      txnGroupId,
      ledgerResult,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Executes a clawback for a sub-order (e.g. return, dispute, or cancellation).
 * Reverses pending or available balances, zeroes saler commission, and refunds buyer.
 *
 * @param {import('pg').Pool} db
 * @param {Object} params
 * @param {number} params.subOrderId
 * @param {string} [params.reason='Order returned/disputed']
 * @param {number} [params.executedBy] - Staff user ID executing clawback
 * @param {number} [params.refundBuyerWalletId] - Buyer wallet ID to receive refund
 * @param {string} [params.idempotencyKey]
 * @param {import('pg').PoolClient} [params.client]
 */
export async function executeClawback(db, {
  subOrderId,
  reason = 'Order returned/disputed',
  executedBy = null,
  refundBuyerWalletId = null,
  idempotencyKey = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Lock escrow entries
    const { rows: escrowRows } = await txClient.query(
      `SELECT id, sub_order_id, wallet_id, beneficiary_role, amount, status
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
        message: `Escrow for sub-order #${subOrderId} is already fully clawed back.`,
      };
    }

    // 2. Resolve buyer wallet ID for refund credit if not passed
    let targetBuyerWalletId = refundBuyerWalletId;
    if (!targetBuyerWalletId) {
      const { rows: subOrderRows } = await txClient.query(
        `SELECT o.customer_id
         FROM sub_orders s
         JOIN orders o ON o.id = s.order_id
         WHERE s.id = $1`,
        [subOrderId]
      );
      if (subOrderRows.length > 0) {
        const bw = await walletRepo.getOrCreateWallet(db, subOrderRows[0].customer_id, { client: txClient });
        targetBuyerWalletId = bw.id;
      }
    }

    if (!targetBuyerWalletId) {
      throw new Error('BUYER_WALLET_REQUIRED: Could not resolve buyer wallet for refund credit during clawback.');
    }

    // 3. Build clawback entries:
    // For each entry:
    // If status == 'LOCKED': DEBIT Beneficiary (ESCROW bucket)
    // If status == 'RELEASED': DEBIT Beneficiary (AVAILABLE bucket) -> per spec, available balance can go negative only on clawback
    // Matching CREDIT: Buyer Wallet (AVAILABLE bucket) with category = 'REFUND'
    const txnGroupId = randomUUID();
    const ledgerEntries = [];
    let totalClawbackPaisa = 0;
    const entryIdsToClawback = [];

    for (const item of escrowRows) {
      if (item.status === 'CLAWED_BACK') continue;

      const amtPaisa = Math.round(parseFloat(item.amount) * 100);
      if (amtPaisa <= 0) continue;

      entryIdsToClawback.push(item.id);
      totalClawbackPaisa += amtPaisa;

      const sourceBucket = item.status === 'LOCKED' ? 'ESCROW' : 'AVAILABLE';

      ledgerEntries.push({
        walletId: item.wallet_id,
        entryType: 'DEBIT',
        amount: item.amount,
        balanceBucket: sourceBucket,
        category: 'CLAWBACK',
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        idempotencyKey: idempotencyKey
          ? `${idempotencyKey}:${item.id}:clawback_debit`
          : `clawback:${subOrderId}:${item.id}:debit`,
        memo: `Clawback deduction (${item.beneficiary_role}): ${reason}`,
        createdBy: executedBy,
      });
    }

    if (totalClawbackPaisa > 0) {
      ledgerEntries.push({
        walletId: targetBuyerWalletId,
        entryType: 'CREDIT',
        amount: (totalClawbackPaisa / 100).toFixed(2),
        balanceBucket: 'AVAILABLE',
        category: 'REFUND',
        referenceType: 'SUB_ORDER',
        referenceId: subOrderId,
        idempotencyKey: idempotencyKey
          ? `${idempotencyKey}:buyer_refund`
          : `clawback:${subOrderId}:buyer_refund`,
        memo: `Refund credited to buyer for sub-order #${subOrderId} (${reason})`,
        createdBy: executedBy,
      });
    }

    // 4. Record balanced double-entry ledger group
    const ledgerResult = await ledgerService.recordTransactionGroup(txClient, {
      txnGroupId,
      entries: ledgerEntries,
      defaultCategory: 'CLAWBACK',
      defaultReferenceType: 'SUB_ORDER',
      defaultReferenceId: subOrderId,
      createdBy: executedBy,
    });

    // 5. Update escrow_entries status to CLAWED_BACK
    await txClient.query(
      `UPDATE escrow_entries
       SET status = 'CLAWED_BACK'
       WHERE id = ANY($1::bigint[])`,
      [entryIdsToClawback]
    );

    return {
      success: true,
      subOrderId,
      clawedBackAmount: (totalClawbackPaisa / 100).toFixed(2),
      reason,
      txnGroupId,
      ledgerResult,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Checks ledger and wallet integrity across all platform wallets.
 */
export async function getIntegrityReport(db, { client } = {}) {
  return walletRepo.checkLedgerIntegrity(db, { client });
}
