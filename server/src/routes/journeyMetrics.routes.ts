/**
 * journeyMetrics.routes.ts — where users stall in their journeys (Prompt 13.7).
 *
 *   GET /admin/platform/guided-experience   platform.guidance.view (LOW, delegable, read-only)
 *
 * WHY no requireModule: this page is where an admin decides whether the `guided_experience` module
 * should stay on, so it must answer while the module is off. The switch itself is the existing
 * PATCH /admin/modules/:key, guarded by platform.module.toggle.
 *
 * WHY no requireRestriction: user_restrictions gate customer and seller capabilities; there is no
 * capability key for reading an admin report (no other admin route uses one).
 *
 * WHY no pagination: the answer is one row per journey step (under fifty), whatever the user count.
 */

import * as controller from '../controllers/journeyMetrics.controller.ts';

export default async function journeyMetricsRoutes(app) {
  app.get(
    '/admin/platform/guided-experience',
    {
      config: { page: '/admin/platform/guided-experience' },
      preHandler: [app.authenticate, app.requirePermission('platform.guidance.view')],
    },
    controller.getReport
  );
}
