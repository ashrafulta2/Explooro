/**
 * requirePage.js — server-side enforcement of per-page availability (traceability row 92).
 *
 * The page availability layer (migration 054, services/pageAccess.service.js) started as a
 * VISIBILITY layer: the client router, sidebar and command palette consult it, but a parked page's
 * API endpoints kept answering. That is fine for COMING_SOON on a feature nobody knows the URL of,
 * and not fine for LIMITED, whose whole promise is "live for these users and nobody else" — a
 * viewer outside the audience could still read the data by calling the endpoint directly.
 *
 * This closes that gap for endpoints that belong to ONE page. A route declares its page:
 *
 *   app.get('/supplier/inventory', {
 *     config: { page: '/supplier/inventory' },
 *     preHandler: [authenticate, requirePerm('catalog.inventory.view')],
 *   }, controller.getInventory);
 *
 * and the onRoute hook below appends the guard to that route's preHandler chain. Declaring it at
 * the route rather than in a central map is deliberate: a map in a config file is a second list
 * nobody updates when a route moves, and the only symptom of the drift would be a parked page
 * whose API still answers — exactly the defect this file exists to fix.
 *
 * WHY an onRoute hook and not a global preHandler hook: instance-level preHandler hooks run BEFORE
 * the route's own preHandler array, so `req.user` would still be empty and every LIMITED page would
 * resolve as if the caller were signed out. onRoute appends to the end of the chain, after
 * authenticate, which is the only place the audience check can be made.
 *
 * WHY a test asserts the hook is registered (server/test/requirePage.test.js): this repo already
 * has one case of a route declaring `config: { requireModule, requirePermission }` with nothing
 * anywhere reading it, so the guard silently did nothing. A declarative convention is only as real
 * as its reader, and only as trustworthy as the test that proves the reader runs.
 *
 * Scope, stated honestly: this guards endpoints a single page owns. An endpoint two pages share
 * cannot be refused — the other page may still be Live — so those stay open and the page toggle
 * remains visibility-only for them. requirePermission and requireModule are still the
 * authorization boundary; this narrows the gap, it does not replace them.
 */

import fp from 'fastify-plugin';
import { getPublicPageMap, resolveState } from '../services/pageAccess.service.js';
import { getRequestContext } from '../plugins/requestContext.js';

/** The viewer identity resolveState() needs — same shape requireModule builds, for the same reason. */
function viewerContext(req) {
  return {
    userId: req.user?.id,
    userRef: req.user?.ref,
    role: req.user?.role || req.user?.roles?.[0],
    roles: req.user?.roles,
  };
}

/**
 * Builds the preHandler for one page path.
 *
 * Fails OPEN. getPublicPageMap() never throws and answers `{}` when the table is unreachable or has
 * not been migrated yet, so an infrastructure problem leaves every page LIVE. A page layer that
 * failed closed would turn one transient database error into a platform-wide outage, which is a far
 * worse failure than a parked page answering for a minute — the posture
 * services/pageAccess.service.js already takes for the public map.
 */
export function createPageGuard(pagePath) {
  return async function requirePagePreHandler(req, reply) {
    const db = req.db || req.server?.db;
    const cache = req.cache || req.server?.cache;

    const map = await getPublicPageMap(db, cache);
    // Resolves LIMITED down to LIVE or HIDDEN for this viewer, and returns LIVE for a super admin
    // and for every locked path. One implementation, shared with the public endpoint and the client.
    const state = resolveState(map, pagePath, viewerContext(req));

    if (state === 'LIVE') return;

    const traceId = getRequestContext()?.trace_id || req.headers?.['x-trace-id'] || 'TRACE-PAGE';

    // COMING_SOON and HIDDEN both mean "not released to this viewer". They are reported with one
    // code and distinguished by page_state, so a client can tell "not yet" from "not for you"
    // without the API growing two error codes that mean the same refusal.
    return reply.status(403).send({
      error: {
        code: 'PAGE_UNAVAILABLE',
        page: pagePath,
        page_state: state,
        message_en:
          state === 'COMING_SOON'
            ? 'This feature is not released yet.'
            : 'This feature is not available on your account.',
        message_bn:
          state === 'COMING_SOON'
            ? 'এই ফিচারটি এখনো চালু করা হয়নি।'
            : 'এই ফিচারটি আপনার অ্যাকাউন্টে উপলব্ধ নয়।',
        trace_id: traceId,
      },
    });
  };
}

/** Normalises whatever shape the route used, so appending never clobbers an existing guard. */
function appendPreHandler(routeOptions, handler) {
  const existing = routeOptions.preHandler;
  if (Array.isArray(existing)) routeOptions.preHandler = [...existing, handler];
  else if (typeof existing === 'function') routeOptions.preHandler = [existing, handler];
  else routeOptions.preHandler = [handler];
}

async function requirePagePlugin(app) {
  // Exposed for a route that would rather be explicit than declarative. Both paths run the same
  // guard; `config: { page }` is the one used in practice because it cannot be mis-ordered.
  app.decorate('requirePage', createPageGuard);

  app.addHook('onRoute', (routeOptions) => {
    const pagePath = routeOptions.config?.page;
    if (typeof pagePath !== 'string' || !pagePath.startsWith('/')) return;
    appendPreHandler(routeOptions, createPageGuard(pagePath));
  });
}

export default fp(requirePagePlugin, {
  name: 'requirePage',
});
