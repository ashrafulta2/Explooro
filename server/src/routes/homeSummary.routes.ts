/**
 * homeSummary.routes.ts — GET /home/summary: the numbers behind the home page's top band.
 *
 * Authenticated only, with no permission key on purpose: the figures are the caller's OWN role
 * summary (the same counts that role's console opens with), chosen server-side from the session's
 * primary role, never from a query parameter, so one role cannot ask for another's numbers.
 * No `config.page`: `/` is locked on in the page toggle, so a guard could never refuse it.
 */

import { getHomeSummary } from '../services/homeSummary.service.ts';

export default async function homeSummaryRoutes(app) {
  app.get(
    '/home/summary',
    {
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      // WHY roles[0]: the client treats the first role as the primary one (services/session.js),
      // so the band and this endpoint always agree on which account type is looking.
      const role = req.user.roles?.[0] || 'customer';
      const data = await getHomeSummary(req.server.db, { userId: req.user.id, role });
      return reply.send({ success: true, data });
    },
  );
}
