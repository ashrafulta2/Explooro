/**
 * grant-scopes.js — which permissions a standing grant can narrow, and with which fields.
 *
 * Mirror of GRANT_SCOPES in server/src/lib/grantScope.js, which validates and ENFORCES them;
 * server/test/grantScope.test.js fails if the two drift. A permission missing here gets no scope
 * field in the Issue Grant drawer, because the server would reject — or, before it validated,
 * silently ignore — any scope on it.
 */

export const GRANT_SCOPES = Object.freeze({
  'finance.payout.approve': Object.freeze({ max_amount: 'amount' }),
});

export function scopeFieldsFor(permissionKey) {
  return GRANT_SCOPES[permissionKey] || null;
}

/**
 * Splits a stored scope into fields this build knows how to describe and ones it doesn't. Unknown
 * fields matter: the server fails closed on them, so such a grant blocks its holder entirely.
 */
export function describeScope(scope) {
  const known = [];
  const unknown = [];
  if (!scope || typeof scope !== 'object') return { known, unknown };
  for (const [field, value] of Object.entries(scope)) {
    if (field === 'max_amount' && Number.isFinite(Number(value))) known.push({ field, value: Number(value) });
    else unknown.push(field);
  }
  return { known, unknown };
}
