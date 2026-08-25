/**
 * supplier.routes.js — Fastify Route definitions for Supplier / Manufacturer Dashboard & Operations (Prompt 11.1).
 */

import * as controller from '../controllers/supplier.controller.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { AppError } from '../plugins/errorHandler.js';

export default async function supplierRoutes(app) {
  const requirePerm = app.requirePermission || requirePermission;
  const reqModule = (key) => (app.requireModule ? app.requireModule(key) : async () => {});
  const authenticate =
    app.authenticate ||
    (async (req) => {
      if (!req.user) throw new AppError('AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
    });

  // 1. Supplier Dashboard Overview & KPI Metrics
  app.get(
    '/supplier/dashboard',
    {
      preHandler: [
        authenticate,
        requirePerm('supplier.dashboard.view'),
      ],
    },
    controller.getDashboardOverview
  );

  // 2. Inventory & Stock Levels
  app.get(
    '/supplier/inventory',
    {
      preHandler: [
        authenticate,
        requirePerm('catalog.inventory.manage'),
      ],
    },
    controller.getInventory
  );

  app.post(
    '/supplier/inventory/stock',
    {
      preHandler: [
        authenticate,
        requirePerm('catalog.inventory.manage'),
      ],
    },
    controller.updateStockLevel
  );

  // 3. Batches & FEFO Expiry (Gated by fefo_batches module)
  app.get(
    '/supplier/batches',
    {
      preHandler: [
        authenticate,
        reqModule('fefo_batches'),
        requirePerm('catalog.batch.manage'),
      ],
    },
    controller.getBatches
  );

  app.post(
    '/supplier/batches',
    {
      preHandler: [
        authenticate,
        reqModule('fefo_batches'),
        requirePerm('catalog.batch.manage'),
      ],
    },
    controller.createBatch
  );

  app.post(
    '/supplier/batches/:id/clearance',
    {
      preHandler: [
        authenticate,
        reqModule('fefo_batches'),
        requirePerm('catalog.batch.manage'),
      ],
    },
    controller.triggerBatchClearance
  );

  app.post(
    '/supplier/batches/:id/recall',
    {
      preHandler: [
        authenticate,
        reqModule('fefo_batches'),
        requirePerm('catalog.batch.manage'),
      ],
    },
    controller.recallBatch
  );

  // 4. Warehouse Nodes (Gated by multi_warehouse module)
  app.get(
    '/supplier/warehouses',
    {
      preHandler: [
        authenticate,
        reqModule('multi_warehouse'),
        requirePerm('catalog.warehouse.manage'),
      ],
    },
    controller.getWarehouses
  );

  app.post(
    '/supplier/warehouses',
    {
      preHandler: [
        authenticate,
        reqModule('multi_warehouse'),
        requirePerm('catalog.warehouse.manage'),
      ],
    },
    controller.createWarehouse
  );

  // 5. Fulfilment Queue & 1-Click Consignments (Gated by courier_hub module)
  app.get(
    '/supplier/fulfilment',
    {
      preHandler: [
        authenticate,
        reqModule('courier_hub'),
        requirePerm('logistics.consignment.create'),
      ],
    },
    controller.getFulfilmentQueue
  );

  app.post(
    '/supplier/fulfilment/consign',
    {
      preHandler: [
        authenticate,
        reqModule('courier_hub'),
        requirePerm('logistics.consignment.create'),
      ],
    },
    controller.bookConsignment
  );

  // 6. Reseller Network Insights & Leaderboard
  app.get(
    '/supplier/resellers',
    {
      preHandler: [
        authenticate,
        requirePerm('supplier.analytics.view'),
      ],
    },
    controller.getResellerInsights
  );

  // 7. Physical Shop Operating Status (Gated by physical_shop_status module)
  app.get(
    '/supplier/store-status',
    {
      preHandler: [
        authenticate,
        reqModule('physical_shop_status'),
        requirePerm('supplier.store.manage'),
      ],
    },
    controller.getStoreStatus
  );

  app.patch(
    '/supplier/store-status',
    {
      preHandler: [
        authenticate,
        reqModule('physical_shop_status'),
        requirePerm('supplier.store.manage'),
      ],
    },
    controller.updateStoreStatus
  );
}
