/**
 * pageAccess.service.js — per-page availability, the layer that sits BESIDE the module system.
 *
 * A platform_modules row answers "does this capability work". A page_toggles row answers "may this
 * viewer see this page". Keeping them apart is the whole point: switching `multi_warehouse` off to
 * hide /supplier/warehouses also switches off nearest-depot order routing, and 101 of the client's
 * 224 routes declare `module: 'core'`, which is deliberately not a platform_modules row and so
 * cannot be switched off at all.
 *
 * Four states — see 054_page_availability.sql for the column and the reasoning:
 *   LIVE | COMING_SOON | HIDDEN | LIMITED
 *
 * The resolution rules below are mirrored in client/src/services/pageAccess.js, which is what the
 * router and the sidebar actually consult. server/test/pageAccess.test.js parses that file and
 * fails on drift: a state the API accepts but the client does not understand is a page that is
 * parked in the database and still visible in the product.
 *
 * Scope, stated honestly: this is a VISIBILITY layer, not an authorization boundary. A hidden
 * page's API endpoints still answer — requirePermission and requireModule are the boundary, and
 * this does not replace either. Enforcing availability server-side would need a route -> API
 * prefix map and is a separate piece of work.
 */

import * as pageToggleRepo from '../repositories/pageToggle.repository.js';
import { AppError } from '../plugins/errorHandler.js';

export const PAGE_STATES = Object.freeze(['LIVE', 'COMING_SOON', 'HIDDEN', 'LIMITED']);

/**
 * Routes no state but LIVE may ever be written to.
 *
 * WHY: parking /admin/platform/pages removes the only surface that can un-park it, and parking
 * /login removes the way back in. Kept in lockstep with LOCKED_PATHS in
 * client/src/services/pageAccess.js — the test asserts both lists match, because a path one side
 * refuses and the other accepts is a lockout waiting to happen.
 */
export const LOCKED_PATHS = Object.freeze(['/', '/login', '/admin/platform/pages']);

const CACHE_KEY = 'page-access:parked';
const CACHE_TTL_SECONDS = 60;

const REASON_MIN_LENGTH = 10;

/** Trailing slashes off, so `/admin/users/` and `/admin/users` are the same page. */
export function normalizePath(path) {
  const p = String(path ?? '').trim();
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

export function isLockedPath(path) {
  return LOCKED_PATHS.includes(normalizePath(path));
}

/** `pg` hands back JSONB already parsed; a text column or a mock db may return a string. */
function readJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToToggle(row) {
  return {
    route_path: row.route_path,
    state: PAGE_STATES.includes(row.state) ? row.state : 'LIVE',
    allowed_roles: readJsonArray(row.allowed_roles),
    allowed_user_ids: readJsonArray(row.allowed_user_ids).map(String),
    reason: row.reason ?? null,
    updated_by: row.updated_by ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/**
 * Validates a proposed change. Pure and exported so the API and the tests assert the same rules
 * with no second implementation to drift. Throws on the first rule broken, with both language
 * messages the API contract requires.
 */
export function validateToggle({ route_path: routePath, state, allowed_roles: allowedRoles, allowed_user_ids: allowedUserIds, reason } = {}) {
  const path = normalizePath(routePath);

  if (!path || !path.startsWith('/')) {
    throw new AppError(
      'VALIDATION_FAILED',
      'route_path must be an absolute path beginning with "/".',
      'route_path অবশ্যই "/" দিয়ে শুরু হওয়া একটি পূর্ণ পাথ হতে হবে।',
      { field: 'route_path' }
    );
  }

  if (!PAGE_STATES.includes(state)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `state must be one of: ${PAGE_STATES.join(', ')}.`,
      `state এগুলোর একটি হতে হবে: ${PAGE_STATES.join(', ')}।`,
      { field: 'state', supported: PAGE_STATES }
    );
  }

  // The lock list is checked before anything else about the payload matters, so the error names
  // the real problem rather than complaining about a missing reason on a write that can never land.
  if (isLockedPath(path) && state !== 'LIVE') {
    throw new AppError(
      'PAGE_LOCKED',
      `"${path}" cannot be switched off — it is one of the pages that would lock you out (${LOCKED_PATHS.join(', ')}).`,
      `"${path}" বন্ধ করা যাবে না — এটি সেই পেজগুলোর একটি যা বন্ধ করলে আপনি নিজেই ঢুকতে পারবেন না।`,
      { field: 'route_path', locked_paths: LOCKED_PATHS }
    );
  }

  const roles = Array.isArray(allowedRoles) ? allowedRoles.filter((r) => typeof r === 'string' && r.trim()) : [];
  const userIds = Array.isArray(allowedUserIds)
    ? allowedUserIds.filter((id) => id !== null && id !== undefined && String(id).trim()).map(String)
    : [];

  if (state === 'LIMITED' && roles.length === 0 && userIds.length === 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'A limited page needs at least one allowed role or user — otherwise it is hidden from everyone, which is what HIDDEN is for.',
      'সীমিত পেজের জন্য অন্তত একটি রোল বা ইউজার দিতে হবে — নাহলে এটি সবার কাছেই লুকানো থাকবে, যার জন্য HIDDEN আছে।',
      { field: 'allowed_roles' }
    );
  }

  if (typeof reason !== 'string' || reason.trim().length < REASON_MIN_LENGTH) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Give a reason of at least ${REASON_MIN_LENGTH} characters for this change.`,
      `এই পরিবর্তনের জন্য অন্তত ${REASON_MIN_LENGTH} অক্ষরের একটি কারণ লিখুন।`,
      { field: 'reason' }
    );
  }

  return {
    route_path: path,
    state,
    // Only LIMITED reads them, so clearing them on every other state keeps a stale rollout list
    // from silently coming back when a page is switched HIDDEN and later LIMITED again.
    allowed_roles: state === 'LIMITED' ? roles : [],
    allowed_user_ids: state === 'LIMITED' ? userIds : [],
    reason: reason.trim(),
  };
}

/**
 * Every parked page as `{ [route_path]: { state, allowed_roles, allowed_user_ids } }` — the shape
 * the client's setPageToggles() consumes. Cached briefly because an unauthenticated endpoint
 * serves it on every cold page load; the cache is dropped the moment a page changes.
 *
 * Never throws: a page layer that failed closed would black out the whole app on a transient
 * database error, so an unreachable table means "everything LIVE" — the posture
 * moduleService.getPublicModulesMap takes for the same reason.
 */
export async function getPublicPageMap(db, cache) {
  if (cache) {
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // A miss or a malformed entry is not an error — fall through to the database.
    }
  }

  let map = {};
  try {
    for (const row of await pageToggleRepo.listParkedPages(db)) {
      const toggle = rowToToggle(row);
      map[toggle.route_path] = {
        state: toggle.state,
        allowed_roles: toggle.allowed_roles,
        allowed_user_ids: toggle.allowed_user_ids,
      };
    }
  } catch {
    // The table may not exist yet on a clone that has not run migrations. "Everything LIVE" is a
    // better answer than a 500 on every page load.
    map = {};
  }

  if (cache) {
    try {
      await cache.set(CACHE_KEY, JSON.stringify(map), CACHE_TTL_SECONDS);
    } catch {
      // Caching is an optimisation; failing to store must not fail the read.
    }
  }

  return map;
}

/** Everything the admin screen needs: every row, parked or not. */
export async function listToggles(db) {
  try {
    return (await pageToggleRepo.listAllPageToggles(db)).map(rowToToggle);
  } catch {
    return [];
  }
}

/**
 * The verdict for one viewer: 'LIVE' | 'COMING_SOON' | 'HIDDEN'. LIMITED never comes out of here —
 * it is a stored state, and resolving it per viewer collapses it to LIVE or HIDDEN.
 *
 * Mirrored by resolvePageAccess() in client/src/services/pageAccess.js, including the super-admin
 * bypass: the point of COMING_SOON is "built, not released yet", and whoever built it has to be
 * able to open the page to check their own work.
 */
export function resolveState(map, path, context = {}) {
  const key = normalizePath(path);
  if (!key) return 'LIVE';
  if (isLockedPath(key)) return 'LIVE';

  const roles = Array.isArray(context.roles) && context.roles.length
    ? context.roles
    : context.role
      ? [context.role]
      : [];
  if (roles.includes('super_admin')) return 'LIVE';

  const row = map?.[key];
  if (!row || row.state === 'LIVE') return 'LIVE';
  if (row.state === 'COMING_SOON') return 'COMING_SOON';
  if (row.state === 'HIDDEN') return 'HIDDEN';

  const allowedRoles = Array.isArray(row.allowed_roles) ? row.allowed_roles : [];
  if (roles.some((r) => allowedRoles.includes(r))) return 'LIVE';

  const allowedUserIds = (Array.isArray(row.allowed_user_ids) ? row.allowed_user_ids : []).map(String);
  const identifiers = [context.userId, context.userRef].filter((v) => v !== undefined && v !== null).map(String);
  if (identifiers.some((id) => allowedUserIds.includes(id))) return 'LIVE';

  return 'HIDDEN';
}

async function invalidate(cache) {
  if (!cache) return;
  try {
    await cache.del(CACHE_KEY);
  } catch {
    // Worst case the previous map serves for up to CACHE_TTL_SECONDS.
  }
}

/**
 * Applies one page's availability. One transaction over that route's row, and a single audit row
 * carrying the previous and the new value — the before/after pair CLAUDE.md requires of every
 * state-changing staff action.
 */
export async function setPageState(
  db,
  cache,
  auditService,
  { toggle, userId = null, actorRole = null, reqContext = {} }
) {
  const next = validateToggle(toggle);

  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  let before = null;
  let after = null;
  try {
    if (isDedicatedClient) await client.query('BEGIN');

    const existing = await pageToggleRepo.lockPageToggle(client, next.route_path);
    // An absent row IS a state — LIVE — and the audit trail has to say so rather than "null",
    // or the first time a page is parked the log reads as if it came from nowhere.
    before = existing
      ? rowToToggle(existing)
      : { route_path: next.route_path, state: 'LIVE', allowed_roles: [], allowed_user_ids: [] };

    after = rowToToggle(
      await pageToggleRepo.upsertPageToggle(client, {
        routePath: next.route_path,
        state: next.state,
        allowedRoles: next.allowed_roles,
        allowedUserIds: next.allowed_user_ids,
        reason: next.reason,
        updatedBy: userId,
      })
    );

    if (isDedicatedClient) await client.query('COMMIT');
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }

  await invalidate(cache);

  const pick = (t) => ({
    state: t.state,
    allowed_roles: t.allowed_roles,
    allowed_user_ids: t.allowed_user_ids,
  });

  if (auditService?.record) {
    await auditService.record(db, {
      action: 'platform.page.toggle',
      targetType: 'page_toggles',
      targetRef: next.route_path,
      beforeJson: pick(before),
      afterJson: pick(after),
      meta: { reason: next.reason },
      riskTier: 'CRITICAL',
      actorId: userId,
      actorRole,
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
  }

  return { before, after };
}
