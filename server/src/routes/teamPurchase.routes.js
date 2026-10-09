/**
 * teamPurchase.routes.js — Fastify route declarations for Group Buying (Prompt 9.5).
 */

import * as teamPurchaseController from '../controllers/teamPurchase.controller.js';
import { requireRestriction } from '../middlewares/requireRestriction.js';

export default async function teamPurchaseRoutes(app) {
  const requireGroupBuying = app.requireModule('group_buying');
  // WHY can_place_order: a completed team becomes real orders, so a buyer barred from ordering is
  // barred from starting or joining a team too.
  const checkCanOrder = requireRestriction('can_place_order');

  // Prices for each team size, shipping charge, payment methods and (signed in) wallet balance.
  // Declared before /team-purchases/:id so "quote" is never read as an id.
  app.get('/team-purchases/quote', {
    preHandler: [app.authenticateOptional, requireGroupBuying],
  }, teamPurchaseController.quote);

  // Open teams anyone may join (?product_id= to narrow to one product).
  app.get('/team-purchases', {
    preHandler: [requireGroupBuying],
  }, teamPurchaseController.listOpen);

  // 1. Start a new team purchase
  app.post('/team-purchases', {
    preHandler: [app.authenticate, requireGroupBuying, checkCanOrder],
  }, teamPurchaseController.create);

  // 2. Join an existing team purchase
  app.post('/team-purchases/:id/join', {
    preHandler: [app.authenticate, requireGroupBuying, checkCanOrder],
  }, teamPurchaseController.join);

  // 3. Get team purchase details & live countdown
  app.get('/team-purchases/:id', {
    preHandler: [requireGroupBuying],
  }, teamPurchaseController.getDetail);

  // 4. List user's active/past team purchases
  app.get('/account/team-purchases', {
    preHandler: [app.authenticate, requireGroupBuying],
  }, teamPurchaseController.getMyTeams);

  // ---- Admin: /admin/growth/group-buy -----------------------------------------------------------------
  // WHY skipMakerChecker on the read: growth.groupbuy.govern is HIGH / approve_before, so without it
  // an admin opening the page would file an approval request instead of seeing it. Writes keep the
  // normal routing: a super admin saves at once, anyone else is sent for approval.
  app.get('/admin/growth/group-buy', {
    preHandler: [app.authenticate, requireGroupBuying, app.requirePermission('growth.groupbuy.govern', { skipMakerChecker: true })],
  }, teamPurchaseController.adminOverview);

  app.put('/admin/growth/group-buy/settings', {
    preHandler: [app.authenticate, app.requirePermission('growth.groupbuy.govern', { targetType: 'platform_module', targetRef: 'group_buying' })],
  }, teamPurchaseController.adminUpdateSettings);

  app.post('/admin/growth/group-buy/sweep', {
    preHandler: [app.authenticate, requireGroupBuying, app.requirePermission('growth.groupbuy.govern')],
  }, teamPurchaseController.adminRunExpirySweep);
}
