/**
 * referral.routes.js — Fastify route declarations for Referral Growth Engine (Prompt 9.3).
 */

import * as referralController from '../controllers/referral.controller.js';

export default async function referralRoutes(app) {
  const requireReferralModule = app.requireModule('referral_engine');
  const requireViewOwn = app.requirePermission('growth.referral.view_own');
  const requireGovern = app.requirePermission('growth.referral.govern');

  // 1. Saler & User Referral Network Hub
  app.get('/saler/referrals/overview', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.getOverview);
  app.get('/referrals/overview', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.getOverview);
  app.get('/account/referrals/overview', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.getOverview);

  app.get('/saler/referrals/tree', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.getTree);
  app.get('/referrals/tree', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.getTree);
  app.get('/account/referrals/tree', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.getTree);

  app.get('/saler/referrals/statement', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.getStatement);
  app.get('/referrals/statement', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.getStatement);
  app.get('/account/referrals/statement', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.getStatement);

  app.post('/saler/referrals/custom-code', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.updateCustomSlug);
  app.post('/referrals/custom-code', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.updateCustomSlug);
  app.post('/account/referrals/custom-code', {
    preHandler: [app.authenticate, requireReferralModule, requireViewOwn],
  }, referralController.updateCustomSlug);

  // 2. Admin Referral Governance
  app.get('/admin/growth/referrals', {
    preHandler: [app.authenticate, requireReferralModule, requireGovern],
  }, referralController.adminGetOverview);
}
