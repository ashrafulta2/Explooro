/**
 * gamification.routes.js — Fastify route declarations for Gamification Subsystem 13.0 (Prompt 9.4).
 */

import * as gamificationController from '../controllers/gamification.controller.js';

export default async function gamificationRoutes(app) {
  const requireCoinsModule = app.requireModule('loyalty_coins');
  const requireQuestsModule = app.requireModule('daily_quests');
  const requireGamificationModule = app.requireModule('gamification');

  // 1. Loyalty Coins Endpoints
  app.get('/coins/balance', {
    preHandler: [app.authenticate, requireCoinsModule],
  }, gamificationController.getCoinBalance);

  app.post('/coins/check-in', {
    preHandler: [app.authenticate, requireCoinsModule],
  }, gamificationController.checkIn);

  app.get('/coins/history', {
    preHandler: [app.authenticate, requireCoinsModule],
  }, gamificationController.getCoinHistory);

  app.get('/admin/coins/liability', {
    preHandler: [app.authenticate, requireCoinsModule, app.requirePermission('finance.overview.view')],
  }, gamificationController.getTotalLiability);

  // 2. Daily & Weekly Quests Endpoints
  app.get('/quests', {
    preHandler: [app.authenticate, requireQuestsModule],
  }, gamificationController.getQuests);

  app.post('/quests/:id/claim', {
    preHandler: [app.authenticate, requireQuestsModule],
  }, gamificationController.claimQuest);

  // 3. Leaderboard Endpoints
  app.get('/leaderboard', {
    preHandler: [app.authenticate, requireGamificationModule],
  }, gamificationController.getLeaderboard);

  app.post('/admin/leaderboard/snapshot', {
    preHandler: [app.authenticate, requireGamificationModule, app.requirePermission('growth.leaderboard.govern')],
  }, gamificationController.adminComputeSnapshot);
}
