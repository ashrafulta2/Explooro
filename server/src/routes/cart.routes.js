/**
 * cart.routes.js — Fastify routes for Cart (Prompt 5.1).
 */

import * as cartCtrl from '../controllers/cart.controller.js';

export default async function cartRoutes(fastify) {
  fastify.get(
    '/cart',
    {
      preHandler: [fastify.authenticateOptional],
    },
    cartCtrl.getCart
  );

  fastify.post(
    '/cart/items',
    {
      preHandler: [fastify.authenticateOptional],
      schema: {
        body: {
          type: 'object',
          required: ['product_id'],
          properties: {
            product_id: { type: ['integer', 'string'] },
            variant_id: { type: ['integer', 'string', 'null'] },
            saler_id: { type: ['integer', 'string', 'null'] },
            bundle_id: { type: ['integer', 'string', 'null'] },
            qty: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    cartCtrl.addItem
  );

  fastify.patch(
    '/cart/items/:id',
    {
      preHandler: [fastify.authenticateOptional],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['qty'],
          properties: {
            qty: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    cartCtrl.updateItem
  );

  fastify.delete(
    '/cart/items/:id',
    {
      preHandler: [fastify.authenticateOptional],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    cartCtrl.removeItem
  );

  fastify.post(
    '/cart/merge',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            guest_token: { type: 'string' },
          },
        },
      },
    },
    cartCtrl.mergeCart
  );
}
