/**
 * cartRecovery.routes.js — Fastify route definitions for Cart Recovery (Prompt 9.6).
 */

import * as cartRecoveryController from '../controllers/cartRecovery.controller.js';

export default async function cartRecoveryRoutes(app) {
  const requireCartRecovery = app.requireModule('cart_recovery');

  // 1. Public link restoring an exact abandoned cart by signed token
  app.get('/cart-recovery/restore/:token', {
    preHandler: [requireCartRecovery],
  }, cartRecoveryController.restore);

  // 2. Saler cart abandonment analytics, drop-offs, and funnel insights
  app.get('/saler/cart-insights', {
    preHandler: [app.authenticate, requireCartRecovery],
  }, cartRecoveryController.getInsights);

  // 3. Saler manual recovery offer dispatch
  app.post('/saler/cart-recovery/:id/manual-offer', {
    preHandler: [app.authenticate, requireCartRecovery],
  }, cartRecoveryController.sendManualOffer);

  // 4. Admin trigger to run recovery sequence sweep
  app.post('/admin/cart-recovery/run-job', {
    preHandler: [app.authenticate, requireCartRecovery],
  }, cartRecoveryController.runJob);
}
