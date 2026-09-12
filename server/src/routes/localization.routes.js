/**
 * localization.routes.js — Language & Localization policy routing.
 *
 * Three endpoints, two guards:
 *
 *   GET  /localization/policy               public — what the client boots from
 *   GET  /admin/platform/localization       platform.localization.view    (LOW,    delegable)
 *   PUT  /admin/platform/localization       platform.localization.update  (MEDIUM, delegable)
 *
 * WHY the update key is MEDIUM and not CRITICAL: the brief is "Super Admin *or a user the Super
 * Admin assigns*". docs/permission-catalog.json's own rule is that CRITICAL implies
 * `delegable: false` and is "never grantable by any path" (docs/rbac-spec.md §2), which would make
 * delegation impossible. MEDIUM is the tier that means exactly what is wanted: not held by any
 * role except Super Admin by default, grantable to a specific user through the existing Access
 * Grants flow (Mode A) or a JIT window (Mode B), and executing immediately once held.
 *
 * WHY no requireModule: this is a `core` governance surface, like Platform Settings and
 * Integrations. Server-side `requireModule` resolves an unknown key to *disabled*, and `core` is
 * deliberately not a row in platform_modules — so gating here would 403 every request. It is also
 * the wrong behaviour on purpose: if the `i18n` module were ever turned off, a Super Admin must
 * still be able to reach the page that decides which single language the site then speaks.
 *
 * WHY no requireRestriction: user_restrictions gate customer/seller capabilities (can_place_order,
 * can_run_ads, …) per docs/rbac-spec.md §5. There is no capability key for an admin governance
 * write, and no other admin route (theme, modules, delegation) uses one.
 */

import * as localizationController from '../controllers/localization.controller.js';

export default async function localizationRoutes(app) {
  const auth = app.authenticate || (async () => {});
  const reqPerm = (perm) => (app.requirePermission ? app.requirePermission(perm) : async () => {});

  // Public: read by every cold page load, including signed-out visitors.
  app.get('/localization/policy', localizationController.getPublicPolicy);

  app.get(
    '/admin/platform/localization',
    { preHandler: [auth, reqPerm('platform.localization.view')] },
    localizationController.getAdminPolicy
  );

  app.put(
    '/admin/platform/localization',
    {
      preHandler: [auth, reqPerm('platform.localization.update')],
      schema: {
        body: {
          type: 'object',
          required: ['default_locale', 'enabled_locales', 'allow_user_override', 'reason'],
          additionalProperties: false,
          properties: {
            default_locale: { type: 'string', minLength: 2, maxLength: 8 },
            enabled_locales: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 2, maxLength: 8 },
            },
            allow_user_override: { type: 'boolean' },
            // Every state-changing admin action records why. The service enforces the same
            // minimum, so the rule holds for callers that bypass schema validation.
            reason: { type: 'string', minLength: 10, maxLength: 500 },
          },
        },
      },
    },
    localizationController.updateAdminPolicy
  );
}
