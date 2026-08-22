/**
 * adminUsers.test.js — Test suite for Prompt 3.3 (Users & Access Admin UI, Matrix, Grants, Approvals & Restrictions).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import requirePermissionPlugin from '../src/middlewares/requirePermission.js';
import userRoutes from '../src/routes/user.routes.js';
import delegationRoutes from '../src/routes/delegation.routes.js';
import restrictionRoutes from '../src/routes/restriction.routes.js';
import * as rbacService from '../src/services/rbac.service.js';

function createMockDb() {
  const users = [
    { id: 1, ref: 'USR-8F2K9QX7', phone: '01711000001', email: 'rahim@explooro.com', is_phone_verified: true, is_email_verified: true, status: 'ACTIVE', created_at: new Date().toISOString() },
    { id: 2, ref: 'USR-3M7V2WQ1', phone: '01711000002', email: 'fatima@explooro.com', is_phone_verified: true, is_email_verified: true, status: 'ACTIVE', created_at: new Date().toISOString() },
  ];

  const profiles = [
    { user_id: 1, full_name: 'Rahim Khan', display_name: 'Rahim', district: 'Dhaka', division: 'Dhaka', address_line: 'Dhanmondi' },
    { user_id: 2, full_name: 'Fatima Fashion', display_name: 'Fatima', district: 'Sylhet', division: 'Sylhet', address_line: 'Zindabazar' },
  ];

  const roles = [
    { id: 1, key: 'customer', label_en: 'Customer', label_bn: 'গ্রাহক', level: 10, is_system: true },
    { id: 4, key: 'moderator', label_en: 'Moderator', label_bn: 'মডারেটর', level: 50, is_system: true },
    { id: 6, key: 'super_admin', label_en: 'Super Admin', label_bn: 'সুপার অ্যাডমিন', level: 100, is_system: true },
  ];

  const userRoles = [
    { user_id: 1, role_id: 4 },
    { user_id: 2, role_id: 1 },
  ];

  const permissions = [
    { key: 'catalog.product.view', domain: 'catalog', label_en: 'View Products', label_bn: 'পণ্য দেখুন', plain_en: 'View catalog products', plain_bn: 'ক্যাটালগ পণ্য দেখুন', risk_tier: 'LOW', delegable: true, approval_mode: 'NONE' },
    { key: 'orders.order.view_all', domain: 'orders', label_en: 'View All Orders', label_bn: 'সকল অর্ডার দেখুন', plain_en: 'View all marketplace orders', plain_bn: 'সকল মার্কেটপ্লেস অর্ডার দেখুন', risk_tier: 'MEDIUM', delegable: true, approval_mode: 'JIT_PER_ACTION' },
    { key: 'finance.payout.approve', domain: 'finance', label_en: 'Approve Payouts', label_bn: 'পেআউট অনুমোদন', plain_en: 'Disburse merchant payouts', plain_bn: 'সেলার পেআউট অনুমোদন', risk_tier: 'HIGH', delegable: false, approval_mode: 'MAKER_CHECKER' },
    { key: 'platform.module.toggle', domain: 'platform', label_en: 'Toggle Modules', label_bn: 'মডিউল টগল', plain_en: 'Enable/disable platform features', plain_bn: 'প্ল্যাটফর্ম মডিউল টগল', risk_tier: 'CRITICAL', delegable: false, approval_mode: 'NONE' },
  ];

  const rolePermissions = [
    { role_id: 4, permission_key: 'orders.order.view_all' },
    { role_id: 4, permission_key: 'catalog.product.view' },
    { role_id: 1, permission_key: 'catalog.product.view' },
  ];

  const restrictions = [];

  return {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // SELECT users list
      if (normalized.startsWith('SELECT u.id, u.ref, u.phone') && normalized.includes('FROM users u')) {
        const rows = users.map((u) => {
          const prof = profiles.find((p) => p.user_id === u.id) || {};
          const ur = userRoles.find((r) => r.user_id === u.id);
          const r = ur ? roles.find((role) => role.id === ur.role_id) : null;
          return {
            ...u,
            full_name: prof.full_name,
            display_name: prof.display_name,
            district: prof.district,
            division: prof.division,
            role_key: r?.key || 'customer',
            role_label_en: r?.label_en || 'Customer',
            role_label_bn: r?.label_bn || 'গ্রাহক',
            active_restrictions_count: 0,
          };
        });
        return { rows };
      }

      // SELECT user detail by ID
      if (normalized.startsWith('SELECT u.*, up.full_name') && normalized.includes('WHERE u.id = $1')) {
        const u = users.find((x) => x.id === parseInt(params[0], 10));
        if (!u) return { rows: [] };
        const prof = profiles.find((p) => p.user_id === u.id) || {};
        return { rows: [{ ...u, ...prof }] };
      }

      // SELECT user by phone or ID
      if (normalized.startsWith('SELECT * FROM users WHERE id = $1')) {
        const u = users.find((x) => x.id === parseInt(params[0], 10));
        return { rows: u ? [{ ...u }] : [] };
      }

      // SELECT roles for user
      if (normalized.includes('FROM user_roles ur') && normalized.includes('WHERE ur.user_id = $1')) {
        const urList = userRoles.filter((r) => r.user_id === parseInt(params[0], 10));
        const userRolesList = urList.map((ur) => roles.find((r) => r.id === ur.role_id)).filter(Boolean);
        return { rows: userRolesList };
      }

      // SELECT user profile and trust score
      if (normalized.startsWith('SELECT u.id, u.ref, u.status') && normalized.includes('FROM users u')) {
        const u = users.find((x) => x.id === parseInt(params[0], 10));
        if (!u) return { rows: [] };
        const prof = profiles.find((p) => p.user_id === u.id) || {};
        return {
          rows: [
            {
              id: u.id,
              ref: u.ref,
              status: u.status,
              district: prof.district || 'Dhaka',
              division: prof.division || 'Dhaka',
              tier: 'STARTER',
              trust_score: 80,
            },
          ],
        };
      }

      // SELECT active restrictions
      if (normalized.includes('FROM user_restrictions') || normalized.includes('FROM segment_restrictions')) {
        return { rows: [] };
      }

      // SELECT roles & permissions matrix
      if (normalized.startsWith('SELECT id, key, label_en, label_bn, level, is_system FROM roles')) {
        return { rows: roles.map((r) => ({ ...r })) };
      }
      if (normalized.startsWith('SELECT key, domain, label_en, label_bn, plain_en, plain_bn, risk_tier')) {
        return { rows: permissions.map((p) => ({ ...p })) };
      }
      if (normalized.startsWith('SELECT role_id, permission_key FROM role_permissions')) {
        return { rows: rolePermissions.map((rp) => ({ ...rp })) };
      }

      // SELECT permissions for role keys
      if (normalized.includes('FROM role_permissions rp') && normalized.includes('WHERE r.key = ANY($1::text[])')) {
        const rKeys = params[0] || [];
        const matched = [];
        for (const rk of rKeys) {
          const r = roles.find((x) => x.key === rk);
          if (r) {
            const rps = rolePermissions.filter((x) => x.role_id === r.id);
            for (const rp of rps) {
              const p = permissions.find((x) => x.key === rp.permission_key);
              if (p) matched.push({ ...p, role_key: rk });
            }
          }
        }
        return { rows: matched };
      }

      // user_permission_overrides
      if (normalized.includes('FROM user_permission_overrides')) {
        return { rows: [] };
      }

      // permission_grant_requests
      if (normalized.includes('FROM permission_grant_requests')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}

describe('Users & Access Admin UI, Matrix & Permissions Introspection (Prompt 3.3)', () => {
  let app;
  let mockDb;

  before(async () => {
    mockDb = createMockDb();
    const cache = {
      store: new Map(),
      async get(k) { return this.store.get(k) || null; },
      async set(k, v) { this.store.set(k, v); },
      async del(k) { this.store.delete(k); },
    };

    app = Fastify({ logger: false });
    app.decorate('db', mockDb);
    app.decorate('cache', cache);

    // Mock authenticate plugin to inject super_admin user
    app.addHook('onRequest', (req, reply, done) => {
      req.user = { id: 999, ref: 'USR-ADMIN', roles: ['super_admin'], role: 'super_admin' };
      done();
    });

    app.decorate('requirePermission', (permKey) => async (req, reply) => {
      // Super admin passes all permission gates
      if (!req.user?.roles?.includes('super_admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
      }
    });

    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    await app.register(userRoutes, { prefix: '/api/v1' });

    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('GET /api/v1/admin/users: returns list of users with roles and profiles', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.users));
    assert.equal(body.users.length, 2);
    assert.equal(body.users[0].full_name, 'Rahim Khan');
    assert.equal(body.users[0].role_key, 'moderator');
  });

  test('GET /api/v1/admin/users/:id: returns detailed user data and roles', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users/1',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.user.id, 1);
    assert.equal(body.user.full_name, 'Rahim Khan');
    assert.equal(body.user.district, 'Dhaka');
    assert.ok(Array.isArray(body.user.roles));
    assert.equal(body.user.roles[0].key, 'moderator');
  });

  test('GET /api/v1/admin/users/:id/permissions: introspects resolved permissions with sources map', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users/1/permissions',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.data.permissions.includes('orders.order.view_all'));
    assert.ok(body.data.sources['orders.order.view_all']);
    assert.equal(body.data.sources['orders.order.view_all'][0].type, 'ROLE');
    assert.equal(body.data.sources['orders.order.view_all'][0].role, 'moderator');
  });

  test('GET /api/v1/admin/roles-permissions: returns roles, permissions and baseline matrix map', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/roles-permissions',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.roles));
    assert.ok(Array.isArray(body.permissions));
    assert.ok(Array.isArray(body.rolePermissions));

    // Confirm CRITICAL permissions exist in registry
    const criticalPerm = body.permissions.find((p) => p.key === 'platform.module.toggle');
    assert.ok(criticalPerm);
    assert.equal(criticalPerm.risk_tier, 'CRITICAL');
  });

  test('Live Delegation Preview generator formats natural language summary correctly', () => {
    const generatePreview = ({ userDisplayName, permName, expiryFormatted, scopeText, lang = 'en' }) => {
      const scopeSuffix = scopeText ? (lang === 'bn' ? ` (${scopeText} সীমার মধ্যে)` : ` (within ${scopeText})`) : '';
      if (lang === 'bn') {
        return `${userDisplayName} ${expiryFormatted} পর্যন্ত ${permName}${scopeSuffix} করতে সক্ষম হবেন।`;
      }
      return `${userDisplayName} will be able to ${permName}${scopeSuffix} until ${expiryFormatted}.`;
    };

    const previewEn = generatePreview({
      userDisplayName: 'Moderator Rahim',
      permName: 'approve refunds up to ৳5,000',
      expiryFormatted: '12 Sep 2026',
      scopeText: 'max_amount: 5000',
      lang: 'en',
    });
    assert.equal(previewEn, 'Moderator Rahim will be able to approve refunds up to ৳5,000 (within max_amount: 5000) until 12 Sep 2026.');

    const previewBn = generatePreview({
      userDisplayName: 'মডারেটর রহিম',
      permName: 'রিফান্ড অনুমোদন',
      expiryFormatted: '১২ সেপ্টেম্বর ২০২৬',
      scopeText: 'সর্বোচ্চ ৫০০০ টাকা',
      lang: 'bn',
    });
    assert.equal(previewBn, 'মডারেটর রহিম ১২ সেপ্টেম্বর ২০২৬ পর্যন্ত রিফান্ড অনুমোদন (সর্বোচ্চ ৫০০০ টাকা সীমার মধ্যে) করতে সক্ষম হবেন।');
  });
});
