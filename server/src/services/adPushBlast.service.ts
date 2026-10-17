/**
 * adPushBlast.service.ts — delivery and settlement of the Push Notification Blast ad format.
 *
 * A shop partner buys N recipients up front (CPS, prepaid, placement PUSH_INBOX). Until this service
 * existed nothing ever sent the push, so the money was taken for a product that was never delivered.
 *
 * The rules, each of which exists to protect either the shopper or the advertiser's money:
 *
 *   1. AUDIENCE — active customers who have not switched marketing push off, never the advertiser,
 *      never the same shopper twice for one campaign, and never a shopper who already received ANY
 *      ad push within `push_frequency_days` (default 3). A shop partner's budget does not buy the
 *      right to spam; the cap is per shopper, across all advertisers.
 *   2. AT MOST ONCE — the (campaign, shopper) row in ad_push_deliveries is inserted BEFORE the send.
 *      A crash or a second worker meets the UNIQUE key and skips. A failed send removes the claim so
 *      that shopper is not counted as reached.
 *   3. PER RECIPIENT DELIVERED — the format is priced per recipient reached. When the campaign ends
 *      (quantity reached, or its end date passes) the unreached share of the prepaid amount goes back
 *      to the advertiser's vault. The refund is proportional to what was actually paid, so a tier
 *      discount or service fee in the original quote is respected without re-deriving a rate.
 *
 * Tunables live in the `sponsored_ads` module's settings_json, not here: `push_frequency_days`,
 * `push_batch_size`.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.ts';
import { writeAudit } from '../lib/audit.ts';
import { isEnabled } from './module.service.ts';
import * as walletRepo from '../repositories/wallet.repository.ts';
import * as ledgerService from './ledger.service.ts';
import { notify } from './notification.service.ts';

export const PUSH_PLACEMENT = 'PUSH_INBOX';
export const PUSH_TEMPLATE_KEY = 'AD_PUSH_BLAST';

/** Bounds for the two module settings. Out-of-range or missing values fall back to the default. */
export const PUSH_SETTING_LIMITS = {
  push_frequency_days: { min: 1, max: 30, default: 3 },
  push_batch_size: { min: 50, max: 5000, default: 500 },
};

/** How many campaigns one sweep will work on, so a backlog cannot hold the scheduler's lock for long. */
const CAMPAIGNS_PER_SWEEP = 5;

function clampSetting(raw, key) {
  const lim = PUSH_SETTING_LIMITS[key];
  const n = Number(raw);
  if (!Number.isInteger(n) || n < lim.min || n > lim.max) return lim.default;
  return n;
}

export async function loadPushSettings(db) {
  const { rows } = await db.query(`SELECT settings_json FROM platform_modules WHERE key = 'sponsored_ads'`);
  const s = rows[0]?.settings_json || {};
  return {
    frequencyDays: clampSetting(s.push_frequency_days, 'push_frequency_days'),
    batchSize: clampSetting(s.push_batch_size, 'push_batch_size'),
  };
}

/** Recipients still owed on a campaign. */
export function remainingToSend(campaign) {
  return Math.max(0, Number(campaign.quantity || 0) - Number(campaign.push_delivered_count || 0));
}

/** A campaign is finished when everyone paid for was reached, or when its end date has passed. */
export function isSettleDue(campaign, now = new Date()) {
  if (remainingToSend(campaign) === 0) return true;
  return Boolean(campaign.end_date) && new Date(campaign.end_date).getTime() <= now.getTime();
}

/**
 * The share of the prepaid amount that belongs to recipients who were never reached, in whole paisa
 * rounded DOWN so the platform never refunds a fraction of a paisa it did not take.
 * Returns a "0.00"-style string.
 */
export function undeliveredRefund(prepaidAmount, quantity, delivered) {
  const qty = Number(quantity);
  const reached = Math.min(Number(delivered), qty);
  if (!(qty > 0) || reached >= qty) return '0.00';
  const paid = Math.round(Number(prepaidAmount) * 100);
  const refundPaisa = Math.floor((paid * (qty - reached)) / qty);
  return (refundPaisa / 100).toFixed(2);
}

async function findPendingCampaigns(db, limit) {
  const { rows } = await db.query(
    `SELECT c.id, c.ref, c.user_id, c.title, c.quantity, c.push_delivered_count, c.prepaid_amount,
            c.end_date, c.status,
            cr.headline, cr.description, cr.destination_url
     FROM ad_campaigns c
     JOIN ad_creatives cr ON cr.campaign_id = c.id
     WHERE c.placement = $1
       AND c.billing_mode = 'PREPAID'
       AND c.push_settled_at IS NULL
       AND c.status IN ('ACTIVE', 'SCHEDULED')
       AND c.start_date <= now()
     ORDER BY c.start_date ASC, c.id ASC
     LIMIT $2`,
    [PUSH_PLACEMENT, limit]
  );
  return rows;
}

async function findAudience(db, campaign, { frequencyDays, limit }) {
  const { rows } = await db.query(
    `SELECT u.id
     FROM users u
     WHERE u.status = 'ACTIVE'
       AND u.deleted_at IS NULL
       AND u.id <> $2
       AND EXISTS (
         SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id AND r.key = 'customer'
       )
       AND NOT EXISTS (
         SELECT 1 FROM notification_preferences np
         WHERE np.user_id = u.id AND np.category = 'MARKETING' AND np.push_enabled = false
       )
       AND NOT EXISTS (
         SELECT 1 FROM ad_push_deliveries d
         WHERE d.user_id = u.id
           AND (d.campaign_id = $1 OR d.sent_at > now() - make_interval(days => $3::int))
       )
     ORDER BY md5(u.id::text || $1::text)
     LIMIT $4`,
    [campaign.id, campaign.user_id, frequencyDays, limit]
  );
  return rows.map((r) => r.id);
}

/** Sends one shopper their push. Returns true only if it was sent and counted. */
async function deliverOne(db, campaign, userId) {
  const { rows: claim } = await db.query(
    `INSERT INTO ad_push_deliveries (campaign_id, user_id) VALUES ($1, $2)
     ON CONFLICT (campaign_id, user_id) DO NOTHING
     RETURNING id`,
    [campaign.id, userId]
  );
  if (claim.length === 0) return false; // another worker (or an earlier run) already took this shopper

  try {
    const result = await notify(db, {
      userId,
      templateKey: PUSH_TEMPLATE_KEY,
      data: {
        headline: campaign.headline || campaign.title,
        body: campaign.description || '',
        destinationUrl: campaign.destination_url || '/',
        campaignRef: campaign.ref,
      },
      channels: ['PUSH', 'INAPP'],
    });
    await db.query(`UPDATE ad_push_deliveries SET notification_id = $2 WHERE id = $1`, [claim[0].id, result.notificationId]);
    await db.query(`UPDATE ad_campaigns SET push_delivered_count = push_delivered_count + 1 WHERE id = $1`, [campaign.id]);
    return true;
  } catch (err) {
    // The shopper was not reached, so they must not be counted as reached or locked out.
    await db.query(`DELETE FROM ad_push_deliveries WHERE id = $1`, [claim[0].id]).catch(() => {});
    console.error(`Ad push to user ${userId} for campaign ${campaign.ref} failed:`, err.message);
    return false;
  }
}

/**
 * Closes a campaign and gives back the money for recipients who were paid for but never reached.
 * Safe to call twice: the second call finds `push_settled_at` set and does nothing.
 */
export async function settleCampaign(db, campaignId) {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(`SELECT * FROM ad_campaigns WHERE id = $1 FOR UPDATE`, [campaignId]);
    const campaign = rows[0];
    if (!campaign || campaign.push_settled_at) return null;

    const refund = undeliveredRefund(campaign.prepaid_amount, campaign.quantity, campaign.push_delivered_count);

    if (Number(refund) > 0) {
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
        memo: `Refund for ${campaign.quantity - campaign.push_delivered_count} push recipients not reached (campaign ${campaign.ref})`,
        // WHY one key per entry, not per group: the ledger stamps the key on every row it writes, and
        // the key is unique, so a group-level key collides with its own second entry. The key also
        // means a retry after a half-finished run cannot refund twice (fastPayout.service does the same).
        entries: [
          { walletId: buyerWallet.id, entryType: 'CREDIT', amount: refund, balanceBucket: 'AVAILABLE', idempotencyKey: `ad-push-refund:${campaign.id}:credit` },
          { walletId: platformWallet.id, entryType: 'DEBIT', amount: refund, balanceBucket: 'AVAILABLE', idempotencyKey: `ad-push-refund:${campaign.id}:debit` },
        ],
      });
    }

    await client.query(
      `UPDATE ad_campaigns SET status = 'COMPLETED', push_settled_at = now(), updated_at = now() WHERE id = $1`,
      [campaign.id]
    );

    await writeAudit(client, {
      action: 'growth.ad.push_settled',
      targetType: 'ad_campaigns',
      targetRef: campaign.id,
      before: { status: campaign.status, push_delivered_count: campaign.push_delivered_count },
      after: {
        status: 'COMPLETED',
        purchased: campaign.quantity,
        delivered: campaign.push_delivered_count,
        refunded_amount: refund,
      },
    });

    return { campaignId: campaign.id, purchased: campaign.quantity, delivered: campaign.push_delivered_count, refunded: refund };
  });
}

/**
 * One sweep: send what is due for each pending blast, then settle any that finished.
 * Sending stops while the `sponsored_ads` module is off, but settlement never does — switching the
 * module off must not strand an advertiser's refund.
 */
export async function runPushBlastSweep(db, cache, now = new Date()) {
  const adsOn = await isEnabled(db, cache, 'sponsored_ads');
  const settings = await loadPushSettings(db);
  const campaigns = await findPendingCampaigns(db, CAMPAIGNS_PER_SWEEP);

  let sent = 0;
  let failed = 0;
  const settled = [];

  for (const campaign of campaigns) {
    let current = campaign;

    if (adsOn) {
      const room = Math.min(remainingToSend(current), settings.batchSize);
      if (room > 0) {
        const audience = await findAudience(db, current, { frequencyDays: settings.frequencyDays, limit: room });
        for (const userId of audience) {
          if (await deliverOne(db, current, userId)) sent += 1;
          else failed += 1;
        }
        const { rows } = await db.query(`SELECT push_delivered_count FROM ad_campaigns WHERE id = $1`, [current.id]);
        current = { ...current, push_delivered_count: rows[0]?.push_delivered_count ?? current.push_delivered_count };
      }
    }

    if (isSettleDue(current, now)) {
      const result = await settleCampaign(db, current.id);
      if (result) settled.push(result);
    }
  }

  return { campaigns: campaigns.length, sent, failed, settled };
}
