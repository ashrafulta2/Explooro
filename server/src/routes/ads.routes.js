/**
 * ads.routes.js — Fastify routes for In-Platform Sponsored Ads Engine (Prompt 9.1).
 */

import * as adsController from '../controllers/ads.controller.js';
import { requireRestriction } from '../middlewares/requireRestriction.js';

export default async function adsRoutes(app) {
  const requireModule = app.requireModule('sponsored_ads');
  const requireManageAds = app.requirePermission('growth.ad.manage_own');
  const requireReviewAds = app.requirePermission('growth.ad.review');
  const checkCanRunAds = requireRestriction('can_run_ads');

  // 1. Seller / Saler Campaign Management
  app.post('/ads/campaigns', {
    preHandler: [app.authenticate, requireModule, requireManageAds, checkCanRunAds],
  }, adsController.createCampaign);

  app.get('/ads/campaigns', {
    preHandler: [app.authenticate, requireModule, requireManageAds],
  }, adsController.listUserCampaigns);

  app.patch('/ads/campaigns/:id', {
    preHandler: [app.authenticate, requireModule, requireManageAds, checkCanRunAds],
  }, adsController.updateCampaign);

  app.post('/ads/campaigns/:id/pause', {
    preHandler: [app.authenticate, requireModule, requireManageAds],
  }, adsController.pauseCampaign);

  app.post('/ads/campaigns/:id/resume', {
    preHandler: [app.authenticate, requireModule, requireManageAds, checkCanRunAds],
  }, adsController.resumeCampaign);

  // 2. Shopper / Placement Auction & Beacon APIs (public / optional auth)
  app.get('/ads/auction', {
    preHandler: [requireModule],
  }, adsController.runAuction);

  app.post('/ads/impressions', {
    preHandler: [requireModule],
  }, adsController.recordImpression);

  app.post('/ads/clicks', {
    preHandler: [requireModule],
  }, adsController.recordClick);

  // 3. Admin & Moderator Review Queue
  app.get('/admin/ads/campaigns/review', {
    preHandler: [app.authenticate, requireModule, requireReviewAds],
  }, adsController.listPendingCampaigns);

  app.post('/admin/ads/campaigns/:id/review', {
    preHandler: [app.authenticate, requireModule, requireReviewAds],
  }, adsController.reviewCampaign);
}
