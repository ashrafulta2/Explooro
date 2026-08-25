/**
 * publicApi.routes.js — Fastify Route Registrations for Public Catalog, Partner APIs & Developer Portal (Prompt 10.7).
 */

import * as controller from '../controllers/publicApi.controller.js';
import * as apiKeyService from '../services/apiKey.service.js';
import { AppError } from '../plugins/errorHandler.js';

export default async function publicApiRoutes(fastify) {
  const requireOpenApiModule = fastify.requireModule ? fastify.requireModule('open_api') : async () => {};

  /**
   * PreHandler for API Key authentication on partner write routes.
   */
  async function authenticateApiKeyPreHandler(req) {
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];
    let rawKey = null;

    if (apiKeyHeader) {
      rawKey = apiKeyHeader;
    } else if (authHeader?.startsWith('Bearer exp_live_') || authHeader?.startsWith('Bearer ')) {
      rawKey = authHeader.replace(/^Bearer\s+/, '').trim();
    }

    if (!rawKey) {
      throw new AppError('AUTH_REQUIRED', 'API key required in X-Api-Key or Authorization header.', 401);
    }

    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    const keyRecord = await apiKeyService.authenticateApiKey(fastify.db, rawKey, clientIp);
    if (!keyRecord) {
      throw new AppError('UNAUTHORIZED', 'Invalid or inactive API key.', 401);
    }

    req.apiKey = keyRecord;
    req.user = {
      id: keyRecord.userId,
      role: keyRecord.userRole,
      name: keyRecord.userName,
      scopes: keyRecord.scopes,
    };
  }

  // ---------------------------------------------------------------------------
  // PUBLIC READ-ONLY CATALOG (No auth required, module gated)
  // ---------------------------------------------------------------------------
  fastify.get('/public/products', { preHandler: [requireOpenApiModule] }, controller.getPublicProducts);
  fastify.get('/public/products/:idOrSlug', { preHandler: [requireOpenApiModule] }, controller.getPublicProductById);
  fastify.get('/public/stores', { preHandler: [requireOpenApiModule] }, controller.getPublicStores);
  fastify.get('/public/stores/:idOrSlug', { preHandler: [requireOpenApiModule] }, controller.getPublicStoreById);
  fastify.get('/public/categories', { preHandler: [requireOpenApiModule] }, controller.getPublicCategories);

  // ---------------------------------------------------------------------------
  // PARTNER WRITE API (API Key + Scoped Permission Required)
  // ---------------------------------------------------------------------------
  fastify.post('/public/orders', {
    preHandler: [requireOpenApiModule, authenticateApiKeyPreHandler],
  }, controller.createPartnerOrder);

  // ---------------------------------------------------------------------------
  // DEVELOPER PORTAL (JWT Auth required for dashboard management)
  // ---------------------------------------------------------------------------
  fastify.post('/developer/api-keys', {
    preHandler: [requireOpenApiModule, fastify.authenticate],
  }, controller.createApiKey);

  fastify.get('/developer/api-keys', {
    preHandler: [requireOpenApiModule, fastify.authenticate],
  }, controller.listApiKeys);

  fastify.post('/developer/api-keys/:id/rotate', {
    preHandler: [requireOpenApiModule, fastify.authenticate],
  }, controller.rotateApiKey);

  fastify.delete('/developer/api-keys/:id', {
    preHandler: [requireOpenApiModule, fastify.authenticate],
  }, controller.revokeApiKey);

  fastify.post('/developer/webhooks', {
    preHandler: [requireOpenApiModule, fastify.authenticate],
  }, controller.createWebhookSubscription);

  fastify.get('/developer/webhooks', {
    preHandler: [requireOpenApiModule, fastify.authenticate],
  }, controller.listWebhookSubscriptions);

  fastify.delete('/developer/webhooks/:id', {
    preHandler: [requireOpenApiModule, fastify.authenticate],
  }, controller.deleteWebhookSubscription);

  fastify.get('/developer/webhooks/deliveries', {
    preHandler: [requireOpenApiModule, fastify.authenticate],
  }, controller.listWebhookDeliveries);

  fastify.post('/developer/webhooks/deliveries/:id/replay', {
    preHandler: [requireOpenApiModule, fastify.authenticate],
  }, controller.replayWebhookDelivery);
}
