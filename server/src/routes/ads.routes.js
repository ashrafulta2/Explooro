/**
 * ads.routes.js — Fastify routes for In-Platform Sponsored Ads Engine (Prompt 9.1).
 */

import * as adsController from '../controllers/ads.controller.js';
import { requireRestriction } from '../middlewares/requireRestriction.js';

export default async function adsRoutes(app) {
  const requireModule = app.requireModule('sponsored_ads');
  const requireManageAds = app.requirePermission('growth.ad.manage_own');
  const requireReviewAds = app.requirePermission('growth.ad.review');
  const requireGovernAds = app.requirePermission('growth.ad.govern');
  const checkCanRunAds = requireRestriction('can_run_ads');

  // 1. Ad marketplace catalogue — what a seller may buy, at what price, with what left in stock.
  app.get('/ads/products', {
    preHandler: [app.authenticate, requireModule, requireManageAds],
  }, adsController.listAdProducts);

  app.post('/ads/quote', {
    preHandler: [app.authenticate, requireModule, requireManageAds],
  }, adsController.quoteCampaign);

  app.get('/ads/availability', {
    preHandler: [app.authenticate, requireModule, requireManageAds],
  }, adsController.getAvailability);

  // The categories a banner takeover can be bought against.
  app.get('/ads/target-categories', {
    preHandler: [app.authenticate, requireModule, requireManageAds],
  }, adsController.listTargetCategories);

  // 2. Seller / Saler Campaign Management
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

  app.post('/ads/campaigns/:id/cancel', {
    preHandler: [app.authenticate, requireModule, requireManageAds],
  }, adsController.cancelCampaign);

  // 3. Shopper / Placement Auction & Beacon APIs (public / optional auth)
  app.get('/ads/auction', {
    preHandler: [requireModule],
  }, adsController.runAuction);

  // Reserved placements are the prepaid counterpart of the auction: already bought, already paid.
  app.get('/ads/reserved', {
    preHandler: [requireModule],
  }, adsController.listReservedPlacements);

  app.post('/ads/impressions', {
    preHandler: [requireModule],
  }, adsController.recordImpression);

  app.post('/ads/clicks', {
    preHandler: [requireModule],
  }, adsController.recordClick);

  // 4. Ad pricing governance — the rate cards behind every format.
  //    `growth.ad.govern` is HIGH risk and delegable, which is what lets a Super Admin hand ad
  //    pricing to a named staff member without handing over anything else.
  app.get('/admin/ads/products', {
    preHandler: [app.authenticate, requireModule, requireGovernAds],
  }, adsController.listAdProductsForAdmin);

  app.patch('/admin/ads/products/:id', {
    preHandler: [app.authenticate, requireModule, requireGovernAds],
  }, adsController.updateAdProductPricing);

  // 5. Admin & Moderator Review Queue
  app.get('/admin/ads/campaigns/review', {
    preHandler: [app.authenticate, requireModule, requireReviewAds],
  }, adsController.listPendingCampaigns);

  app.post('/admin/ads/campaigns/:id/review', {
    preHandler: [app.authenticate, requireModule, requireReviewAds],
  }, adsController.reviewCampaign);
}
