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
  fastify.register(async function (salerScope) {
    salerScope.addHook('onRequest', fastify.authenticate);

    salerScope.get(
      '/saler/store',
      {
        config: {
          requireModule: 'virtual_storefront',
          requirePermission: 'saler.store.manage',
        },
      },
      storeController.getMyStore
    );

    salerScope.put(
      '/saler/store',
      {
        config: {
          requireModule: 'virtual_storefront',
          requirePermission: 'saler.store.manage',
        },
      },
      storeController.updateMyStore
    );

    salerScope.patch(
      '/saler/store/status',
      {
        config: {
          requireModule: 'physical_shop_status',
          requirePermission: 'saler.store.manage',
        },
      },
      storeController.updateStoreStatus
    );

    salerScope.put(
      '/saler/store/shelves',
      {
        config: {
          requireModule: 'virtual_storefront',
          requirePermission: 'saler.store.manage',
        },
      },
      storeController.updateShelves
    );
  });
}
