/**
 * referralEscrow.service.js — what happens to a referral commission after it is earned.
 *
 * referral.service.evaluateQualifyingEvent credits the beneficiary's ESCROW bucket and writes a
 * `referral_earnings` row in PENDING_ESCROW. Nothing used to move it on from there: no job released
 * it when `escrow_release_at` passed, and an admin had no way to settle a held one. This file owns
 * the two ways out, each a balanced ledger group:
 *
 *   release  beneficiary ESCROW -> beneficiary AVAILABLE   (the commission becomes spendable)
 *   void     beneficiary ESCROW -> platform AVAILABLE      (the commission goes back to the treasury
 *                                                           that funded it; the earning is VOIDED)
 *
 * Both are only valid from PENDING_ESCROW and re-check that under a row lock, so a double click, two
 * admins or the job racing an admin settles an earning exactly once.
 */

import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import * as ledgerService from './ledger.service.js';
import { resolvePlatformWalletId } from './vault.service.js';

const DEFAULT_BATCH_SIZE = 200;

/** Moves one locked PENDING_ESCROW earning to AVAILABLE. Caller owns the transaction. */
async function releaseLocked(client, earning, memo) {
  const amount = Number(earning.commission_amount).toFixed(2);
  await ledgerService.recordTransactionGroup(client, {
    defaultCategory: 'ESCROW_RELEASE',
    defaultReferenceType: 'referral_earnings',
    defaultReferenceId: earning.id,
    memo,
    entries: [
      { walletId: earning.wallet_id, entryType: 'DEBIT', amount, balanceBucket: 'ESCROW' },
      { walletId: earning.wallet_id, entryType: 'CREDIT', amount, balanceBucket: 'AVAILABLE' },
    ],
  });
  await client.query(
    `UPDATE referral_earnings SET status = 'AVAILABLE', released_at = now(), updated_at = now() WHERE id = $1`,
    [earning.id]
  );
  return amount;
}

/** Returns one locked PENDING_ESCROW earning to the platform treasury. Caller owns the transaction. */
async function voidLocked(client, earning, platformWalletId, memo) {
  const amount = Number(earning.commission_amount).toFixed(2);
  await ledgerService.recordTransactionGroup(client, {
    defaultCategory: 'REFERRAL_REVERSAL',
    defaultReferenceType: 'referral_earnings',
    defaultReferenceId: earning.id,
    memo,
    entries: [
      { walletId: earning.wallet_id, entryType: 'DEBIT', amount, balanceBucket: 'ESCROW' },
      { walletId: platformWalletId, entryType: 'CREDIT', amount, balanceBucket: 'AVAILABLE' },
    ],
  });
  await client.query(
    `UPDATE referral_earnings SET status = 'VOIDED', updated_at = now() WHERE id = $1`,
    [earning.id]
  );
  return amount;
}

/**
 * Releases every earning whose holding period has ended. Earnings on a FRAUD_FLAGGED referral stay
 * put: a flag means a human has not decided yet, and the clock must not decide for them.
 */
export async function releaseDueEarnings(db, { batchSize = DEFAULT_BATCH_SIZE } = {}) {
  const { rows: due } = await db.query(
    `SELECT re.id
       FROM referral_earnings re
       JOIN referrals r ON r.id = re.referral_id
      WHERE re.status = 'PENDING_ESCROW'
        AND re.escrow_release_at <= now()
        AND r.status <> 'FRAUD_FLAGGED'
      ORDER BY re.escrow_release_at ASC
      LIMIT $1`,
    [batchSize]
  );

  let released = 0;
  let totalPaisa = 0;
  const errors = [];
  for (const { id } of due) {
    try {
      await withTransaction(db, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM referral_earnings WHERE id = $1 FOR UPDATE`,
          [id]
        );
        // Settled by an admin or another worker since the scan.
        if (!rows[0] || rows[0].status !== 'PENDING_ESCROW') return;
        const amount = await releaseLocked(client, rows[0], `Referral commission released after holding period (earning ${id})`);
        released += 1;
        totalPaisa += Math.round(Number(amount) * 100);
      });
    } catch (err) {
      errors.push({ earningId: id, message: err?.message || String(err) });
    }
  }

  return {
    scanned: due.length,
    released,
    totalReleased: (totalPaisa / 100).toFixed(2),
    errors,
    batchFull: due.length >= batchSize,
  };
}

/**
 * Settles every held earning on one referral inside the caller's transaction.
 * @param {'RELEASE'|'VOID'} decision
 * @returns {{ count: number, amount: string }}
 */
export async function settleReferralEarnings(client, referralId, decision, memo) {
  if (decision !== 'RELEASE' && decision !== 'VOID') {
    throw new AppError('VALIDATION_ERROR', 'decision must be RELEASE or VOID.');
  }
  const { rows: held } = await client.query(
    `SELECT * FROM referral_earnings WHERE referral_id = $1 AND status = 'PENDING_ESCROW' ORDER BY id FOR UPDATE`,
    [referralId]
  );
  if (held.length === 0) return { count: 0, amount: '0.00' };

  const platformWalletId = decision === 'VOID' ? await resolvePlatformWalletId(client, client) : null;
  let paisa = 0;
  for (const earning of held) {
    const amount = decision === 'RELEASE'
      ? await releaseLocked(client, earning, memo)
      : await voidLocked(client, earning, platformWalletId, memo);
    paisa += Math.round(Number(amount) * 100);
  }
  return { count: held.length, amount: (paisa / 100).toFixed(2) };
}
