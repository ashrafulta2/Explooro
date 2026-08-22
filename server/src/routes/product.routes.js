/**
 * product.routes.js — Routes for Products, Dynamic Pricing & Sourcing (Prompt 4.3).
 */

import * as productController from '../controllers/product.controller.js';
import * as sourcingController from '../controllers/sourcing.controller.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { requireRestriction } from '../middlewares/requireRestriction.js';

export default async function productRoutes(app) {
  const requirePerm = app.requirePermission || requirePermission;
  const requireRestr = app.requireRestriction || requireRestriction;

  // Public Catalog & Product Detail
  app.get('/products', productController.listProducts);
  app.get('/products/:id', productController.getProduct);
  app.post('/pricing/preview', productController.previewPricing);

  // Supplier Product Management
  app.post(
    '/products',
    {
      preHandler: [
        requirePerm('catalog.product.create'),
        requireRestr('can_list_products'),
      ],
    },
    productController.createProduct
  );

  app.patch('/products/:id', productController.updateProduct);
  app.delete('/products/:id', productController.deleteProduct);

  // Saler Sourcing & Virtual Storefront
  app.get('/sourcing/catalog', sourcingController.getSourcingCatalog);
  app.get('/sourcing/my-store', sourcingController.getMyStore);
  app.post(
    '/sourcing/add-to-store',
    {
      preHandler: [
        requireRestr('can_curate_store'),
      ],
    },
    sourcingController.addToStore
  );
}
