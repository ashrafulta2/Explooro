/**
 * deliveryCharge.routes.ts — the per-parcel delivery charge for normal checkout, by delivery zone.
 *
 *   GET  /delivery/policy            public — the cart and Quick Buy show it before sign-in
 *   GET  /admin/platform/delivery    platform.delivery.view    (LOW)
 *   PUT  /admin/platform/delivery    platform.delivery.update  (CRITICAL: super admin only)
 *
 * WHY CRITICAL: it changes what every shopper pays on every order. The product owner asked for the
 * super admin to set it, and CRITICAL is the tier that means "super admin only, applies at once"
 * (requirePermission.ts). The team-purchase charge is HIGH instead because it went through the
 * group_buying module's maker-checker flow.
 *
 * WHY no requireModule: like Language and Genie this is a `core` governance surface.
 */

import * as deliveryChargeController from '../controllers/deliveryCharge.controller.ts';

export default async function deliveryChargeRoutes(app) {
  const auth = app.authenticate || (async () => {});
  const reqPerm = (perm) => (app.requirePermission ? app.requirePermission(perm) : async () => {});

  app.get('/delivery/policy', deliveryChargeController.getPublicPolicy);

  app.get(
    '/admin/platform/delivery',
    { config: { page: '/admin/platform/delivery' }, preHandler: [auth, reqPerm('platform.delivery.view')] },
    deliveryChargeController.getAdminPolicy
  );

  app.put(
    '/admin/platform/delivery',
    {
      config: { page: '/admin/platform/delivery' },
      preHandler: [auth, reqPerm('platform.delivery.update')],
      schema: {
        body: {
          type: 'object',
          required: ['zones', 'default_zone', 'reason'],
          additionalProperties: false,
          properties: {
            // Shape only: every range and cross-zone rule is the service's (validatePolicy).
            zones: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  key: { type: 'string', maxLength: 40 },
                  name_en: { type: 'string', maxLength: 200 },
                  name_bn: { type: 'string', maxLength: 200 },
                  charge: { type: 'number' },
                  team_charge: { type: 'number' },
                  days_min: { type: 'integer' },
                  days_max: { type: 'integer' },
                  districts: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 64 } },
                },
              },
            },
            default_zone: { type: 'string', maxLength: 40 },
            cutoff_hour: { type: ['integer', 'null'] },
            expected_updated_at: { type: ['string', 'null'] },
            reason: { type: 'string', minLength: 10, maxLength: 500 },
          },
        },
      },
    },
    deliveryChargeController.updateAdminPolicy
  );
}
