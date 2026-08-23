/**
 * ads.service.js — Sponsored Ads Engine Service (Prompt 9.1).
 *
 * Implements:
 * - Campaign Lifecycle: Create, update, pause, resume, auto/manual review.
 * - Granular Permissions & Restrictions: can_run_ads capability, ad_budget_cap limit.
 * - Second-Price Real-Time Auction & Module Gating.
 * - Viewability-Based Impression Tracking with 30-second deduplication.
 * - Fraud-Proof Double-Entry Billing: Excludes self-clicks, throttles duplicates, ensures exact ledger balance.
 * - Admin Governance: Review queue, keyword blocklists, density caps.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import { isEnabled } from './module.service.js';
import * as rbacService from './rbac.service.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import { runSecondPriceAuction, MIN_RESERVE_PRICE } from './adAuction.service.js';

const BLOCKED_KEYWORDS_DEFAULT = ['illegal', 'replica', 'counterfeit', 'fake', 'weapons', 'adult', 'gambling'];

/**
 * Generates an ad campaign reference code.
 */
function generateCampaignRef() {
  const code = randomBytes(4).toString('hex').toUpperCase();
  return `ADC-${code}`;
}

/**
 * Checks whether content contains any blocked keywords.
 */
function containsBlockedKeywords(text = '', blocklist = BLOCKED_KEYWORDS_DEFAULT) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const word of blocklist) {
    if (lower.includes(word.toLowerCase())) {
      return word;
    }
  }
  return null;
}

/**
 * Creates a new Sponsored Ad Campaign.
 */
export async function createCampaign(db, cache, userId, campaignData, reqMeta = {}) {
  // 1. Check capability restriction: can_run_ads
  const restriction = await rbacService.evaluateRestrictionsForCapability(db, userId, 'can_run_ads');
  if (restriction && restriction.mode === 'BLOCK') {
    throw new AppError('USER_RESTRICTED', restriction.reason || 'You are restricted from running ads.');
  }

  // 2. Check numeric limit restriction: ad_budget_cap
  const budgetCapRestriction = await rbacService.evaluateRestrictionsForCapability(db, userId, 'ad_budget_cap');
  const dailyBudget = Number(campaignData.daily_budget);
  const totalBudget = Number(campaignData.total_budget);
  const bidAmount = Number(campaignData.bid_amount);

  if (isNaN(dailyBudget) || dailyBudget < 10) {
    throw new AppError('INVALID_DAILY_BUDGET', 'Daily budget must be at least ৳10.00.');
  }
  if (isNaN(totalBudget) || totalBudget < dailyBudget) {
    throw new AppError('INVALID_TOTAL_BUDGET', 'Total budget must be at least equal to daily budget.');
  }
  if (isNaN(bidAmount) || bidAmount < MIN_RESERVE_PRICE) {
    throw new AppError('INVALID_BID_AMOUNT', `Bid amount must be at least ৳${MIN_RESERVE_PRICE.toFixed(2)}.`);
  }

  if (budgetCapRestriction && budgetCapRestriction.limit_value != null) {
    const maxAllowedBudget = Number(budgetCapRestriction.limit_value);
    if (totalBudget > maxAllowedBudget || dailyBudget > maxAllowedBudget) {
      throw new AppError(
        'BUDGET_CAP_EXCEEDED',
        `Your budget exceeds your assigned ad budget limit of ৳${maxAllowedBudget.toFixed(2)}.`
      );
    }
  }

  // 3. Keyword blocklist inspection
  const creative = campaignData.creative || {};
  const allText = `${campaignData.title || ''} ${creative.headline || ''} ${creative.description || ''} ${(campaignData.targeting?.keywords || []).join(' ')}`;
  const blockedFound = containsBlockedKeywords(allText);
  if (blockedFound) {
    throw new AppError('BLOCKED_KEYWORD', `Content contains a prohibited keyword: "${blockedFound}".`);
  }

  // 4. Verify seller has a valid wallet
  const wallet = await walletRepo.getOrCreateWallet(db, userId);
  if (!wallet) {
    throw new AppError('WALLET_NOT_FOUND', 'Seller wallet could not be found or initialized.');
  }

  // 5. Determine initial status based on creative review policy
  // Fetch module settings for sponsored_ads
  const { rows: moduleRows } = await db.query(
    `SELECT settings_json FROM platform_modules WHERE key = 'sponsored_ads'`
  );
  const moduleSettings = moduleRows[0]?.settings_json || {};
  const requireReview = moduleSettings.require_creative_review !== false;

  // Check seller tier for auto-approval
  const { rows: userRows } = await db.query(
    `SELECT u.id, u.trust_tier, r.key as role_key
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1`,
    [userId]
  );
  const user = userRows[0] || {};
  const isAutoApproved = user.trust_tier === 'ELITE_PARTNER' || user.role_key === 'super_admin';
  const initialStatus = requireReview && !isAutoApproved ? 'PENDING_REVIEW' : 'ACTIVE';

  const ref = generateCampaignRef();
  const targetingJson = JSON.stringify(campaignData.targeting || { categories: [], districts: [], keywords: [] });

  return await withTransaction(db, async (client) => {
    const insertCampaignQuery = `
      INSERT INTO ad_campaigns (
        ref, user_id, title, objective, placement, status, targeting_json,
        daily_budget, total_budget, bid_amount, start_date, end_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    const startDate = campaignData.start_date ? new Date(campaignData.start_date) : new Date();
    const endDate = campaignData.end_date ? new Date(campaignData.end_date) : null;

    const { rows: cRows } = await client.query(insertCampaignQuery, [
      ref,
      userId,
      campaignData.title || 'Untitled Campaign',
      campaignData.objective || 'TRAFFIC',
      campaignData.placement || 'SEARCH_RESULTS',
      initialStatus,
      targetingJson,
      dailyBudget.toFixed(2),
      totalBudget.toFixed(2),
      bidAmount.toFixed(2),
      startDate,
      endDate,
    ]);
    const campaign = cRows[0];

    // Insert creative
    const insertCreativeQuery = `
      INSERT INTO ad_creatives (
        campaign_id, product_id, headline, description, banner_image_url,
        call_to_action, destination_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const { rows: crRows } = await client.query(insertCreativeQuery, [
      campaign.id,
      creative.product_id ? Number(creative.product_id) : null,
      creative.headline || campaign.title,
      creative.description || '',
      creative.banner_image_url || null,
      creative.call_to_action || 'SHOP_NOW',
      creative.destination_url || (creative.product_id ? `/product/${creative.product_id}` : '/'),
    ]);

    const createdCreative = crRows[0];

    // Audit log
    await writeAudit(client, {
      userId,
      action: 'growth.ad.create',
      resourceType: 'ad_campaigns',
      resourceId: campaign.id,
      after: { campaign, creative: createdCreative },
      ipAddress: reqMeta.ip || null,
      userAgent: reqMeta.userAgent || null,
    });

    return {
      ...campaign,
      creative: createdCreative,
    };
  });
}

/**
 * Updates an existing ad campaign.
 */
export async function updateCampaign(db, cache, userId, campaignId, updates, reqMeta = {}) {
  const { rows: existingRows } = await db.query(
    `SELECT c.*, row_to_json(cr.*) as creative
     FROM ad_campaigns c
     LEFT JOIN ad_creatives cr ON cr.campaign_id = c.id
     WHERE c.id = $1 AND c.user_id = $2`,
    [campaignId, userId]
  );

  if (existingRows.length === 0) {
    throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found or does not belong to you.');
  }

  const existing = existingRows[0];

  const dailyBudget = updates.daily_budget != null ? Number(updates.daily_budget) : Number(existing.daily_budget);
  const totalBudget = updates.total_budget != null ? Number(updates.total_budget) : Number(existing.total_budget);
  const bidAmount = updates.bid_amount != null ? Number(updates.bid_amount) : Number(existing.bid_amount);

  if (totalBudget < dailyBudget) {
    throw new AppError('INVALID_BUDGET', 'Total budget cannot be less than daily budget.');
  }

  return await withTransaction(db, async (client) => {
    const { rows: updatedRows } = await client.query(
      `UPDATE ad_campaigns
       SET title = COALESCE($1, title),
           objective = COALESCE($2, objective),
           placement = COALESCE($3, placement),
           targeting_json = COALESCE($4::jsonb, targeting_json),
           daily_budget = $5,
           total_budget = $6,
           bid_amount = $7,
           updated_at = now()
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [
        updates.title ?? null,
        updates.objective ?? null,
        updates.placement ?? null,
        updates.targeting ? JSON.stringify(updates.targeting) : null,
        dailyBudget.toFixed(2),
        totalBudget.toFixed(2),
        bidAmount.toFixed(2),
        campaignId,
        userId,
      ]
    );

    let updatedCreative = existing.creative;
    if (updates.creative) {
      const cr = updates.creative;
      const { rows: crRows } = await client.query(
        `UPDATE ad_creatives
         SET headline = COALESCE($1, headline),
             description = COALESCE($2, description),
             banner_image_url = COALESCE($3, banner_image_url),
             call_to_action = COALESCE($4, call_to_action),
             destination_url = COALESCE($5, destination_url),
             updated_at = now()
         WHERE campaign_id = $6
         RETURNING *`,
        [
          cr.headline ?? null,
          cr.description ?? null,
          cr.banner_image_url ?? null,
          cr.call_to_action ?? null,
          cr.destination_url ?? null,
          campaignId,
        ]
      );
      updatedCreative = crRows[0];
    }

    await writeAudit(client, {
      userId,
      action: 'growth.ad.update',
      resourceType: 'ad_campaigns',
      resourceId: campaignId,
      before: existing,
      after: { campaign: updatedRows[0], creative: updatedCreative },
      ipAddress: reqMeta.ip || null,
      userAgent: reqMeta.userAgent || null,
    });

    return {
      ...updatedRows[0],
      creative: updatedCreative,
    };
  });
}

/**
 * Changes status of a campaign (PAUSE / RESUME).
 */
export async function toggleCampaignStatus(db, cache, userId, campaignId, newStatus, reqMeta = {}) {
  const { rows } = await db.query(
    `SELECT * FROM ad_campaigns WHERE id = $1 AND user_id = $2`,
    [campaignId, userId]
  );

  if (rows.length === 0) {
    throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found.');
  }

  const campaign = rows[0];

  if (newStatus === 'ACTIVE' && campaign.status === 'COMPLETED') {
    throw new AppError('CAMPAIGN_COMPLETED', 'Completed campaigns must have total budget increased before resuming.');
  }

  const { rows: updatedRows } = await db.query(
    `UPDATE ad_campaigns
     SET status = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [newStatus, campaignId, userId]
  );

  await writeAudit(db, {
    userId,
    action: `growth.ad.${newStatus.toLowerCase()}`,
    resourceType: 'ad_campaigns',
    resourceId: campaignId,
    before: { status: campaign.status },
    after: { status: newStatus },
    ipAddress: reqMeta.ip || null,
    userAgent: reqMeta.userAgent || null,
  });

  return updatedRows[0];
}

/**
 * Lists campaigns for a user with aggregated performance metrics.
 */
export async function listUserCampaigns(db, userId, { status, placement, limit = 50, offset = 0 } = {}) {
  let query = `
    SELECT c.*,
           row_to_json(cr.*) as creative,
           COALESCE(p.title_en, '') as product_title_en,
           COALESCE(p.title_bn, '') as product_title_bn,
           COALESCE(p.default_retail_price, 0) as product_price
    FROM ad_campaigns c
    LEFT JOIN ad_creatives cr ON cr.campaign_id = c.id
    LEFT JOIN products p ON p.id = cr.product_id
    WHERE c.user_id = $1
  `;
  const params = [userId];

  if (status) {
    params.push(status);
    query += ` AND c.status = $${params.length}`;
  }
  if (placement) {
    params.push(placement);
    query += ` AND c.placement = $${params.length}`;
  }

  query += ` ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await db.query(query, params);

  // Auto-reset today_spent_amount if last_spent_date is before current date
  const now = new Date().toISOString().slice(0, 10);
  const campaigns = rows.map((c) => {
    const lastDate = c.last_spent_date ? new Date(c.last_spent_date).toISOString().slice(0, 10) : now;
    const todaySpent = lastDate === now ? Number(c.today_spent_amount) : 0.0;
    const impressions = Number(c.impressions_count) || 0;
    const clicks = Number(c.clicks_count) || 0;
    const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : '0.00';

    return {
      ...c,
      today_spent_amount: todaySpent.toFixed(2),
      ctr_percentage: ctr,
    };
  });

  return campaigns;
}

/**
 * Runs Real-Time Auction to select sponsored ads for a placement.
 */
export async function runAuction(db, cache, { placement, categoryId, district, keyword, limit = 3, viewerId = null }) {
  // 1. Check if sponsored_ads module is enabled
  const enabled = await isEnabled(db, cache, 'sponsored_ads', { userId: viewerId, district });
  if (!enabled) {
    return [];
  }

  // 2. Fetch candidate active campaigns matching placement
  const query = `
    SELECT c.*,
           cr.id as creative_id,
           cr.headline,
           cr.description,
           cr.banner_image_url,
           cr.call_to_action,
           cr.destination_url,
           cr.product_id,
           u.trust_tier as seller_tier,
           row_to_json(p.*) as product
    FROM ad_campaigns c
    JOIN ad_creatives cr ON cr.campaign_id = c.id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN products p ON p.id = cr.product_id
    WHERE c.status = 'ACTIVE'
      AND c.placement = $1
      AND c.spent_amount < c.total_budget
      AND (c.end_date IS NULL OR c.end_date > now())
  `;

  const { rows } = await db.query(query, [placement]);
  if (rows.length === 0) {
    return [];
  }

  // Filter out campaigns that reached daily budget
  const nowStr = new Date().toISOString().slice(0, 10);
  const eligible = rows.filter((c) => {
    const lastDate = c.last_spent_date ? new Date(c.last_spent_date).toISOString().slice(0, 10) : nowStr;
    const todaySpent = lastDate === nowStr ? Number(c.today_spent_amount) : 0;
    return todaySpent < Number(c.daily_budget);
  });

  if (eligible.length === 0) {
    return [];
  }

  // 3. Run Second-Price Auction algorithm
  const winners = runSecondPriceAuction(eligible, {
    placement,
    categoryId,
    district,
    keyword,
    maxSlots: limit,
  });

  return winners;
}

/**
 * Records a viewability-based impression with 30-second deduplication.
 */
export async function recordImpression(db, cache, {
  campaignId,
  creativeId = null,
  viewerId = null,
  sessionId = null,
  ipAddress = null,
  placement = 'SEARCH_RESULTS',
  viewable = true,
}) {
  if (!viewable) {
    return { recorded: false, reason: 'NOT_VIEWABLE' };
  }

  // Deduplication check via cache or in-memory key (30s window)
  const dedupeKey = `ad_imp:${campaignId}:${viewerId || sessionId || ipAddress || 'anon'}`;
  if (cache) {
    const exists = await cache.get(dedupeKey);
    if (exists) {
      return { recorded: false, reason: 'DEDUPLICATED' };
    }
    await cache.set(dedupeKey, '1', 30);
  }

  // Insert impression & increment campaign count
  try {
    await db.query(
      `INSERT INTO ad_impressions (campaign_id, creative_id, viewer_id, session_id, ip_address, placement, viewable)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [campaignId, creativeId, viewerId, sessionId, ipAddress, placement, true]
    );

    await db.query(
      `UPDATE ad_campaigns SET impressions_count = impressions_count + 1 WHERE id = $1`,
      [campaignId]
    );
  } catch (err) {
    // If partitioned table issue or connection hiccup, don't fail shopper UI
    console.error('Failed to insert ad_impressions:', err.message);
  }

  return { recorded: true };
}

/**
 * Records an ad click, validates against fraud (self-clicks, rapid duplicates),
 * and atomically debits seller wallet and credits platform treasury via double-entry ledger.
 */
export async function recordClickAndBill(db, cache, {
  campaignId,
  creativeId = null,
  viewerId = null,
  sessionId = null,
  ipAddress = null,
  chargedCpc = null,
  reqMeta = {},
}) {
  return await withTransaction(db, async (client) => {
    // 1. Fetch campaign with row lock
    const { rows: cRows } = await client.query(
      `SELECT * FROM ad_campaigns WHERE id = $1 FOR UPDATE`,
      [campaignId]
    );

    if (cRows.length === 0) {
      throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found.');
    }

    const campaign = cRows[0];

    // 2. Fraud Check: Self-click exclusion
    const isSelfClick = viewerId != null && Number(viewerId) === Number(campaign.user_id);
    if (isSelfClick) {
      await client.query(
        `INSERT INTO ad_clicks (campaign_id, creative_id, user_id, session_id, ip_address, cpc_charged, is_valid, invalid_reason)
         VALUES ($1, $2, $3, $4, $5, 0.00, false, 'SELF_CLICK')`,
        [campaignId, creativeId, viewerId, sessionId, ipAddress]
      );

      return {
        billed: false,
        fraudReason: 'SELF_CLICK',
        cpcCharged: 0.00,
        destinationUrl: campaign.creative?.destination_url || '/',
      };
    }

    // 3. Fraud Check: Duplicate click throttle (5 minutes per user/IP/session)
    const dedupeKey = `ad_clk:${campaignId}:${viewerId || sessionId || ipAddress || 'anon'}`;
    let isDuplicate = false;
    if (cache) {
      const exists = await cache.get(dedupeKey);
      if (exists) {
        isDuplicate = true;
      } else {
        await cache.set(dedupeKey, '1', 300); // 5 minutes
      }
    }

    if (isDuplicate) {
      await client.query(
        `INSERT INTO ad_clicks (campaign_id, creative_id, user_id, session_id, ip_address, cpc_charged, is_valid, invalid_reason)
         VALUES ($1, $2, $3, $4, $5, 0.00, false, 'DUPLICATE_CLICK')`,
        [campaignId, creativeId, viewerId, sessionId, ipAddress]
      );

      return {
        billed: false,
        fraudReason: 'DUPLICATE_CLICK',
        cpcCharged: 0.00,
        destinationUrl: campaign.creative?.destination_url || '/',
      };
    }

    // 4. Calculate actual billing amount bounded by remaining campaign budget
    const targetCpc = chargedCpc != null ? Number(chargedCpc) : Number(campaign.bid_amount);
    const totalBudget = Number(campaign.total_budget);
    const totalSpent = Number(campaign.spent_amount);
    const dailyBudget = Number(campaign.daily_budget);

    const nowStr = new Date().toISOString().slice(0, 10);
    const lastDate = campaign.last_spent_date ? new Date(campaign.last_spent_date).toISOString().slice(0, 10) : nowStr;
    const todaySpent = lastDate === nowStr ? Number(campaign.today_spent_amount) : 0;

    const remainingTotal = Math.max(0, totalBudget - totalSpent);
    const remainingDaily = Math.max(0, dailyBudget - todaySpent);
    const availableBudget = Math.min(remainingTotal, remainingDaily);

    if (availableBudget <= 0) {
      // Hard stop at budget cap
      await client.query(
        `UPDATE ad_campaigns SET status = 'COMPLETED', updated_at = now() WHERE id = $1`,
        [campaignId]
      );
      return {
        billed: false,
        fraudReason: 'BUDGET_EXHAUSTED',
        cpcCharged: 0.00,
      };
    }

    const actualCharge = Math.min(targetCpc, availableBudget);
    const chargeStr = actualCharge.toFixed(2);

    // 5. Deduct from seller's wallet via Double-Entry General Ledger
    const sellerWallet = await walletRepo.getOrCreateWallet(db, campaign.user_id, { client });

    // Platform treasury wallet (Super Admin / Admin User ID 1)
    const { rows: adminRows } = await client.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.key = 'super_admin'
       ORDER BY u.id ASC LIMIT 1`
    );
    const platformUserId = adminRows[0]?.id ?? 1;
    const platformWallet = await walletRepo.getOrCreateWallet(db, platformUserId, { client });

    const txnGroupId = randomUUID();

    // Balanced Double-Entry: Debit Seller, Credit Platform Treasury
    await ledgerService.recordTransactionGroup(client, {
      txnGroupId,
      defaultCategory: 'AD_SPEND',
      defaultReferenceType: 'ad_campaigns',
      defaultReferenceId: campaign.id,
      memo: `CPC charge for campaign #${campaign.ref} (click)`,
      entries: [
        {
          walletId: sellerWallet.id,
          entryType: 'DEBIT',
          amount: chargeStr,
          balanceBucket: 'AVAILABLE',
          category: 'AD_SPEND',
          referenceType: 'ad_campaigns',
          referenceId: campaign.id,
        },
        {
          walletId: platformWallet.id,
          entryType: 'CREDIT',
          amount: chargeStr,
          balanceBucket: 'AVAILABLE',
          category: 'AD_SPEND',
          referenceType: 'ad_campaigns',
          referenceId: campaign.id,
        },
      ],
    });

    // 6. Record click & billing rows
    const { rows: clickRows } = await client.query(
      `INSERT INTO ad_clicks (campaign_id, creative_id, user_id, session_id, ip_address, cpc_charged, is_valid)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id`,
      [campaignId, creativeId, viewerId, sessionId, ipAddress, chargeStr]
    );
    const clickId = clickRows[0]?.id;

    await client.query(
      `INSERT INTO ad_billing (campaign_id, click_id, wallet_id, amount, txn_group_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [campaignId, clickId, sellerWallet.id, chargeStr, txnGroupId]
    );

    // 7. Update campaign metrics
    const newTotalSpent = totalSpent + actualCharge;
    const newTodaySpent = todaySpent + actualCharge;
    const isCompleted = newTotalSpent >= totalBudget;

    await client.query(
      `UPDATE ad_campaigns
       SET spent_amount = $1,
           today_spent_amount = $2,
           last_spent_date = CURRENT_DATE,
           clicks_count = clicks_count + 1,
           status = CASE WHEN $3 = true THEN 'COMPLETED' ELSE status END,
           updated_at = now()
       WHERE id = $4`,
      [newTotalSpent.toFixed(2), newTodaySpent.toFixed(2), isCompleted, campaignId]
    );

    return {
      billed: true,
      cpcCharged: actualCharge,
      clickId,
      txnGroupId,
      remainingTotalBudget: (totalBudget - newTotalSpent).toFixed(2),
    };
  });
}

/**
 * Lists pending campaigns for admin review.
 */
export async function listPendingCampaigns(db, { limit = 20, offset = 0 } = {}) {
  const query = `
    SELECT c.*,
           row_to_json(cr.*) as creative,
           u.phone as seller_phone,
           u.display_name_en as seller_name_en,
           u.trust_tier as seller_tier
    FROM ad_campaigns c
    JOIN ad_creatives cr ON cr.campaign_id = c.id
    JOIN users u ON u.id = c.user_id
    WHERE c.status = 'PENDING_REVIEW'
    ORDER BY c.created_at ASC
    LIMIT $1 OFFSET $2
  `;
  const { rows } = await db.query(query, [limit, offset]);
  return rows;
}

/**
 * Admin review decision (APPROVE / REJECT).
 */
export async function reviewCampaign(db, adminId, campaignId, { decision, reason = null }, reqMeta = {}) {
  const newStatus = decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';

  const { rows } = await db.query(
    `UPDATE ad_campaigns
     SET status = $1,
         rejection_reason = $2,
         reviewed_by = $3,
         reviewed_at = now(),
         updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [newStatus, decision === 'REJECT' ? reason : null, adminId, campaignId]
  );

  if (rows.length === 0) {
    throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found.');
  }

  await writeAudit(db, {
    userId: adminId,
    action: `growth.ad.review_${decision.toLowerCase()}`,
    resourceType: 'ad_campaigns',
    resourceId: campaignId,
    after: { decision, status: newStatus, reason },
    ipAddress: reqMeta.ip || null,
    userAgent: reqMeta.userAgent || null,
  });

  return rows[0];
}
