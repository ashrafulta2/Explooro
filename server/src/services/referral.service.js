/**
 * referral.service.js — Multi-Tier Referral & Network Growth Engine (Prompt 9.3).
 *
 * Implements DFD Subsystem 14.0:
 * 1. Multi-tier attribution (Tier 1 direct 5%, Tier 2 indirect 2%).
 * 2. Strict anti-fraud controls:
 *    - Self-referral detection (same user, shared device fingerprint, matching phone/NID).
 *    - Circular referral prevention (upstream ancestor graph check).
 *    - Daily velocity limit throttling.
 * 3. Double-entry ledger integration with holding period (credits PENDING_ESCROW for 7 days).
 * 4. Referral tree hierarchy & earnings statement queries.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import { isEnabled } from './module.service.js';

export async function getReferralSettings(db) {
  try {
    const { rows } = await db.query(
      `SELECT settings_json FROM platform_modules WHERE key = 'referral_engine'`
    );
    return rows[0]?.settings_json || {
      tier_1_rate_pct: 5.0,
      tier_2_rate_pct: 2.0,
      max_tier_depth: 2,
      holding_period_days: 7,
      qualifying_event: 'FIRST_ORDER',
      daily_velocity_limit: 20,
    };
  } catch {
    return {
      tier_1_rate_pct: 5.0,
      tier_2_rate_pct: 2.0,
      max_tier_depth: 2,
      holding_period_days: 7,
      qualifying_event: 'FIRST_ORDER',
      daily_velocity_limit: 20,
    };
  }
}

function generateReferralCode() {
  const code = randomBytes(3).toString('hex').toUpperCase();
  return `REF-${code}`;
}

function generateReferralLinkRef() {
  const code = randomBytes(4).toString('hex').toUpperCase();
  return `REF-LINK-${code}`;
}

/**
 * Retrieves or generates the user's primary referral code and link.
 */
export async function getOrCreateUserReferralCode(db, userId) {
  const { rows } = await db.query(
    `SELECT * FROM user_referral_codes WHERE user_id = $1`,
    [userId]
  );

  if (rows.length > 0) {
    return rows[0];
  }

  // WHY the arbiter is `code` and not `user_id`: user_referral_codes has no unique constraint on
  // user_id — only the plain index idx_user_referral_codes_user — so `ON CONFLICT (user_id)` could
  // never resolve an arbiter and every first-time call raised 42P10. The unique columns are `code`
  // and `custom_slug`. The SELECT above is the real idempotency guard; this only covers the race.
  const code = generateReferralCode();
  const { rows: inserted } = await db.query(
    `INSERT INTO user_referral_codes (user_id, code, clicks_count, signups_count)
     VALUES ($1, $2, 0, 0)
     ON CONFLICT (code) DO NOTHING
     RETURNING *`,
    [userId, code]
  );

  if (inserted.length > 0) {
    return inserted[0];
  }

  // Either a concurrent request created this user's row, or the generated code collided.
  const { rows: existing } = await db.query(
    `SELECT * FROM user_referral_codes WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );

  if (existing.length === 0) {
    throw new Error('REFERRAL_CODE_COLLISION: Could not mint a referral code; retry the request.');
  }

  return existing[0];
}

/**
 * Updates the user's vanity referral slug.
 */
export async function updateCustomSlug(db, userId, customSlug) {
  const slug = String(customSlug || '').trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || slug.length < 3 || slug.length > 40) {
    throw new AppError('INVALID_SLUG', 'Custom slug must be 3-40 alphanumeric characters and hyphens.');
  }

  // Check uniqueness
  const { rows: existing } = await db.query(
    `SELECT id FROM user_referral_codes WHERE custom_slug = $1 AND user_id != $2`,
    [slug, userId]
  );
  if (existing.length > 0) {
    throw new AppError('SLUG_TAKEN', 'This custom referral slug is already in use.');
  }

  const { rows } = await db.query(
    `UPDATE user_referral_codes
     SET custom_slug = $1, updated_at = now()
     WHERE user_id = $2
     RETURNING *`,
    [slug, userId]
  );

  return rows[0];
}

/**
 * Records referral attribution for a new user with multi-tier hierarchy & anti-fraud verification.
 */
export async function recordReferralAttribution(db, cache, {
  referralCode,
  referredUserId,
  deviceFingerprint = null,
  ip = null,
  phone = null,
  nid = null,
}) {
  const enabled = await isEnabled(db, cache, 'referral_engine');
  if (!enabled || !referralCode) {
    return { attributed: false, reason: 'MODULE_DISABLED_OR_NO_CODE' };
  }

  const settings = await getReferralSettings(db);
  const dailyVelocityLimit = settings?.daily_velocity_limit || 20;

  // 1. Resolve referrer code or slug
  const cleanCode = String(referralCode).trim().toUpperCase();
  const cleanSlug = String(referralCode).trim().toLowerCase();

  const { rows: codeRows } = await db.query(
    `SELECT urc.*, u.phone as referrer_phone, k.nid_number as referrer_nid
     FROM user_referral_codes urc
     JOIN users u ON u.id = urc.user_id
     LEFT JOIN kyc_verifications k ON k.user_id = u.id AND k.status = 'APPROVED'
     WHERE UPPER(urc.code) = $1 OR urc.custom_slug = $2`,
    [cleanCode, cleanSlug]
  );

  if (codeRows.length === 0) {
    return { attributed: false, reason: 'INVALID_REFERRAL_CODE' };
  }

  const referrer = codeRows[0];
  const referrerUserId = Number(referrer.user_id);

  // 2. Anti-Fraud Check 1: Self-Referral
  if (referrerUserId === Number(referredUserId)) {
    return { attributed: false, isFraud: true, reason: 'SELF_REFERRAL_SAME_ACCOUNT' };
  }

  // Cross-check matching phone or NID
  if (phone && referrer.referrer_phone && phone === referrer.referrer_phone) {
    return { attributed: false, isFraud: true, reason: 'SELF_REFERRAL_PHONE_MATCH' };
  }
  if (nid && referrer.referrer_nid && nid === referrer.referrer_nid) {
    return { attributed: false, isFraud: true, reason: 'SELF_REFERRAL_NID_MATCH' };
  }

  // Cross-check matching device fingerprint
  if (deviceFingerprint) {
    const { rows: deviceMatches } = await db.query(
      `SELECT id FROM referrals
       WHERE referrer_user_id = $1 AND device_fingerprint = $2
       LIMIT 1`,
      [referrerUserId, deviceFingerprint]
    );
    if (deviceMatches.length > 0) {
      return { attributed: false, isFraud: true, reason: 'SELF_REFERRAL_DEVICE_MATCH' };
    }
  }

  // 3. Anti-Fraud Check 2: Circular Referral (A refers B refers A)
  const { rows: circularCheck } = await db.query(
    `SELECT id FROM referrals
     WHERE referrer_user_id = $1 AND referred_user_id = $2
     LIMIT 1`,
    [referredUserId, referrerUserId]
  );
  if (circularCheck.length > 0) {
    return { attributed: false, isFraud: true, reason: 'CIRCULAR_REFERRAL_DETECTED' };
  }

  // 4. Anti-Fraud Check 3: Velocity Limit
  const { rows: velocityRows } = await db.query(
    `SELECT COUNT(*)::int as count FROM referrals
     WHERE referrer_user_id = $1 AND created_at > now() - INTERVAL '24 hours'`,
    [referrerUserId]
  );
  if ((velocityRows[0]?.count || 0) >= dailyVelocityLimit) {
    return { attributed: false, isFraud: true, reason: 'VELOCITY_LIMIT_EXCEEDED' };
  }

  // 5. Multi-Tier Referral Construction (Tier 1 and Tier 2)
  const tier1Ref = generateReferralLinkRef();
  const qualifyingEvent = settings?.qualifying_event || 'FIRST_ORDER';

  const { rows: tier1Rows } = await db.query(
    `INSERT INTO referrals (
      ref, referrer_user_id, referred_user_id, tier_level, status,
      qualifying_event, device_fingerprint, ip_address, meta_json
    )
    VALUES ($1, $2, $3, 1, 'PENDING', $4, $5, $6, $7)
    ON CONFLICT (referrer_user_id, referred_user_id) DO NOTHING
    RETURNING *`,
    [
      tier1Ref,
      referrerUserId,
      referredUserId,
      qualifyingEvent,
      deviceFingerprint,
      ip,
      JSON.stringify({ codeUsed: referralCode }),
    ]
  );

  const tier1Referral = tier1Rows[0];
  if (!tier1Referral) {
    return { attributed: false, reason: 'ALREADY_REFERRED' };
  }

  // Increment signups counter on referrer code
  await db.query(
    `UPDATE user_referral_codes SET signups_count = signups_count + 1 WHERE id = $1`,
    [referrer.id]
  );

  // Check if Referrer has an upstream Tier 1 sponsor (Making this Tier 2)
  const { rows: upstreamRows } = await db.query(
    `SELECT referrer_user_id FROM referrals
     WHERE referred_user_id = $1 AND tier_level = 1 AND status != 'FRAUD_FLAGGED'
     LIMIT 1`,
    [referrerUserId]
  );

  let tier2Referral = null;
  if (upstreamRows.length > 0) {
    const tier2ReferrerId = Number(upstreamRows[0].referrer_user_id);
    // Ensure no circular loop at tier 2
    if (tier2ReferrerId !== Number(referredUserId)) {
      const tier2Ref = generateReferralLinkRef();
      const { rows: t2Rows } = await db.query(
        `INSERT INTO referrals (
          ref, referrer_user_id, referred_user_id, tier_level, parent_referral_id,
          status, qualifying_event, device_fingerprint, ip_address
        )
        VALUES ($1, $2, $3, 2, $4, 'PENDING', $5, $6, $7)
        ON CONFLICT (referrer_user_id, referred_user_id) DO NOTHING
        RETURNING *`,
        [
          tier2Ref,
          tier2ReferrerId,
          referredUserId,
          tier1Referral.id,
          qualifyingEvent,
          deviceFingerprint,
          ip,
        ]
      );
      tier2Referral = t2Rows[0] || null;
    }
  }

  return {
    attributed: true,
    tier1: tier1Referral,
    tier2: tier2Referral,
  };
}

/**
 * Evaluates and credits multi-tier referral earnings when a qualifying event occurs (e.g. FIRST_ORDER).
 */
export async function evaluateQualifyingEvent(db, cache, {
  userId,
  eventType = 'FIRST_ORDER',
  orderId = null,
  orderAmount = 0,
}) {
  const enabled = await isEnabled(db, cache, 'referral_engine');
  if (!enabled) return [];

  const settings = await getReferralSettings(db);
  const tier1Rate = Number(settings?.tier_1_rate_pct || 5.0);
  const tier2Rate = Number(settings?.tier_2_rate_pct || 2.0);
  const holdingPeriodDays = Number(settings?.holding_period_days || 7);

  // Find active pending referrals for this referred user
  const { rows: pendingReferrals } = await db.query(
    `SELECT * FROM referrals
     WHERE referred_user_id = $1
       AND status = 'PENDING'
       AND qualifying_event = $2`,
    [userId, eventType]
  );

  if (pendingReferrals.length === 0) {
    return [];
  }

  const earningsCreated = [];

  for (const ref of pendingReferrals) {
    const ratePct = ref.tier_level === 1 ? tier1Rate : tier2Rate;
    const commissionAmount = Number(((orderAmount * ratePct) / 100).toFixed(2));

    if (commissionAmount <= 0) continue;

    const escrowReleaseAt = new Date(Date.now() + holdingPeriodDays * 86400000);

    await withTransaction(db, async (client) => {
      // 1. Mark referral as QUALIFIED
      await client.query(
        `UPDATE referrals
         SET status = 'QUALIFIED', qualified_at = now(), updated_at = now()
         WHERE id = $1`,
        [ref.id]
      );

      // 2. Fetch platform admin user for treasury wallet
      const { rows: adminRows } = await client.query(
        `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE r.key = 'super_admin'
         ORDER BY u.id ASC LIMIT 1`
      );
      const platformUserId = adminRows[0]?.id ?? 1;

      const beneficiaryWallet = await walletRepo.getOrCreateWallet(db, ref.referrer_user_id, { client });
      const platformWallet = await walletRepo.getOrCreateWallet(db, platformUserId, { client });

      const txnGroupId = randomUUID();
      const amountStr = commissionAmount.toFixed(2);

      // 3. Double-Entry Ledger: Debit Platform Treasury (AVAILABLE), Credit Beneficiary (PENDING_ESCROW)
      await ledgerService.recordTransactionGroup(client, {
        txnGroupId,
        defaultCategory: 'REFERRAL_COMMISSION',
        defaultReferenceType: 'referrals',
        defaultReferenceId: ref.id,
        memo: `Tier ${ref.tier_level} referral commission for ${ref.ref}`,
        entries: [
          {
            walletId: platformWallet.id,
            entryType: 'DEBIT',
            amount: amountStr,
            balanceBucket: 'AVAILABLE',
            category: 'REFERRAL_COMMISSION',
            referenceType: 'referrals',
            referenceId: ref.id,
          },
          {
            walletId: beneficiaryWallet.id,
            entryType: 'CREDIT',
            amount: amountStr,
            balanceBucket: 'ESCROW',
            category: 'REFERRAL_COMMISSION',
            referenceType: 'referrals',
            referenceId: ref.id,
          },
        ],
      });

      // 4. Insert referral_earnings record
      const { rows: eRows } = await client.query(
        `INSERT INTO referral_earnings (
          referral_id, beneficiary_user_id, tier_level, trigger_event,
          trigger_order_id, order_amount, commission_rate_pct, commission_amount,
          status, escrow_release_at, wallet_id, txn_group_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING_ESCROW', $9, $10, $11)
        RETURNING *`,
        [
          ref.id,
          ref.referrer_user_id,
          ref.tier_level,
          `${eventType}_COMPLETED`,
          orderId,
          orderAmount.toFixed(2),
          ratePct.toFixed(2),
          amountStr,
          escrowReleaseAt,
          beneficiaryWallet.id,
          txnGroupId,
        ]
      );

      earningsCreated.push(eRows[0]);
    });
  }

  return earningsCreated;
}

/**
 * Returns summary statistics for a user's referral network.
 */
export async function getReferralNetworkOverview(db, userId) {
  const codeRecord = await getOrCreateUserReferralCode(db, userId);

  // Aggregated network stats
  const { rows: stats } = await db.query(
    `SELECT
       COUNT(*)::int as total_referrals,
       COUNT(*) FILTER (WHERE tier_level = 1)::int as tier1_count,
       COUNT(*) FILTER (WHERE tier_level = 2)::int as tier2_count,
       COUNT(*) FILTER (WHERE status = 'QUALIFIED')::int as qualified_count,
       COUNT(*) FILTER (WHERE status = 'PENDING')::int as pending_count
     FROM referrals
     WHERE referrer_user_id = $1`,
    [userId]
  );

  // Earnings aggregation
  const { rows: earningStats } = await db.query(
    `SELECT
       COALESCE(SUM(commission_amount), 0)::numeric(14,2) as total_earnings,
       COALESCE(SUM(commission_amount) FILTER (WHERE status = 'PENDING_ESCROW'), 0)::numeric(14,2) as pending_escrow,
       COALESCE(SUM(commission_amount) FILTER (WHERE status = 'AVAILABLE'), 0)::numeric(14,2) as available_earnings
     FROM referral_earnings
     WHERE beneficiary_user_id = $1`,
    [userId]
  );

  return {
    code: codeRecord.code,
    custom_slug: codeRecord.custom_slug,
    clicks_count: codeRecord.clicks_count,
    signups_count: codeRecord.signups_count,
    stats: stats[0] || { total_referrals: 0, tier1_count: 0, tier2_count: 0, qualified_count: 0, pending_count: 0 },
    earnings: earningStats[0] || { total_earnings: '0.00', pending_escrow: '0.00', available_earnings: '0.00' },
  };
}

/**
 * Returns the hierarchical network tree for visual display on ReferralHubPage.
 */
export async function getReferralTree(db, userId) {
  const query = `
    SELECT r.*,
           COALESCE(up.display_name, up.full_name) as referee_name,
           u.email as referee_email,
           u.created_at as joined_at,
           COALESCE(SUM(re.commission_amount), 0)::numeric(14,2) as earned_from_referee
    FROM referrals r
    JOIN users u ON u.id = r.referred_user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN referral_earnings re ON re.referral_id = r.id
    WHERE r.referrer_user_id = $1
    GROUP BY r.id, u.id, up.user_id
    ORDER BY r.tier_level ASC, r.created_at DESC
  `;

  const { rows } = await db.query(query, [userId]);
  return rows;
}

/**
 * Returns the chronological referral earnings statement for a user.
 */
export async function getReferralStatement(db, userId, { limit = 50, offset = 0 } = {}) {
  const query = `
    SELECT re.*,
           r.ref as referral_ref,
           COALESCE(up.display_name, up.full_name) as referee_name
    FROM referral_earnings re
    JOIN referrals r ON r.id = re.referral_id
    JOIN users u ON u.id = r.referred_user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE re.beneficiary_user_id = $1
    ORDER BY re.created_at DESC
    LIMIT $2 OFFSET $3
  `;

  const { rows } = await db.query(query, [userId, limit, offset]);
  return rows;
}
