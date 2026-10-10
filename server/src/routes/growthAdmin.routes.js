/**
 * growthAdmin.routes.js — admin read models and policy writes for the Phase 9 pages
 * (/admin/growth/ads, /admin/growth/quests, /admin/growth/coins).
 */

import * as growthAdminController from '../controllers/growthAdmin.controller.js';

export default async function growthAdminRoutes(app) {
  const requireAdsModule = app.requireModule('sponsored_ads');
  const requireQuestsModule = app.requireModule('daily_quests');
  const requireCoinsModule = app.requireModule('loyalty_coins');

  app.get('/admin/growth/ads', {
    preHandler: [app.authenticate, requireAdsModule, app.requirePermission('growth.ad.govern')],
  }, growthAdminController.getAdsOverview);

  for (const verb of ['pause', 'resume']) {
    app.post(`/admin/growth/ads/:id/${verb}`, {
      preHandler: [app.authenticate, requireAdsModule, app.requirePermission('growth.ad.govern')],
    }, verb === 'pause' ? growthAdminController.pauseCampaign : growthAdminController.resumeCampaign);
  }

  app.get('/admin/growth/quests', {
    preHandler: [app.authenticate, requireQuestsModule, app.requirePermission('growth.quest.govern')],
  }, growthAdminController.getQuestsOverview);

  app.patch('/admin/growth/quests/:id', {
    preHandler: [app.authenticate, requireQuestsModule, app.requirePermission('growth.quest.govern')],
  }, growthAdminController.updateQuest);

  // The coins page carries its own guard (growth.coins.govern) so a coins-only delegate is not
  // forced to also hold the quest permission just to open the page.
  app.get('/admin/growth/coins', {
    preHandler: [app.authenticate, requireCoinsModule, app.requirePermission('growth.coins.govern')],
  }, growthAdminController.getQuestsOverview);

  app.patch('/admin/growth/coins/policy', {
    preHandler: [app.authenticate, requireCoinsModule, app.requirePermission('growth.coins.govern')],
  }, growthAdminController.updateCoinPolicy);
}
