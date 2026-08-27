/**
 * wishlist.routes.js — Fastify routes for Wishlist (Prompt 5.1).
 */

import * as wishlistCtrl from '../controllers/wishlist.controller.js';

export default async function wishlistRoutes(fastify) {
  fastify.get(
    '/wishlist',
    {
      preHandler: [fastify.authenticate],
    },
    wishlistCtrl.getWishlist
  );

  fastify.post(
    '/wishlist/:productId',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['productId'],
          properties: {
            productId: { type: 'string' },
          },
        },
      },
    },
    wishlistCtrl.toggleWishlistItem
  );

  fastify.delete(
    '/wishlist/:productId',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['productId'],
          properties: {
            productId: { type: 'string' },
          },
        },
      },
    },
    wishlistCtrl.removeWishlistItem
  );

  fastify.patch(
    '/wishlist/:productId/notify',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['productId'],
          properties: {
            productId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['notify_on_drop'],
          properties: {
            notify_on_drop: { type: 'boolean' },
          },
        },
      },
    },
    wishlistCtrl.setWishlistNotify
  );
}
