/**
 * permissions.js — Client-side Permission Resolution & Locked State Service (Prompt 2.8).
 *
 * Sourced from /api/v1/me/permissions (Prompt 2.4).
 * Exposes:
 * - can(permissionKey)
 * - isRestricted(capabilityKey)
 * - whyDenied(permissionKey) -> 'held' | 'no_permission' | 'requestable' | 'critical_locked' | 'maker_checker' | 'restricted' | 'module_off'
 * - getActiveJitGrants()
 * - releaseJitAccess(grantRef)
 */

import { api } from '../core/api.js';
import { appStore } from '../state/appStore.js';
import catalog from '../../../docs/permission-catalog.json';

const catalogPermissions = new Map(catalog.permissions.map((p) => [p.key, p]));

let heldPermissions = new Set();
let permissionSources = {};
let activeRoles = [];
let activeGrants = [];
let activeJitWindows = [];
let activeRestrictions = [];

/**
 * Syncs permissions state with appStore.
 */
function syncWithStore() {
  const permList = Array.from(heldPermissions);
  appStore.update((s) => ({
    auth: {
      ...s.auth,
      permissions: permList,
      roles: activeRoles,
    },
    shell: {
      ...s.shell,
      elevatedGrant: activeJitWindows.length > 0 ? formatElevatedGrant(activeJitWindows[0]) : null,
    },
  }));
}

function formatElevatedGrant(jit) {
  const meta = catalogPermissions.get(jit.permission_key);
  const expiresAt = new Date(jit.window_expires_at).getTime();
  return {
    ref: jit.ref,
    permission: jit.permission_key,
    feature: meta?.label_en || jit.permission_key,
    feature_bn: meta?.label_bn || jit.permission_key,
    expiresAt,
  };
}

/**
 * Initializes and fetches resolved permissions for the authenticated user.
 */
export async function initPermissions() {
  try {
    const res = await api.get('/me/permissions');
    if (res?.data) {
      heldPermissions = new Set(res.data.permissions || []);
      permissionSources = res.data.sources || {};
      activeRoles = res.data.roles || [];
      activeGrants = res.data.grants || [];
      activeJitWindows = (res.data.jit_windows || []).filter(
        (j) => new Date(j.window_expires_at).getTime() > Date.now()
      );
      activeRestrictions = res.data.restrictions || [];

      syncWithStore();
      return res.data;
    }
  } catch {
    // If not authenticated or request failed
  }

  return { permissions: [], roles: [] };
}

/**
 * Re-fetches permissions payload to reflect JIT approvals or admin actions live.
 */
export async function refreshPermissions() {
  return initPermissions();
}

/**
 * Clears cached permissions when logging out.
 */
export function clearPermissions() {
  heldPermissions.clear();
  permissionSources = {};
  activeRoles = [];
  activeGrants = [];
  activeJitWindows = [];
  activeRestrictions = [];
  syncWithStore();
}

/**
 * Checks if the current user holds a specific permission key.
 */
export function can(permissionKey) {
  if (!permissionKey) return true;
  return heldPermissions.has(permissionKey);
}

/**
 * Checks if the current user is restricted for a given capability switch.
 */
export function isRestricted(capabilityKey) {
  if (!capabilityKey) return false;
  return activeRestrictions.some(
    (r) => r.capability_key === capabilityKey && r.mode === 'BLOCK'
  );
}

/**
 * Gets active restriction object for capability key.
 */
export function getRestriction(capabilityKey) {
  if (!capabilityKey) return null;
  return activeRestrictions.find((r) => r.capability_key === capabilityKey) || null;
}

/**
 * Detailed determination of why access is granted or denied.
 * Returns: 'held' | 'no_permission' | 'requestable' | 'critical_locked' | 'maker_checker' | 'restricted' | 'module_off'
 */
export function whyDenied(permissionKey, moduleKey = null) {
  if (moduleKey && moduleKey !== 'core') {
    const isModuleOn = appStore.get()?.modules?.[moduleKey];
    if (isModuleOn === false) return 'module_off';
  }

  if (!permissionKey) return 'held';

  if (can(permissionKey)) return 'held';

  // Check if capability restriction applies
  const matchingRestriction = activeRestrictions.find(
    (r) => r.capability_key === permissionKey || permissionKey.includes(r.capability_key)
  );
  if (matchingRestriction && matchingRestriction.mode === 'BLOCK') {
    return 'restricted';
  }

  const meta = catalogPermissions.get(permissionKey);
  const isSuperAdmin = activeRoles.includes('super_admin');

  if (meta?.risk_tier === 'CRITICAL' && !isSuperAdmin) {
    return 'critical_locked';
  }

  if (meta?.risk_tier === 'MEDIUM') {
    return 'requestable';
  }

  if (meta?.risk_tier === 'HIGH') {
    return 'maker_checker';
  }

  return 'no_permission';
}

/**
 * Returns catalog entry metadata for a permission key.
 */
export function getPermissionMetadata(permissionKey) {
  return catalogPermissions.get(permissionKey) || null;
}

/**
 * Returns currently active JIT grant elevations.
 */
export function getActiveJitGrants() {
  return activeJitWindows.filter((j) => new Date(j.window_expires_at).getTime() > Date.now());
}

/**
 * Releases an active JIT elevated access window early.
 */
export async function releaseJitAccess(grantRef) {
  try {
    // Release elevated access grant
    appStore.update((s) => ({
      shell: { ...s.shell, elevatedGrant: null },
    }));
    await refreshPermissions();
    return true;
  } catch {
    return false;
  }
}
