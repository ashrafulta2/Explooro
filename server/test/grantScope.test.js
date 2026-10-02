/**
 * grantScope.test.js — a standing grant's scope_json is validated, enforced, and mirrored.
 *
 * Invariants (docs/rbac-spec.md §3.1, §4.1, §8):
 * 1. Only a scope the server can enforce is accepted; anything else is VALIDATION_FAILED.
 * 2. A holder whose only source is a scoped GRANT is refused above the limit — before maker-checker,
 *    so an out-of-scope action can't even be queued for approval.
 * 3. A role source (or an unscoped grant) makes the hold unrestricted.
 * 4. A stored scope field nothing can check fails closed.
 * 5. A HIGH approve_before permission the caller doesn't hold is 403, not a queued pending action.
 * 6. client/src/config/grant-scopes.js mirrors server/src/lib/grantScope.js.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { GRANT_SCOPES, validateGrantScope, restrictingScopes, scopeAllows } from '../src/lib/grantScope.js';
import { GRANT_SCOPES as CLIENT_GRANT_SCOPES } from '../../client/src/config/grant-scopes.js';
import { requirePermission } from '../src/middlewares/requirePermission.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import { createMemoryCache } from '../src/config/cache-drivers/memory.js';

const PAYOUT_APPROVE = {
  key: 'finance.payout.approve',
  domain: 'finance',
  label_en: 'Approve payouts',
  label_bn: 'পেআউট অনুমোদন',
  risk_tier: 'HIGH',
  delegable: true,
  approval_mode: 'approve_before',
};

function mockDb({ roleKeys = [], rolePerms = [], overrides = [] }) {
  const pendingActions = [];
  return {
    pendingActions,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ');
      if (q.includes('FROM user_roles ur')) return { rows: roleKeys.map((key, i) => ({ id: i + 1, key })) };
      if (q.includes('FROM role_permissions rp')) {
        return {
          rows: rolePerms
            .filter((rp) => (params[0] || []).includes(rp.role_key))
            .map((rp) => ({ ...PAYOUT_APPROVE, role_key: rp.role_key })),
        };
      }
      if (q.includes('FROM user_permission_overrides')) return { rows: overrides };
      if (q.includes('FROM permissions WHERE key = $1')) return { rows: params[0] === PAYOUT_APPROVE.key ? [PAYOUT_APPROVE] : [] };
      if (q.includes('INSERT INTO pending_admin_actions')) {
        const row = { id: pendingActions.length + 1, ref: params[0], expires_at: new Date() };
        pendingActions.push(row);
        return { rows: [row] };
      }
      return { rows: [] };
    },
  };
}

function grant(scope) {
  return {
    id: 7,
    user_id: 40,
    permission_key: PAYOUT_APPROVE.key,
    effect: 'GRANT',
    scope_json: scope,
    reason: 'Covering finance during leave',
    granted_by: 1,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    revoked_at: null,
  };
}

async function approve(db, amount) {
  const app = Fastify();
  app.decorate('db', db);
  app.decorate('cache', createMemoryCache());
  app.register(errorHandlerPlugin);
  let executed = false;
  app.post(
    '/payouts/:id/approve',
    {
      preHandler: [
        async (req) => { req.user = { id: 40 }; },
        requirePermission(PAYOUT_APPROVE.key, { scopeFacts: async () => ({ amount }) }),
      ],
    },
    async () => { executed = true; return { ok: true }; }
  );
  await app.ready();
  const res = await app.inject({ method: 'POST', url: '/payouts/9/approve', payload: {} });
  await app.close();
  return { res, executed, body: JSON.parse(res.payload || '{}') };
}

describe('Standing grant scopes', () => {
  test('1. validateGrantScope accepts only an enforceable scope', () => {
    assert.equal(validateGrantScope(PAYOUT_APPROVE.key, null), null);
    assert.equal(validateGrantScope(PAYOUT_APPROVE.key, {}), null);
    assert.deepEqual(validateGrantScope(PAYOUT_APPROVE.key, { max_amount: '50000.456' }), { max_amount: 50000.46 });

    const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
    assert.equal(code(() => validateGrantScope(PAYOUT_APPROVE.key, { max_amount_bdt: 50000 })), 'VALIDATION_FAILED');
    assert.equal(code(() => validateGrantScope(PAYOUT_APPROVE.key, { max_amount: -5 })), 'VALIDATION_FAILED');
    assert.equal(code(() => validateGrantScope(PAYOUT_APPROVE.key, { constraint: 'Dhaka only' })), 'VALIDATION_FAILED');
    assert.equal(code(() => validateGrantScope('catalog.product.delete', { category: 'fashion' })), 'VALIDATION_FAILED');
    assert.equal(code(() => validateGrantScope(PAYOUT_APPROVE.key, [1])), 'VALIDATION_FAILED');
  });

  test('2. a scoped grant holder is refused above the limit, before any pending action is queued', async () => {
    const db = mockDb({ overrides: [grant({ max_amount: 50000 })] });

    const over = await approve(db, 50000.01);
    assert.equal(over.res.statusCode, 403);
    assert.equal(over.body.error.code, 'PERMISSION_DENIED');
    assert.equal(over.body.error.details.reason, 'SCOPE_EXCEEDED');
    assert.equal(db.pendingActions.length, 0);
    assert.equal(over.executed, false);

    const within = await approve(db, 50000);
    assert.equal(within.res.statusCode, 202, 'within scope still goes through maker-checker');
    assert.equal(db.pendingActions.length, 1);
  });

  test('2b. a scoped holder fails closed when the amount is unknown', async () => {
    const db = mockDb({ overrides: [grant({ max_amount: 50000 })] });
    const missing = await approve(db, null);
    assert.equal(missing.res.statusCode, 403);
  });

  test('3. a role source or an unscoped grant is unrestricted', async () => {
    assert.equal(restrictingScopes([{ type: 'ROLE', role: 'admin' }, { type: 'GRANT', scope: { max_amount: 1 } }]), null);
    assert.equal(restrictingScopes([{ type: 'GRANT', scope: null }]), null);
    assert.equal(restrictingScopes([{ type: 'JIT', scope: { order_id: 5 } }]), null);
    assert.deepEqual(restrictingScopes([{ type: 'GRANT', scope: { max_amount: 10 } }]), [{ max_amount: 10 }]);

    const db = mockDb({ roleKeys: ['admin'], rolePerms: [{ role_key: 'admin' }], overrides: [grant({ max_amount: 100 })] });
    const res = await approve(db, 999999);
    assert.equal(res.res.statusCode, 202);
  });

  test('4. a stored scope field nothing can check fails closed', () => {
    assert.equal(scopeAllows({ max_amount_bdt: 50000 }, { amount: 1 }), false);
    assert.equal(scopeAllows({ constraint: 'Dhaka' }, { amount: 1 }), false);
    assert.equal(scopeAllows({ max_amount: 100 }, { amount: 100 }), true);
    assert.equal(scopeAllows({ max_amount: 100 }, { amount: null }), false);
  });

  test('5. a HIGH approve_before permission the caller does not hold is 403, not queued', async () => {
    const db = mockDb({});
    const res = await approve(db, 10);
    assert.equal(res.res.statusCode, 403);
    assert.equal(res.body.error.code, 'PERMISSION_DENIED');
    assert.equal(db.pendingActions.length, 0);
  });

  test('6. the client scope registry mirrors the server one', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(CLIENT_GRANT_SCOPES)), JSON.parse(JSON.stringify(GRANT_SCOPES)));
  });
});
