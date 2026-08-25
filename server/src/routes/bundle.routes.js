/**
 * bundle.routes.js — Fastify routes for Cross-Seller Bundling & Surge Pricing Engine (Prompt 10.5).
 */

import * as bundleController from '../controllers/bundle.controller.js';

export default async function bundleRoutes(app) {
  const requireBundlingModule = app.requireModule('product_bundling');
  const requireSurgeModule = app.requireModule('demand_surge');

  const requireManageBundle = app.requirePermission('saler.bundle.manage');
  const requireSupplierStore = app.requirePermission('supplier.store.manage');
  const requireGovernPricing = app.requirePermission('catalog.product.govern');

  // 1. Cross-Seller Bundling Endpoints
  app.post('/saler/bundles/preview', {
    preHandler: [app.authenticate, requireBundlingModule, requireManageBundle],
  }, bundleController.previewBundleBreakdown);

  app.post('/saler/bundles', {
    preHandler: [app.authenticate, requireBundlingModule, requireManageBundle],
  }, bundleController.createBundle);

  app.get('/saler/bundles', {
    preHandler: [app.authenticate, requireBundlingModule, requireManageBundle],
  }, bundleController.listSalerBundles);

  app.get('/bundles/:idOrRef', {
    preHandler: [requireBundlingModule],
  }, bundleController.getBundle);

  app.patch('/saler/bundles/:id', {
    preHandler: [app.authenticate, requireBundlingModule, requireManageBundle],
  }, bundleController.updateBundle);

  app.delete('/saler/bundles/:id', {
    preHandler: [app.authenticate, requireBundlingModule, requireManageBundle],
  }, bundleController.deleteBundle);

  app.post('/cart/bundle', {
    preHandler: [requireBundlingModule],
  }, bundleController.addBundleToCart);

  // 2. Dynamic Demand Surge Pricing Endpoints (Advisory Only)
  app.get('/supplier/surge/recommendations', {
    preHandler: [app.authenticate, requireSurgeModule],
  }, bundleController.listSupplierSurgeRecommendations);

  app.get('/supplier/surge/analyze/:productId', {
    preHandler: [app.authenticate, requireSurgeModule],
  }, bundleController.analyzeProductDemand);

  app.post('/supplier/surge/recommendations/:id/accept', {
    preHandler: [app.authenticate, requireSurgeModule],
  }, bundleController.acceptSurgeRecommendation);

  app.post('/supplier/surge/recommendations/:id/dismiss', {
    preHandler: [app.authenticate, requireSurgeModule],
  }, bundleController.dismissSurgeRecommendation);

  // 3. Admin Surge Scanner
  app.post('/admin/surge/scan', {
    preHandler: [app.authenticate, requireSurgeModule, requireGovernPricing],
  }, bundleController.scanSurges);
}
