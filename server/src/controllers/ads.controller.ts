/**
 * ads.controller.ts — Handlers for Sponsored Ads API (Prompt 9.1).
 */

import * as adsService from '../services/ads.service.ts';
import * as adProductsService from '../services/adProducts.service.ts';
import * as adDestination from '../services/adDestination.service.ts';
import * as adAudience from '../services/adAudience.service.ts';
import * as adDensity from '../services/adDensity.service.ts';
import * as adProductRepo from '../repositories/adProduct.repository.ts';
import * as walletRepo from '../repositories/wallet.repository.ts';

export async function createCampaign(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const userId = req.user.id;

  const result = await adsService.createCampaign(db, cache, userId, req.body, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.status(201).send({
    campaign: result,
  });
}

export async function updateCampaign(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const userId = req.user.id;
  const campaignId = parseInt(req.params.id, 10);

  const result = await adsService.updateCampaign(db, cache, userId, campaignId, req.body, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.send({
    campaign: result,
  });
}

export async function pauseCampaign(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const userId = req.user.id;
  const campaignId = parseInt(req.params.id, 10);

  const result = await adsService.toggleCampaignStatus(db, cache, userId, campaignId, 'PAUSED', {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.send({
    campaign: result,
  });
}

export async function resumeCampaign(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const userId = req.user.id;
  const campaignId = parseInt(req.params.id, 10);

  const result = await adsService.toggleCampaignStatus(db, cache, userId, campaignId, 'ACTIVE', {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.send({
    campaign: result,
  });
}

export async function listUserCampaigns(req, reply) {
  const db = req.db || req.server?.db;
  const userId = req.user.id;
  const { status, placement, limit, offset } = req.query || {};

  const campaigns = await adsService.listUserCampaigns(db, userId, {
    status,
    placement,
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({
    campaigns,
  });
}

export async function runAuction(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { placement = 'SEARCH_RESULTS', category_id, district, keyword, limit } = req.query || {};

  const winners = await adsService.runAuction(db, cache, {
    placement,
    categoryId: category_id,
    district,
    keyword,
    limit: limit ? parseInt(limit, 10) : 3,
    viewerId: req.user?.id || null,
  });

  return reply.send({
    ads: winners,
  });
}

export async function recordImpression(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { campaign_id, creative_id, placement, viewable = true } = req.body || {};

  const result = await adsService.recordImpression(db, cache, {
    campaignId: parseInt(campaign_id, 10),
    creativeId: creative_id ? parseInt(creative_id, 10) : null,
    viewerId: req.user?.id || null,
    sessionId: req.headers['x-session-id'] || null,
    ipAddress: req.ip,
    placement: placement || 'SEARCH_RESULTS',
    viewable: viewable === true || viewable === 'true',
  });

  return reply.send(result);
}

export async function recordClick(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { campaign_id, creative_id, charged_cpc } = req.body || {};

  const result = await adsService.recordClickAndBill(db, cache, {
    campaignId: parseInt(campaign_id, 10),
    creativeId: creative_id ? parseInt(creative_id, 10) : null,
    viewerId: req.user?.id || null,
    sessionId: req.headers['x-session-id'] || null,
    ipAddress: req.ip,
    chargedCpc: charged_cpc ? parseFloat(charged_cpc) : null,
    reqMeta: { ip: req.ip, userAgent: req.headers['user-agent'] },
  });

  return reply.send(result);
}

export async function listPendingCampaigns(req, reply) {
  const db = req.db || req.server?.db;
  const { limit, offset } = req.query || {};

  const pending = await adsService.listPendingCampaigns(db, {
    limit: limit ? parseInt(limit, 10) : 20,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({
    campaigns: pending,
  });
}

export async function reviewCampaign(req, reply) {
  const db = req.db || req.server?.db;
  const adminId = req.user.id;
  const campaignId = parseInt(req.params.id, 10);
  const { decision, reason } = req.body || {};

  const result = await adsService.reviewCampaign(db, adminId, campaignId, { decision, reason }, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.send({
    campaign: result,
  });
}

/* ------------------------------------------------------------------------------------------- *
 * Ad marketplace — catalogue, quoting, inventory and admin rate cards.
 * ------------------------------------------------------------------------------------------- */

export async function listAdProducts(req, reply) {
  const db = req.db || req.server?.db;
  const role = req.user?.roles?.[0] || req.user?.role || null;

  const result = await adProductsService.listForSeller(db, req.user.id, { role });
  return reply.send(result);
}

export async function listPromotableProducts(req, reply) {
  const db = req.db || req.server?.db;
  const { limit, offset } = req.query || {};

  const result = await adDestination.listPromotableProducts(db, req.user.id, { limit, offset });
  return reply.send(result);
}

export async function quoteCampaign(req, reply) {
  const db = req.db || req.server?.db;
  const body = req.body || {};

  const result = await adProductsService.quoteCampaign(db, req.user.id, {
    ad_product_key: body.ad_product_key,
    total_budget: body.total_budget,
    daily_budget: body.daily_budget,
    bid_amount: body.bid_amount,
    duration_days: body.duration_days,
    quantity: body.quantity,
    category_id: body.category_id,
    start_date: body.start_date,
  });

  return reply.send({ quote: result });
}

export async function getAvailability(req, reply) {
  const db = req.db || req.server?.db;
  const { product_key, category_id, days } = req.query || {};

  const result = await adProductsService.getAvailabilityCalendar(db, product_key, {
    categoryId: category_id ? Number(category_id) : null,
    days: days ? parseInt(days, 10) : 30,
  });

  return reply.send(result);
}

export async function cancelCampaign(req, reply) {
  const db = req.db || req.server?.db;
  const campaignId = parseInt(req.params.id, 10);

  const result = await adsService.cancelCampaign(db, req.user.id, campaignId, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.send({ campaign: result });
}

export async function listReservedPlacements(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { placement = 'HOME_HERO', category_id, date } = req.query || {};

  const placements = await adsService.listReservedPlacements(db, cache, {
    placement,
    categoryId: category_id ? Number(category_id) : null,
    date: date || null,
    viewerId: req.user?.id || null,
  });

  return reply.send({ placements });
}

export async function listAdProductsForAdmin(req, reply) {
  const db = req.db || req.server?.db;
  const { days } = req.query || {};

  const result = await adProductsService.listForAdmin(db, {
    days: days ? parseInt(days, 10) : 30,
  });

  return reply.send(result);
}

export async function updateAdProductPricing(req, reply) {
  const db = req.db || req.server?.db;
  const productId = parseInt(req.params.id, 10);

  const result = await adProductsService.updateProductPricing(db, req.user.id, productId, req.body || {}, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.send({ product: result });
}

const densityShape = (d) => ({ SEARCH_RESULTS: d.SEARCH_RESULTS, FEED: d.FEED });

/** GET /ads/density — where sponsored cards go in the search and feed grids. Never fails. */
export async function getDensity(req, reply) {
  const density = await adDensity.loadDensity(req.db || req.server?.db);
  return reply.send({ density: densityShape(density) });
}

/** GET /admin/ads/density — the density, its bounds, and the timestamp the form sends back. */
export async function getAdminDensity(req, reply) {
  const density = await adDensity.loadDensity(req.db || req.server?.db);
  return reply.send({
    density: densityShape(density),
    updated_at: density.updated_at,
    limits: adDensity.DENSITY_LIMITS,
    defaults: adDensity.DEFAULT_DENSITY,
  });
}

/** PUT /admin/ads/density */
export async function updateAdminDensity(req, reply) {
  const body = req.body || {};
  const density = await adDensity.updateDensity(req.db || req.server?.db, {
    input: body.density,
    reason: body.reason,
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    expectedUpdatedAt: body.expected_updated_at ?? null,
    reqContext: { ip: req.ip, userAgent: req.headers?.['user-agent'], traceId: req.traceId },
  });
  return reply.send({ density: densityShape(density), updated_at: density.updated_at });
}

/**
 * GET /ads/easy/options — everything the simple Boost wizard needs in one call: the format and its
 * limits, what this account may promote (own published posts, own store, promotable products), the
 * vault balance it will be paid from, and the audience choices. Only the caller's own things.
 */
export async function getEasyOptions(req, reply) {
  const db = req.db || req.server?.db;
  const userId = req.user.id;
  const product = await adProductRepo.getProductByKey(db, adsService.EASY_BOOST_KEY);
  const [{ rows: posts }, { rows: stores }, promotable, wallet, { rows: categories }, rules] = await Promise.all([
    db.query(
      `SELECT id, ref, post_type, title, left(COALESCE(body, ''), 140) AS excerpt, created_at
         FROM community_posts
        WHERE author_id = $1 AND status = 'PUBLISHED'
        ORDER BY created_at DESC
        LIMIT 20`,
      [userId]
    ),
    db.query(
      `SELECT slug, shop_name FROM virtual_stores
        WHERE saler_id = $1 AND is_active AND deleted_at IS NULL
        ORDER BY id LIMIT 1`,
      [userId]
    ),
    adDestination.listPromotableProducts(db, userId, { limit: 50 }),
    walletRepo.getOrCreateWallet(db, userId),
    db.query(
      `SELECT id, name_en, name_bn FROM categories
        WHERE is_active = true AND parent_id IS NULL
        ORDER BY display_order ASC, name_en ASC LIMIT 100`
    ),
    adAudience.loadRules(db),
  ]);
  const rc = product?.rate_card || {};
  return reply.send({
    format: product
      ? {
          key: product.key,
          enabled: Boolean(product.is_enabled),
          name_en: product.name_en,
          name_bn: product.name_bn,
          min_budget: Number(rc.min_budget) || 0,
          min_days: Number(rc.min_days) || 1,
          max_days: Number(rc.max_days) || 30,
        }
      : null,
    posts,
    store: stores[0] ?? null,
    products: promotable.items,
    vault: { available: wallet?.available_balance ?? '0.00' },
    audience: {
      roles: adAudience.AUDIENCE_ROLES,
      genders: adAudience.GENDERS,
      divisions: adAudience.DIVISIONS,
      interests: categories,
      min_audience_size: rules.min_audience_size,
    },
  });
}

/** POST /ads/audience-estimate — "about N people" for the audience the wizard has so far. */
export async function estimateAudience(req, reply) {
  const db = req.db || req.server?.db;
  const rules = await adAudience.loadRules(db);
  const result = await adAudience.estimateAudience(db, adAudience.normalizeAudience(req.body?.audience), rules);
  return reply.send(result);
}

export async function listTargetCategories(req, reply) {
  const db = req.db || req.server?.db;
  const { rows } = await db.query(
    `SELECT id, name_en, name_bn, slug
     FROM categories
     WHERE is_active = true AND parent_id IS NULL
     ORDER BY display_order ASC, name_en ASC
     LIMIT 100`
  );
  return reply.send({ categories: rows });
}
