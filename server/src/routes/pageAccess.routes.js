/**
 * pageAccess.routes.js — per-page availability routing.
 *
 *   GET  /page-access            public — what the client applies at boot
 *   GET  /admin/pages            platform.page.view    (LOW,      delegable)
 *   PUT  /admin/pages            platform.page.toggle  (CRITICAL, super_admin only)
 *
 * WHY CRITICAL for the write key: parking a page takes a surface away from every user at once,
 * which is the same blast radius as platform.module.toggle, and that key is CRITICAL. CRITICAL
 * implies `delegable: false` (docs/rbac-spec.md §2), so this one stays with the Super Admin — the
 * stated requirement was "the super admin must have a system to activate and deactivate every
 * feature and every page", not a delegable one. The read key is LOW and delegable so staff can see
 * why a page is missing without being able to move it.
 *
 * WHY no requireModule: like Module Control, Language and Platform Settings, this is a `core`
 * governance surface, and `core` is deliberately not a row in platform_modules, so gating on it
 * would 403 every call.
 *
 * WHY no requireRestriction: user_restrictions gate customer/seller capabilities, and there is no
 * capability key for an admin governance write (no other admin route uses one).
 */

import * as pageAccessController from '../controllers/pageAccess.controller.js';

export default async function pageAccessRoutes(app) {
  const auth = app.authenticate || (async () => {});
  const reqPerm = (perm) => (app.requirePermission ? app.requirePermission(perm) : async () => {});

  // Optional auth: a signed-out visitor still needs the map, because a HIDDEN public page must be
  // hidden from them too. The resolution is per-viewer, so an anonymous caller simply has no role.
  const optionalAuth = async (req, reply) => {
    try {
      if (app.authenticate) await app.authenticate(req, reply);
    } catch {
      // Ignored — this endpoint answers for signed-out visitors by design.
    }
  };

  app.get('/page-access', { preHandler: [optionalAuth] }, pageAccessController.getPublicPages);

  app.get(
    '/admin/pages',
    { preHandler: [auth, reqPerm('platform.page.view')] },
    pageAccessController.listAdminPages
  );

  app.put(
    '/admin/pages',
    {
      preHandler: [auth, reqPerm('platform.page.toggle')],
      schema: {
        body: {
          type: 'object',
          required: ['route_path', 'state', 'reason'],
          additionalProperties: false,
          properties: {
            route_path: { type: 'string', minLength: 1, maxLength: 512 },
            // Type only: the allowed set, the lock list and the LIMITED-needs-an-audience rule are
            // the service's (one implementation, two messages).
            state: { type: 'string', minLength: 1, maxLength: 32 },
            allowed_roles: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 16 },
            // Accepts numbers or strings: users.id is BIGSERIAL, and JSON gives it back either way
            // depending on the client. The service normalises to strings.
            //
            // WHY anyOf and not `type: ['string','integer']`: Ajv's strict mode (Fastify's default
            // validator) warns on a union `type` and some configurations refuse the schema
            // outright, which would 500 every write with a message about strictTypes.
            allowed_user_ids: {
              type: 'array',
              items: { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'integer' }] },
              maxItems: 200,
            },
            // Every state-changing admin action records why. The service enforces the same minimum,
            // so the rule holds for callers that bypass schema validation.
            reason: { type: 'string', minLength: 10, maxLength: 500 },
          },
        },
      },
    },
    pageAccessController.updateAdminPage
  );
}
