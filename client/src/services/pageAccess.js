/**
 * pageAccess.js — per-page availability, the layer that sits BESIDE the module system.
 *
 * A module answers "does this capability work at all". Page availability answers "may this viewer
 * see this page". They are deliberately different questions: switching `multi_warehouse` off to
 * hide /supplier/warehouses also switches off nearest-depot order routing, and 101 of the route
 * table's 224 entries are `module: 'core'` and so cannot be hidden by a module at all. This gives
 * the super admin a per-route switch that changes nothing about the feature underneath.
 *
 * Four states, stored per `route_path`:
 *   LIVE         — normal.
 *   COMING_SOON  — nav item still rendered, with a "Coming soon" badge; the URL renders the
 *                  ComingSoonPage placeholder instead of the real page. For a feature that is
 *                  built but not released yet, which is the case this whole layer exists for.
 *   HIDDEN       — absent from the nav; the URL renders the 404 page.
 *   LIMITED      — LIVE for the listed roles and user ids, HIDDEN for everyone else. This is the
 *                  "release it to just this one supplier first" case.
 *
 * ONE resolution function, used by BOTH core/router.js (through main.js) and
 * components/shell/Sidebar.js — docs/super-admin-audit.md §5 invariant 1 ("the nav guard must
 * equal the route guard"). client/test/pageAvailability.test.js fails if either consumer grows its
 * own copy of these rules.
 *
 * Scope, stated plainly: this is a VISIBILITY layer, not a security boundary. A hidden page's API
 * endpoints still answer, so a determined caller with the right permission can still reach the
 * data by hand. That is adequate for "the feature is built but not released", which is what it was
 * asked for; server-side enforcement would need a route→API-prefix map and is a separate step.
 */

import { api } from '../core/api.js';

export const PAGE_STATES = Object.freeze(['LIVE', 'COMING_SOON', 'HIDDEN', 'LIMITED']);

/**
 * Routes no state but LIVE may ever be written to.
 *
 * WHY: without this, hiding /admin/platform/pages removes the only surface that can un-hide it,
 * and hiding /login removes the way back in. Kept in lockstep with LOCKED_PATHS in
 * server/src/services/pageAccess.service.js — the test asserts both lists match, because a path
 * the API accepts but the client refuses (or the reverse) is a lockout waiting to happen.
 */
export const LOCKED_PATHS = Object.freeze(['/', '/login', '/admin/platform/pages']);

/** `{ [route_path]: { state, allowed_roles: [], allowed_user_ids: [] } }` */
let toggles = {};
const listeners = new Set();

/**
 * Loads the viewer's page-availability map. Never throws: a page layer that fails closed would
 * black out the whole app on a transient API error, so an unreachable endpoint means "everything
 * LIVE" — the same posture featureFlags.js takes.
 */
export async function initPageAccess() {
  try {
    const res = await api.get('/page-access');
    setPageToggles(res?.pages ?? res?.data ?? {});
  } catch {
    setPageToggles({});
  }
}

export function setPageToggles(next = {}) {
  toggles = {};
  for (const [path, row] of Object.entries(next || {})) {
    if (!row) continue;
    toggles[normalizePath(path)] = {
      state: PAGE_STATES.includes(row.state) ? row.state : 'LIVE',
      allowed_roles: Array.isArray(row.allowed_roles) ? row.allowed_roles : [],
      allowed_user_ids: Array.isArray(row.allowed_user_ids) ? row.allowed_user_ids.map(String) : [],
    };
  }
  for (const fn of listeners) {
    try {
      fn(toggles);
    } catch {
      // A broken listener must not stop the others from being told.
    }
  }
}

export function getPageToggles() {
  return toggles;
}

export function subscribePageAccess(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Trailing slashes off, so `/admin/users/` and `/admin/users` are the same page. */
export function normalizePath(path) {
  const p = String(path || '');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

export function isLockedPath(path) {
  return LOCKED_PATHS.includes(normalizePath(path));
}

/**
 * The verdict for THIS viewer: 'LIVE' | 'COMING_SOON' | 'HIDDEN'. Note that LIMITED never comes
 * out of here — it is a stored state, and resolving it per viewer collapses it to LIVE or HIDDEN.
 *
 * `ctx` is the router's auth context: `{ role, roles, permissions, user }`.
 */
export function resolvePageAccess(path, ctx = {}) {
  const key = normalizePath(path);
  if (!key) return 'LIVE';
  if (isLockedPath(key)) return 'LIVE';

  // WHY the super admin is exempt: the point of COMING_SOON is "built, not released yet", and the
  // person who built it has to be able to open the page to check their own work. Without the
  // bypass, switching a page off also takes it away from the only account that can switch it back
  // on, and the lock list above would have to grow to cover every admin page anyone might need.
  // The trade-off is that a super admin cannot see the hiding take effect on their own account —
  // /admin/platform/pages says so on the page, and the dev role switcher shows the viewer's side.
  if (isSuperAdmin(ctx)) return 'LIVE';

  const row = toggles[key];
  if (!row || row.state === 'LIVE') return 'LIVE';
  if (row.state === 'COMING_SOON') return 'COMING_SOON';
  if (row.state === 'HIDDEN') return 'HIDDEN';

  // LIMITED
  const role = ctx.role ?? null;
  const roles = Array.isArray(ctx.roles) && ctx.roles.length ? ctx.roles : role ? [role] : [];
  if (roles.some((r) => row.allowed_roles.includes(r))) return 'LIVE';

  const identifiers = [ctx.user?.id, ctx.user?.ref, ctx.userId, ctx.userRef]
    .filter((v) => v !== undefined && v !== null)
    .map(String);
  if (identifiers.some((id) => row.allowed_user_ids.includes(id))) return 'LIVE';

  return 'HIDDEN';
}

/** Nav filter: a HIDDEN page is not in the DOM; a COMING_SOON one is, carrying its badge. */
export function isPageVisibleInNav(path, ctx = {}) {
  return resolvePageAccess(path, ctx) !== 'HIDDEN';
}

export function isPageComingSoon(path, ctx = {}) {
  return resolvePageAccess(path, ctx) === 'COMING_SOON';
}

function isSuperAdmin(ctx = {}) {
  if (ctx.role === 'super_admin') return true;
  if (Array.isArray(ctx.roles) && ctx.roles.includes('super_admin')) return true;
  return Array.isArray(ctx.permissions) && ctx.permissions.includes('platform.page.toggle');
}
