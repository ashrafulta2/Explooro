/**
 * recommendationAdmin.routes.js — operator routes for the personalized home feed (Phase G).
 *
 *   GET /admin/platform/recommendations                  platform.recommendation.view    (LOW,    delegable)
 *   GET /admin/platform/recommendations/funnel           platform.recommendation.view
 *   PUT /admin/platform/recommendations/:section         platform.recommendation.update  (MEDIUM, delegable)
 *
 * WHY MEDIUM and not CRITICAL for the update key: same reasoning as genie.routes.js — the brief is
 * "Super Admin or someone the Super Admin assigns", and CRITICAL implies `delegable: false`. These
 * numbers decide what shoppers see first, not where money moves: the commission split, escrow and
 * payouts are untouched by anything on this page.
 *
 * WHY no requireModule: like Language, Genie and Platform Settings this is a `core` governance
 * surface. The ranking weights also govern the NON-personal signals (trending, best sellers, quality)
 * an opted-out shopper still gets, so the page must stay reachable when the `personalization_signals`
 * module — which only controls capture — is switched off.
 *
 * WHY no requireRestriction: user_restrictions gate customer/seller capabilities, and there is no
 * capability key for an admin governance write (no other admin route uses one).
 *
 * WHY `app.requirePermission(...)` is called directly and not behind a fallback: a missing decorator
 * must stop the server from booting, not leave a governance write unguarded.
 */

import * as controller from '../controllers/recommendationAdmin.controller.js';
import { SECTION_KEYS, MIN_REASON_LENGTH } from '../services/recommendationAdmin.service.js';

const PAGE = '/admin/platform/recommendations';

export default async function recommendationAdminRoutes(app) {
  const auth = app.authenticate;
  const view = app.requirePermission('platform.recommendation.view');
  const update = app.requirePermission('platform.recommendation.update');

  // `config.page` is read by the onRoute hook in middlewares/requirePage.js: when this page is parked
  // at /admin/platform/pages, these endpoints answer 403 PAGE_UNAVAILABLE instead of data.
  app.get(PAGE, { config: { page: PAGE }, preHandler: [auth, view] }, controller.getAdminSettings);

  app.get(
    `${PAGE}/funnel`,
    {
      config: { page: PAGE },
      preHandler: [auth, view],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            // Type only: the range is the service's rule (a bad value falls back to the default window).
            days: { type: 'integer' },
            attribution_days: { type: 'integer' },
            audience: { type: 'string', enum: ['customer', 'saler'] },
          },
        },
      },
    },
    controller.getAdminFunnel
  );

  app.put(
    `${PAGE}/:section`,
    {
      config: { page: PAGE },
      preHandler: [auth, update],
      schema: {
        params: {
          type: 'object',
          required: ['section'],
          properties: { section: { type: 'string', enum: SECTION_KEYS } },
        },
        body: {
          type: 'object',
          required: ['value', 'reason'],
          additionalProperties: false,
          properties: {
            // The shape is the service's rule, section by section (one implementation, two messages).
            value: { type: 'object' },
            // The `updated_at` the form was loaded with; a mismatch is a 409, not a silent overwrite.
            base_updated_at: { type: ['string', 'null'] },
            reason: { type: 'string', minLength: MIN_REASON_LENGTH, maxLength: 500 },
          },
        },
      },
    },
    controller.updateAdminSection
  );
}
