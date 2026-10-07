/**
 * store.routes.js — Fastify plugin for storefront, builder, status & OG routes (Prompt 4.8).
 */

import * as storeController from '../controllers/store.controller.js';

export default async function storeRoutes(fastify) {
  // Public storefront & slug check
  fastify.get('/stores/check-slug', storeController.checkSlug);
  fastify.get('/stores/:slug', storeController.getStore);

  // Dynamic OpenGraph image endpoints
  fastify.get('/og/store/:slug', storeController.getStoreOgImage);
  fastify.get('/og/product/:slug', storeController.getProductOgImage);

  // Saler Store Management (Protected)
  // WHY preHandler and not `config: { requireModule, requirePermission }`: nothing in the server
  // reads `routeOptions.config` — there is no onRoute hook that turns those keys into guards — so
  // the declarative form these four routes used compiled down to "authenticate only". Any signed-in
  // customer could read and write their own storefront, with both modules switched off.
  // The keys below are unchanged from that dead `config:` block, and both are registered:
  // `virtual_storefront` / `physical_shop_status` in server/src/config/modules.seed.json,
  // `saler.store.manage` (LOW, delegable) in docs/permission-catalog.json — see
  // docs/super-admin-audit.md §5 invariants 3 and 4. The shape itself is now guarded by
  // server/test/routeGuards.test.js.
  fastify.register(async function (salerScope) {
    const requireVirtualStorefront = salerScope.requireModule('virtual_storefront');
    const requirePhysicalShopStatus = salerScope.requireModule('physical_shop_status');
    const requireStoreManage = salerScope.requirePermission('saler.store.manage');

    // WHY authenticate stays an onRequest hook instead of being repeated in every preHandler array:
    // onRequest runs before preHandler, so req.user is already established when the module and
    // permission guards run — and listing it again would cost a second session lookup per request.
    salerScope.addHook('onRequest', fastify.authenticate);

    salerScope.get(
      '/saler/store',
      { preHandler: [requireVirtualStorefront, requireStoreManage] },
      storeController.getMyStore
    );

    salerScope.put(
      '/saler/store',
      { preHandler: [requireVirtualStorefront, requireStoreManage] },
      storeController.updateMyStore
    );

    salerScope.patch(
      '/saler/store/status',
      { preHandler: [requirePhysicalShopStatus, requireStoreManage] },
      storeController.updateStoreStatus
    );

    salerScope.put(
      '/saler/store/shelves',
      { preHandler: [requireVirtualStorefront, requireStoreManage] },
      storeController.updateShelves
    );
  });
}
