/**
 * integration.routes.ts — gateway credentials and pause switches (migration 108).
 *
 *   GET  /admin/platform/integrations              platform.integration.view    (MEDIUM, delegable)
 *   GET  /admin/platform/integrations/logs         platform.integration.view    (payment webhooks)
 *   PUT  /admin/platform/integrations/:key         platform.integration.manage  (CRITICAL: super admin only)
 *   PUT  /admin/platform/integrations/:key/status  platform.integration.manage  (CRITICAL)
 *   POST /admin/platform/integrations/:key/test    platform.integration.manage  (CRITICAL)
 *
 * WHY Test needs manage and not view: it writes the result onto the card and into the audit log,
 * and it tells whoever runs it which credentials are missing on a live gateway.
 *
 * WHY no requireModule / requireRestriction: a `core` governance surface like genie.routes.ts (see
 * its header): `core` is not a module row, and no restriction key covers an admin write.
 */

import * as controller from '../controllers/integration.controller.ts';

const PAGE = '/admin/platform/integrations';

export default async function integrationRoutes(app) {
  const auth = app.authenticate || (async () => {});
  const reqPerm = (perm) => (app.requirePermission ? app.requirePermission(perm) : async () => {});
  // Type and shape only: whether the key is in the catalog is the service's rule (404).
  const keyParams = {
    type: 'object',
    required: ['key'],
    properties: { key: { type: 'string', pattern: '^[a-z0-9_]{2,64}$' } },
  };
  const reason = { type: 'string', minLength: 10, maxLength: 500 };

  app.get(
    '/admin/platform/integrations',
    { config: { page: PAGE }, preHandler: [auth, reqPerm('platform.integration.view')] },
    controller.listIntegrations
  );

  // Registered before /:key routes only for readability; Fastify prefers the static segment anyway.
  app.get(
    '/admin/platform/integrations/logs',
    {
      config: { page: PAGE },
      preHandler: [auth, reqPerm('platform.integration.view')],
      schema: { querystring: { type: 'object', properties: { limit: { type: 'integer' } } } },
    },
    controller.listWebhookLogs
  );

  app.put(
    '/admin/platform/integrations/:key',
    {
      config: { page: PAGE },
      preHandler: [auth, reqPerm('platform.integration.manage')],
      schema: {
        params: keyParams,
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: {
            // Field names and lengths are the service's rule (validateValues), against the catalog.
            values: { type: 'object', additionalProperties: { type: 'string' } },
            clear: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            reason,
          },
        },
      },
    },
    controller.updateCredentials
  );

  app.put(
    '/admin/platform/integrations/:key/status',
    {
      config: { page: PAGE },
      preHandler: [auth, reqPerm('platform.integration.manage')],
      schema: {
        params: keyParams,
        body: {
          type: 'object',
          required: ['enabled', 'reason'],
          additionalProperties: false,
          properties: { enabled: { type: 'boolean' }, reason },
        },
      },
    },
    controller.setStatus
  );

  app.post(
    '/admin/platform/integrations/:key/test',
    {
      config: { page: PAGE },
      preHandler: [auth, reqPerm('platform.integration.manage')],
      schema: { params: keyParams },
    },
    controller.testIntegration
  );
}
