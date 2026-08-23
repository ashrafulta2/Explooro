/**
 * product.routes.js — Routes for Products, Dynamic Pricing & Sourcing (Prompt 4.3).
 */

import * as productController from '../controllers/product.controller.js';
import * as sourcingController from '../controllers/sourcing.controller.js';
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
  app.get('/products/:id', productController.getProduct);
  app.post('/pricing/preview', productController.previewPricing);

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
  app.delete('/products/:id', { preHandler: [authenticate] }, productController.deleteProduct);

  // Saler Sourcing & Virtual Storefront
  app.get('/sourcing/catalog', sourcingController.getSourcingCatalog);
  // Same issue as above: getMyStore reads req.user.id to find the caller's own store, but with no
  // preHandler that id was always undefined, so this always returned an empty store.
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
