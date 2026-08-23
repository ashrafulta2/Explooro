/**
 * teamPurchase.routes.js — Fastify route declarations for Group Buying (Prompt 9.5).
 */

import * as teamPurchaseController from '../controllers/teamPurchase.controller.js';

export default async function teamPurchaseRoutes(app) {
  const requireGroupBuying = app.requireModule('group_buying');

  // 1. Start a new team purchase
  app.post('/team-purchases', {
    preHandler: [app.authenticate, requireGroupBuying],
  }, teamPurchaseController.create);

  // 2. Join an existing team purchase
  app.post('/team-purchases/:id/join', {
    preHandler: [app.authenticate, requireGroupBuying],
  }, teamPurchaseController.join);

  // 3. Get team purchase details & live countdown
  app.get('/team-purchases/:id', {
    preHandler: [requireGroupBuying],
  }, teamPurchaseController.getDetail);

  // 4. List user's active/past team purchases
  app.get('/account/team-purchases', {
    preHandler: [app.authenticate, requireGroupBuying],
  }, teamPurchaseController.getMyTeams);
}
