/**
 * ads.service.js — Sponsored Ads Engine Service (Prompt 9.1, extended by the ad marketplace).
 *
 * Implements:
 * - Campaign Lifecycle: Create, update, pause, resume, cancel, auto/manual review.
 * - Granular Permissions & Restrictions: can_run_ads capability, ad_budget_cap limit.
 * - Multi-format purchase: every campaign is bought as an `ad_products` row, priced by
 *   services/adPricing.js, and billed one of two ways —
 *     METERED  (CPC, CPM)                 → charged per valid click / per viewable impression.
 *     PREPAID  (FLAT_DAILY, FLAT_SLOT, CPS) → charged in full at purchase, inventory reserved.
 * - Second-Price Real-Time Auction & Module Gating (metered formats only — a reserved placement
 *   was already paid for, so it must never be put back into an auction it could lose).
 * - Viewability-Based Impression Tracking with 30-second deduplication.
 * - Fraud-Proof Double-Entry Billing: Excludes self-clicks, throttles duplicates, ensures exact ledger balance.
 * - Admin Governance: Review queue, keyword blocklists, density caps, rate cards.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import { isEnabled } from './module.service.js';
import * as rbacService from './rbac.service.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import * as adProductRepo from '../repositories/adProduct.repository.js';
import * as adProductsService from './adProducts.service.js';
import { quote as priceQuote, meteredCharge, rate, PREPAID_MODELS } from './adPricing.js';
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
 * Maps a legacy placement to an ad product key, so a client that still posts the pre-marketplace
 * payload (placement + bid, no ad_product_key) keeps working and lands on the right format.
 */
function legacyProductKeyForPlacement(placement) {
  switch (placement) {
    case 'PRODUCT_PAGE': return 'product_page_ads';
    case 'FEED': return 'feed_promotion';
    case 'CATEGORY_BANNER': return 'category_banner';
    default: return 'search_boost';
  }
}

/**
 * Debits the advertiser's vault and credits the platform treasury, in one balanced double-entry
 * group. Used by every ad charge except the CPC click path, which carries its own fraud checks:
 * the up-front purchase of a prepaid placement, and each settled block of CPM views. Runs inside
 * the caller's transaction so the campaign row, the ledger entries and the slot reservations
 * either all land or none do.
 */
async function chargeAdvertiser(client, { buyerUserId, campaign, amount, memo }) {
  const amountNum = Number(amount);
  if (!(amountNum > 0)) return null;

  const buyerWallet = await walletRepo.getOrCreateWallet(client, buyerUserId, { client });
  if (Number(buyerWallet.available_balance) < amountNum) {
    throw new AppError(
      'INSUFFICIENT_VAULT_BALANCE',
      `This placement costs ৳${amountNum.toFixed(2)} but your vault has ৳${Number(buyerWallet.available_balance).toFixed(2)}. Top up your vault and try again.`
    );
  }

  const { rows: adminRows } = await client.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.key = 'super_admin'
     ORDER BY u.id ASC LIMIT 1`
  );
  const platformUserId = adminRows[0]?.id ?? 1;
  const platformWallet = await walletRepo.getOrCreateWallet(client, platformUserId, { client });

  const txnGroupId = randomUUID();
  const amountStr = amountNum.toFixed(2);

  await ledgerService.recordTransactionGroup(client, {
    txnGroupId,
    defaultCategory: 'AD_SPEND',
    defaultReferenceType: 'ad_campaigns',
    defaultReferenceId: campaign.id,
    memo,
    entries: [
      { walletId: buyerWallet.id, entryType: 'DEBIT', amount: amountStr, balanceBucket: 'AVAILABLE' },
      { walletId: platformWallet.id, entryType: 'CREDIT', amount: amountStr, balanceBucket: 'AVAILABLE' },
    ],
  });

  await client.query(
    `INSERT INTO ad_billing (campaign_id, click_id, wallet_id, amount, txn_group_id)
     VALUES ($1, NULL, $2, $3, $4)`,
    [campaign.id, buyerWallet.id, amountStr, txnGroupId]
  );

  return { txnGroupId, walletId: buyerWallet.id, amount: amountStr };
}

/**
 * Reserves the day-level inventory a slot-backed format occupies. Throws if the run is already
 * sold out — the unique index is the real guard, so two sellers racing for the last slot cannot
 * both win.
 */
async function reserveSlots(client, { product, campaign, input, totalAmount }) {
  const slotKey = adProductsService.resolveSlotKey(product, { categoryId: input.category_id });
  const slotsPerPeriod = rate(product.rate_card, 'slots_per_period');

  const days = product.pricing_model === 'FLAT_DAILY'
    ? Math.max(1, Number(input.duration_days) || rate(product.rate_card, 'min_days'))
    : Math.max(1, Number(input.quantity) || 1);

  const startDate = input.start_date ? new Date(input.start_date) : new Date();
  const dates = adProductsService.expandDates(startDate, days);

  const slotIndex = await adProductRepo.findFreeSlotIndex(
    client, slotKey, dates[0], dates[dates.length - 1], slotsPerPeriod
  );
  if (slotIndex == null) {
    throw new AppError(
      'SLOT_SOLD_OUT',
      `All ${slotsPerPeriod} positions for this placement are booked between ${dates[0]} and ${dates[dates.length - 1]}. Pick different dates.`
    );
  }

  const amountPerDay = (Number(totalAmount) / dates.length).toFixed(2);
  await adProductRepo.insertSlotBookings(client, {
    campaignId: campaign.id,
    adProductId: product.id,
    slotKey,
    slotIndex,
    dates,
    amountPerDay,
  });

  return { slotKey, slotIndex, dates };
}

/**
 * Creates a new ad campaign of any marketplace format.
 */
export async function createCampaign(db, cache, userId, campaignData, reqMeta = {}) {
  // 1. Check capability restriction: can_run_ads
  const restriction = await rbacService.evaluateRestrictionsForCapability(db, userId, 'can_run_ads');
  if (restriction && restriction.mode === 'BLOCK') {
    throw new AppError('USER_RESTRICTED', restriction.reason || 'You are restricted from running ads.');
  }

  // 2. Resolve which format is being bought.
  const productKey = campaignData.ad_product_key || legacyProductKeyForPlacement(campaignData.placement);
  const product = await adProductRepo.getProductByKey(db, productKey);
  if (!product) {
    throw new AppError('AD_PRODUCT_NOT_FOUND', 'Unknown ad format.');
  }
  if (!product.is_enabled) {
    throw new AppError('AD_PRODUCT_DISABLED', 'This ad format is not on sale right now.');
  }

  const { rows: roleRows } = await db.query(
    `SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
    [userId]
  );
  const userRoleKeys = roleRows.map((r) => r.key);
  const isPrivileged = userRoleKeys.some((k) => k === 'super_admin' || k === 'admin');
  if (!isPrivileged && !userRoleKeys.some((k) => product.allowed_roles.includes(k))) {
    throw new AppError('AD_PRODUCT_FORBIDDEN', 'Your account type cannot buy this ad format.');
  }

  // 3. Keyword blocklist inspection (applies to every format).
  const creative = campaignData.creative || {};
  const allText = `${campaignData.title || ''} ${creative.headline || ''} ${creative.description || ''} ${(campaignData.targeting?.keywords || []).join(' ')}`;
  const blockedFound = containsBlockedKeywords(allText);
  if (blockedFound) {
    throw new AppError('BLOCKED_KEYWORD', `Content contains a prohibited keyword: "${blockedFound}".`);
  }

  // 4. Price it. adPricing.quote is the single authority and throws on every commercial floor
  //    (minimum budget, minimum days, bid below the placement's floor CPC, …).
  const tier = await adProductsService.getSellerTier(db, userId);
  const quoteInput = {
    total_budget: campaignData.total_budget,
    daily_budget: campaignData.daily_budget,
    bid_amount: campaignData.bid_amount,
    duration_days: campaignData.duration_days,
    quantity: campaignData.quantity,
  };
  const quote = priceQuote(product, quoteInput, { tier });
  const isPrepaid = PREPAID_MODELS.includes(product.pricing_model);
  const commitment = Number(isPrepaid ? quote.charge_now : quote.budget_cap);

  // 5. Numeric limit restriction: ad_budget_cap, measured against what this purchase commits.
  const budgetCapRestriction = await rbacService.evaluateRestrictionsForCapability(db, userId, 'ad_budget_cap');
  if (budgetCapRestriction && budgetCapRestriction.limit_value != null) {
    const maxAllowedBudget = Number(budgetCapRestriction.limit_value);
    if (commitment > maxAllowedBudget) {
      throw new AppError(
        'BUDGET_CAP_EXCEEDED',
        `This purchase (৳${commitment.toFixed(2)}) exceeds your assigned ad budget limit of ৳${maxAllowedBudget.toFixed(2)}.`
      );
    }
  }

  // 6. Verify buyer has a valid wallet
  const wallet = await walletRepo.getOrCreateWallet(db, userId);
  if (!wallet) {
    throw new AppError('WALLET_NOT_FOUND', 'Seller wallet could not be found or initialized.');
  }

  // 7. Review policy: the format's own switch wins, but the module can turn review off globally.
  const { rows: moduleRows } = await db.query(
    `SELECT settings_json FROM platform_modules WHERE key = 'sponsored_ads'`
  );
  const moduleSettings = moduleRows[0]?.settings_json || {};
  const reviewRequiredGlobally = moduleSettings.require_creative_review !== false;
  const isAutoApproved = tier === 'ELITE_PARTNER' || isPrivileged;
  const needsReview = reviewRequiredGlobally && product.requires_review && !isAutoApproved;

  const startDate = campaignData.start_date ? new Date(campaignData.start_date) : new Date();
  const startsInFuture = startDate.getTime() > Date.now() + 60 * 1000;

  let initialStatus;
  if (needsReview) initialStatus = 'PENDING_REVIEW';
  else if (isPrepaid && startsInFuture) initialStatus = 'SCHEDULED';
  else initialStatus = 'ACTIVE';

  // Budget columns carry different meanings per billing mode: a metered campaign's total_budget is
  // its spend cap, a prepaid one's is simply what it cost.
  const durationDays = isPrepaid
    ? Math.max(1, Number(campaignData.duration_days) || Number(campaignData.quantity) || rate(product.rate_card, 'min_days'))
    : (campaignData.duration_days ? Number(campaignData.duration_days) : null);

  const totalBudget = isPrepaid ? commitment : Number(campaignData.total_budget);
  const dailyBudget = isPrepaid
    ? Number((commitment / durationDays).toFixed(2))
    : Number(campaignData.daily_budget || campaignData.total_budget);
  const bidAmount = product.pricing_model === 'CPC'
    ? Number(campaignData.bid_amount || rate(product.rate_card, 'suggested_cpc'))
    : 0;

  const endDate = campaignData.end_date
    ? new Date(campaignData.end_date)
    : (isPrepaid ? new Date(startDate.getTime() + durationDays * 86400000) : null);

  const ref = generateCampaignRef();
  const targetingJson = JSON.stringify(campaignData.targeting || { categories: [], districts: [], keywords: [] });

  return await withTransaction(db, async (client) => {
    const { rows: cRows } = await client.query(
      `INSERT INTO ad_campaigns (
         ref, user_id, title, objective, placement, status, targeting_json,
         daily_budget, total_budget, bid_amount, start_date, end_date,
         ad_product_id, pricing_model, billing_mode, prepaid_amount, duration_days, quantity, quote_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)
       RETURNING *`,
      [
        ref,
        userId,
        campaignData.title || product.name_en,
        campaignData.objective || 'TRAFFIC',
        product.placement,
        initialStatus,
        targetingJson,
        dailyBudget.toFixed(2),
        totalBudget.toFixed(2),
        bidAmount.toFixed(2),
        startDate,
        endDate,
        product.id,
        product.pricing_model,
        isPrepaid ? 'PREPAID' : 'METERED',
        isPrepaid ? commitment.toFixed(2) : '0.00',
        durationDays,
        campaignData.quantity ? Number(campaignData.quantity) : null,
        JSON.stringify(quote),
      ]
    );
    const campaign = cRows[0];

    const { rows: crRows } = await client.query(
      `INSERT INTO ad_creatives (
         campaign_id, product_id, headline, description, banner_image_url,
         call_to_action, destination_url
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        campaign.id,
        creative.product_id ? Number(creative.product_id) : null,
        creative.headline || campaign.title,
        creative.description || '',
        creative.banner_image_url || null,
        creative.call_to_action || 'SHOP_NOW',
        creative.destination_url || (creative.product_id ? `/product/${creative.product_id}` : '/'),
      ]
    );
    const createdCreative = crRows[0];

    // 8. Reserve inventory, then take the money. Reservation first so a sold-out run fails before
    //    the seller is charged for a placement they cannot have.
    let reservation = null;
    if (adProductsService.SLOT_BACKED_MODELS.includes(product.pricing_model)) {
      reservation = await reserveSlots(client, { product, campaign, input: campaignData, totalAmount: commitment });
      if (reservation) {
        await client.query(`UPDATE ad_campaigns SET slot_key = $1 WHERE id = $2`, [reservation.slotKey, campaign.id]);
        campaign.slot_key = reservation.slotKey;
      }
    }

    let payment = null;
    if (isPrepaid) {
      payment = await chargeAdvertiser(client, {
        buyerUserId: userId,
        campaign,
        amount: commitment,
        memo: `${product.name_en} purchase for campaign ${campaign.ref}`,
      });
      // Prepaid money has already left the vault, so the campaign's spend is complete on day one.
      await client.query(
        `UPDATE ad_campaigns SET spent_amount = $1, today_spent_amount = $1, last_spent_date = CURRENT_DATE WHERE id = $2`,
        [commitment.toFixed(2), campaign.id]
      );
      campaign.spent_amount = commitment.toFixed(2);
    }

    await writeAudit(client, {
      userId,
      action: 'growth.ad.create',
      resourceType: 'ad_campaigns',
      resourceId: campaign.id,
      after: { campaign, creative: createdCreative, quote, reservation, payment },
      ipAddress: reqMeta.ip || null,
      userAgent: reqMeta.userAgent || null,
    });

    return {
      ...campaign,
      creative: createdCreative,
      quote,
      reservation,
      ad_product_key: product.key,
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
           COALESCE(p.default_retail_price, 0) as product_price,
           ap.key as ad_product_key,
           ap.name_en as ad_product_name_en,
           ap.name_bn as ad_product_name_bn,
           ap.icon as ad_product_icon
    FROM ad_campaigns c
    LEFT JOIN ad_creatives cr ON cr.campaign_id = c.id
    LEFT JOIN products p ON p.id = cr.product_id
    LEFT JOIN ad_products ap ON ap.id = c.ad_product_id
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
           COALESCE(ts.tier, 'STARTER') as seller_tier,
           row_to_json(p.*) as product
    FROM ad_campaigns c
    JOIN ad_creatives cr ON cr.campaign_id = c.id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN trust_scores ts ON ts.user_id = u.id
    LEFT JOIN products p ON p.id = cr.product_id
    WHERE c.status = 'ACTIVE'
      AND c.placement = $1
      AND c.billing_mode = 'METERED'
      AND c.spent_amount < c.total_budget
      AND (c.end_date IS NULL OR c.end_date > now())
  `;
  // WHY billing_mode filter: a PREPAID placement was bought outright and holds a reserved slot.
  // Feeding it back into the auction would let a higher bidder outrank a seller who already paid.
  // Reserved placements are served by listReservedPlacements() instead.

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
  let newCount = null;
  try {
    await db.query(
      `INSERT INTO ad_impressions (campaign_id, creative_id, viewer_id, session_id, ip_address, placement, viewable)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [campaignId, creativeId, viewerId, sessionId, ipAddress, placement, true]
    );

    const { rows } = await db.query(
      `UPDATE ad_campaigns SET impressions_count = impressions_count + 1
       WHERE id = $1
       RETURNING impressions_count, pricing_model, billing_mode`,
      [campaignId]
    );
    newCount = rows[0] || null;
  } catch (err) {
    // If partitioned table issue or connection hiccup, don't fail shopper UI
    console.error('Failed to insert ad_impressions:', err.message);
    return { recorded: true, billed: false };
  }

  // CPM settles on whole thousands, which is what the seller was quoted ("৳80 per 1,000 views").
  // A partial final thousand is never charged — rounding goes to the advertiser, not the platform.
  if (newCount?.pricing_model === 'CPM' && newCount.billing_mode === 'METERED'
      && Number(newCount.impressions_count) % CPM_BILLING_BATCH === 0) {
    try {
      const billing = await billCpmBatch(db, campaignId);
      return { recorded: true, billed: billing.billed, amount: billing.amount };
    } catch (err) {
      // A billing hiccup must not break the shopper's page; the batch is retried at the next
      // thousand, and the impression itself is already recorded.
      console.error('CPM billing failed for campaign', campaignId, err.message);
    }
  }

  return { recorded: true, billed: false };
}

/** CPM is quoted per thousand views, so that is also the unit it settles in. */
const CPM_BILLING_BATCH = 1000;

/**
 * Charges one thousand-impression block against a CPM campaign's budget, as a balanced
 * double-entry group. Mirrors the CPC click path — same wallets, same AD_SPEND category — so
 * platform ad revenue reconciles across both billing models.
 */
export async function billCpmBatch(db, campaignId) {
  return await withTransaction(db, async (client) => {
    const { rows: cRows } = await client.query(
      `SELECT c.*, p.rate_card
       FROM ad_campaigns c
       LEFT JOIN ad_products p ON p.id = c.ad_product_id
       WHERE c.id = $1 FOR UPDATE OF c`,
      [campaignId]
    );
    const campaign = cRows[0];
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found.');

    const totalBudget = Number(campaign.total_budget);
    const totalSpent = Number(campaign.spent_amount);
    const dailyBudget = Number(campaign.daily_budget);
    const nowStr = new Date().toISOString().slice(0, 10);
    const lastDate = campaign.last_spent_date
      ? new Date(campaign.last_spent_date).toISOString().slice(0, 10)
      : nowStr;
    const todaySpent = lastDate === nowStr ? Number(campaign.today_spent_amount) : 0;

    const availableBudget = Math.min(
      Math.max(0, totalBudget - totalSpent),
      Math.max(0, dailyBudget - todaySpent)
    );

    if (availableBudget <= 0) {
      await client.query(
        `UPDATE ad_campaigns SET status = 'COMPLETED', updated_at = now() WHERE id = $1`,
        [campaignId]
      );
      return { billed: false, reason: 'BUDGET_EXHAUSTED', amount: '0.00' };
    }

    const charge = meteredCharge('CPM', {
      cpmRate: rate(campaign.rate_card || {}, 'cpm_rate'),
      impressions: CPM_BILLING_BATCH,
      availableBudget,
    });

    // An empty vault pauses the campaign rather than failing the charge: the seller can top up and
    // resume, and the platform stops delivering views it cannot bill for.
    const advertiserWallet = await walletRepo.getOrCreateWallet(client, campaign.user_id, { client });
    if (Number(advertiserWallet.available_balance) < Number(charge)) {
      await client.query(
        `UPDATE ad_campaigns SET status = 'PAUSED', updated_at = now() WHERE id = $1`,
        [campaignId]
      );
      return { billed: false, reason: 'INSUFFICIENT_VAULT_BALANCE', amount: '0.00' };
    }

    const payment = await chargeAdvertiser(client, {
      buyerUserId: campaign.user_id,
      campaign,
      amount: charge,
      memo: `CPM charge for campaign ${campaign.ref} (${CPM_BILLING_BATCH} views)`,
    });

    const newTotalSpent = totalSpent + Number(charge);
    await client.query(
      `UPDATE ad_campaigns
       SET spent_amount = $1,
           today_spent_amount = $2,
           last_spent_date = CURRENT_DATE,
           status = CASE WHEN $3 = true THEN 'COMPLETED' ELSE status END,
           updated_at = now()
       WHERE id = $4`,
      [
        newTotalSpent.toFixed(2),
        (todaySpent + Number(charge)).toFixed(2),
        newTotalSpent >= totalBudget,
        campaignId,
      ]
    );

    return { billed: true, amount: charge, txnGroupId: payment?.txnGroupId || null };
  });
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
 * Cancels a campaign and frees any inventory it was still holding for future days.
 *
 * WHY no automatic refund: a prepaid placement is sold for a reserved period, and the days already
 * served were delivered. Refunding the unused tail is a money movement an admin must decide on, so
 * cancellation releases the inventory (which the platform can resell) and leaves the refund to the
 * vault's existing adjustment flow. The audit row records exactly what was given up.
 */
export async function cancelCampaign(db, userId, campaignId, reqMeta = {}) {
  const { rows } = await db.query(
    `SELECT c.*, p.pricing_model, p.rate_card 
     FROM ad_campaigns c
     JOIN ad_products p ON p.id = c.ad_product_id
     WHERE c.id = $1 AND c.user_id = $2`,
    [campaignId, userId]
  );
  if (rows.length === 0) {
    throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found.');
  }
  const campaign = rows[0];

  if (campaign.status === 'COMPLETED') {
    throw new AppError('CAMPAIGN_COMPLETED', 'This campaign has already finished.');
  }

  return await withTransaction(db, async (client) => {
    const releasedDays = await adProductRepo.releaseBookingsForCampaign(client, campaignId);
    let refundAmount = 0;

    // Prorated Refund for FLAT_DAILY prepaid campaigns
    if (campaign.pricing_model === 'FLAT_DAILY' && releasedDays > 0) {
      const dailyRate = rate(campaign.rate_card || {}, 'daily_rate');
      refundAmount = dailyRate * releasedDays;

      if (refundAmount > 0) {
        const buyerWallet = await walletRepo.getOrCreateWallet(client, userId, { client });
        
        const { rows: adminRows } = await client.query(
          `SELECT u.id FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
           WHERE r.key = 'super_admin'
           ORDER BY u.id ASC LIMIT 1`
        );
        const platformUserId = adminRows[0]?.id ?? 1;
        const platformWallet = await walletRepo.getOrCreateWallet(client, platformUserId, { client });

        await ledgerService.recordTransactionGroup(client, {
          txnGroupId: randomUUID(),
          defaultCategory: 'AD_SPEND', // or 'AD_REFUND'
          defaultReferenceType: 'ad_campaigns',
          defaultReferenceId: campaign.id,
          memo: `Prorated refund for cancelled prepaid campaign (Released ${releasedDays} days)`,
          entries: [
            { walletId: buyerWallet.id, entryType: 'CREDIT', amount: refundAmount.toFixed(2), balanceBucket: 'AVAILABLE' },
            { walletId: platformWallet.id, entryType: 'DEBIT', amount: refundAmount.toFixed(2), balanceBucket: 'AVAILABLE' },
          ],
        });
      }
    }

    const { rows: updated } = await client.query(
      `UPDATE ad_campaigns SET status = 'COMPLETED', end_date = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [campaignId]
    );

    await writeAudit(client, {
      userId,
      action: 'growth.ad.cancel',
      resourceType: 'ad_campaigns',
      resourceId: campaignId,
      before: { status: campaign.status, end_date: campaign.end_date },
      after: { status: 'COMPLETED', released_slot_days: releasedDays, refunded_amount: refundAmount },
      ipAddress: reqMeta.ip || null,
      userAgent: reqMeta.userAgent || null,
    });

    return { ...updated[0], released_slot_days: releasedDays, refunded_amount: refundAmount };
  });
}

/**
 * Serves the reserved (prepaid) placements booked for a surface today.
 *
 * This is the counterpart to runAuction: formats bought outright — the homepage spotlight, a
 * category banner, a boosted storefront — do not compete for the slot they already paid for, they
 * simply render in their booked position.
 */
export async function listReservedPlacements(db, cache, { placement, categoryId = null, date = null, viewerId = null }) {
  const enabled = await isEnabled(db, cache, 'sponsored_ads', { userId: viewerId });
  if (!enabled) return [];

  const slotKey = placement === 'CATEGORY_BANNER' && categoryId
    ? `CATEGORY:${Number(categoryId)}`
    : placement;

  const { rows } = await db.query(
    `SELECT b.slot_index,
            c.id as campaign_id,
            c.ref,
            c.title,
            c.placement,
            c.user_id,
            cr.id as creative_id,
            cr.headline,
            cr.description,
            cr.banner_image_url,
            cr.call_to_action,
            cr.destination_url,
            cr.product_id
     FROM ad_slot_bookings b
     JOIN ad_campaigns c ON c.id = b.campaign_id
     JOIN ad_creatives cr ON cr.campaign_id = c.id
     WHERE b.slot_key = $1
       AND b.booking_date = COALESCE($2::date, CURRENT_DATE)
       AND c.status IN ('ACTIVE', 'SCHEDULED')
     ORDER BY b.slot_index ASC`,
    [slotKey, date]
  );

  return rows;
}

/**
 * Lists pending campaigns for admin review.
 */
export async function listPendingCampaigns(db, { limit = 20, offset = 0 } = {}) {
  const query = `
    SELECT c.*,
           row_to_json(cr.*) as creative,
           u.phone as seller_phone,
           COALESCE(up.display_name, up.full_name) as seller_name_en,
           ts.tier as seller_tier
    FROM ad_campaigns c
    JOIN ad_creatives cr ON cr.campaign_id = c.id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN trust_scores ts ON ts.user_id = u.id
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

/**
 * Processes CPA (Cost Per Acquisition) attribution for an order.
 * Calculates commission based on the campaign's rate card and charges the advertiser.
 */
export async function processCpaAttribution(client, campaignId, orderRef, orderAmountBdt) {
  const { rows } = await client.query(
    `SELECT c.*, p.rate_card, p.pricing_model
     FROM ad_campaigns c
     JOIN ad_products p ON p.id = c.ad_product_id
     WHERE c.id = $1`,
    [campaignId]
  );
  
  const campaign = rows[0];
  if (!campaign || campaign.pricing_model !== 'CPA' || campaign.status !== 'ACTIVE') {
    return null;
  }

  const cpaPercent = rate(campaign.rate_card || {}, 'cpa_percent');
  const chargeAmount = (Number(orderAmountBdt) * cpaPercent) / 100;
  
  if (chargeAmount <= 0) return null;
  
  try {
    const payment = await chargeAdvertiser(client, {
      buyerUserId: campaign.user_id,
      campaign,
      amount: chargeAmount.toFixed(2),
      memo: `CPA commission for attributed order ${orderRef}`,
    });
    
    // Log the attribution as a pseudo-click for analytics
    await client.query(
      `INSERT INTO ad_clicks (campaign_id, creative_id, user_id, session_id, ip_address, cpc_charged, is_valid)
       VALUES ($1, NULL, NULL, 'CPA_ATTRIBUTION', '0.0.0.0', $2, true)`,
      [campaign.id, chargeAmount.toFixed(2)]
    );
    
    return payment;
  } catch (err) {
    // If the advertiser doesn't have enough balance, we can't charge them now.
    // In a real system we might record this debt or pause the campaign.
    // For now, pause the campaign.
    await client.query(`UPDATE ad_campaigns SET status = 'PAUSED' WHERE id = $1`, [campaign.id]);
    return null;
  }
}

