/**
 * ads.controller.js — Handlers for Sponsored Ads API (Prompt 9.1).
 */

import * as adsService from '../services/ads.service.js';

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
