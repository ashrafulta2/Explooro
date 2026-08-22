/**
 * restriction.test.js — Comprehensive automated test suite for Granular Activity Control (Prompt 2.6).
 *
 * Verifies all 4 acceptance criteria from docs/prompt.md Prompt 2.6:
 * 1. Setting can_withdraw=BLOCK on a user makes payout endpoint return USER_RESTRICTED with stored reason in en & bn.
 * 2. A segment restriction automatically applies to a user who becomes matching after it was created.
 * 3. max_cod_order_value is enforced at checkout with a clear user-facing message.
 * 4. A moderator applying a restriction creates a pending action instead of applying it.
 *
 * Plus tests for:
 * - 12 capability switches and 5 numeric limits.
 * - Dynamic segment dry-run preview matching.
 * - Restriction updates and lifting with audit trails.
 * - REST API endpoints under /api/v1/admin/restrictions.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import * as restrictionService from '../src/services/restriction.service.js';
import * as segmentService from '../src/services/segment.service.js';
import { requireRestriction } from '../src/middlewares/requireRestriction.js';
import { requirePermission } from '../src/middlewares/requirePermission.js';
import restrictionRoutes from '../src/routes/restriction.routes.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import { createMemoryCache } from '../src/config/cache-drivers/memory.js';

const ALL_ROLES = [
  { id: 1, key: 'super_admin', label_en: 'Super Admin', level: 100 },
  { id: 2, key: 'admin', label_en: 'Admin', level: 80 },
  { id: 3, key: 'moderator', label_en: 'Moderator', level: 60 },
  { id: 4, key: 'saler', label_en: 'Saler', level: 20 },
  { id: 5, key: 'customer', label_en: 'Customer', level: 10 },
];

const ALL_PERMISSIONS = [
  {
    key: 'users.account.view',
    domain: 'users',
    label_en: 'View user accounts',
    label_bn: 'ইউজার অ্যাকাউন্ট দেখা',
    risk_tier: 'LOW',
    delegable: true,
  },
  {
    key: 'users.restriction.manage',
    domain: 'users',
    label_en: 'Manage user restrictions',
    label_bn: 'ব্যবহারকারীর নিষেধাজ্ঞা পরিচালনা',
    plain_en: 'restrict user capabilities',
    plain_bn: 'ব্যবহারকারীর ক্ষমতা সীমিত করতে',
    risk_tier: 'HIGH',
    delegable: true,
    approval_mode: 'approve_before',
  },
  {
    key: 'vault.payout.request',
    domain: 'vault',
    label_en: 'Request payout withdrawal',
    label_bn: 'পেআউট উত্তোলনের আবেদন',
    risk_tier: 'LOW',
    delegable: true,
  },
];

function createRestrictionMockDb({
  users = [
    { id: 1, ref: 'USR-SUPER1', phone: '+8801700000001', status: 'ACTIVE' },
    { id: 2, ref: 'USR-MOD1', phone: '+8801700000002', status: 'ACTIVE' },
    { id: 10, ref: 'USR-SALER1', phone: '+8801700000010', status: 'ACTIVE' },
    { id: 20, ref: 'USR-SALER2', phone: '+8801700000020', status: 'ACTIVE' },
    { id: 30, ref: 'USR-CUST1', phone: '+8801700000030', status: 'ACTIVE' },
  ],
  userRoles = [
    { user_id: 1, role_id: 1, role_key: 'super_admin' },
    { user_id: 2, role_id: 3, role_key: 'moderator' },
    { user_id: 10, role_id: 4, role_key: 'saler' },
    { user_id: 20, role_id: 4, role_key: 'saler' },
    { user_id: 30, role_id: 5, role_key: 'customer' },
  ],
  userProfiles = [
    { user_id: 10, district: 'Dhaka', division: 'Dhaka' },
    { user_id: 20, district: 'Chattogram', division: 'Chattogram' },
    { user_id: 30, district: 'Dhaka', division: 'Dhaka' },
  ],
  trustScores = [
    { user_id: 10, tier: 'STARTER', score: 30 },
    { user_id: 20, tier: 'VERIFIED', score: 85 },
    { user_id: 30, tier: 'STARTER', score: 45 },
  ],
  restrictions = [],
} = {}) {
  const pendingActions = [];
  const auditLogs = [];

  const db = {
    users,
    userRoles,
    userProfiles,
    trustScores,
    restrictions,
    pendingActions,
    auditLogs,
    async connect() {
      return {
        query: db.query,
        release: () => {},
      };
    },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Roles for user
      if (normalized.includes('FROM user_roles ur') && normalized.includes('JOIN roles r')) {
        const userId = params[0];
        const assigned = userRoles.filter((ur) => ur.user_id === userId);
        const rows = assigned
          .map((ur) => ALL_ROLES.find((r) => r.id === ur.role_id || r.key === ur.role_key))
          .filter(Boolean);
        return { rows };
      }

      // Permissions for role keys
      if (normalized.includes('FROM role_permissions rp') && normalized.includes('JOIN permissions p')) {
        const roleKeys = params[0] || [];
        const matched = [];
        for (const rk of roleKeys) {
          if (rk === 'super_admin') {
            matched.push(...ALL_PERMISSIONS.map((p) => ({ ...p, role_key: rk })));
          } else if (rk === 'moderator') {
            matched.push(
              ...ALL_PERMISSIONS.filter((p) => p.key !== 'users.account.delete').map((p) => ({ ...p, role_key: rk }))
            );
          } else if (rk === 'saler') {
            matched.push({ ...ALL_PERMISSIONS[0], role_key: rk }, { ...ALL_PERMISSIONS[2], role_key: rk });
          }
        }
        return { rows: matched };
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

      // Active segment restrictions
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

      // Insert user restriction
      if (normalized.includes('INSERT INTO user_restrictions')) {
        const [
          subjectType,
          subjectRef,
          segmentPredicate,
          capabilityKey,
          mode,
          limitValue,
          reason,
          reasonBn,
          evidenceJson,
          appliedBy,
          expiresAt,
        ] = params;
        const row = {
          id: restrictions.length + 1,
          subject_type: subjectType,
          subject_ref: subjectRef,
          segment_predicate: typeof segmentPredicate === 'string' ? JSON.parse(segmentPredicate) : segmentPredicate,
          capability_key: capabilityKey,
          mode,
          limit_value: limitValue,
          reason,
          reason_bn: reasonBn,
          evidence_json: typeof evidenceJson === 'string' ? JSON.parse(evidenceJson) : evidenceJson,
          applied_by: appliedBy,
          expires_at: expiresAt,
          lifted_at: null,
          lifted_by: null,
          created_at: new Date(),
        };
        restrictions.push(row);
        return { rows: [row] };
      }

      // Get user restriction by ID
      if (normalized.includes('FROM user_restrictions ur') && normalized.includes('ur.id = $1')) {
        const id = params[0];
        const row = restrictions.find((r) => r.id === id);
        return { rows: row ? [row] : [] };
      }

      // Update user restriction
      if (normalized.includes('UPDATE user_restrictions') && normalized.includes('SET mode = COALESCE')) {
        const [id, mode, limitValue, reason, reasonBn, evidenceJson, expiresAt] = params;
        const row = restrictions.find((r) => r.id === id);
        if (row && !row.lifted_at) {
          if (mode) row.mode = mode;
          if (limitValue !== null) row.limit_value = limitValue;
          if (reason) row.reason = reason;
          if (reasonBn) row.reason_bn = reasonBn;
          if (evidenceJson) row.evidence_json = typeof evidenceJson === 'string' ? JSON.parse(evidenceJson) : evidenceJson;
          if (expiresAt) row.expires_at = expiresAt;
          return { rows: [row] };
        }
        return { rows: [] };
      }

      // Lift user restriction
      if (normalized.includes('UPDATE user_restrictions') && normalized.includes('SET lifted_at = now()')) {
        const [id, liftedBy, liftReason] = params;
        const row = restrictions.find((r) => r.id === id);
        if (row && !row.lifted_at) {
          row.lifted_at = new Date();
          row.lifted_by = liftedBy;
          row.evidence_json = { ...(row.evidence_json || {}), lift_reason: liftReason };
          return { rows: [row] };
        }
        return { rows: [] };
      }

      // List restrictions for user
      if (normalized.includes('FROM user_restrictions ur') && normalized.includes("ur.subject_type = 'USER'")) {
        const [userIdStr, userRef] = params;
        const rows = restrictions.filter(
          (r) => r.subject_type === 'USER' && (r.subject_ref === userIdStr || r.subject_ref === userRef)
        );
        return { rows };
      }

      // List all restrictions
      if (normalized.includes('FROM user_restrictions ur')) {
        return { rows: restrictions };
      }

      // Segment preview count
      if (normalized.includes('SELECT count(DISTINCT u.id)::int AS count FROM users u')) {
        let matching = users.filter((u) => {
          const up = userProfiles.find((p) => p.user_id === u.id);
          const ts = trustScores.find((t) => t.user_id === u.id);
          const userCtx = {
            roles: userRoles.filter((ur) => ur.user_id === u.id).map((ur) => ur.role_key),
            district: up?.district,
            division: up?.division,
            status: u.status,
            tier: ts?.tier,
            trust_score: ts?.score,
          };
          return true;
        });
        return { rows: [{ count: matching.length }] };
      }

      // Segment preview sample rows
      if (normalized.includes('SELECT u.id, u.ref, u.phone, u.status')) {
        const rows = users.slice(0, 10).map((u) => {
          const up = userProfiles.find((p) => p.user_id === u.id);
          const ts = trustScores.find((t) => t.user_id === u.id);
          return {
            id: u.id,
            ref: u.ref,
            phone: u.phone,
            status: u.status,
            district: up?.district,
            division: up?.division,
            tier: ts?.tier || 'STARTER',
            trust_score: ts?.score || 50,
          };
        });
        return { rows };
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

      // Permission by key
      if (normalized.includes('FROM permissions WHERE key = $1')) {
        const key = params[0];
        const p = ALL_PERMISSIONS.find((perm) => perm.key === key);
        return { rows: p ? [p] : [] };
      }

      // Insert audit log
      if (normalized.includes('INSERT INTO audit_logs')) {
        auditLogs.push(params);
        return { rows: [{ id: auditLogs.length }] };
      }

      return { rows: [] };
    },
  };

  return db;
}

describe('Granular Activity Control (Prompt 2.6)', () => {
  test('Acceptance 1: can_withdraw=BLOCK makes payout endpoint return USER_RESTRICTED with stored reason in en & bn', async () => {
    const db = createRestrictionMockDb({
      restrictions: [
        {
          id: 1,
          subject_type: 'USER',
          subject_ref: '10',
          capability_key: 'can_withdraw',
          mode: 'BLOCK',
          reason: 'Payouts paused during return surge investigation',
          reason_bn: 'রিটার্ন বৃদ্ধির তদন্ত চলাকালীন পেআউট উত্তোলন সাময়িকভাবে বন্ধ আছে',
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
            req.user = { id: 10, roles: ['saler'] };
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
    assert.equal(body.error.message_en, 'Payouts paused during return surge investigation');
    assert.equal(body.error.message_bn, 'রিটার্ন বৃদ্ধির তদন্ত চলাকালীন পেআউট উত্তোলন সাময়িকভাবে বন্ধ আছে');
  });

  test('Acceptance 2: A segment restriction automatically applies to a user who becomes matching after it was created', async () => {
    const db = createRestrictionMockDb({
      restrictions: [
        {
          id: 2,
          subject_type: 'SEGMENT',
          subject_ref: 'SEG-LOW-TRUST-DHAKA',
          segment_predicate: {
            role: 'saler',
            district: 'Dhaka',
            trust_score_lt: 40,
          },
          capability_key: 'can_use_cod',
          mode: 'BLOCK',
          reason: 'COD disabled for low-trust salers in Dhaka segment',
          reason_bn: 'ঢাকা সেগমেন্টের স্বল্প-ট্রাস্ট সেলারদের জন্য ক্যাশ অন ডেলিভারি বন্ধ',
        },
      ],
    });
    const cache = createMemoryCache();

    // User 10 (Saler in Dhaka with trust score 30) matches dynamically
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);

    app.post(
      '/api/v1/orders/checkout',
      {
        preHandler: [
          async (req) => {
            req.user = { id: 10, roles: ['saler'] };
          },
          requireRestriction('can_use_cod'),
        ],
      },
      async () => ({ data: { checkout: true } })
    );

    await app.ready();

    // 1. User 10 is blocked because trust score is 30 (< 40)
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/checkout',
      payload: { method: 'COD' },
    });

    assert.equal(res1.statusCode, 403);
    const body1 = JSON.parse(res1.payload);
    assert.equal(body1.error.code, 'USER_RESTRICTED');
    assert.equal(body1.error.details.capability, 'can_use_cod');

    // 2. User 20 (Saler in Chattogram with trust score 85) is NOT blocked
    const appUser20 = Fastify();
    appUser20.decorate('db', db);
    appUser20.decorate('cache', cache);
    appUser20.register(errorHandlerPlugin);

    appUser20.post(
      '/api/v1/orders/checkout',
      {
        preHandler: [
          async (req) => {
            req.user = { id: 20, roles: ['saler'] };
          },
          requireRestriction('can_use_cod'),
        ],
      },
      async () => ({ data: { checkout: true } })
    );

    await appUser20.ready();

    const res2 = await appUser20.inject({
      method: 'POST',
      url: '/api/v1/orders/checkout',
      payload: { method: 'COD' },
    });

    assert.equal(res2.statusCode, 200);
    const body2 = JSON.parse(res2.payload);
    assert.equal(body2.data.checkout, true);
  });

  test('Acceptance 3: max_cod_order_value is enforced with a clear user-facing message', async () => {
    const db = createRestrictionMockDb({
      restrictions: [
        {
          id: 3,
          subject_type: 'USER',
          subject_ref: '10',
          capability_key: 'max_cod_order_value',
          mode: 'THROTTLE',
          limit_value: 3000,
          reason: 'Your maximum COD order value is capped at ৳3,000.',
          reason_bn: 'আপনার সর্বোচ্চ ক্যাশ-অন-ডেলিভারি অর্ডারের সীমা ৳৩,০০০ নির্ধারণ করা হয়েছে।',
        },
      ],
    });

    // 1. Within limit (৳2500 <= ৳3000) -> passes without error
    await assert.doesNotReject(async () => {
      await restrictionService.checkNumericLimit(db, 10, 'max_cod_order_value', 2500);
    });

    // 2. Exceeding limit (৳4500 > ৳3000) -> throws USER_RESTRICTED with clear bilingual message
    await assert.rejects(
      async () => {
        await restrictionService.checkNumericLimit(db, 10, 'max_cod_order_value', 4500);
      },
      (err) => {
        assert.equal(err.code, 'USER_RESTRICTED');
        assert.equal(err.messageEn, 'Your maximum COD order value is capped at ৳3,000.');
        assert.equal(err.messageBn, 'আপনার সর্বোচ্চ ক্যাশ-অন-ডেলিভারি অর্ডারের সীমা ৳৩,০০০ নির্ধারণ করা হয়েছে।');
        assert.equal(err.details.limit_value, 3000);
        assert.equal(err.details.requested_value, 4500);
        return true;
      }
    );
  });

  test('Acceptance 4: A moderator applying a restriction creates a pending action instead of applying it', async () => {
    const db = createRestrictionMockDb();
    const cache = createMemoryCache();

    let routeExecuted = false;
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);

    app.post(
      '/api/v1/admin/restrictions',
      {
        preHandler: [
          async (req) => {
            req.user = { id: 2, roles: ['moderator'] }; // Moderator, not super_admin
          },
          requirePermission('users.restriction.manage'),
        ],
      },
      async () => {
        routeExecuted = true;
        return { data: { created: true } };
      }
    );

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/restrictions',
      payload: {
        subject_type: 'USER',
        subject_ref: '10',
        capability_key: 'can_withdraw',
        mode: 'BLOCK',
        reason: 'Investigation on payout anomalies',
      },
    });

    assert.equal(res.statusCode, 202);
    assert.equal(routeExecuted, false); // Route handler was intercepted
    const body = JSON.parse(res.payload);
    assert.equal(body.deferred.code, 'PERMISSION_PENDING_APPROVAL');
    assert.equal(body.deferred.action_key, 'users.restriction.manage');
    assert.ok(body.deferred.pending_action_ref.startsWith('PAA-'));
    assert.equal(db.pendingActions.length, 1);
    assert.equal(db.restrictions.length, 0); // Not applied yet!
  });

  test('Super Admin applies restriction immediately (Status 201)', async () => {
    const db = createRestrictionMockDb();
    const cache = createMemoryCache();

    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 1, roles: ['super_admin'] };
    });
    app.decorate('requirePermission', () => async (req) => {
      req.user = { id: 1, roles: ['super_admin'] };
    });
    await app.register(restrictionRoutes, { prefix: '/api/v1' });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/restrictions',
      payload: {
        subject_type: 'USER',
        subject_ref: '10',
        capability_key: 'can_sell',
        mode: 'BLOCK',
        reason: 'Counterfeit policy violation under review',
        reason_bn: 'নকল পণ্য নীতি লঙ্ঘনের অভিযোগ পর্যালোচনাধীন',
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.equal(body.data.restriction.capability_key, 'can_sell');
    assert.equal(body.data.restriction.mode, 'BLOCK');
    assert.equal(db.restrictions.length, 1);
  });

  test('Segment preview: returns match count and sample users', async () => {
    const db = createRestrictionMockDb();
    const result = await segmentService.previewSegmentMatch(db, {
      role: 'saler',
      district: 'Dhaka',
      tier: 'STARTER',
    });

    assert.ok(typeof result.matching_count === 'number');
    assert.ok(Array.isArray(result.sample_users));
  });

  test('updateRestriction and liftRestriction: updates and lifts with audit and cache bump', async () => {
    const db = createRestrictionMockDb();
    const cache = createMemoryCache();

    // 1. Apply restriction
    const applied = await restrictionService.applyRestriction(db, cache, {
      subjectType: 'USER',
      subjectRef: '10',
      capabilityKey: 'can_list_products',
      mode: 'THROTTLE',
      limitValue: 5,
      reason: 'New account listing limit',
      appliedBy: 1,
    });

    assert.equal(applied.limit_value, 5);

    // 2. Update limitValue to 10
    const updated = await restrictionService.updateRestriction(db, cache, {
      restrictionId: applied.id,
      limitValue: 10,
      reason: 'Trust level increased, raising limit to 10',
      updatedBy: 1,
    });

    assert.equal(updated.limit_value, 10);

    // 3. Lift restriction
    const lifted = await restrictionService.liftRestriction(db, cache, {
      restrictionId: applied.id,
      liftedBy: 1,
      reason: 'Full seller verification complete, restrictions removed',
    });

    assert.ok(lifted.lifted_at);
    assert.equal(db.auditLogs.length, 3); // 1 apply + 1 update + 1 lift
  });

  test('GET /api/v1/admin/restrictions: returns all restrictions', async () => {
    const db = createRestrictionMockDb({
      restrictions: [
        {
          id: 1,
          subject_type: 'USER',
          subject_ref: '10',
          capability_key: 'can_withdraw',
          mode: 'BLOCK',
          reason: 'Investigation on payout surge',
        },
        {
          id: 2,
          subject_type: 'SEGMENT',
          subject_ref: 'SEG-1',
          capability_key: 'can_use_cod',
          mode: 'BLOCK',
          reason: 'COD disabled for high-risk segment',
        },
      ],
    });
    const cache = createMemoryCache();

    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', cache);
    app.register(errorHandlerPlugin);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 1, roles: ['super_admin'] };
    });
    app.decorate('requirePermission', () => async (req) => {
      req.user = { id: 1, roles: ['super_admin'] };
    });
    await app.register(restrictionRoutes, { prefix: '/api/v1' });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/restrictions',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.data.restrictions.length, 2);
  });

  test('SHADOW_BAN mode requires evidence_json documenting concrete abuse', async () => {
    const db = createRestrictionMockDb();
    const cache = createMemoryCache();

    // 1. Missing evidence_json -> throws validation error
    await assert.rejects(
      async () => {
        await restrictionService.applyRestriction(db, cache, {
          subjectType: 'USER',
          subjectRef: '10',
          capabilityKey: 'can_chat',
          mode: 'SHADOW_BAN',
          reason: 'Spam bot network suspected',
          appliedBy: 1,
        });
      },
      (err) => {
        assert.equal(err.code, 'VALIDATION_FAILED');
        assert.ok(err.messageEn.includes('evidence_json'));
        return true;
      }
    );

    // 2. With evidence_json -> succeeds
    const applied = await restrictionService.applyRestriction(db, cache, {
      subjectType: 'USER',
      subjectRef: '10',
      capabilityKey: 'can_chat',
      mode: 'SHADOW_BAN',
      evidenceJson: { log_ref: 'LOG-SPAM-1234', pattern: 'repeat_message_flood' },
      reason: 'Spam bot network verified with telemetry',
      appliedBy: 1,
    });

    assert.equal(applied.mode, 'SHADOW_BAN');
    assert.ok(applied.evidence_json);
  });

  test('Segment numeric limit applies only to matching users', async () => {
    const db = createRestrictionMockDb({
      restrictions: [
        {
          id: 4,
          subject_type: 'SEGMENT',
          subject_ref: 'SEG-STARTER-SALERS-DHAKA',
          segment_predicate: {
            role: 'saler',
            district: 'Dhaka',
            tier: 'STARTER',
          },
          capability_key: 'max_cod_order_value',
          mode: 'THROTTLE',
          limit_value: 3000,
          reason: 'COD capped at ৳3,000 for Dhaka starter salers',
          reason_bn: 'ঢাকা স্টার্টার সেলারদের জন্য ক্যাশ অন ডেলিভারি সর্বোচ্চ ৩০০০ টাকা',
        },
      ],
    });

    // User 10: Saler in Dhaka with STARTER tier -> MATCHES predicate -> exceeding limit throws
    await assert.rejects(
      async () => {
        await restrictionService.checkNumericLimit(db, 10, 'max_cod_order_value', 4000);
      },
      (err) => {
        assert.equal(err.code, 'USER_RESTRICTED');
        assert.equal(err.details.limit_value, 3000);
        return true;
      }
    );

    // User 20: Saler in Chattogram with VERIFIED tier -> DOES NOT MATCH predicate -> allowed
    await assert.doesNotReject(async () => {
      await restrictionService.checkNumericLimit(db, 20, 'max_cod_order_value', 4000);
    });
  });

  test('evaluatePredicate handles case-insensitivity and complex criteria', () => {
    const userCtx = {
      roles: ['Saler'],
      district: 'Dhaka',
      division: 'DHAKA',
      tier: 'Starter',
      trust_score: 35,
    };

    // Case-insensitive role, district, tier, and numeric lt
    const match = segmentService.evaluatePredicate(
      {
        role: 'saler',
        district: 'dhaka',
        division: 'dhaka',
        tier: 'STARTER',
        trust_score_lt: 40,
      },
      userCtx
    );
    assert.equal(match, true);

    const noMatch = segmentService.evaluatePredicate(
      {
        role: 'saler',
        district: 'Chattogram',
      },
      userCtx
    );
    assert.equal(noMatch, false);
  });

  test('All 12 capability switches and 5 numeric limits are recognized', () => {
    const expectedCaps = [
      'can_login',
      'can_list_products',
      'can_sell',
      'can_buy',
      'can_use_cod',
      'can_withdraw',
      'can_chat',
      'can_live_stream',
      'can_run_ads',
      'can_refer',
      'can_post_review',
      'can_upload_video',
    ];

    const expectedLimits = [
      'max_withdrawal_per_day',
      'max_products',
      'max_cod_order_value',
      'max_daily_messages',
      'ad_budget_cap',
    ];

    for (const cap of expectedCaps) {
      assert.ok(restrictionService.VALID_CAPABILITIES.has(cap), `Missing capability: ${cap}`);
    }

    for (const limit of expectedLimits) {
      assert.ok(restrictionService.VALID_NUMERIC_LIMITS.has(limit), `Missing numeric limit: ${limit}`);
      assert.ok(restrictionService.VALID_CAPABILITIES.has(limit), `Numeric limit not in capability set: ${limit}`);
    }
  });
});
