/**
 * adRefund.ts — gives an advertiser's money back from the platform treasury, for ad formats that are
 * paid up front (FLAT_DAILY, FLAT_SLOT, CPS).
 *
 * One place for it because two flows need exactly the same entry: a rejected campaign (full price) and a
 * Push Blast that reached fewer people than were paid for (the unreached share).
 *
 * WHY one idempotency key PER ENTRY: the ledger stamps the key on every row it writes and the key is
 * unique, so a single group-level key collides with the group's own second entry (found by running a
 * refund against a real database). fastPayout.service uses the same `:suffix` convention.
 */

import { randomUUID } from 'node:crypto';
import * as walletRepo from '../repositories/wallet.repository.ts';
import * as ledgerService from './ledger.service.ts';

/**
 * @param client  a pg client inside the caller's transaction
 * @param opts.campaign  ad_campaigns row (needs id, user_id)
 * @param opts.amount    "0.00"-style string, must be > 0
 * @param opts.keyBase   unique per refund *reason* and campaign, e.g. `ad-reject-refund:42`
 */
export async function refundAdvertiser(client, { campaign, amount, memo, keyBase }) {
  const buyerWallet = await walletRepo.getOrCreateWallet(client, campaign.user_id, { client });

  const { rows: adminRows } = await client.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.key = 'super_admin'
     ORDER BY u.id ASC LIMIT 1`
  );
  const platformWallet = await walletRepo.getOrCreateWallet(client, adminRows[0]?.id ?? 1, { client });

  await ledgerService.recordTransactionGroup(client, {
    txnGroupId: randomUUID(),
    defaultCategory: 'AD_SPEND',
    defaultReferenceType: 'ad_campaigns',
    defaultReferenceId: campaign.id,
    memo,
    entries: [
      { walletId: buyerWallet.id, entryType: 'CREDIT', amount, balanceBucket: 'AVAILABLE', idempotencyKey: `${keyBase}:credit` },
      { walletId: platformWallet.id, entryType: 'DEBIT', amount, balanceBucket: 'AVAILABLE', idempotencyKey: `${keyBase}:debit` },
    ],
  });
}
