/**
 * rbac.test.js — Automated test suite for RBAC Resolution Engine (Prompt 2.4).
 *
 * Verifies all 4 acceptance criteria from docs/prompt.md Prompt 2.4:
 * 1. A DENY override defeats a role permission and a GRANT override simultaneously.
 * 2. Revoking a grant invalidates the cache and the next request is denied.
 * 3. A CRITICAL permission cannot be granted to a non-super-admin by any path.
 * 4. A HIGH-tier request returns 202 with a pending action id, and nothing is mutated.
 *
 * Plus tests for:
 * - Dynamic segment evaluation (role, district, tier, trust score thresholds).
 * - requireRestriction enforcement modes (BLOCK, THROTTLE, FORCE_REVIEW_QUEUE, SHADOW_BAN).
 * - GET /api/v1/me/permissions payload shape.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import {
  resolvePermissions,
  hasPermission,
  whyDenied,
  matchSegmentPredicate,
  getPermissionsPayload,
  bumpUserPermissionVersion,
  invalidateUserPermissionCache,
} from '../src/services/rbac.service.js';
import { requirePermission } from '../src/middlewares/requirePermission.js';
import { requireRestriction } from '../src/middlewares/requireRestriction.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import { createMemoryCache } from '../src/config/cache-drivers/memory.js';

const ALL_SAMPLE_ROLES = [
  { id: 1, key: 'super_admin', label_en: 'Super Admin', level: 100 },
  { id: 2, key: 'admin', label_en: 'Admin', level: 80 },
  { id: 3, key: 'moderator', label_en: 'Moderator', level: 60 },
  { id: 4, key: 'editor', label_en: 'Editor', level: 60 },
  { id: 5, key: 'supplier', label_en: 'Supplier', level: 20 },
  { id: 6, key: 'saler', label_en: 'Saler', level: 20 },
  { id: 7, key: 'customer', label_en: 'Customer', level: 10 },
];

// Mock DB factory that supports simulated RBAC tables
function createMockDb({
  users = [],
  roles = ALL_SAMPLE_ROLES,
  userRoles = [],
  permissions = [],
  rolePermissions = [],
  userOverrides = [],
  jitGrants = [],
  restrictions = [],
  userProfiles = [],
  trustScores = [],
} = {}) {
  const pendingActions = [];
  const auditLogs = [];

  return {
    pendingActions,
    auditLogs,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Roles for user
      if (normalized.includes('FROM user_roles ur') && normalized.includes('JOIN roles r')) {
        const userId = params[0];
        const assigned = userRoles.filter((ur) => ur.user_id === userId);
        const rows = assigned
          .map((ur) => roles.find((r) => r.id === ur.role_id || r.key === ur.role_key))
          .filter(Boolean);
        return { rows };
      }

      // Permissions for role keys
      if (normalized.includes('FROM role_permissions rp') && normalized.includes('JOIN permissions p')) {
        const roleKeys = params[0] || [];
        const matched = [];
        for (const rk of roleKeys) {
          const rpList = rolePermissions.filter((rp) => rp.role_key === rk);
          for (const rp of rpList) {
            const p = permissions.find((perm) => perm.key === rp.permission_key);
            if (p) {
              matched.push({
                key: p.key,
                domain: p.domain,
                label_en: p.label_en,
                label_bn: p.label_bn,
                plain_en: p.plain_en,
                plain_bn: p.plain_bn,
                risk_tier: p.risk_tier,
                delegable: p.delegable,
                approval_mode: p.approval_mode || 'approve_before',
                role_key: rk,
              });
            }
          }
        }
        return { rows: matched };
      }

      // Active user overrides
      if (normalized.includes('FROM user_permission_overrides')) {
        const userId = params[0];
        const rows = userOverrides.filter(
          (o) => o.user_id === userId && !o.revoked_at && (!o.expires_at || new Date(o.expires_at) > new Date())
        );
        return { rows };
      }

      // Active JIT grants
      if (normalized.includes('FROM permission_grant_requests')) {
        const userId = params[0];
        const rows = jitGrants.filter(
          (j) =>
            j.requester_id === userId &&
            j.status === 'APPROVED' &&
            (!j.window_expires_at || new Date(j.window_expires_at) > new Date())
        );
        return { rows };
      }

      // Permission by key
      if (normalized.includes('FROM permissions WHERE key = $1')) {
        const key = params[0];
        const p = permissions.find((perm) => perm.key === key);
        return { rows: p ? [p] : [] };
      }

      // All permissions
      if (normalized.includes('FROM permissions ORDER BY key ASC')) {
        return { rows: permissions };
      }

      // Direct user restrictions
      if (normalized.includes("FROM user_restrictions WHERE subject_type = 'USER'")) {
        const [userIdStr, userRef, capKey] = params;
        const rows = restrictions.filter(
          (r) =>
            r.subject_type === 'USER' &&
            (r.subject_ref === userIdStr || r.subject_ref === userRef) &&
            !r.lifted_at &&
            (!r.expires_at || new Date(r.expires_at) > new Date()) &&
            (!capKey || r.capability_key === capKey)
        );
        return { rows };
      }

      // Segment restrictions
      if (normalized.includes("FROM user_restrictions WHERE subject_type = 'SEGMENT'")) {
        const [capKey] = params;
        const rows = restrictions.filter(
          (r) =>
            r.subject_type === 'SEGMENT' &&
            !r.lifted_at &&
            (!r.expires_at || new Date(r.expires_at) > new Date()) &&
            (!capKey || r.capability_key === capKey)
        );
        return { rows };
      }

      // User profile and trust
      if (normalized.includes('FROM users u') && normalized.includes('LEFT JOIN user_profiles up')) {
        const userId = params[0];
        const u = users.find((user) => user.id === userId);
        const up = userProfiles.find((p) => p.user_id === userId);
        const ts = trustScores.find((t) => t.user_id === userId);
        if (!u) return { rows: [] };
        return {
          rows: [
            {
              id: u.id,
              ref: u.ref,
              status: u.status || 'ACTIVE',
              district: up?.district || null,
              division: up?.division || null,
              tier: ts?.tier || 'STARTER',
              trust_score: ts?.score ?? 50,
            },
          ],
        };
      }

      // Find user by id
      if (normalized.includes('FROM users WHERE id = $1')) {
        const userId = params[0];
        const u = users.find((user) => user.id === userId);
        return { rows: u ? [u] : [] };
      }

      // Insert pending admin action
      if (normalized.includes('INSERT INTO pending_admin_actions')) {
        const [ref, actorId, actionKey, payloadJson, targetType, targetRef, actorNote, expiresAt] = params;
        const row = {
          id: pendingActions.length + 1,
          ref,
          actor_id: actorId,
          action_key: actionKey,
          payload_json: typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson,
          target_type: targetType,
          target_ref: targetRef,
          actor_note: actorNote,
          expires_at: expiresAt,
          status: 'PENDING',
          created_at: new Date(),
        };
        pendingActions.push(row);
        return { rows: [row] };
      }

      // Insert audit log
      if (normalized.includes('INSERT INTO audit_logs')) {
        auditLogs.push(params);
        return { rows: [{ id: auditLogs.length }] };
      }

      return { rows: [] };
    },
  };
}

describe('RBAC Resolution Engine (Prompt 2.4)', () => {
  const samplePermissions = [
    {
      key: 'users.account.view',
      domain: 'users',
      label_en: 'View user accounts',
      label_bn: 'ইউজার অ্যাকাউন্ট দেখা',
      risk_tier: 'LOW',
      delegable: true,
      approval_mode: 'approve_before',
    },
    {
      key: 'users.account.edit',
      domain: 'users',
      label_en: 'Edit user accounts',
      label_bn: 'ইউজার অ্যাকাউন্ট সম্পাদনা',
      plain_en: 'change profile details',
      plain_bn: 'প্রোফাইল পরিবর্তন করতে',
      risk_tier: 'MEDIUM',
      delegable: true,
      approval_mode: 'approve_before',
    },
    {
      key: 'orders.refund.execute',
      domain: 'orders',
      label_en: 'Execute refunds',
      label_bn: 'রিফান্ড কার্যকর করা',
      plain_en: 'refund customer money',
      plain_bn: 'টাকা রিফান্ড করতে',
      risk_tier: 'HIGH',
      delegable: true,
      approval_mode: 'approve_before',
    },
    {
      key: 'security.session.revoke',
      domain: 'security',
      label_en: 'Force sign-out',
      label_bn: 'জোরপূর্বক লগআউট',
      plain_en: 'sign out user',
      plain_bn: 'লগআউট করতে',
      risk_tier: 'HIGH',
      delegable: true,
      approval_mode: 'execute_then_review',
    },
    {
      key: 'users.account.delete',
      domain: 'users',
      label_en: 'Delete accounts',
      label_bn: 'অ্যাকাউন্ট মুছে ফেলা',
      plain_en: 'permanently delete a user account',
      plain_bn: 'অ্যাকাউন্ট স্থায়ীভাবে মুছে ফেলতে',
      risk_tier: 'CRITICAL',
      delegable: false,
      approval_mode: 'approve_before',
    },
  ];

  const sampleRoles = [
    { id: 1, key: 'moderator', label_en: 'Moderator', level: 60 },
    { id: 2, key: 'admin', label_en: 'Admin', level: 80 },
    { id: 3, key: 'super_admin', label_en: 'Super Admin', level: 100 },
  ];

  test('Resolution Step 1: Collects permissions from assigned roles', async () => {
    const db = createMockDb({
      users: [{ id: 10, ref: 'USR-MOD1' }],
      roles: sampleRoles,
      userRoles: [{ user_id: 10, role_id: 1, role_key: 'moderator' }],
      permissions: samplePermissions,
      rolePermissions: [{ role_key: 'moderator', permission_key: 'users.account.view' }],
    });
    const cache = createMemoryCache();

    const resolved = await resolvePermissions(db, cache, 10);
    assert.equal(resolved.permissions.has('users.account.view'), true);
    assert.equal(resolved.permissions.has('users.account.edit'), false);

    const sources = resolved.sources.get('users.account.view');
    assert.equal(sources.length, 1);
    assert.equal(sources[0].type, 'ROLE');
    assert.equal(sources[0].role, 'moderator');
  });

  test('Acceptance 1: A DENY override defeats a role permission and a GRANT override simultaneously', async () => {
    const db = createMockDb({
      users: [{ id: 20, ref: 'USR-MOD2' }],
      roles: sampleRoles,
      userRoles: [{ user_id: 20, role_id: 1, role_key: 'moderator' }],
      permissions: samplePermissions,
      rolePermissions: [{ role_key: 'moderator', permission_key: 'users.account.view' }],
      userOverrides: [
        // Grant override for users.account.view
        {
          id: 101,
          user_id: 20,
          permission_key: 'users.account.view',
          effect: 'GRANT',
          reason: 'Coverage for surge',
          granted_by: 1,
          expires_at: new Date(Date.now() + 86400000),
          created_at: new Date(),
        },
        // Unconditional DENY override on the same permission
        {
          id: 102,
          user_id: 20,
          permission_key: 'users.account.view',
          effect: 'DENY',
          reason: 'Under disciplinary review for privacy breach',
          granted_by: 1,
          expires_at: new Date(Date.now() + 86400000),
          created_at: new Date(),
        },
      ],
    });
    const cache = createMemoryCache();

    const resolved = await resolvePermissions(db, cache, 20);
    // DENY beats role permission AND grant override simultaneously
    assert.equal(resolved.permissions.has('users.account.view'), false);
    assert.equal(resolved.sources.has('users.account.view'), false);
  });

  test('Acceptance 2: Revoking a grant invalidates the cache and the next request is denied', async () => {
    const overrides = [
      {
        id: 201,
        user_id: 30,
        permission_key: 'users.account.edit',
        effect: 'GRANT',
        reason: 'Temporary ticket coverage',
        granted_by: 1,
        expires_at: new Date(Date.now() + 86400000),
        created_at: new Date(),
      },
    ];

    const db = createMockDb({
      users: [{ id: 30, ref: 'USR-MOD3' }],
      roles: sampleRoles,
      userRoles: [{ user_id: 30, role_id: 1, role_key: 'moderator' }],
      permissions: samplePermissions,
      rolePermissions: [],
      userOverrides: overrides,
    });
    const cache = createMemoryCache();

    // First request: cached with grant active
    const firstCheck = await hasPermission(db, cache, 30, 'users.account.edit');
    assert.equal(firstCheck, true);

    // Revoke the grant in database
    overrides[0].revoked_at = new Date();

    // Invalidate cache immediately by bumping user version key
    await invalidateUserPermissionCache(cache, 30);

    // Next request: instantly denied with zero 5-minute lag
    const secondCheck = await hasPermission(db, cache, 30, 'users.account.edit');
    assert.equal(secondCheck, false);
  });

  test('Acceptance 3: A CRITICAL permission cannot be granted to a non-super-admin by any path', async () => {
    const db = createMockDb({
      users: [{ id: 40, ref: 'USR-MOD4' }],
      roles: sampleRoles,
      userRoles: [{ user_id: 40, role_id: 1, role_key: 'moderator' }], // Moderator, not super_admin
      permissions: samplePermissions,
      rolePermissions: [],
      userOverrides: [
        // Malicious or accidental grant override for CRITICAL permission
        {
          id: 301,
          user_id: 40,
          permission_key: 'users.account.delete',
          effect: 'GRANT',
          reason: 'Sneaky grant attempt',
          granted_by: 1,
          expires_at: new Date(Date.now() + 86400000),
          created_at: new Date(),
        },
      ],
      jitGrants: [
        // JIT grant attempt for CRITICAL permission
        {
          id: 401,
          ref: 'PGR-CRIT01',
          requester_id: 40,
          permission_key: 'users.account.delete',
          status: 'APPROVED',
          approver_id: 1,
          window_expires_at: new Date(Date.now() + 3600000),
        },
      ],
    });
    const cache = createMemoryCache();

    const resolved = await resolvePermissions(db, cache, 40);
    // CRITICAL-tier permissions are stripped for any non-super-admin
    assert.equal(resolved.permissions.has('users.account.delete'), false);

    // But for a super_admin, it resolves cleanly:
    const superAdminDb = createMockDb({
      users: [{ id: 1, ref: 'USR-SUPER' }],
      roles: sampleRoles,
      userRoles: [{ user_id: 1, role_id: 3, role_key: 'super_admin' }],
      permissions: samplePermissions,
      rolePermissions: [{ role_key: 'super_admin', permission_key: 'users.account.delete' }],
    });
    const superResolved = await resolvePermissions(superAdminDb, cache, 1);
    assert.equal(superResolved.permissions.has('users.account.delete'), true);
  });

  test('Acceptance 4: A HIGH-tier request returns 202 with a pending action id, and nothing is mutated', async () => {
    const db = createMockDb({
      users: [{ id: 50, ref: 'USR-MOD5' }],
      roles: sampleRoles,
      userRoles: [{ user_id: 50, role_id: 1, role_key: 'moderator' }],
      permissions: samplePermissions,
      rolePermissions: [{ role_key: 'moderator', permission_key: 'orders.refund.execute' }],
    });
    const cache = createMemoryCache();

    let handlerExecuted = false;

    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);

    app.post(
      '/api/v1/orders/123/refund',
      {
        preHandler: [
          async (req) => {
            req.user = { id: 50, roles: ['moderator'] };
          },
          requirePermission('orders.refund.execute'),
        ],
      },
      async () => {
        handlerExecuted = true;
        return { data: { refunded: true } };
      }
    );

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/123/refund',
      payload: { amount: 3200, reason: 'Customer return confirmed' },
    });

    // Handler must NOT have executed
    assert.equal(handlerExecuted, false);

    // Reply is 202 Accepted with PERMISSION_PENDING_APPROVAL deferred envelope
    assert.equal(res.statusCode, 202);
    const body = JSON.parse(res.payload);
    assert.ok(body.deferred);
    assert.equal(body.deferred.code, 'PERMISSION_PENDING_APPROVAL');
    assert.equal(body.deferred.action_key, 'orders.refund.execute');
    assert.ok(body.deferred.pending_action_ref.startsWith('PAA-'));
    assert.ok(body.deferred.pending_action_id > 0);

    // Database recorded the pending admin action
    assert.equal(db.pendingActions.length, 1);
    assert.equal(db.pendingActions[0].action_key, 'orders.refund.execute');
    assert.equal(db.pendingActions[0].actor_id, 50);
  });

  test('JIT Grant (Mode B): MEDIUM tier permission denied with requestable: true, then resolves when approved', async () => {
    const jitGrants = [];
    const db = createMockDb({
      users: [{ id: 60, ref: 'USR-MOD6' }],
      roles: sampleRoles,
      userRoles: [{ user_id: 60, role_id: 1, role_key: 'moderator' }],
      permissions: samplePermissions,
      rolePermissions: [],
      jitGrants,
    });
    const cache = createMemoryCache();

    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);

    app.patch(
      '/api/v1/users/99/edit',
      {
        preHandler: [
          async (req) => {
            req.user = { id: 60, roles: ['moderator'] };
          },
          requirePermission('users.account.edit'),
        ],
      },
      async () => ({ data: { success: true } })
    );

    await app.ready();

    // 1. Without JIT grant: 403 PERMISSION_DENIED with requestable: true
    const res1 = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/99/edit',
      payload: { display_name: 'Updated' },
    });

    assert.equal(res1.statusCode, 403);
    const body1 = JSON.parse(res1.payload);
    assert.equal(body1.error.code, 'PERMISSION_DENIED');
    assert.equal(body1.error.details.requestable, true);
    assert.equal(body1.error.details.risk_tier, 'MEDIUM');
    assert.ok(body1.error.details.plain_en);

    // 2. Admin approves JIT request:
    jitGrants.push({
      id: 501,
      ref: 'PGR-TEST01',
      requester_id: 60,
      permission_key: 'users.account.edit',
      status: 'APPROVED',
      approver_id: 1,
      window_expires_at: new Date(Date.now() + 7200000), // 2 hours
    });
    await invalidateUserPermissionCache(cache, 60);

    // 3. User can now execute immediately
    const res2 = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/99/edit',
      payload: { display_name: 'Updated' },
    });
    assert.equal(res2.statusCode, 200);
    const body2 = JSON.parse(res2.payload);
    assert.equal(body2.data.success, true);
  });

  test('requireRestriction: BLOCK returns 403 USER_RESTRICTED with bilingual message', async () => {
    const db = createMockDb({
      users: [{ id: 70, ref: 'USR-SALER1' }],
      restrictions: [
        {
          id: 601,
          subject_type: 'USER',
          subject_ref: '70',
          capability_key: 'can_withdraw',
          mode: 'BLOCK',
          reason: 'Payouts paused during return investigation',
          reason_bn: 'রিটার্ন তদন্ত চলাকালীন পেআউট স্থগিত করা হয়েছে',
        },
      ],
    });
    const cache = createMemoryCache();

    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);

    app.post(
      '/api/v1/vault/withdraw',
      {
        preHandler: [
          async (req) => {
            req.user = { id: 70, roles: ['saler'] };
          },
          requireRestriction('can_withdraw'),
        ],
      },
      async () => ({ data: { success: true } })
    );

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vault/withdraw',
      payload: { amount: 5000 },
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.code, 'USER_RESTRICTED');
    assert.equal(body.error.message_en, 'Payouts paused during return investigation');
    assert.equal(body.error.message_bn, 'রিটার্ন তদন্ত চলাকালীন পেআউট স্থগিত করা হয়েছে');
  });

  test('requireRestriction: Dynamic segment predicate matching', async () => {
    const db = createMockDb({
      users: [{ id: 80, ref: 'USR-SALER2' }],
      userRoles: [{ user_id: 80, role_id: 6, role_key: 'saler' }],
      userProfiles: [{ user_id: 80, district: 'Dhaka', division: 'Dhaka' }],
      trustScores: [{ user_id: 80, tier: 'STARTER', score: 35 }],
      restrictions: [
        {
          id: 701,
          subject_type: 'SEGMENT',
          subject_ref: 'SEG-LOW-TRUST-SALER',
          segment_predicate: {
            role: 'saler',
            district: 'Dhaka',
            tier: 'STARTER',
            trust_score_lt: 40,
          },
          capability_key: 'can_use_cod',
          mode: 'BLOCK',
          reason: 'COD disabled for low trust accounts in this segment',
          reason_bn: 'এই সেগমেন্টের স্বল্প ট্রাস্ট অ্যাকাউন্টের জন্য ক্যাশ-অন-ডেলিভারি বন্ধ',
        },
      ],
    });
    const cache = createMemoryCache();

    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);

    app.post(
      '/api/v1/orders/checkout',
      {
        preHandler: [
          async (req) => {
            req.user = { id: 80, roles: ['saler'] };
          },
          requireRestriction('can_use_cod'),
        ],
      },
      async () => ({ data: { success: true } })
    );

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/checkout',
      payload: { method: 'COD' },
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.code, 'USER_RESTRICTED');
    assert.equal(body.error.details.capability, 'can_use_cod');
  });

  test('requireRestriction: THROTTLE enforces rate limits', async () => {
    const db = createMockDb({
      users: [{ id: 90, ref: 'USR-SALER3' }],
      restrictions: [
        {
          id: 801,
          subject_type: 'USER',
          subject_ref: '90',
          capability_key: 'can_list_products',
          mode: 'THROTTLE',
          limit_value: 2, // Limit to 2 attempts
          reason: 'Listing limit applied',
        },
      ],
    });
    const cache = createMemoryCache();

    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);

    app.post(
      '/api/v1/products/create',
      {
        preHandler: [
          async (req) => {
            req.user = { id: 90, roles: ['saler'] };
          },
          requireRestriction('can_list_products'),
        ],
      },
      async () => ({ data: { created: true } })
    );

    await app.ready();

    // 1st request -> ok
    const res1 = await app.inject({ method: 'POST', url: '/api/v1/products/create' });
    assert.equal(res1.statusCode, 200);

    // 2nd request -> ok
    const res2 = await app.inject({ method: 'POST', url: '/api/v1/products/create' });
    assert.equal(res2.statusCode, 200);

    // 3rd request -> exceeded limit 2 -> 429 RATE_LIMITED
    const res3 = await app.inject({ method: 'POST', url: '/api/v1/products/create' });
    assert.equal(res3.statusCode, 429);
    const body3 = JSON.parse(res3.payload);
    assert.equal(body3.error.code, 'RATE_LIMITED');
  });

  test('GET /api/v1/me/permissions: returns full introspection payload with sources and grants', async () => {
    const db = createMockDb({
      users: [{ id: 100, ref: 'USR-DEV100' }],
      roles: sampleRoles,
      userRoles: [{ user_id: 100, role_id: 1, role_key: 'moderator' }],
      permissions: samplePermissions,
      rolePermissions: [{ role_key: 'moderator', permission_key: 'users.account.view' }],
      userOverrides: [
        {
          id: 901,
          user_id: 100,
          permission_key: 'orders.refund.execute',
          effect: 'GRANT',
          scope_json: { max_amount: 5000 },
          reason: 'Holiday queue cover',
          granted_by: 1,
          expires_at: new Date(Date.now() + 86400000),
          created_at: new Date(),
        },
      ],
      jitGrants: [
        {
          id: 950,
          ref: 'PGR-950',
          requester_id: 100,
          permission_key: 'users.account.edit',
          status: 'APPROVED',
          approver_id: 1,
          window_expires_at: new Date(Date.now() + 3600000),
          target_scope_json: { user_id: 99 },
          reason: 'Need to fix customer name',
        },
      ],
      restrictions: [
        {
          id: 980,
          subject_type: 'USER',
          subject_ref: '100',
          capability_key: 'can_chat',
          mode: 'FORCE_REVIEW_QUEUE',
          reason: 'Monitor new moderator chat',
        },
      ],
    });
    const cache = createMemoryCache();

    const payload = await getPermissionsPayload(db, cache, 100);

    assert.ok(Array.isArray(payload.permissions));
    assert.ok(payload.permissions.includes('users.account.view'));
    assert.ok(payload.permissions.includes('orders.refund.execute'));
    assert.ok(payload.permissions.includes('users.account.edit'));

    assert.equal(typeof payload.sources, 'object');
    assert.equal(payload.sources['users.account.view'][0].type, 'ROLE');
    assert.equal(payload.sources['orders.refund.execute'][0].type, 'GRANT');
    assert.equal(payload.sources['users.account.edit'][0].type, 'JIT');

    assert.equal(payload.grants.length, 1);
    assert.equal(payload.grants[0].permission_key, 'orders.refund.execute');

    assert.equal(payload.jit_windows.length, 1);
    assert.equal(payload.jit_windows[0].permission_key, 'users.account.edit');

    assert.equal(payload.restrictions.length, 1);
    assert.equal(payload.restrictions[0].capability_key, 'can_chat');
  });

  test('whyDenied: correctly identifies reason for denial across tiers', async () => {
    const db = createMockDb({
      users: [{ id: 110, ref: 'USR-DEV110' }],
      roles: ALL_SAMPLE_ROLES,
      userRoles: [{ user_id: 110, role_id: 3, role_key: 'moderator' }],
      permissions: samplePermissions,
      rolePermissions: [{ role_key: 'moderator', permission_key: 'users.account.view' }],
    });
    const cache = createMemoryCache();

    // Held
    assert.equal(await whyDenied(db, cache, 110, 'users.account.view'), 'held');

    // CRITICAL tier -> critical_locked
    assert.equal(await whyDenied(db, cache, 110, 'users.account.delete'), 'critical_locked');

    // HIGH tier -> maker_checker
    assert.equal(await whyDenied(db, cache, 110, 'orders.refund.execute'), 'maker_checker');

    // MEDIUM tier -> requestable
    assert.equal(await whyDenied(db, cache, 110, 'users.account.edit'), 'requestable');
  });

  test('super_admin executes HIGH tier actions directly without maker-checker deferral', async () => {
    const db = createMockDb({
      users: [{ id: 1, ref: 'USR-SUPER' }],
      roles: ALL_SAMPLE_ROLES,
      userRoles: [{ user_id: 1, role_id: 1, role_key: 'super_admin' }],
      permissions: samplePermissions,
      rolePermissions: [{ role_key: 'super_admin', permission_key: 'orders.refund.execute' }],
    });
    const cache = createMemoryCache();

    let executed = false;
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);

    app.post(
      '/api/v1/orders/123/refund',
      {
        preHandler: [
          async (req) => {
            req.user = { id: 1, roles: ['super_admin'] };
          },
          requirePermission('orders.refund.execute'),
        ],
      },
      async () => {
        executed = true;
        return { data: { refunded: true } };
      }
    );

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/123/refund',
      payload: { amount: 1000 },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(executed, true);
    assert.equal(db.pendingActions.length, 0); // No pending action created
  });

  test('HIGH tier with execute_then_review proceeds immediately for permitted staff', async () => {
    const db = createMockDb({
      users: [{ id: 120, ref: 'USR-MOD120' }],
      roles: ALL_SAMPLE_ROLES,
      userRoles: [{ user_id: 120, role_id: 3, role_key: 'moderator' }],
      permissions: samplePermissions,
      rolePermissions: [{ role_key: 'moderator', permission_key: 'security.session.revoke' }],
    });
    const cache = createMemoryCache();

    let executed = false;
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);

    app.post(
      '/api/v1/security/sessions/force-revoke',
      {
        preHandler: [
          async (req) => {
            req.user = { id: 120, roles: ['moderator'] };
          },
          requirePermission('security.session.revoke'),
        ],
      },
      async () => {
        executed = true;
        return { data: { revoked: true } };
      }
    );

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/security/sessions/force-revoke',
      payload: { session_id: '999' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(executed, true);
  });
});
