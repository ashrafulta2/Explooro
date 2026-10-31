/**
 * variantOptions.routes.ts — which variant options (size, colour, weight, ...) each category offers.
 *
 *   GET /admin/catalog/variant-options   catalog.category.view    (LOW)
 *   PUT /admin/catalog/variant-options   catalog.category.manage  (MEDIUM, delegable)
 *   GET /catalog/variant-options          signed in: the product form's list for one category
 *
 * WHY catalog.category.*: this is part of how categories are set up, the same keys the category
 * page uses; no new permission was invented (docs/permission-catalog.json).
 *
 * WHY no requireModule: categories and the product form are `core`, which cannot be switched off.
 * WHY no requireRestriction on the admin routes: user_restrictions gate customer/seller capabilities,
 * and there is no capability key for an admin governance write (see genie.routes.ts).
 */

import * as controller from '../controllers/variantOptions.controller.ts';
import { AppError } from '../plugins/errorHandler.ts';

export default async function variantOptionsRoutes(app) {
  // Same fallbacks as product.routes.ts, for a test app without the real auth plugins.
  const authenticate =
    app.authenticate ||
    (async (req) => {
      if (!req.user) throw new AppError('AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
    });
  const reqPerm = (perm) => app.requirePermission(perm);

  app.get(
    '/admin/catalog/variant-options',
    { config: { page: '/admin/catalog/variant-options' }, preHandler: [authenticate, reqPerm('catalog.category.view')] },
    controller.getAdminPolicy
  );

  app.put(
    '/admin/catalog/variant-options',
    {
      config: { page: '/admin/catalog/variant-options' },
      preHandler: [authenticate, reqPerm('catalog.category.manage')],
      schema: {
        body: {
          type: 'object',
          required: ['categories', 'reason'],
          additionalProperties: false,
          properties: {
            // Shape only: which options and categories are valid is the service's rule.
            categories: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
            reason: { type: 'string', minLength: 10, maxLength: 500 },
            base_updated_at: { type: ['string', 'null'] },
          },
        },
      },
    },
    controller.updateAdminPolicy
  );

  // No config.page: the product form (supplier and admin catalog pages) is not one page.
  app.get('/catalog/variant-options', { preHandler: [authenticate] }, controller.getForCategory);
}
