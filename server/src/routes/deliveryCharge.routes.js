/**
 * deliveryCharge.routes.js — the per-parcel delivery charge for normal checkout.
 *
 *   GET  /delivery/policy            public — the cart and Quick Buy show it before sign-in
 *   GET  /admin/platform/delivery    platform.delivery.view    (LOW)
 *   PUT  /admin/platform/delivery    platform.delivery.update  (CRITICAL: super admin only)
 *
 * WHY CRITICAL: it changes what every shopper pays on every order. The product owner asked for the
 * super admin to set it, and CRITICAL is the tier that means "super admin only, applies at once"
 * (requirePermission.js). The team-purchase charge is HIGH instead because it went through the
 * group_buying module's maker-checker flow.
 *
 * WHY no requireModule: like Language and Genie this is a `core` governance surface.
 */

import * as deliveryChargeController from '../controllers/deliveryCharge.controller.js';

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
          required: ['per_parcel_charge', 'reason'],
          additionalProperties: false,
          properties: {
            // Type only: the range is the service's rule.
            per_parcel_charge: { type: 'number' },
            reason: { type: 'string', minLength: 10, maxLength: 500 },
          },
        },
      },
    },
    deliveryChargeController.updateAdminPolicy
  );
}
