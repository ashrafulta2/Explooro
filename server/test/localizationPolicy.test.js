/**
 * localizationPolicy.test.js — Language & Default Locale governance.
 *
 * Covers the invariants the feature actually claims:
 *  1. The four validation rules, including the one that matters most — a default that is not
 *     itself enabled is refused, because it would strand every new visitor on a locale the
 *     switcher will not offer.
 *  2. A successful write lands in platform_settings as three rows in ONE transaction.
 *  3. A successful write leaves an audit_logs row carrying both before and after.
 *  4. A rejected write mutates nothing.
 *  5. The reason is mandatory and at least 10 characters, enforced in the service and not only
 *     by the route schema.
 *  6. The public endpoint answers for a signed-out visitor and degrades to the shipped default
 *     rather than throwing when the table is unreadable.
 *  7. The route guards are the two keys the catalog declares, and the update key is delegable —
 *     the whole point of the feature is that a Super Admin can assign it.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import localizationRoutes from '../src/routes/localization.routes.js';
import * as localizationService from '../src/services/localization.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const SEEDED = {
  'localization.default_locale': '"en"',
  'localization.enabled_locales': '["en","bn"]',
  'localization.allow_user_override': 'true',
};

/**
 * A platform_settings + audit_logs stand-in. Deliberately records the BEGIN/COMMIT it is handed
 * and whether a FOR UPDATE lock was taken, since "all three rows move together" is one of the
 * properties under test and it is invisible from the returned policy alone.
 */
function createMockDb({ failReads = false } = {}) {
  const settings = new Map(
    Object.entries(SEEDED).map(([key, value]) => [
      key,
      { key, value_json: value, value_type: 'STRING', group_key: 'localization', updated_by: null, updated_at: null },
    ])
  );
  const auditLog = [];
  const txnOps = [];
  let lockTaken = 0;

  const db = {
    settings,
    auditLog,
    txnOps,
    get lockTaken() {
      return lockTaken;
    },
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();

      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        txnOps.push(q);
        return { rows: [] };
      }

      if (q.startsWith('SELECT key, value_json FROM platform_settings') && q.includes('FOR UPDATE')) {
        lockTaken += 1;
        return { rows: [...settings.values()].map((r) => ({ key: r.key, value_json: r.value_json })) };
      }

      if (q.startsWith('SELECT key, value_json, value_type') && q.includes('WHERE group_key = $1')) {
        if (failReads) throw new Error('relation "platform_settings" does not exist');
        const rows = [...settings.values()]
          .filter((r) => r.group_key === params[0])
          .sort((a, b) => a.key.localeCompare(b.key));
        return { rows };
      }

      if (q.startsWith('INSERT INTO platform_settings')) {
        const [key, valueJson, valueType, labelEn, labelBn, groupKey, isSensitive, updatedBy] = params;
        const row = {
          key,
          value_json: valueJson,
          value_type: valueType,
          label_en: labelEn,
          label_bn: labelBn,
          group_key: groupKey,
          is_sensitive: isSensitive,
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
        };
        settings.set(key, row);
        return { rows: [row] };
      }

      if (q.startsWith('INSERT INTO audit_logs')) {
        const row = {
          id: auditLog.length + 1,
          actor_id: params[0],
          actor_role: params[1],
          action: params[2],
          target_type: params[3],
          target_ref: params[4],
          before_json: params[5] ? JSON.parse(params[5]) : null,
          after_json: params[6] ? JSON.parse(params[6]) : null,
          risk_tier: params[8],
        };
        auditLog.push(row);
        return { rows: [row] };
      }

      // role_permissions / user_permission_overrides for the "who can change this" roster.
      if (q.startsWith('SELECT r.key, r.label_en')) {
        return { rows: [{ key: 'super_admin', label_en: 'Super Admin', label_bn: 'সুপার অ্যাডমিন' }] };
      }
      if (q.startsWith('SELECT o.id, o.user_id')) {
        return { rows: [] };
      }
      if (q.startsWith('SELECT al.*')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  // withTransaction-style pooling: the service takes a dedicated client when one is available.
  db.connect = async () => ({
    query: db.query,
    release() {},
  });

  return db;
}

function createCache() {
  const store = new Map();
  return {
    store,
    async get(k) {
      return store.get(k) ?? null;
    },
    async set(k, v) {
      store.set(k, v);
    },
    async del(k) {
      store.delete(k);
    },
  };
}

describe('Language & Default Locale governance', () => {
  describe('validatePolicy — the rules, with no database in the way', () => {
    test('accepts a well-formed policy and normalises the locale list', () => {
      const out = localizationService.validatePolicy({
        default_locale: 'bn',
        enabled_locales: ['bn', 'en', 'bn'],
        allow_user_override: false,
      });
      assert.deepEqual(out, {
        default_locale: 'bn',
        enabled_locales: ['bn', 'en'],
        allow_user_override: false,
      });
    });

    test('refuses a default the platform does not enable', () => {
      assert.throws(
        () =>
          localizationService.validatePolicy({
            default_locale: 'bn',
            enabled_locales: ['en'],
            allow_user_override: true,
          }),
        (err) => {
          assert.equal(err.code, 'VALIDATION_ERROR');
          assert.match(err.messageEn ?? err.message, /must also be enabled/i);
          assert.ok(err.messageBn, 'validation errors carry a Bengali message too');
          return true;
        }
      );
    });

    test('refuses a locale this build ships no dictionary for', () => {
      assert.throws(
        () =>
          localizationService.validatePolicy({
            default_locale: 'fr',
            enabled_locales: ['en', 'fr'],
            allow_user_override: true,
          }),
        (err) => err.code === 'VALIDATION_ERROR'
      );
    });

    test('refuses an empty locale list', () => {
      assert.throws(
        () =>
          localizationService.validatePolicy({
            default_locale: 'en',
            enabled_locales: [],
            allow_user_override: true,
          }),
        (err) => err.code === 'VALIDATION_ERROR'
      );
    });

    test('SUPPORTED_LOCALES matches the client engine and the users.locale constraint', () => {
      const i18nSrc = fs.readFileSync(path.join(repoRoot, 'client/src/services/i18n.js'), 'utf8');
      const match = i18nSrc.match(/const SUPPORTED = \[([^\]]+)\]/);
      assert.ok(match, 'client i18n.js declares a SUPPORTED array');
      const clientLocales = match[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean)
        .sort();
      assert.deepEqual(
        [...localizationService.SUPPORTED_LOCALES].sort(),
        clientLocales,
        'a locale the server allows but the client cannot render is a broken default'
      );

      const identitySql = fs.readFileSync(
        path.join(repoRoot, 'server/src/db/migrations/001_identity.sql'),
        'utf8'
      );
      const check = identitySql.match(/locale\s+TEXT NOT NULL DEFAULT '\w+' CHECK \(locale IN \(([^)]+)\)\)/);
      assert.ok(check, '001_identity.sql constrains users.locale');
      const dbLocales = check[1]
        .split(',')
        .map((s) => s.trim().replace(/'/g, ''))
        .sort();
      assert.deepEqual([...localizationService.SUPPORTED_LOCALES].sort(), dbLocales);
    });
  });

  describe('updatePolicy — persistence, transaction and audit', () => {
    test('writes all three settings rows and audits before/after', async () => {
      const db = createMockDb();
      const cache = createCache();
      const auditService = await import('../src/services/audit.service.js');

      await cache.set('localization:policy', JSON.stringify({ default_locale: 'en' }));

      const after = await localizationService.updatePolicy(db, cache, auditService, {
        policy: { default_locale: 'bn', enabled_locales: ['bn', 'en'], allow_user_override: false },
        reason: 'Switching the storefront to Bangla-first for the Eid campaign.',
        userId: 7,
        actorRole: 'super_admin',
      });

      assert.equal(after.default_locale, 'bn');
      assert.deepEqual(after.enabled_locales, ['bn', 'en']);
      assert.equal(after.allow_user_override, false);

      assert.equal(JSON.parse(db.settings.get('localization.default_locale').value_json), 'bn');
      assert.deepEqual(JSON.parse(db.settings.get('localization.enabled_locales').value_json), ['bn', 'en']);
      assert.equal(JSON.parse(db.settings.get('localization.allow_user_override').value_json), false);

      assert.deepEqual(db.txnOps, ['BEGIN', 'COMMIT'], 'the three rows move as one transaction');
      assert.ok(db.lockTaken >= 1, 'the settings group is locked before the read-modify-write');

      assert.equal(db.auditLog.length, 1, 'exactly one audit row per policy change');
      const entry = db.auditLog[0];
      assert.equal(entry.action, 'platform.localization.update');
      assert.equal(entry.actor_id, 7);
      assert.equal(entry.risk_tier, 'MEDIUM');
      assert.equal(entry.before_json.default_locale, 'en', 'audit records what it was');
      assert.equal(entry.after_json.default_locale, 'bn', 'audit records what it became');
      assert.match(entry.after_json.meta.reason, /Eid campaign/);

      assert.equal(
        await cache.get('localization:policy'),
        null,
        'the cached policy is dropped so the next read is not stale'
      );
    });

    test('a rejected policy mutates nothing and writes no audit row', async () => {
      const db = createMockDb();
      await assert.rejects(
        localizationService.updatePolicy(db, createCache(), null, {
          policy: { default_locale: 'bn', enabled_locales: ['en'], allow_user_override: true },
          reason: 'This reason is long enough to pass the length check.',
          userId: 7,
        }),
        (err) => err.code === 'VALIDATION_ERROR'
      );
      assert.equal(JSON.parse(db.settings.get('localization.default_locale').value_json), 'en');
      assert.equal(db.auditLog.length, 0);
      assert.deepEqual(db.txnOps, [], 'validation runs before the transaction is opened');
    });

    test('a reason under 10 characters is refused by the service, not only by the route schema', async () => {
      const db = createMockDb();
      await assert.rejects(
        localizationService.updatePolicy(db, createCache(), null, {
          policy: { default_locale: 'bn', enabled_locales: ['bn', 'en'], allow_user_override: true },
          reason: 'because',
          userId: 7,
        }),
        (err) => err.code === 'VALIDATION_ERROR' && /10 characters/.test(err.messageEn ?? err.message)
      );
      assert.equal(JSON.parse(db.settings.get('localization.default_locale').value_json), 'en');
      assert.equal(db.auditLog.length, 0);
    });
  });

  describe('getPolicy — reads and degradation', () => {
    test('reads the seeded policy', async () => {
      const policy = await localizationService.getPolicy(createMockDb(), null);
      assert.equal(policy.default_locale, 'en');
      assert.deepEqual([...policy.enabled_locales].sort(), ['bn', 'en']);
      assert.equal(policy.allow_user_override, true);
    });

    test('falls back to the shipped default when the table cannot be read', async () => {
      const policy = await localizationService.getPolicy(createMockDb({ failReads: true }), null);
      assert.equal(policy.default_locale, localizationService.FALLBACK_LOCALE);
      assert.deepEqual([...policy.enabled_locales].sort(), [...localizationService.SUPPORTED_LOCALES].sort());
    });
  });

  describe('HTTP surface', () => {
    let app;
    let db;

    before(async () => {
      db = createMockDb();
      const cache = createCache();

      app = Fastify({ logger: false });
      app.decorate('db', db);
      app.decorate('cache', cache);
      app.decorate('authenticate', async (req) => {
        req.user = { id: 9, ref: 'USR-ADMIN', roles: ['super_admin'], role: 'super_admin' };
      });
      app.decorate('requirePermission', (permKey) => async (req, reply) => {
        req.requestedPermission = permKey;
        if (!req.user?.roles?.includes('super_admin')) {
          return reply.status(403).send({ error: { code: 'PERMISSION_DENIED' } });
        }
      });

      app.register(requestContextPlugin);
      app.register(errorHandlerPlugin);
      await app.register(localizationRoutes, { prefix: '/api/v1' });
      await app.ready();
    });

    after(async () => {
      await app.close();
    });

    test('the public policy endpoint needs no authentication', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/localization/policy' });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.ok(body.policy.default_locale);
      assert.ok(Array.isArray(body.policy.enabled_locales));
      assert.equal(typeof body.policy.allow_user_override, 'boolean');
      assert.deepEqual(body.supported_locales, localizationService.SUPPORTED_LOCALES);
    });

    test('the admin read returns the policy, the authority roster and can_update', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/platform/localization' });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.ok(body.policy);
      assert.ok(Array.isArray(body.authority.roles));
      assert.ok(body.authority.roles.some((r) => r.key === 'super_admin'));
      assert.equal(typeof body.can_update, 'boolean');
    });

    test('a PUT without a reason is rejected by the route schema', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/platform/localization',
        payload: { default_locale: 'bn', enabled_locales: ['bn', 'en'], allow_user_override: true },
      });
      assert.equal(res.statusCode, 400);
    });

    test('a valid PUT applies the policy', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/platform/localization',
        payload: {
          default_locale: 'bn',
          enabled_locales: ['bn', 'en'],
          allow_user_override: true,
          reason: 'Bangla-first rollout approved by the product council.',
        },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().policy.default_locale, 'bn');
      assert.ok(db.auditLog.some((e) => e.action === 'platform.localization.update'));
    });
  });

  describe('Permission catalog contract', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'docs/permission-catalog.json'), 'utf8')
    );
    const byKey = new Map(catalog.permissions.map((p) => [p.key, p]));

    test('both keys exist in the catalog', () => {
      assert.ok(byKey.has('platform.localization.view'));
      assert.ok(byKey.has('platform.localization.update'));
    });

    test('the update key is delegable — assignability is the feature', () => {
      const perm = byKey.get('platform.localization.update');
      assert.equal(perm.delegable, true);
      assert.notEqual(
        perm.risk_tier,
        'CRITICAL',
        'CRITICAL implies delegable:false, which would make "or an assigned user" impossible'
      );
      assert.equal(perm.risk_tier, 'MEDIUM', 'MEDIUM is the grantable-and-immediate tier');
      assert.deepEqual(perm.default_roles, ['super_admin']);
      assert.ok(perm.plain_en && perm.plain_bn, 'a requestable permission needs plain language');
    });

    test('the view key is held by the roles that see the page', () => {
      const perm = byKey.get('platform.localization.view');
      assert.equal(perm.risk_tier, 'LOW');
      assert.ok(perm.default_roles.includes('super_admin'));
      assert.ok(perm.default_roles.includes('admin'));
    });

    test('the routes are guarded by exactly those two keys', () => {
      const src = fs.readFileSync(
        path.join(repoRoot, 'server/src/routes/localization.routes.js'),
        'utf8'
      );
      assert.match(src, /reqPerm\('platform\.localization\.view'\)/);
      assert.match(src, /reqPerm\('platform\.localization\.update'\)/);
    });

    test('the i18n module no longer declares a competing default_locale', () => {
      const modules = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'server/src/config/modules.seed.json'), 'utf8')
      );
      const i18n = modules.modules.find((m) => m.key === 'i18n');
      assert.ok(i18n, 'the i18n module still exists');
      assert.ok(
        !i18n.sub_settings_schema?.properties?.default_locale,
        'two writers for one value is the ambiguity migration 043 removes'
      );
    });
  });
});
