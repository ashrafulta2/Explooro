/**
 * attributionAdmin.routes.ts — how long a storefront visit or link click credits a shop partner.
 *
 *   GET  /admin/growth/attribution   growth.attribution.view    (LOW)
 *   PUT  /admin/growth/attribution   growth.attribution.update  (CRITICAL: super admin only)
 *
 * WHY CRITICAL: a longer window credits more sales to shop partners, which moves the partner share
 * of those orders from the platform to them. Like the delivery charge and referral rates it is a
 * money rule, so only the super admin sets it, and it applies at once.
 *
 * WHY requireModule('social_seller_kit'): attribution belongs to the partner kit (tracked links);
 * the nav item carries the same module, so the nav guard equals the route guard.
 *
 * WHY no requireRestriction: user_restrictions gate customer/seller capabilities, and there is no
 * capability key for an admin governance write (see genie.routes.ts).
 */

import * as attributionAdminController from '../controllers/attributionAdmin.controller.ts';

export default async function attributionAdminRoutes(app) {
  const requireKit = app.requireModule('social_seller_kit');

  app.get(
    '/admin/growth/attribution',
    {
      config: { page: '/admin/growth/attribution' },
      preHandler: [app.authenticate, requireKit, app.requirePermission('growth.attribution.view')],
    },
    attributionAdminController.getAdminPolicy
  );

  app.put(
    '/admin/growth/attribution',
    {
      config: { page: '/admin/growth/attribution' },
      preHandler: [app.authenticate, requireKit, app.requirePermission('growth.attribution.update')],
      schema: {
        body: {
          type: 'object',
          required: ['window_days', 'reason'],
          additionalProperties: false,
          properties: {
            // Type only: the range is the service's rule (attribution.service.ts WINDOW_LIMITS).
            window_days: { type: 'integer' },
            reason: { type: 'string', minLength: 10, maxLength: 500 },
          },
        },
      },
    },
    attributionAdminController.updateAdminPolicy
  );
}
