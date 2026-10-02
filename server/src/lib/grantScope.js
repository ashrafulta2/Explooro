/**
 * grantScope.js — the one place a standing grant's `scope_json` is defined, validated and enforced.
 *
 * docs/rbac-spec.md §3.1: "scope_json narrows a grant: {"max_amount": 5000} … The owning service
 * enforces the scope." Before this file the column was stored and displayed but never checked, so
 * the Access Grants page promised "up to ৳50,000" on a payout grant whose holder could approve any
 * amount. The client mirror is client/src/config/grant-scopes.js; server/test/grantScope.test.js
 * fails if the two drift.
 */

import { AppError } from '../plugins/errorHandler.js';

// WHY only permissions with a live enforcement point are listed: a scope the server never checks
// is worse than no scope, because it reads as a safety limit. A permission is added here in the
// same change that passes `scopeFacts` to its route's requirePermission(...).
export const GRANT_SCOPES = Object.freeze({
  'finance.payout.approve': Object.freeze({ max_amount: 'amount' }),
});

// WHY this ceiling: money is NUMERIC(14,2) (CLAUDE.md constraint 10), so anything larger could never
// match a real amount — it is the column's limit, not a business number.
const MAX_AMOUNT = 999999999999.99;

function invalid(en, bn, details) {
  return new AppError('VALIDATION_FAILED', en, bn, details);
}

/**
 * Validates and normalises a scope for `permissionKey`. Returns null for "no scope".
 * Throws VALIDATION_FAILED for anything the server could not enforce.
 */
export function validateGrantScope(permissionKey, raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalid('Scope must be an object.', 'স্কোপ সঠিক ফরম্যাটে নেই।');
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) return null;

  const fields = GRANT_SCOPES[permissionKey];
  if (!fields) {
    throw invalid(
      'This permission cannot be limited by a scope.',
      'এই পারমিশনে কোনো সীমা (স্কোপ) নির্ধারণ করা যায় না।',
      { permission_key: permissionKey }
    );
  }

  const out = {};
  for (const key of keys) {
    const type = fields[key];
    if (!type) {
      throw invalid(`Unknown scope field "${key}".`, `অজানা স্কোপ ফিল্ড "${key}"।`, { field: key });
    }
    if (type === 'amount') {
      const n = Number(raw[key]);
      if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) {
        throw invalid('The amount limit must be a positive number.', 'টাকার সীমা একটি ধনাত্মক সংখ্যা হতে হবে।', { field: key });
      }
      out[key] = Math.round(n * 100) / 100;
    }
  }
  return out;
}

/**
 * The scopes that bound a user's hold on one permission, from rbac.service's `sources` entries.
 * Returns null when the hold is unrestricted — any ROLE or JIT source, or any unscoped GRANT.
 *
 * WHY JIT counts as unrestricted: its `target_scope_json` records what the request was FOR
 * ({"order_id": 8891}) as context for the approver, not a limit, and JIT only covers MEDIUM-tier
 * permissions, none of which are in GRANT_SCOPES.
 */
export function restrictingScopes(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const scopes = [];
  for (const s of sources) {
    if (s.type !== 'GRANT') return null;
    if (!s.scope || typeof s.scope !== 'object' || Object.keys(s.scope).length === 0) return null;
    scopes.push(s.scope);
  }
  return scopes;
}

/** Does one stored scope allow an action described by `facts`? Unknown fields fail closed. */
export function scopeAllows(scope, facts = {}) {
  for (const [key, limit] of Object.entries(scope)) {
    if (key === 'max_amount') {
      const amount = Number(facts.amount);
      if (facts.amount === null || facts.amount === undefined || !Number.isFinite(amount)) return false;
      if (amount > Number(limit)) return false;
      continue;
    }
    // WHY fail closed: rows written before validation existed can hold keys like
    // {"constraint": "..."} or {"max_amount_bdt": …}. Nothing can check them, so they must not
    // silently widen into "no limit".
    return false;
  }
  return true;
}
