/**
 * partnerReward.routes.ts — the monthly shop partner reward pool (Phase B; partnerReward.service.ts).
 *
 *   GET  /admin/growth/partner-rewards                  growth.partner_reward.view    (LOW)
 *   GET  /admin/growth/partner-rewards/runs/:id/payouts growth.partner_reward.view    (LOW, paginated)
 *   PUT  /admin/growth/partner-rewards                  growth.partner_reward.update  (CRITICAL)
 *   POST /admin/growth/partner-rewards/close            growth.partner_reward.run     (CRITICAL)
 *   GET  /saler/partner-reward                          saler.dashboard.view          (own numbers only)
 *
 * WHY CRITICAL: the weights decide who gets the pool and the ad share moves platform money into it,
 * so, like the attribution window, only the super admin changes them, and it applies at once.
 *
 * WHY requireModule('virtual_storefront'): the job is gated on it and partners promote through their
 * storefront; the nav item carries the same module, so the nav guard equals the route guard.
 *
 * WHY no requireRestriction: user_restrictions gate customer/seller capabilities, and there is no
 * capability key for an admin governance write or for reading one's own dashboard card.
 */

import * as controller from '../controllers/partnerReward.controller.ts';

const PAGE = '/admin/growth/partner-rewards';

export default async function partnerRewardRoutes(app) {
  const requireStorefront = app.requireModule('virtual_storefront');
  const admin = (perm) => [app.authenticate, requireStorefront, app.requirePermission(perm)];

  app.get(PAGE, { config: { page: PAGE }, preHandler: admin('growth.partner_reward.view') }, controller.getAdminView);

  app.get(
    `${PAGE}/runs/:id/payouts`,
    {
      config: { page: PAGE },
      preHandler: admin('growth.partner_reward.view'),
      schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } },
    },
    controller.getRunPayouts
  );

  const intIn = { type: 'integer' };
  app.put(
    PAGE,
    {
      config: { page: PAGE },
      preHandler: admin('growth.partner_reward.update'),
      schema: {
        body: {
          type: 'object',
          required: ['weights', 'ad_revenue_share_pct', 'community_points', 'max_posts_per_day', 'settle_lag_days', 'reason'],
          additionalProperties: false,
          // Types only: the ranges are the service's rule (partnerReward.service.ts RULE_LIMITS).
          properties: {
            weights: {
              type: 'object',
              required: ['sales', 'social', 'community', 'activity'],
              additionalProperties: false,
              properties: { sales: intIn, social: intIn, community: intIn, activity: intIn },
            },
            ad_revenue_share_pct: { type: 'number' },
            community_points: {
              type: 'object',
              required: ['post', 'like', 'comment', 'save'],
              additionalProperties: false,
              properties: { post: intIn, like: intIn, comment: intIn, save: intIn },
            },
            max_posts_per_day: intIn,
            settle_lag_days: intIn,
            expected_updated_at: { type: ['string', 'null'] },
            reason: { type: 'string', minLength: 10, maxLength: 500 },
          },
        },
      },
    },
    controller.updateRules
  );

  app.post(`${PAGE}/close`, { config: { page: PAGE }, preHandler: admin('growth.partner_reward.run') }, controller.closeNow);

  // A dashboard card, not one page's endpoint, so no `config.page` (same as /saler/partner-score).
  app.get(
    '/saler/partner-reward',
    { preHandler: [app.authenticate, requireStorefront, app.requirePermission('saler.dashboard.view')] },
    controller.getOwnView
  );
}
