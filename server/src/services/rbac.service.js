/**
 * rbac.service.js — RBAC Resolution Engine & Delegation Service (Prompt 2.4).
 *
 * Implements the 6-step permission resolution algorithm from docs/rbac-spec.md §4.
 *
 * Invariants:
 * 1. DENY always wins: a user DENY override unconditionally removes a permission, defeating
 *    both role permissions and GRANT overrides simultaneously.
 * 2. CRITICAL permissions are strictly Super Admin only. They cannot be granted via overrides or
 *    JIT requests to any non-super-admin under any circumstances.
 * 3. Cache versioning: invalidation uses global/per-user cache version keys rather than waiting for
 *    TTL expiry. A revoked permission must stop working within one request.
 */

import * as permRepo from '../repositories/permission.repository.js';
import { evaluatePredicate } from './segment.service.js';
import { AppError } from '../plugins/errorHandler.js';

const PERMISSION_CACHE_TTL_S = 300; // 5 minutes

export async function getGlobalVersion(cache) {
  if (!cache) return 1;
  const val = await cache.get('rbac:version:global');
  return val ? Number(val) : 1;
}

export async function getUserVersion(cache, userId) {
  if (!cache) return 1;
  const val = await cache.get(`rbac:version:user:${userId}`);
  return val ? Number(val) : 1;
}

export async function bumpUserPermissionVersion(cache, userId) {
  if (!cache) return 1;
  const current = await getUserVersion(cache, userId);
  const next = current + 1;
  await cache.set(`rbac:version:user:${userId}`, next);
  return next;
}

export async function bumpGlobalPermissionVersion(cache) {
  if (!cache) return 1;
  const current = await getGlobalVersion(cache);
  const next = current + 1;
  await cache.set('rbac:version:global', next);
  return next;
}

export async function invalidateUserPermissionCache(cache, userId) {
  return bumpUserPermissionVersion(cache, userId);
}

export async function invalidateGlobalPermissionCache(cache) {
  return bumpGlobalPermissionVersion(cache);
}

function buildCacheKey(globalVer, userVer, userId) {
  return `perm:v${globalVer}:${userVer}:${userId}`;
}

/**
 * Executes the 6-step resolution algorithm from docs/rbac-spec.md §4:
 *
 * 1. ROLES: Load all user roles, collect their permissions, record { type: 'ROLE', role }.
 * 2. GRANTS: Union active user GRANT overrides, record { type: 'GRANT', ... }.
 * 3. JIT: Union active approved JIT grants, record { type: 'JIT', ... }.
 * 4. DENY: Subtract active user DENY overrides unconditionally.
 * 5. CRITICAL: Remove all CRITICAL-tier permissions unless user holds super_admin role.
 * 6. RETURN: { permissions: Set<string>, sources: Map<string, Source[]>, roles: string[], metadata: Map }
 */
export async function resolvePermissions(db, cache, userId, { bypassCache = false } = {}) {
  let gVer = 1;
  let uVer = 1;
  let cacheKey = null;

  if (cache && !bypassCache) {
    gVer = await getGlobalVersion(cache);
    uVer = await getUserVersion(cache, userId);
    cacheKey = buildCacheKey(gVer, uVer, userId);

    const cachedJson = await cache.get(cacheKey);
    if (cachedJson) {
      try {
        const parsed = typeof cachedJson === 'string' ? JSON.parse(cachedJson) : cachedJson;
        return {
          permissions: new Set(parsed.permissions),
          sources: new Map(Object.entries(parsed.sources)),
          roles: parsed.roles || [],
          metadata: new Map(Object.entries(parsed.metadata || {})),
        };
      } catch {
        // Fall back to computation on parse error
      }
    }
  }

  // 1. ROLES
  const userRoles = await permRepo.getRolesForUser(db, userId);
  const roleKeys = userRoles.map((r) => r.key);
  const isSuperAdmin = roleKeys.includes('super_admin');

  const rolePermRows = await permRepo.getPermissionsForRoleKeys(db, roleKeys);

  const permissions = new Set();
  const sources = new Map();
  const metadata = new Map();

  for (const row of rolePermRows) {
    permissions.add(row.key);

    if (!sources.has(row.key)) {
      sources.set(row.key, []);
    }
    sources.get(row.key).push({
      type: 'ROLE',
      role: row.role_key,
    });

    metadata.set(row.key, {
      key: row.key,
      domain: row.domain,
      label_en: row.label_en,
      label_bn: row.label_bn,
      plain_en: row.plain_en,
      plain_bn: row.plain_bn,
      risk_tier: row.risk_tier,
      delegable: row.delegable,
      approval_mode: row.approval_mode,
    });
  }

  // 2. GRANTS (user_permission_overrides WHERE effect = 'GRANT')
  const activeOverrides = await permRepo.getActiveUserOverrides(db, userId);
  const grantOverrides = activeOverrides.filter((o) => o.effect === 'GRANT');

  for (const grant of grantOverrides) {
    const key = grant.permission_key;
    permissions.add(key);

    if (!sources.has(key)) {
      sources.set(key, []);
    }
    sources.get(key).push({
      type: 'GRANT',
      override_id: grant.id,
      granted_by: grant.granted_by,
      expires_at: grant.expires_at,
      scope: grant.scope_json,
      reason: grant.reason,
    });

    if (!metadata.has(key)) {
      const permDetail = await permRepo.getPermissionByKey(db, key);
      if (permDetail) metadata.set(key, permDetail);
    }
  }

  // 3. JIT (permission_grant_requests WHERE status = 'APPROVED' AND window_expires_at > now())
  const activeJitGrants = await permRepo.getActiveJitGrants(db, userId);

  for (const jit of activeJitGrants) {
    const key = jit.permission_key;
    permissions.add(key);

    if (!sources.has(key)) {
      sources.set(key, []);
    }
    sources.get(key).push({
      type: 'JIT',
      request_id: jit.id,
      request_ref: jit.ref,
      approver_id: jit.approver_id,
      window_expires_at: jit.window_expires_at,
      scope: jit.target_scope_json,
      reason: jit.reason,
    });

    if (!metadata.has(key)) {
      const permDetail = await permRepo.getPermissionByKey(db, key);
      if (permDetail) metadata.set(key, permDetail);
    }
  }

  // 4. DENY (user_permission_overrides WHERE effect = 'DENY')
  // DENY beats ROLE, GRANT, and JIT unconditionally.
  const denyOverrides = activeOverrides.filter((o) => o.effect === 'DENY');

  for (const deny of denyOverrides) {
    const key = deny.permission_key;
    permissions.delete(key);
    sources.delete(key);
  }

  // 5. CRITICAL (Super Admin only check)
  // If the user does not hold super_admin, remove all CRITICAL-tier permissions.
  // This runs AFTER grants, so no grant path can ever smuggle in a CRITICAL permission.
  if (!isSuperAdmin) {
    for (const key of Array.from(permissions)) {
      let meta = metadata.get(key);
      if (!meta) {
        meta = await permRepo.getPermissionByKey(db, key);
        if (meta) metadata.set(key, meta);
      }
      if (meta && meta.risk_tier === 'CRITICAL') {
        permissions.delete(key);
        sources.delete(key);
      }
    }
  }

  // Save to cache if cache is available
  if (cache && cacheKey) {
    const cachePayload = {
      permissions: Array.from(permissions),
      sources: Object.fromEntries(sources),
      roles: roleKeys,
      metadata: Object.fromEntries(metadata),
    };
    await cache.set(cacheKey, JSON.stringify(cachePayload), PERMISSION_CACHE_TTL_S);
  }

  return {
    permissions,
    sources,
    roles: roleKeys,
    metadata,
  };
}

export async function hasPermission(db, cache, userId, permissionKey) {
  const resolved = await resolvePermissions(db, cache, userId);
  return resolved.permissions.has(permissionKey);
}

export async function getPermissionDetails(db, permissionKey) {
  return permRepo.getPermissionByKey(db, permissionKey);
}

/**
 * Returns why a permission is denied:
 * - 'held': held by user
 * - 'critical_locked': CRITICAL risk tier and user is not super_admin
 * - 'requestable': MEDIUM risk tier, can be requested via JIT (Mode B)
 * - 'maker_checker': HIGH risk tier, requires maker-checker submission (Mode C)
 * - 'no_permission': LOW risk tier not in role
 */
export async function whyDenied(db, cache, userId, permissionKey) {
  const resolved = await resolvePermissions(db, cache, userId);
  if (resolved.permissions.has(permissionKey)) {
    return 'held';
  }

  const perm = await getPermissionDetails(db, permissionKey);
  if (!perm) return 'not_found';

  if (perm.risk_tier === 'CRITICAL') {
    return 'critical_locked';
  }
  if (perm.risk_tier === 'HIGH') {
    return 'maker_checker';
  }
  if (perm.risk_tier === 'MEDIUM') {
    return 'requestable';
  }
  return 'no_permission';
}

/**
 * Matches dynamic segment predicates against user attributes at request time.
 * docs/rbac-spec.md §5.4: "Segments are evaluated at request time, not materialised."
 */
export function matchSegmentPredicate(userContext, predicate) {
  return evaluatePredicate(predicate, userContext);
}

/**
 * Evaluates active restrictions (direct and segment-based) for a specific capability.
 */
export async function evaluateRestrictionsForCapability(db, userId, capabilityKey) {
  const userProfile = await permRepo.getUserProfileAndTrust(db, userId);
  if (!userProfile) return null;

  const roles = await permRepo.getRolesForUser(db, userId);
  const roleKeys = roles.map((r) => r.key);

  const userContext = {
    userId,
    userRef: userProfile.ref,
    status: userProfile.status,
    district: userProfile.district,
    division: userProfile.division,
    tier: userProfile.tier || 'STARTER',
    trust_score: userProfile.trust_score !== null ? Number(userProfile.trust_score) : 50,
    roles: roleKeys,
  };

  // Check direct user restrictions first
  const directRestrictions = await permRepo.getDirectUserRestrictions(
    db,
    userId,
    userProfile.ref,
    capabilityKey
  );

  if (directRestrictions.length > 0) {
    return directRestrictions[0];
  }

  // Check segment restrictions
  const segmentRestrictions = await permRepo.getActiveSegmentRestrictions(db, capabilityKey);
  for (const restriction of segmentRestrictions) {
    if (matchSegmentPredicate(userContext, restriction.segment_predicate)) {
      return restriction;
    }
  }

  return null;
}

/**
 * Prepares the full resolved payload for GET /api/v1/me/permissions.
 */
export async function getPermissionsPayload(db, cache, userId) {
  const resolved = await resolvePermissions(db, cache, userId);
  const grants = await permRepo.getActiveUserOverrides(db, userId);
  const jitWindows = await permRepo.getActiveJitGrants(db, userId);

  const userProfile = await permRepo.getUserProfileAndTrust(db, userId);
  const userRef = userProfile?.ref || String(userId);
  const directRestrictions = await permRepo.getDirectUserRestrictions(db, userId, userRef);
  const segmentRestrictions = await permRepo.getActiveSegmentRestrictions(db);

  const userContext = {
    userId,
    userRef,
    status: userProfile?.status,
    district: userProfile?.district,
    division: userProfile?.division,
    tier: userProfile?.tier || 'STARTER',
    trust_score: userProfile?.trust_score !== null ? Number(userProfile.trust_score) : 50,
    roles: resolved.roles,
  };

  const matchingSegmentRestrictions = segmentRestrictions.filter((r) =>
    matchSegmentPredicate(userContext, r.segment_predicate)
  );

  const mergedRestrictions = [...directRestrictions, ...matchingSegmentRestrictions];

  return {
    permissions: Array.from(resolved.permissions),
    sources: Object.fromEntries(resolved.sources),
    roles: resolved.roles,
    grants: grants.map((g) => ({
      id: g.id,
      permission_key: g.permission_key,
      effect: g.effect,
      scope_json: g.scope_json,
      reason: g.reason,
      granted_by: g.granted_by,
      expires_at: g.expires_at,
    })),
    jit_windows: jitWindows.map((j) => ({
      id: j.id,
      ref: j.ref,
      permission_key: j.permission_key,
      window_expires_at: j.window_expires_at,
      status: 'APPROVED',
      scope_json: j.target_scope_json,
      reason: j.reason,
    })),
    restrictions: mergedRestrictions.map((r) => ({
      id: r.id,
      capability_key: r.capability_key,
      mode: r.mode,
      limit_value: r.limit_value !== null ? Number(r.limit_value) : null,
      reason: r.reason,
      reason_bn: r.reason_bn,
      expires_at: r.expires_at,
    })),
  };
}
