/**
 * permissionMatrix.js — pure model behind the Roles × Permissions baseline matrix (Prompt 3.3).
 *
 * Kept free of DOM and i18n so the rules the page relies on can be pinned by a plain node:test:
 * what a cell means, how roles are ordered, and how the domain / risk / search filters combine.
 */

export const RISK_TIERS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// Order only — a domain the catalog adds later still shows up, sorted after these.
const DOMAIN_ORDER = [
  'admin', 'users', 'staff', 'security', 'system', 'platform', 'catalog', 'moderation', 'orders',
  'logistics', 'finance', 'growth', 'content', 'chat', 'live', 'support', 'saler', 'supplier', 'ai',
];

/** Lowest privilege first, so the grid reads left → right as a ladder. Ties keep a stable order. */
export function sortRoles(roles = []) {
  return [...roles].sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || String(a.key).localeCompare(String(b.key)));
}

/** roleId → Set of permission keys that role holds, straight from the `role_permissions` rows. */
export function buildHeldIndex(rolePermissions = []) {
  const held = new Map();
  for (const row of rolePermissions) {
    if (!held.has(row.role_id)) held.set(row.role_id, new Set());
    held.get(row.role_id).add(row.permission_key);
  }
  return held;
}

/**
 * What one cell of the grid shows.
 *
 * WHY driven purely by the data: the page used to draw a tick for Super Admin on every row. The
 * catalog does not say that — Super Admin holds 151 of 187 permissions and deliberately lacks the
 * saler.* / supplier.* workspace ones — so the tick lied about 36 of them.
 *
 * `locked` marks a CRITICAL permission the role does not hold: the RBAC resolver strips CRITICAL
 * from everyone but Super Admin (rbac.service.js), so it is not something a grant can fix.
 */
export function cellState(role, permission, held) {
  if (held.get(role.id)?.has(permission.key)) return 'granted';
  if (permission.risk_tier === 'CRITICAL' && role.key !== 'super_admin') return 'locked';
  return 'none';
}

/** roleId → how many permissions of the WHOLE catalog the role holds (never the filtered view). */
export function countHeldByRole(roles, permissions, held) {
  const known = new Set(permissions.map((p) => p.key));
  const totals = new Map();
  for (const role of roles) {
    let n = 0;
    for (const key of held.get(role.id) ?? []) if (known.has(key)) n += 1;
    totals.set(role.id, n);
  }
  return totals;
}

/** Domains present in the data with their permission counts, in a stable, meaningful order. */
export function listDomains(permissions = []) {
  const counts = new Map();
  for (const p of permissions) {
    const key = p.domain || 'system';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rank = (key) => {
    const i = DOMAIN_ORDER.indexOf(key);
    return i === -1 ? DOMAIN_ORDER.length : i;
  };
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

/** Domain + risk tier + free-text search, all ANDed. `domain: 'ALL'` and `risk: 'ALL'` mean no filter. */
export function filterPermissions(permissions = [], { domain = 'ALL', risk = 'ALL', query = '' } = {}) {
  const needle = query.trim().toLowerCase();
  return permissions.filter((p) => {
    if (domain !== 'ALL' && (p.domain || 'system') !== domain) return false;
    if (risk !== 'ALL' && p.risk_tier !== risk) return false;
    if (!needle) return true;
    return [p.key, p.label_en, p.label_bn, p.plain_en, p.plain_bn].some((v) => v && String(v).toLowerCase().includes(needle));
  });
}

/** [domain, permissions[]] pairs, preserving `listDomains` order. */
export function groupByDomain(permissions = []) {
  const groups = new Map();
  for (const p of permissions) {
    const key = p.domain || 'system';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const order = listDomains(permissions).map((d) => d.key);
  return order.map((key) => [key, groups.get(key)]);
}
