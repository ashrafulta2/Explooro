/**
 * genie.routes.js — popup genie-effect policy routing.
 *
 *   GET  /genie/policy               public — what the client applies at boot
 *   GET  /admin/platform/genie       platform.genie.view    (LOW,    delegable)
 *   PUT  /admin/platform/genie       platform.genie.update  (MEDIUM, delegable)
 *
 * WHY MEDIUM and not CRITICAL for the update key: the brief is "Super Admin *or a user the Super
 * Admin assigns*". CRITICAL implies `delegable: false` (docs/rbac-spec.md §2), which would make
 * delegation impossible. MEDIUM is not held by any role but Super Admin by default, is grantable
 * through Access Grants, and executes immediately once held — the tier localization.routes.js
 * already settled on for the same reasons.
 *
 * WHY no requireModule: like Language and Platform Settings this is a `core` governance surface,
 * and `core` is deliberately not a row in platform_modules, so gating on it would 403 every call.
 *
 * WHY no requireRestriction: user_restrictions gate customer/seller capabilities, and there is no
 * capability key for an admin governance write (no other admin route uses one).
 */

import * as genieController from '../controllers/genie.controller.js';

export default async function genieRoutes(app) {
  const auth = app.authenticate || (async () => {});
  const reqPerm = (perm) => (app.requirePermission ? app.requirePermission(perm) : async () => {});

  // Public: read by every cold page load, including signed-out visitors.
  app.get('/genie/policy', genieController.getPublicPolicy);

  app.get(
    '/admin/platform/genie',
    { preHandler: [auth, reqPerm('platform.genie.view')] },
    genieController.getAdminPolicy
  );

  app.put(
    '/admin/platform/genie',
    {
      preHandler: [auth, reqPerm('platform.genie.update')],
      schema: {
        body: {
          type: 'object',
          required: ['enabled', 'duration_ms', 'quality', 'reason'],
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            // Type only: the numeric range is the service's rule (one implementation, two messages).
            duration_ms: { type: 'integer' },
            quality: { type: 'string', minLength: 1, maxLength: 16 },
            // Every state-changing admin action records why. The service enforces the same minimum,
            // so the rule holds for callers that bypass schema validation.
            reason: { type: 'string', minLength: 10, maxLength: 500 },
          },
        },
      },
    },
    genieController.updateAdminPolicy
  );
}
