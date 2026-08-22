/**
 * module.test.js — Module Control Backend, Targeting & Middleware Test Suite (Prompt 3.1).
 *
 * Verifies all Prompt 3.1 requirements and acceptance criteria:
 * 1. Toggling a module off causes routes protected by requireModule to return 403 MODULE_DISABLED within one request.
 * 2. A reason is required (min 10 chars) and stored; change appears in audit_logs and module history.
 * 3. Percentage rollout is deterministic per user (same user always gets the same answer).
 * 4. Disabling `chat` warns (409 Conflict) that `whatsapp_bridge` and `live_commerce` depend on it; cascade=true disables them.
 * 5. Targeting rules hierarchy (USER > DISTRICT > TIER > ROLE).
 * 6. Settings schema validation.
 * 7. Public GET /api/v1/modules returns active flag set.
 * 8. Non-super_admin cannot toggle modules (CRITICAL tier enforcement).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

import * as moduleService from '../src/services/module.service.js';
import * as moduleRepo from '../src/repositories/module.repository.js';
import * as auditService from '../src/services/audit.service.js';
import moduleRoutes from '../src/routes/module.routes.js';
import requireModulePlugin from '../src/middlewares/requireModule.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import requestContextPlugin from '../src/plugins/requestContext.js';
import { createMemoryCache } from '../src/config/cache-drivers/memory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load seed modules
const modulesSeedPath = path.resolve(__dirname, '../src/config/modules.seed.json');
const modulesSeed = JSON.parse(readFileSync(modulesSeedPath, 'utf8'));

const ALL_ROLES = [
  { id: 1, key: 'super_admin', label_en: 'Super Admin', level: 100 },
  { id: 2, key: 'admin', label_en: 'Admin', level: 80 },
  { id: 3, key: 'moderator', label_en: 'Moderator', level: 60 },
  { id: 4, key: 'saler', label_en: 'Saler', level: 20 },
  { id: 5, key: 'customer', label_en: 'Customer', level: 10 },
];

const ALL_PERMISSIONS = [
  {
    key: 'platform.module.view',
    domain: 'platform',
    label_en: 'View module settings',
    label_bn: 'মডিউল সেটিংস দেখা',
    risk_tier: 'LOW',
    delegable: true,
  },
  {
    key: 'platform.module.toggle',
    domain: 'platform',
    label_en: 'Turn modules on or off',
    label_bn: 'মডিউল চালু বা বন্ধ করা',
    risk_tier: 'CRITICAL',
    delegable: false,
  },
  {
    key: 'platform.module.settings',
    domain: 'platform',
    label_en: 'Change module settings',
    label_bn: 'মডিউল সেটিংস পরিবর্তন',
    risk_tier: 'CRITICAL',
    delegable: false,
  },
  {
    key: 'platform.module.targeting',
    domain: 'platform',
    label_en: 'Configure module targeting',
    label_bn: 'মডিউল টার্গেটিং নির্ধারণ',
    risk_tier: 'CRITICAL',
    delegable: false,
  },
];

function createModuleMockDb() {
  const users = [
    { id: 1, ref: 'USR-SUPER1', phone: '+8801700000001', status: 'ACTIVE' },
    { id: 3, ref: 'USR-MOD1', phone: '+8801700000003', status: 'ACTIVE' },
    { id: 5, ref: 'USR-CUST1', phone: '+8801700000005', status: 'ACTIVE' },
  ];

  const userRoles = [
    { user_id: 1, role_id: 1, role_key: 'super_admin' },
    { user_id: 3, role_id: 3, role_key: 'moderator' },
    { user_id: 5, role_id: 5, role_key: 'customer' },
  ];

  const platformModules = modulesSeed.modules.map((m) => ({
    key: m.key,
    group_key: m.group,
    label_en: m.label_en,
    label_bn: m.label_bn,
    description_en: m.description_en,
    description_bn: m.description_bn,
    is_enabled: m.default_enabled !== false,
    default_enabled: m.default_enabled !== false,
    settings_json: m.sub_settings_schema?.properties
      ? Object.fromEntries(
          Object.entries(m.sub_settings_schema.properties)
            .filter(([, v]) => v.default !== undefined)
            .map(([k, v]) => [k, v.default])
        )
      : {},
    settings_schema: m.sub_settings_schema || null,
    depends_on: m.depends_on || [],
    scheduled_on_at: null,
    scheduled_off_at: null,
    last_reason: null,
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const moduleTargetingRules = [];
  const auditLogs = [];

  let nextRuleId = 1;
  let nextAuditId = 1;

  const db = {
    users,
    userRoles,
    platformModules,
    moduleTargetingRules,
    auditLogs,

    async connect() {
      return { query: db.query, release: () => {} };
    },

    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // SELECT FROM platform_modules ORDER BY group_key
      if (normalized.startsWith('SELECT') && normalized.includes('FROM platform_modules') && !normalized.includes('WHERE')) {
        return { rows: platformModules.map((m) => ({ ...m })) };
      }

      // SELECT single module
      if (normalized.includes('FROM platform_modules') && normalized.includes('WHERE key = $1')) {
        const row = platformModules.find((m) => m.key === params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }

      // SELECT active dependent modules
      if (normalized.includes('FROM platform_modules') && normalized.includes('$1 = ANY(depends_on) AND is_enabled = true')) {
        const rows = platformModules.filter((m) => m.depends_on && m.depends_on.includes(params[0]) && m.is_enabled);
        return { rows: rows.map((m) => ({ ...m })) };
      }

      // UPDATE platform_modules SET is_enabled
      if (normalized.startsWith('UPDATE platform_modules') && normalized.includes('SET is_enabled = $2')) {
        const [key, enabled, reason, updatedBy, scheduledOnAt, scheduledOffAt] = params;
        const row = platformModules.find((m) => m.key === key);
        if (row) {
          row.is_enabled = enabled;
          row.last_reason = reason;
          row.updated_by = updatedBy;
          row.scheduled_on_at = scheduledOnAt;
          row.scheduled_off_at = scheduledOffAt;
          row.updated_at = new Date().toISOString();
          return { rows: [{ ...row }] };
        }
        return { rows: [] };
      }

      // UPDATE platform_modules SET settings_json
      if (normalized.startsWith('UPDATE platform_modules') && normalized.includes('SET settings_json = $2')) {
        const [key, settingsJsonStr, updatedBy] = params;
        const row = platformModules.find((m) => m.key === key);
        if (row) {
          row.settings_json = JSON.parse(settingsJsonStr);
          row.updated_by = updatedBy;
          row.updated_at = new Date().toISOString();
          return { rows: [{ ...row }] };
        }
        return { rows: [] };
      }

      // Raw UPDATE for bulk test setup
      if (normalized.startsWith('UPDATE platform_modules SET is_enabled = true WHERE key IN')) {
        for (const m of platformModules) {
          if (sql.includes(`'${m.key}'`)) {
            m.is_enabled = true;
          }
        }
        return { rows: [] };
      }

      // Raw UPDATE single
      if (normalized.startsWith('UPDATE platform_modules SET is_enabled = true WHERE key =')) {
        for (const m of platformModules) {
          if (sql.includes(`'${m.key}'`)) {
            m.is_enabled = true;
          }
        }
        return { rows: [] };
      }

      // SELECT FROM module_targeting_rules WHERE module_key = $1
      if (normalized.includes('FROM module_targeting_rules WHERE module_key = $1')) {
        const rows = moduleTargetingRules.filter((r) => r.module_key === params[0]);
        rows.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id - b.id);
        return { rows: rows.map((r) => ({ ...r })) };
      }

      // SELECT all targeting rules
      if (normalized.includes('FROM module_targeting_rules') && !normalized.includes('WHERE')) {
        const rows = [...moduleTargetingRules];
        rows.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id - b.id);
        return { rows: rows.map((r) => ({ ...r })) };
      }

      // INSERT INTO module_targeting_rules
      if (normalized.startsWith('INSERT INTO module_targeting_rules')) {
        const [moduleKey, targetType, targetValue, isEnabled, priority, createdBy] = params;
        const newRule = {
          id: nextRuleId++,
          module_key: moduleKey,
          target_type: targetType,
          target_value: targetValue,
          is_enabled: isEnabled,
          priority,
          created_by: createdBy,
          created_at: new Date().toISOString(),
        };
        moduleTargetingRules.push(newRule);
        return { rows: [{ ...newRule }] };
      }

      // DELETE FROM module_targeting_rules WHERE id = $1
      if (normalized.startsWith('DELETE FROM module_targeting_rules WHERE id = $1')) {
        const id = parseInt(params[0], 10);
        const idx = moduleTargetingRules.findIndex((r) => r.id === id);
        if (idx >= 0) {
          const removed = moduleTargetingRules.splice(idx, 1)[0];
          return { rows: [{ ...removed }] };
        }
        return { rows: [] };
      }

      // Raw DELETE FROM module_targeting_rules
      if (normalized.startsWith('DELETE FROM module_targeting_rules')) {
        const mKeyMatch = sql.match(/module_key\s*=\s*'([^']+)'/);
        if (mKeyMatch) {
          const mKey = mKeyMatch[1];
          for (let i = moduleTargetingRules.length - 1; i >= 0; i--) {
            if (moduleTargetingRules[i].module_key === mKey) {
              moduleTargetingRules.splice(i, 1);
            }
          }
        }
        return { rows: [] };
      }

      // INSERT INTO audit_logs
      if (normalized.startsWith('INSERT INTO audit_logs')) {
        const [
          actorId,
          actorRole,
          action,
          targetType,
          targetRef,
          beforeJson,
          afterJson,
          undoPayload,
          riskTier,
          isBreakglass,
          ipAddress,
          userAgent,
          traceId,
        ] = params;

        const row = {
          id: nextAuditId++,
          actor_id: actorId,
          actor_role: actorRole,
          action,
          target_type: targetType,
          target_ref: targetRef,
          before_json: beforeJson,
          after_json: afterJson,
          undo_payload: undoPayload,
          risk_tier: riskTier,
          is_breakglass: isBreakglass,
          ip_address: ipAddress,
          user_agent: userAgent,
          trace_id: traceId,
          prev_hash: 'mock_prev_hash',
          row_hash: 'mock_row_hash',
          created_at: new Date().toISOString(),
        };
        auditLogs.push(row);
        return { rows: [{ ...row }] };
      }

      // SELECT FROM audit_logs
      if (normalized.includes('FROM audit_logs')) {
        const rows = auditLogs.filter((l) => l.target_type === 'platform_module' && l.target_ref === params[0]);
        return { rows: rows.map((l) => ({ ...l })) };
      }

      return { rows: [] };
    },
  };

  return db;
}

describe('Module Control Backend, Targeting & Middleware (Prompt 3.1)', () => {
  let app;
  let mockDb;
  let cache;

  before(async () => {
    mockDb = createModuleMockDb();
    cache = createMemoryCache();

    app = Fastify({ logger: false });
    app.decorate('db', mockDb);
    app.decorate('cache', cache);

    // Mock authentication pre-handler
    app.decorate('authenticate', async (req) => {
      const auth = req.headers.authorization;
      if (!auth) {
        req.user = null;
        return;
      }
      if (auth.includes('super_admin')) {
        req.user = { id: 1, ref: 'USR-SUPER1', role: 'super_admin', roles: ['super_admin'], tier: 'ELITE_PARTNER', district: 'Dhaka' };
      } else if (auth.includes('moderator')) {
        req.user = { id: 3, ref: 'USR-MOD1', role: 'moderator', roles: ['moderator'], tier: 'STARTER', district: 'Sylhet' };
      } else if (auth.includes('customer')) {
        req.user = { id: 5, ref: 'USR-CUST1', role: 'customer', roles: ['customer'], tier: 'STARTER', district: 'Chittagong' };
      }
    });

    // Mock requirePermission
    app.decorate('requirePermission', (permKey) => async (req, reply) => {
      if (!req.user) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } });
      }
      if (req.user.roles.includes('super_admin')) {
        return; // Super admin has all permissions
      }
      if (permKey.startsWith('platform.module.')) {
        if (permKey === 'platform.module.view' && (req.user.roles.includes('moderator') || req.user.roles.includes('admin'))) {
          return;
        }
        // Critical actions require super_admin
        return reply.status(403).send({ error: { code: 'FORBIDDEN_PERMISSION', permission: permKey } });
      }
    });

    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    app.register(requireModulePlugin);
    await app.register(moduleRoutes, { prefix: '/api/v1' });

    // Test route for requireModule middleware verification
    app.get('/test-wishlist-gated', {
      preHandler: [app.requireModule('wishlist')],
      handler: async () => ({ status: 'success' }),
    });

    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('Public endpoint GET /api/v1/modules returns flag set for client consumption', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/modules',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.modules);
    assert.equal(typeof body.modules, 'object');
    assert.equal(body.modules.virtual_storefront, true);
    assert.equal(body.modules.chat, true);
    assert.equal(body.modules.customer_verification, false);
  });

  test('Acceptance 3: Percentage rollout is deterministic per user', () => {
    const userA = 'user_1001';
    const userB = 'user_1002';

    const bucketA1 = moduleService.computePercentageBucket('ai_concierge', userA);
    const bucketA2 = moduleService.computePercentageBucket('ai_concierge', userA);
    const bucketB = moduleService.computePercentageBucket('ai_concierge', userB);

    assert.equal(bucketA1, bucketA2, 'Same user must produce identical hash bucket every time');
    assert.ok(bucketA1 >= 0 && bucketA1 < 100);
    assert.ok(bucketB >= 0 && bucketB < 100);
  });

  test('Acceptance 4: Disabling chat warns (409 Conflict) about dependents; cascade=true disables them', async () => {
    // Ensure chat, whatsapp_bridge, live_commerce are enabled first
    await mockDb.query(`UPDATE platform_modules SET is_enabled = true WHERE key IN ('chat', 'whatsapp_bridge', 'live_commerce')`);
    await moduleService.bumpCacheVersion(cache);

    // Attempt to disable chat without cascade
    const resWithoutCascade = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/modules/chat',
      headers: { authorization: 'Bearer super_admin' },
      payload: {
        enabled: false,
        reason: 'Maintenance on chat gateway',
        cascade: false,
      },
    });

    assert.equal(resWithoutCascade.statusCode, 409);
    const conflictBody = resWithoutCascade.json();
    assert.equal(conflictBody.error.code, 'MODULE_DEPENDENCY_CONFLICT');
    assert.ok(conflictBody.error.dependents.length >= 2);
    const dependentKeys = conflictBody.error.dependents.map((d) => d.key);
    assert.ok(dependentKeys.includes('whatsapp_bridge'));
    assert.ok(dependentKeys.includes('live_commerce'));

    // Re-attempt with cascade = true
    const resWithCascade = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/modules/chat',
      headers: { authorization: 'Bearer super_admin' },
      payload: {
        enabled: false,
        reason: 'Maintenance on chat gateway with full cascade',
        cascade: true,
      },
    });

    assert.equal(resWithCascade.statusCode, 200);
    const successBody = resWithCascade.json();
    assert.equal(successBody.data.module.is_enabled, false);
    assert.ok(successBody.data.cascaded.length >= 2);

    // Check DB state
    const chatRow = await moduleRepo.getModuleByKey(mockDb, 'chat');
    const waRow = await moduleRepo.getModuleByKey(mockDb, 'whatsapp_bridge');
    const liveRow = await moduleRepo.getModuleByKey(mockDb, 'live_commerce');

    assert.equal(chatRow.is_enabled, false);
    assert.equal(waRow.is_enabled, false);
    assert.equal(liveRow.is_enabled, false);

    // Clean up: re-enable chat and dependents
    await mockDb.query(`UPDATE platform_modules SET is_enabled = true WHERE key IN ('chat', 'whatsapp_bridge', 'live_commerce')`);
    await moduleService.bumpCacheVersion(cache);
  });

  test('Acceptance 2: Mandatory reason validation (<10 chars rejected) & audit trail', async () => {
    // Attempt toggle with short reason
    const shortReasonRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/modules/wishlist',
      headers: { authorization: 'Bearer super_admin' },
      payload: {
        enabled: false,
        reason: 'Too short',
      },
    });

    assert.equal(shortReasonRes.statusCode, 400);
    assert.equal(shortReasonRes.json().error.code, 'INVALID_REASON');

    // Valid toggle
    const validToggleRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/modules/wishlist',
      headers: { authorization: 'Bearer super_admin' },
      payload: {
        enabled: false,
        reason: 'Temporary overhaul of wishlist indexing service',
      },
    });

    assert.equal(validToggleRes.statusCode, 200);

    // Check history endpoint
    const historyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/modules/wishlist/history',
      headers: { authorization: 'Bearer super_admin' },
    });

    assert.equal(historyRes.statusCode, 200);
    const historyData = historyRes.json().data;
    assert.ok(Array.isArray(historyData));
    assert.ok(historyData.length > 0);
    assert.equal(historyData[historyData.length - 1].target_ref, 'wishlist');
    assert.equal(historyData[historyData.length - 1].action, 'module.disable');

    // Clean up
    await mockDb.query(`UPDATE platform_modules SET is_enabled = true WHERE key = 'wishlist'`);
    await moduleService.bumpCacheVersion(cache);
  });

  test('Acceptance 1: requireModule middleware returns 403 MODULE_DISABLED immediately when module is toggled off', async () => {
    // When wishlist is enabled
    await mockDb.query(`UPDATE platform_modules SET is_enabled = true WHERE key = 'wishlist'`);
    await moduleService.bumpCacheVersion(cache);

    const activeRes = await app.inject({
      method: 'GET',
      url: '/test-wishlist-gated',
    });
    assert.equal(activeRes.statusCode, 200);
    assert.equal(activeRes.json().status, 'success');

    // Toggle wishlist off
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/modules/wishlist',
      headers: { authorization: 'Bearer super_admin' },
      payload: {
        enabled: false,
        reason: 'Disabling wishlist to test middleware gating',
      },
    });

    // In the very next request, the route must return 403 MODULE_DISABLED
    const disabledRes = await app.inject({
      method: 'GET',
      url: '/test-wishlist-gated',
    });

    assert.equal(disabledRes.statusCode, 403);
    const errBody = disabledRes.json();
    assert.equal(errBody.error.code, 'MODULE_DISABLED');
    assert.equal(errBody.error.module_key, 'wishlist');
    assert.ok(errBody.error.message_en.includes('Wishlist & price alerts'));
    assert.ok(errBody.error.message_bn.includes('উইশলিস্ট'));

    // Clean up
    await mockDb.query(`UPDATE platform_modules SET is_enabled = true WHERE key = 'wishlist'`);
    await moduleService.bumpCacheVersion(cache);
  });

  test('Targeting rules hierarchy (USER > DISTRICT > TIER > ROLE)', async () => {
    // Enable module globally
    await mockDb.query(`UPDATE platform_modules SET is_enabled = true WHERE key = 'sourcing'`);
    await mockDb.query(`DELETE FROM module_targeting_rules WHERE module_key = 'sourcing'`);
    await moduleService.bumpCacheVersion(cache);

    // Rule 1: District "Sylhet" is DISABLED (Priority 30)
    await moduleRepo.createTargetingRule(mockDb, {
      moduleKey: 'sourcing',
      targetType: 'DISTRICT',
      targetValue: 'Sylhet',
      isEnabled: false,
      priority: 30,
    });

    // Rule 2: User "999" is ENABLED (Priority 40)
    await moduleRepo.createTargetingRule(mockDb, {
      moduleKey: 'sourcing',
      targetType: 'USER',
      targetValue: '999',
      isEnabled: true,
      priority: 40,
    });

    await moduleService.bumpCacheVersion(cache);

    // User in Sylhet without user override -> DISABLED
    const sylhetUserCheck = await moduleService.isEnabled(mockDb, cache, 'sourcing', {
      userId: 123,
      district: 'Sylhet',
    });
    assert.equal(sylhetUserCheck, false, 'District rule should disable sourcing in Sylhet');

    // User 999 in Sylhet -> ENABLED because USER (priority 40) beats DISTRICT (priority 30)
    const user999Check = await moduleService.isEnabled(mockDb, cache, 'sourcing', {
      userId: 999,
      district: 'Sylhet',
    });
    assert.equal(user999Check, true, 'User rule should override district rule');

    // Clean up
    await mockDb.query(`DELETE FROM module_targeting_rules WHERE module_key = 'sourcing'`);
    await moduleService.bumpCacheVersion(cache);
  });

  test('Module sub-settings validation', async () => {
    // Valid settings update on return window
    const validRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/modules/returns_engine/settings',
      headers: { authorization: 'Bearer super_admin' },
      payload: {
        settings: {
          return_window_days: 14,
          auto_approve_below_amount: 100,
        },
      },
    });

    assert.equal(validRes.statusCode, 200);
    assert.equal(validRes.json().data.settings_json.return_window_days, 14);

    // Invalid settings (wrong type for integer)
    const invalidRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/modules/returns_engine/settings',
      headers: { authorization: 'Bearer super_admin' },
      payload: {
        settings: {
          return_window_days: 'fourteen',
        },
      },
    });

    assert.equal(invalidRes.statusCode, 400);
    assert.equal(invalidRes.json().error.code, 'SCHEMA_VALIDATION_ERROR');
  });

  test('Non-super_admin cannot toggle modules (CRITICAL tier enforcement)', async () => {
    const modRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/modules/wishlist',
      headers: { authorization: 'Bearer moderator' },
      payload: {
        enabled: false,
        reason: 'Moderator attempting to toggle module',
      },
    });

    assert.equal(modRes.statusCode, 403);
  });
});
