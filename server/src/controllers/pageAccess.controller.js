/**
 * pageAccess.controller.js — Request handlers for the per-page availability API.
 */

import * as pageAccessService from '../services/pageAccess.service.js';
import * as auditService from '../services/audit.service.js';
import * as auditRepo from '../repositories/audit.repository.js';

function dbOf(req) {
  return req.db || req.server?.db;
}

function cacheOf(req) {
  return req.cache || req.server?.cache;
}

function reqContextOf(req) {
  return {
    traceId: req.traceId,
    ip: req.ip,
    userAgent: req.headers?.['user-agent'],
  };
}

/**
 * Public. The client applies this on every cold page load, so it must answer for a signed-out
 * visitor and must never fail — the service degrades to an empty map ("everything LIVE") rather
 * than throwing.
 *
 * Sends the parked rows rather than a resolved per-page verdict: the client has the route table
 * and resolves each page against it (client/src/services/pageAccess.js), which keeps one round
 * trip instead of 224 and keeps the sidebar filter and the router guard reading one source.
 */
export async function getPublicPages(req, reply) {
  const pages = await pageAccessService.getPublicPageMap(dbOf(req), cacheOf(req));
  return reply.send({ pages, states: pageAccessService.PAGE_STATES, locked_paths: pageAccessService.LOCKED_PATHS });
}

/**
 * Admin read: every stored row plus the recent change history, so the screen can show what moved
 * and why without a second trip to the Audit Log. The full page list is NOT sent — the client's
 * route table is the registry, and a server-side copy of it would go stale.
 */
export async function listAdminPages(req, reply) {
  const db = dbOf(req);
  const toggles = await pageAccessService.listToggles(db);

  let history = [];
  try {
    const result = await auditRepo.listAuditLogs(db, { action: 'platform.page.toggle', limit: 20 });
    history = result?.items ?? [];
  } catch {
    // The screen is still useful without history; an empty list renders an explicit empty state.
  }

  return reply.send({
    pages: toggles,
    states: pageAccessService.PAGE_STATES,
    locked_paths: pageAccessService.LOCKED_PATHS,
    history,
    can_toggle: Boolean(req.userPermissions?.has?.('platform.page.toggle')),
  });
}

/**
 * Writes one page's availability. The route path travels in the BODY, not the URL: a path is full
 * of slashes and would have to be double-encoded as a parameter, which is how a page named
 * `/admin/catalog/warehouses` becomes a 404 nobody can explain.
 */
export async function updateAdminPage(req, reply) {
  const body = req.body || {};
  const result = await pageAccessService.setPageState(dbOf(req), cacheOf(req), auditService, {
    toggle: {
      route_path: body.route_path,
      state: body.state,
      allowed_roles: body.allowed_roles,
      allowed_user_ids: body.allowed_user_ids,
      reason: body.reason,
    },
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    reqContext: reqContextOf(req),
  });

  return reply.send({
    data: { page: result.after, before: result.before },
    message_en: `"${result.after.route_path}" is now ${result.after.state}.`,
    message_bn: `"${result.after.route_path}" এখন ${result.after.state}।`,
  });
}
