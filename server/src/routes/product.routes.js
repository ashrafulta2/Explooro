/**
 * product.routes.js — Routes for Products, Dynamic Pricing & Sourcing (Prompt 4.3).
 */

import * as productController from '../controllers/product.controller.js';
import * as sourcingController from '../controllers/sourcing.controller.js';
import * as sampleKit from '../controllers/sampleKit.controller.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { requireRestriction } from '../middlewares/requireRestriction.js';
import { AppError } from '../plugins/errorHandler.js';

export default async function productRoutes(app) {
  const requirePerm = app.requirePermission || requirePermission;
  const requireRestr = app.requireRestriction || requireRestriction;
  // Same fallback pattern as requirePerm/requireRestr above — a minimal test app that doesn't
  // register the real authenticate plugin (but still simulates a signed-in req.user via its own
  // onRequest hook) gets an equivalent guard instead of a hard dependency on the real decorator.
  const authenticate =
    app.authenticate ||
    (async (req) => {
      if (!req.user) throw new AppError('AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
    });

  // Public Catalog & Product Detail
  app.get('/products', productController.listProducts);
  app.get('/catalog/categories', productController.listCategories);
  app.get('/products/:id', productController.getProduct);
  app.post('/pricing/preview', productController.previewPricing);

  // Admin Catalog Analytics
  // WHY the same permission as the catalog page it feeds (catalog.product.view_all): a KPI that
  // totals stock and inventory value across every supplier is exactly as sensitive as the list.
  app.get(
    '/admin/catalog/stats',
    { preHandler: [authenticate, requirePerm('catalog.product.view_all')] },
    productController.getCatalogStats
  );

  // Supplier Product Management
  app.post(
    '/products',
    {
      preHandler: [
        authenticate,
        requirePerm('catalog.product.create'),
        requireRestr('can_list_products'),
      ],
    },
    productController.createProduct
  );

  // WHY authenticate here: updateProduct/deleteProduct check req.user against the product's
  // supplier_id, but nothing populated req.user before — every request (including the real owner)
  // was silently falling through as unauthenticated, so the ownership check always failed.
  app.patch('/products/:id', { preHandler: [authenticate] }, productController.updateProduct);
  app.post('/products/:id/restock', { preHandler: [authenticate] }, productController.restockProduct);
  app.delete('/products/:id', { preHandler: [authenticate] }, productController.deleteProduct);

  // Saler Sourcing & Virtual Storefront
  app.get('/sourcing/catalog', sourcingController.getSourcingCatalog);
  // Sponsored Sourcing Slot (supplier attraction step 2). Unlike the catalog above this is guarded:
  // sponsored cards expose a supplier's wholesale pricing to the saler it is sold to.
  app.get(
    '/sourcing/sponsored',
    {
      config: { page: '/saler/sourcing' },
      preHandler: [
        authenticate,
        ...(app.requireModule ? [app.requireModule('sourcing')] : []),
        requirePerm('saler.sourcing.view'),
      ],
    },
    sourcingController.getSponsoredSourcing
  );
  // Volume Incentive from the saler's side: progress towards each supplier's tiers, and payouts.
  app.get(
    '/sourcing/incentives',
    {
      config: { page: '/saler/incentives' },
      preHandler: [
        authenticate,
        ...(app.requireModule ? [app.requireModule('sourcing')] : []),
        requirePerm('saler.sourcing.view'),
      ],
    },
    sourcingController.getSalerIncentives
  );
  // Same issue as above: getMyStore reads req.user.id to find the caller's own store, but with no
  // preHandler that id was always undefined, so this always returned an empty store.
  // Sample Requests + Marketing Kits (supplier attraction step 4). A request moves the saler's own money
  // (into their HELD bucket), so it has its own permission apart from browsing.
  const sampleGuards = (perm) => [authenticate, ...(app.requireModule ? [app.requireModule('sourcing')] : []), requirePerm(perm)];
  app.get('/sourcing/samples', { config: { page: '/saler/samples' }, preHandler: sampleGuards('saler.sourcing.view') }, sampleKit.getSalerSamples);
  app.post('/sourcing/samples', { config: { page: '/saler/samples' }, preHandler: sampleGuards('saler.sample.request') }, sampleKit.requestSample);
  app.post('/sourcing/samples/:id/:action', { config: { page: '/saler/samples' }, preHandler: sampleGuards('saler.sample.request') }, sampleKit.actOnMySample);
  app.get('/sourcing/marketing-kits', { config: { page: '/saler/marketing-kits' }, preHandler: sampleGuards('saler.sourcing.view') }, sampleKit.getSalerKits);

  app.get('/sourcing/my-store', { preHandler: [authenticate] }, sourcingController.getMyStore);
  app.post(
    '/sourcing/add-to-store',
    {
      preHandler: [
        authenticate,
        requireRestr('can_curate_store'),
      ],
    },
    sourcingController.addToStore
  );
}
