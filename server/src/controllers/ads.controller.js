/**
 * ads.controller.js — Handlers for Sponsored Ads API (Prompt 9.1).
 */

import * as adsService from '../services/ads.service.js';
import * as adProductsService from '../services/adProducts.service.js';

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
