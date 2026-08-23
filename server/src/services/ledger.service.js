/**
 * ledger.service.js — Double-Entry General Ledger Service (Prompt 6.1).
 *
 * Enforces:
 * - Mathematical balance invariant: SUM(Debits) === SUM(Credits) across every transaction group.
 * - Single-sided writes fail immediately before any database mutation.
 * - Pessimistic row-locking (SELECT ... FOR UPDATE) in deterministic ascending wallet order.
 * - Immutable append-only audit trail linking each balance movement to a business entity.
 */

import { randomUUID } from 'node:crypto';
import * as walletRepo from '../repositories/wallet.repository.js';

/**
 * Converts a monetary value to integer paisa to eliminate floating-point rounding errors.
 */
function toPaisa(val) {
  const num = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(num)) {
    throw new Error(`INVALID_AMOUNT: "${val}" is not a valid number`);
  }
  return Math.round(num * 100);
}

/**
 * Formats integer paisa into 2-decimal string.
 */
function fromPaisa(paisa) {
  return (paisa / 100).toFixed(2);
}

/**
 * Records a balanced double-entry transaction group within an active database transaction.
 *
 * @param {import('pg').PoolClient} client - Checked-out database client inside BEGIN/COMMIT
 * @param {Object} params
 * @param {string} [params.txnGroupId] - Shared UUID for this balanced transaction group
 * @param {Array<{walletId: number, entryType: 'DEBIT'|'CREDIT', amount: string|number, balanceBucket: 'AVAILABLE'|'ESCROW'|'HELD', category?: string, referenceType?: string, referenceId?: number, idempotencyKey?: string, memo?: string, createdBy?: number}>} params.entries
 * @param {string} [params.defaultCategory] - Default category if not provided per entry
 * @param {string} [params.defaultReferenceType] - Default referenceType if not provided per entry
 * @param {number} [params.defaultReferenceId] - Default referenceId if not provided per entry
 * @param {string} [params.idempotencyKey] - Group-level idempotency key
 * @param {string} [params.memo] - Group-level memo
 * @param {number} [params.createdBy] - User ID initiating the transaction
 */
export async function recordTransactionGroup(client, {
  txnGroupId = randomUUID(),
  entries = [],
  defaultCategory = 'ADJUSTMENT',
  defaultReferenceType = 'MANUAL',
  defaultReferenceId = 0,
  idempotencyKey = null,
  memo = null,
  createdBy = null,
} = {}) {
  if (!entries || entries.length < 2) {
    throw new Error('DOUBLE_ENTRY_VIOLATION: A transaction group must contain at least 2 entries (debit and credit).');
  }

  let totalDebitsPaisa = 0;
  let totalCreditsPaisa = 0;
  const normalizedEntries = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const amountPaisa = toPaisa(e.amount);

    if (amountPaisa <= 0) {
      throw new Error(`INVALID_AMOUNT: Entry at index ${i} has amount <= 0 (${e.amount})`);
    }

    if (e.entryType !== 'DEBIT' && e.entryType !== 'CREDIT') {
      throw new Error(`INVALID_ENTRY_TYPE: Entry at index ${i} has invalid entryType "${e.entryType}". Must be 'DEBIT' or 'CREDIT'.`);
    }

    if (e.balanceBucket !== 'AVAILABLE' && e.balanceBucket !== 'ESCROW' && e.balanceBucket !== 'HELD') {
      throw new Error(`INVALID_BALANCE_BUCKET: Entry at index ${i} has invalid balanceBucket "${e.balanceBucket}". Must be 'AVAILABLE', 'ESCROW', or 'HELD'.`);
    }

    if (e.entryType === 'DEBIT') {
      totalDebitsPaisa += amountPaisa;
    } else {
      totalCreditsPaisa += amountPaisa;
    }

    normalizedEntries.push({
      txn_group_id: txnGroupId,
      wallet_id: parseInt(e.walletId, 10),
      entry_type: e.entryType,
      amount: fromPaisa(amountPaisa),
      amountPaisa,
      balance_bucket: e.balanceBucket,
      category: e.category ?? defaultCategory,
      reference_type: e.referenceType ?? defaultReferenceType,
      reference_id: parseInt(e.referenceId ?? defaultReferenceId, 10),
      idempotency_key: e.idempotencyKey ?? idempotencyKey ?? null,
      memo: e.memo ?? memo ?? null,
      created_by: e.createdBy ?? createdBy ?? null,
    });
  }

  // 1. Enforce mathematical equality: Debits == Credits
  if (totalDebitsPaisa !== totalCreditsPaisa) {
    throw new Error(
      `UNBALANCED_TRANSACTION_GROUP: Total Debits (৳${fromPaisa(totalDebitsPaisa)}) does not equal Total Credits (৳${fromPaisa(totalCreditsPaisa)}). Single-sided writes are forbidden.`
    );
  }

  // 2. Collect distinct wallet IDs and lock them in deterministic order
  const distinctWalletIds = [...new Set(normalizedEntries.map((e) => e.wallet_id))];
  const lockedWallets = await walletRepo.getWalletsByIdsForUpdate(client, distinctWalletIds);

  if (lockedWallets.length !== distinctWalletIds.length) {
    const foundIds = new Set(lockedWallets.map((w) => w.id));
    const missing = distinctWalletIds.filter((id) => !foundIds.has(id));
    throw new Error(`WALLET_NOT_FOUND: The following wallet IDs were not found: ${missing.join(', ')}`);
  }

  // 3. Aggregate balance bucket deltas per wallet
  const walletDeltas = new Map();
  for (const walletId of distinctWalletIds) {
    walletDeltas.set(walletId, {
      availablePaisa: 0,
      pendingEscrowPaisa: 0,
      heldPaisa: 0,
      lifetimeEarnedPaisa: 0,
      lifetimeWithdrawnPaisa: 0,
    });
  }

  for (const entry of normalizedEntries) {
    const d = walletDeltas.get(entry.wallet_id);
    const sign = entry.entry_type === 'CREDIT' ? 1 : -1;
    const delta = sign * entry.amountPaisa;

    if (entry.balance_bucket === 'AVAILABLE') {
      d.availablePaisa += delta;
      if (entry.entry_type === 'CREDIT' && (entry.category === 'SALE_COMMISSION' || entry.category === 'SUPPLIER_PAYMENT' || entry.category === 'ESCROW_RELEASE')) {
        d.lifetimeEarnedPaisa += entry.amountPaisa;
      }
      if (entry.entry_type === 'DEBIT' && entry.category === 'PAYOUT') {
        d.lifetimeWithdrawnPaisa += entry.amountPaisa;
      }
    } else if (entry.balance_bucket === 'ESCROW') {
      d.pendingEscrowPaisa += delta;
    } else if (entry.balance_bucket === 'HELD') {
      d.heldPaisa += delta;
    }
  }

  // 4. Insert append-only ledger transaction rows
  const insertedLedgerRows = await walletRepo.insertLedgerEntries(client, normalizedEntries);

  // 5. Mutate wallet balance buckets atomically
  const updatedWallets = [];
  for (const [walletId, deltas] of walletDeltas.entries()) {
    const updated = await walletRepo.updateWalletBalances(client, walletId, {
      availableDelta: fromPaisa(deltas.availablePaisa),
      pendingEscrowDelta: fromPaisa(deltas.pendingEscrowPaisa),
      heldDelta: fromPaisa(deltas.heldPaisa),
      lifetimeEarnedDelta: fromPaisa(deltas.lifetimeEarnedPaisa),
      lifetimeWithdrawnDelta: fromPaisa(deltas.lifetimeWithdrawnPaisa),
    });
    updatedWallets.push(updated);
  }

  return {
    txnGroupId,
    entries: insertedLedgerRows,
    updatedWallets,
    totalAmount: fromPaisa(totalDebitsPaisa),
  };
}
