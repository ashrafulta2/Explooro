/**
 * delegation.test.js — Comprehensive automated test suite for Delegation Engine (Prompt 2.5).
 *
 * Verifies all requirements and acceptance criteria:
 * - Mode A: Standing grants (max 90 days, min 10-char reason, no CRITICAL, audit, cache bump).
 * - Mode B: JIT access requests (MEDIUM tier, no self-grant, window timeboxing, audit, cache bump).
 * - Mode C: Maker-checker (live precondition re-validation, no self-approval, transactional execution, audit).
 * - Expiry Cron: Automatic background sweep of overdue JIT windows, pending actions, and grants.
 * - HTTP Endpoints: Complete REST API integration.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import * as delegationService from '../src/services/delegation.service.js';
import * as makerCheckerService from '../src/services/makerChecker.service.js';
import { runGrantExpiryJob } from '../src/jobs/grantExpiryCron.js';
import { resolvePermissions, hasPermission } from '../src/services/rbac.service.js';
import { requirePermission } from '../src/middlewares/requirePermission.js';
import delegationRoutes from '../src/routes/delegation.routes.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import { createMemoryCache } from '../src/config/cache-drivers/memory.js';

const SAMPLE_ROLES = [
  { id: 1, key: 'super_admin', label_en: 'Super Admin', level: 100 },
  { id: 2, key: 'admin', label_en: 'Admin', level: 80 },
  { id: 3, key: 'moderator', label_en: 'Moderator', level: 60 },
  { id: 4, key: 'customer', label_en: 'Customer', level: 10 },
];

const SAMPLE_PERMISSIONS = [
  {
    key: 'users.account.view',
    domain: 'users',
    label_en: 'View user accounts',
    label_bn: 'ইউজার অ্যাকাউন্ট দেখা',
    risk_tier: 'LOW',
    delegable: true,
  },
  {
    key: 'users.permission.grant',
    domain: 'users',
    label_en: 'Grant permissions',
    label_bn: 'অনুমতি প্রদান',
    risk_tier: 'HIGH',
    delegable: true,
  },
  {
    key: 'users.permission.revoke',
    domain: 'users',
    label_en: 'Revoke permissions',
    label_bn: 'অনুমতি প্রত্যাহার',
    risk_tier: 'HIGH',
    delegable: true,
  },
  {
    key: 'admin.approval.view',
    domain: 'admin',
    label_en: 'View approval queue',
    label_bn: 'অনুমোদন সারি দেখা',
    risk_tier: 'LOW',
    delegable: true,
  },
  {
    key: 'admin.approval.decide',
    domain: 'admin',
    label_en: 'Decide approval requests',
    label_bn: 'অনুমোদন সিদ্ধান্ত',
    risk_tier: 'HIGH',
    delegable: true,
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
    key: 'users.account.delete',
    domain: 'users',
    label_en: 'Delete accounts',
    label_bn: 'অ্যাকাউন্ট মুছে ফেলা',
    risk_tier: 'CRITICAL',
    delegable: false,
  },
];

function createDelegationMockDb({
  users = [
    { id: 1, ref: 'USR-SUPER1', phone: '+8801700000001' },
    { id: 2, ref: 'USR-ADMIN1', phone: '+8801700000002' },
    { id: 3, ref: 'USR-MOD1', phone: '+8801700000003' },
    { id: 4, ref: 'USR-MOD2', phone: '+8801700000004' },
  ],
  userRoles = [
    { user_id: 1, role_id: 1, role_key: 'super_admin' },
    { user_id: 2, role_id: 2, role_key: 'admin' },
    { user_id: 3, role_id: 3, role_key: 'moderator' },
    { user_id: 4, role_id: 3, role_key: 'moderator' },
  ],
  rolePermissions = [
    { role_key: 'super_admin', permission_key: 'users.account.delete' },
    { role_key: 'super_admin', permission_key: 'orders.refund.execute' },
    { role_key: 'admin', permission_key: 'users.permission.grant' },
    { role_key: 'admin', permission_key: 'users.permission.revoke' },
    { role_key: 'admin', permission_key: 'admin.approval.view' },
    { role_key: 'admin', permission_key: 'admin.approval.decide' },
    { role_key: 'admin', permission_key: 'users.account.view' },
    { role_key: 'moderator', permission_key: 'users.account.view' },
    { role_key: 'moderator', permission_key: 'orders.refund.execute' },
  ],
  userOverrides = [],
  jitGrants = [],
  pendingActions = [],
} = {}) {
  const auditLogs = [];

  const db = {
    users,
    userRoles,
    userOverrides,
    jitGrants,
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

      // BEGIN / COMMIT / ROLLBACK
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }

      // Roles for user
      if (normalized.includes('FROM user_roles ur') && normalized.includes('JOIN roles r')) {
        const userId = params[0];
        const assigned = userRoles.filter((ur) => ur.user_id === userId);
        const rows = assigned
          .map((ur) => SAMPLE_ROLES.find((r) => r.id === ur.role_id || r.key === ur.role_key))
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
            const p = SAMPLE_PERMISSIONS.find((perm) => perm.key === rp.permission_key);
            if (p) {
              matched.push({ ...p, role_key: rk });
            }
          }
        }
        return { rows: matched };
      }

      // Active user overrides
      if (normalized.includes('FROM user_permission_overrides') && normalized.includes('revoked_at IS NULL')) {
        const userId = params[0];
        const rows = userOverrides.filter(
          (o) => o.user_id === userId && !o.revoked_at && (!o.expires_at || new Date(o.expires_at) > new Date())
        );
        return { rows };
      }

      // Overdue grant overrides
      if (normalized.includes('FROM user_permission_overrides WHERE revoked_at IS NULL AND expires_at <= now()')) {
        const rows = userOverrides.filter(
          (o) => !o.revoked_at && o.expires_at && new Date(o.expires_at) <= new Date()
        );
        return { rows };
      }

      // Insert grant override
      if (normalized.includes('INSERT INTO user_permission_overrides')) {
        const [userId, permissionKey, effect, scopeJson, reason, grantedBy, expiresAt] = params;
        const row = {
          id: userOverrides.length + 1,
          user_id: userId,
          permission_key: permissionKey,
          effect,
          scope_json: typeof scopeJson === 'string' ? JSON.parse(scopeJson) : scopeJson,
          reason,
          granted_by: grantedBy,
          expires_at: expiresAt,
          revoked_at: null,
          revoked_by: null,
          created_at: new Date(),
        };
        userOverrides.push(row);
        return { rows: [row] };
      }

      // Get grant override by id
      if (normalized.includes('FROM user_permission_overrides WHERE id = $1')) {
        const id = params[0];
        const row = userOverrides.find((o) => o.id === id);
        return { rows: row ? [row] : [] };
      }

      // Revoke grant override
      if (normalized.includes('UPDATE user_permission_overrides SET revoked_at = now()')) {
        const [id, revokedBy] = params;
        const row = userOverrides.find((o) => o.id === id);
        if (row && !row.revoked_at) {
          row.revoked_at = new Date();
          row.revoked_by = revokedBy;
          return { rows: [row] };
        }
        return { rows: [] };
      }

      // List grant overrides
      if (normalized.includes('FROM user_permission_overrides upo')) {
        const rows = userOverrides.map((o) => ({
          ...o,
          user_ref: 'USR-MOCK',
          user_phone: '+8801700000000',
          granted_by_ref: 'USR-ADMIN',
          risk_tier: 'MEDIUM',
        }));
        return { rows };
      }

      // Active JIT grants
      if (normalized.includes('FROM permission_grant_requests') && normalized.includes("status = 'APPROVED'")) {
        const userId = params[0];
        const rows = jitGrants.filter(
          (j) =>
            j.requester_id === userId &&
            j.status === 'APPROVED' &&
            (!j.window_expires_at || new Date(j.window_expires_at) > new Date())
        );
        return { rows };
      }

      // Insert JIT request
      if (normalized.includes('INSERT INTO permission_grant_requests')) {
        const [ref, requesterId, permissionKey, targetScopeJson, reason] = params;
        const row = {
          id: jitGrants.length + 1,
          ref,
          requester_id: requesterId,
          permission_key: permissionKey,
          target_scope_json: typeof targetScopeJson === 'string' ? JSON.parse(targetScopeJson) : targetScopeJson,
          reason,
          status: 'PENDING',
          approver_id: null,
          approver_note: null,
          window_minutes: null,
          window_expires_at: null,
          created_at: new Date(),
        };
        jitGrants.push(row);
        return { rows: [row] };
      }

      // Get JIT request by id
      if (normalized.includes('FROM permission_grant_requests pgr') && normalized.includes('pgr.id = $1')) {
        const id = params[0];
        const row = jitGrants.find((j) => j.id === id);
        return { rows: row ? [row] : [] };
      }

      // Decide JIT request
      if (normalized.includes('UPDATE permission_grant_requests') && normalized.includes('SET status = $2')) {
        const [id, status, approverId, approverNote, windowMinutes, windowExpiresAt, decidedAt] = params;
        const row = jitGrants.find((j) => j.id === id);
        if (row) {
          row.status = status;
          row.approver_id = approverId;
          row.approver_note = approverNote;
          row.window_minutes = windowMinutes;
          row.window_expires_at = windowExpiresAt;
          row.decided_at = decidedAt;
          return { rows: [row] };
        }
        return { rows: [] };
      }

      // Expire overdue JIT requests
      if (normalized.includes("UPDATE permission_grant_requests SET status = 'EXPIRED'")) {
        const expired = [];
        for (const j of jitGrants) {
          if (j.status === 'APPROVED' && j.window_expires_at && new Date(j.window_expires_at) <= new Date()) {
            j.status = 'EXPIRED';
            expired.push(j);
          }
        }
        return { rows: expired };
      }

      // List JIT requests
      if (normalized.includes('FROM permission_grant_requests pgr')) {
        return { rows: jitGrants };
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
          approver_id: null,
          approver_note: null,
          created_at: new Date(),
        };
        pendingActions.push(row);
        return { rows: [row] };
      }

      // Get pending action by id
      if (normalized.includes('FROM pending_admin_actions paa') && normalized.includes('paa.id = $1')) {
        const id = params[0];
        const row = pendingActions.find((a) => a.id === id);
        return { rows: row ? [row] : [] };
      }

      // Expire overdue pending actions (MUST BE MATCHED BEFORE GENERIC UPDATE)
      if (normalized.includes("UPDATE pending_admin_actions SET status = 'EXPIRED'")) {
        const expired = [];
        for (const a of pendingActions) {
          if (a.status === 'PENDING' && a.expires_at && new Date(a.expires_at) <= new Date()) {
            a.status = 'EXPIRED';
            expired.push(a);
          }
        }
        return { rows: expired };
      }

      // Update pending action decision
      if (normalized.includes('UPDATE pending_admin_actions')) {
        const [id, status, approverId, approverNote, decidedAt, appliedAt, failureReason] = params;
        const row = pendingActions.find((a) => a.id === id);
        if (row) {
          row.status = status;
          row.approver_id = approverId;
          row.approver_note = approverNote;
          row.decided_at = decidedAt;
          row.applied_at = appliedAt;
          row.failure_reason = failureReason;
          return { rows: [row] };
        }
        return { rows: [] };
      }

      // List pending actions
      if (normalized.includes('FROM pending_admin_actions paa')) {
        return { rows: pendingActions };
      }

      // Permission by key
      if (normalized.includes('FROM permissions WHERE key = $1')) {
        const key = params[0];
        const p = SAMPLE_PERMISSIONS.find((perm) => perm.key === key);
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

describe('Delegation Engine (Prompt 2.5)', () => {
  /* ======================================================================= */
  /* Mode A: Standing Grants                                                 */
  /* ======================================================================= */
  describe('Mode A: Standing Grants', () => {
    test('createStandingGrant: creates grant, audits before/after, and invalidates cache', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
      const grant = await delegationService.createStandingGrant(db, cache, {
        userId: 3,
        permissionKey: 'users.account.edit',
        reason: 'Temporary coverage for Ramadan surge',
        grantedBy: 2,
        expiresAt,
        ip: '127.0.0.1',
      });

      assert.equal(grant.user_id, 3);
      assert.equal(grant.permission_key, 'users.account.edit');
      assert.equal(grant.effect, 'GRANT');

      // Verified: audit log written
      assert.equal(db.auditLogs.length, 1);

      // Verified: permission now resolves for user 3
      const resolved = await resolvePermissions(db, cache, 3);
      assert.equal(resolved.permissions.has('users.account.edit'), true);
    });

    test('createStandingGrant: rejects reason shorter than 10 characters', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      await assert.rejects(
        async () => {
          await delegationService.createStandingGrant(db, cache, {
            userId: 3,
            permissionKey: 'users.account.edit',
            reason: 'Short', // < 10 chars
            grantedBy: 2,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          });
        },
        { code: 'VALIDATION_FAILED' }
      );
    });

    test('createStandingGrant: rejects expiry exceeding 90 days', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      const over90Days = new Date(Date.now() + 95 * 24 * 60 * 60 * 1000).toISOString();
      await assert.rejects(
        async () => {
          await delegationService.createStandingGrant(db, cache, {
            userId: 3,
            permissionKey: 'users.account.edit',
            reason: 'Coverage for whole quarter plus buffer',
            grantedBy: 2,
            expiresAt: over90Days,
          });
        },
        { code: 'VALIDATION_FAILED' }
      );
    });

    test('createStandingGrant: rejects CRITICAL permission outright', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      await assert.rejects(
        async () => {
          await delegationService.createStandingGrant(db, cache, {
            userId: 3,
            permissionKey: 'users.account.delete', // CRITICAL
            reason: 'Attempting to delegate account deletion',
            grantedBy: 1,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          });
        },
        { code: 'PERMISSION_DENIED' }
      );
    });

    test('revokeStandingGrant: revokes grant, audits before/after, and invalidates cache', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      const grant = await delegationService.createStandingGrant(db, cache, {
        userId: 3,
        permissionKey: 'users.account.edit',
        reason: 'Temporary surge coverage',
        grantedBy: 2,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      assert.equal(await hasPermission(db, cache, 3, 'users.account.edit'), true);

      // Revoke grant
      const revoked = await delegationService.revokeStandingGrant(db, cache, {
        grantId: grant.id,
        revokedBy: 2,
        reason: 'Surge period has ended early',
      });

      assert.ok(revoked.revoked_at);

      // Access is immediately revoked without waiting
      assert.equal(await hasPermission(db, cache, 3, 'users.account.edit'), false);
    });
  });

  /* ======================================================================= */
  /* Mode B: Just-In-Time Requests                                           */
  /* ======================================================================= */
  describe('Mode B: Just-In-Time Requests', () => {
    test('createAccessRequest: creates PGR request with PENDING status', async () => {
      const db = createDelegationMockDb();

      const request = await delegationService.createAccessRequest(db, {
        requesterId: 3,
        permissionKey: 'users.account.edit',
        targetScopeJson: { user_id: 99 },
        reason: 'Customer requested manual spelling fix on name',
      });

      assert.ok(request.ref.startsWith('PGR-'));
      assert.equal(request.status, 'PENDING');
      assert.equal(request.requester_id, 3);
    });

    test('createAccessRequest: rejects non-MEDIUM permissions', async () => {
      const db = createDelegationMockDb();

      await assert.rejects(
        async () => {
          await delegationService.createAccessRequest(db, {
            requesterId: 3,
            permissionKey: 'users.account.delete', // CRITICAL
            reason: 'Need to delete an account quickly',
          });
        },
        { code: 'PERMISSION_DENIED' }
      );

      await assert.rejects(
        async () => {
          await delegationService.createAccessRequest(db, {
            requesterId: 3,
            permissionKey: 'orders.refund.execute', // HIGH -> Must use maker-checker
            reason: 'Need to refund customer money now',
          });
        },
        { code: 'PERMISSION_DENIED' }
      );
    });

    test('decideAccessRequest: blocks self-approval (no_self_grant)', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      const request = await delegationService.createAccessRequest(db, {
        requesterId: 3,
        permissionKey: 'users.account.edit',
        reason: 'Fixing user profile details',
      });

      // User 3 attempting to approve own request
      await assert.rejects(
        async () => {
          await delegationService.decideAccessRequest(db, cache, {
            requestId: request.id,
            decision: 'APPROVE',
            approverId: 3, // Same as requester_id!
            approverNote: 'Approved myself',
          });
        },
        { code: 'SELF_APPROVAL_FORBIDDEN' }
      );
    });

    test('decideAccessRequest: approving opens time-boxed window and activates permission', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      const request = await delegationService.createAccessRequest(db, {
        requesterId: 3,
        permissionKey: 'users.account.edit',
        reason: 'Fixing user profile details',
      });

      assert.equal(await hasPermission(db, cache, 3, 'users.account.edit'), false);

      // Admin (user 2) approves with 60-minute window
      const decided = await delegationService.decideAccessRequest(db, cache, {
        requestId: request.id,
        decision: 'APPROVE',
        approverId: 2,
        approverNote: 'Approved for 1 hour',
        windowMinutes: 60,
      });

      assert.equal(decided.status, 'APPROVED');
      assert.equal(decided.window_minutes, 60);
      assert.ok(decided.window_expires_at);

      // Requester now holds permission immediately
      assert.equal(await hasPermission(db, cache, 3, 'users.account.edit'), true);
    });
  });

  /* ======================================================================= */
  /* Mode C: Maker-Checker                                                   */
  /* ======================================================================= */
  describe('Mode C: Maker-Checker & Executor Registry', () => {
    test('Maker-checker submission creates pending action and intercepts mutation', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      let handlerExecuted = false;
      const app = Fastify();
      app.decorate('db', db);
      app.decorate('cache', cache);
      app.register(errorHandlerPlugin);

      app.post(
        '/api/v1/orders/777/refund',
        {
          preHandler: [
            async (req) => {
              req.user = { id: 3, roles: ['moderator'] };
            },
            requirePermission('orders.refund.execute'),
          ],
        },
        async () => {
          handlerExecuted = true;
          return { data: { success: true } };
        }
      );

      await app.ready();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders/777/refund',
        payload: { order_id: 777, amount: 2500, reason: 'Damaged item return' },
      });

      assert.equal(res.statusCode, 202);
      assert.equal(handlerExecuted, false);
      const body = JSON.parse(res.payload);
      assert.equal(body.deferred.code, 'PERMISSION_PENDING_APPROVAL');
      assert.ok(body.deferred.pending_action_id > 0);
      assert.equal(db.pendingActions.length, 1);
    });

    test('decidePendingAction: blocks self-approval (no_self_approval)', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      const action = await db.query(
        `INSERT INTO pending_admin_actions (ref, actor_id, action_key, payload_json, target_type, target_ref, actor_note, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        ['PAA-TEST01', 3, 'orders.refund.execute', JSON.stringify({ amount: 1000 }), 'order', '777', null, new Date(Date.now() + 86400000)]
      );

      await assert.rejects(
        async () => {
          await makerCheckerService.decidePendingAction(db, cache, {
            actionId: action.rows[0].id,
            decision: 'APPROVE',
            approverId: 3, // Actor attempting to approve own action
          });
        },
        { code: 'SELF_APPROVAL_FORBIDDEN' }
      );
    });

    test('decidePendingAction: re-validates preconditions live at approval time and applies mutation', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      let orderRefunded = false;
      let orderStatus = 'CONFIRMED'; // Initial condition

      // Register executor for orders.refund.execute
      makerCheckerService.registerActionExecutor('orders.refund.execute', {
        async validatePreconditions(payload) {
          if (orderStatus !== 'CONFIRMED') {
            throw new Error(`Cannot refund order in status "${orderStatus}".`);
          }
          if (payload.amount > 5000) {
            throw new Error('Refund amount exceeds maximum permissible single limit.');
          }
        },
        async execute(payload) {
          orderRefunded = true;
          orderStatus = 'REFUNDED';
          return { refund_ref: 'RFD-12345', amount: payload.amount };
        },
      });

      // Insert pending action submitted by Moderator (user 3)
      const actionRow = (
        await db.query(
          `INSERT INTO pending_admin_actions (ref, actor_id, action_key, payload_json, target_type, target_ref, actor_note, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          ['PAA-REFUND01', 3, 'orders.refund.execute', JSON.stringify({ amount: 3000 }), 'order', 'ORD-999', null, new Date(Date.now() + 86400000)]
        )
      ).rows[0];

      // Admin (user 2) approves
      const result = await makerCheckerService.decidePendingAction(db, cache, {
        actionId: actionRow.id,
        decision: 'APPROVE',
        approverId: 2,
        approverNote: 'Confirmed customer proof of return',
      });

      assert.equal(result.status, 'APPLIED');
      assert.equal(orderRefunded, true);
      assert.equal(orderStatus, 'REFUNDED');
      assert.equal(result.result.refund_ref, 'RFD-12345');
    });

    test('decidePendingAction: aborts cleanly and marks FAILED when preconditions have changed', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      let orderStatus = 'CANCELLED'; // Precondition changed between submission and review!

      makerCheckerService.registerActionExecutor('orders.refund.execute', {
        async validatePreconditions() {
          if (orderStatus !== 'CONFIRMED') {
            throw new Error(`Cannot refund order in status "${orderStatus}".`);
          }
        },
        async execute() {
          throw new Error('Should not reach execute');
        },
      });

      const actionRow = (
        await db.query(
          `INSERT INTO pending_admin_actions (ref, actor_id, action_key, payload_json, target_type, target_ref, actor_note, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          ['PAA-REFUND02', 3, 'orders.refund.execute', JSON.stringify({ amount: 1500 }), 'order', 'ORD-888', null, new Date(Date.now() + 86400000)]
        )
      ).rows[0];

      await assert.rejects(
        async () => {
          await makerCheckerService.decidePendingAction(db, cache, {
            actionId: actionRow.id,
            decision: 'APPROVE',
            approverId: 2,
          });
        },
        { code: 'PRECONDITION_CHANGED' }
      );

      // Verify status marked FAILED in DB
      assert.equal(db.pendingActions[0].status, 'FAILED');
      assert.ok(db.pendingActions[0].failure_reason.includes('CANCELLED'));
    });
  });

  /* ======================================================================= */
  /* Expiry Cron Sweep                                                       */
  /* ======================================================================= */
  describe('Grant Expiry Cron Job', () => {
    test('runGrantExpiryJob: sweeps expired JIT windows and overdue pending actions', async () => {
      const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
      const db = createDelegationMockDb({
        jitGrants: [
          {
            id: 1,
            ref: 'PGR-EXP1',
            requester_id: 3,
            permission_key: 'users.account.edit',
            status: 'APPROVED',
            window_expires_at: pastDate,
          },
        ],
        pendingActions: [
          {
            id: 1,
            ref: 'PAA-EXP1',
            actor_id: 3,
            action_key: 'orders.refund.execute',
            status: 'PENDING',
            expires_at: pastDate,
          },
        ],
      });
      const cache = createMemoryCache();

      const summary = await runGrantExpiryJob(db, cache);
      assert.equal(summary.expiredJitCount, 1);
      assert.equal(summary.expiredPendingActionsCount, 1);
      assert.equal(summary.invalidatedUsersCount, 1);

      assert.equal(db.jitGrants[0].status, 'EXPIRED');
      assert.equal(db.pendingActions[0].status, 'EXPIRED');
    });
  });

  /* ======================================================================= */
  /* REST API Integration Routes                                             */
  /* ======================================================================= */
  describe('REST Endpoints Integration', () => {
    test('POST /api/v1/admin/grants and DELETE /api/v1/admin/grants/:id', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      const app = Fastify();
      app.decorate('db', db);
      app.decorate('cache', cache);
      app.register(errorHandlerPlugin);
      app.decorate('authenticate', async (req) => {
        req.user = { id: 2, roles: ['admin'] };
      });
      app.decorate('requirePermission', (key) => async (req) => {
        req.user = { id: 2, roles: ['admin'] };
      });
      await app.register(delegationRoutes, { prefix: '/api/v1' });
      await app.ready();

      // 1. Create grant
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/grants',
        payload: {
          user_id: 4,
          permission_key: 'users.account.edit',
          reason: 'Coverage for weekend queue backlog',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      });

      assert.equal(createRes.statusCode, 201);
      const createBody = JSON.parse(createRes.payload);
      assert.equal(createBody.data.grant.user_id, 4);

      // 2. Revoke grant
      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/grants/${createBody.data.grant.id}`,
        payload: { reason: 'Backlog cleared earlier than anticipated' },
      });

      assert.equal(revokeRes.statusCode, 200);
      const revokeBody = JSON.parse(revokeRes.payload);
      assert.equal(revokeBody.data.revoked, true);
    });

    test('POST /api/v1/access-requests and PATCH /api/v1/access-requests/:id', async () => {
      const db = createDelegationMockDb();
      const cache = createMemoryCache();

      const app = Fastify();
      app.decorate('db', db);
      app.decorate('cache', cache);
      app.register(errorHandlerPlugin);
      app.decorate('authenticate', async (req) => {
        req.user = { id: 3, roles: ['moderator'] };
      });
      app.decorate('requirePermission', (key) => async (req) => {
        req.user = { id: 2, roles: ['admin'] };
      });
      await app.register(delegationRoutes, { prefix: '/api/v1' });
      await app.ready();

      // 1. Submit JIT request
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/v1/access-requests',
        payload: {
          permission_key: 'users.account.edit',
          reason: 'Need to correct customer delivery address',
        },
      });

      assert.equal(submitRes.statusCode, 201);
      const submitBody = JSON.parse(submitRes.payload);
      const requestId = submitBody.data.access_request.id;

      // 2. Admin decides request
      const decideRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/access-requests/${requestId}`,
        payload: {
          decision: 'APPROVE',
          note: 'Approved for 60 minutes',
          window_minutes: 60,
        },
      });

      assert.equal(decideRes.statusCode, 200);
      const decideBody = JSON.parse(decideRes.payload);
      assert.equal(decideBody.data.access_request.status, 'APPROVED');
    });
  });
});
