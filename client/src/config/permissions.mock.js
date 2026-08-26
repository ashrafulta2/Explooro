/**
 * permissions.mock.js — a stand-in for the RBAC resolution engine (Prompt 2.4).
 *
 * In the real system the client never holds the permission catalog: the server resolves what a
 * user has, and for anything it doesn't, a `PERMISSION_DENIED` response carries `risk_tier` /
 * `requestable` / `plain_en` / `plain_bn` inline (docs/api-contract.md §3.7) — already handled by
 * core/api.js's `explooro:permission-denied` event. But a sidebar has to know BEFORE any request
 * is made whether to render an item locked, so Prompt 1.7's shell needs *some* source for that.
 *
 * Rather than hand-typing risk tiers for the ~90 permission keys navigation.js references — a
 * second copy of docs/permission-catalog.json that could silently drift from the first — this
 * reads the same catalog Prompt 0.4 already produced. Deleted whole in Prompt 2.4 once the server
 * resolves this for real.
 */
import catalog from '../../../docs/permission-catalog.json' with { type: 'json' };

const byKey = new Map(catalog.permissions.map((p) => [p.key, p]));
const roleLabels = new Map(catalog.roles.map((r) => [r.key, r]));

/** Full catalog entry for a permission key — `{ risk_tier, plain_en, plain_bn, default_roles, ... }`. */
export function getPermissionMeta(key) {
  return byKey.get(key) ?? null;
}

/** `{ label_en, label_bn, level }` for a role key, straight from the same catalog. */
export function getRoleMeta(role) {
  return roleLabels.get(role) ?? null;
}

/** Every permission key a role holds by default (no delegation/restriction layered on yet). */
export function defaultPermissionsForRole(role) {
  return catalog.permissions.filter((p) => p.default_roles?.includes(role)).map((p) => p.key);
}
