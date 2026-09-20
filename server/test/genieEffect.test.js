/**
 * genieEffect.test.js — popup genie-effect governance (/admin/platform/genie).
 *
 * Covers the invariants the feature actually claims:
 *  1. The validation rules: switch is a boolean, duration a whole number inside the bounds,
 *     quality one of the presets.
 *  2. The server's bounds and presets are the SAME ones the client engine clamps to — otherwise the
 *     page would offer a value the engine silently changes.
 *  3. A successful write lands as three platform_settings rows in ONE transaction, takes the group
 *     lock, and leaves a single audit row carrying before and after.
 *  4. A rejected write mutates nothing and audits nothing.
 *  5. The reason is mandatory (10+ chars) in the service, not only the route schema.
 *  6. The public endpoint answers signed-out and degrades to the shipped default when the table is
 *     unreadable.
 *  7. The route guards are the two catalog keys, and the update key is delegable.
 *  8. The migration seeds exactly the shipped defaults, so a fresh install matches DEFAULT_POLICY.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import genieRoutes from '../src/routes/genie.routes.js';
import * as genieService from '../src/services/genie.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const SEEDED = {
  'genie.enabled': 'true',
  'genie.duration_ms': '650',
  'genie.quality': '"balanced"',
};

/** A platform_settings + audit_logs stand-in that records BEGIN/COMMIT and FOR UPDATE locks. */
function createMockDb({ failReads = false } = {}) {
  const settings = new Map(
    Object.entries(SEEDED).map(([key, value]) => [
      key,
      { key, value_json: value, value_type: 'STRING', group_key: 'genie', updated_by: null, updated_at: null },
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

      if (q.startsWith('SELECT r.key, r.label_en')) {
        return { rows: [{ key: 'super_admin', label_en: 'Super Admin', label_bn: 'সুপার অ্যাডমিন' }] };
      }
      if (q.startsWith('SELECT o.id, o.user_id')) return { rows: [] };
      if (q.startsWith('SELECT al.*')) return { rows: [] };

      return { rows: [] };
    },
  };

  db.connect = async () => ({ query: db.query, release() {} });
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

const VALID = { enabled: true, duration_ms: 900, quality: 'smooth' };

describe('Popup genie effect governance', () => {
  describe('validatePolicy — the rules, with no database in the way', () => {
    test('accepts a well-formed policy unchanged', () => {
      assert.deepEqual(genieService.validatePolicy(VALID), VALID);
    });

    test('accepts both ends of the duration range', () => {
      const { min, max } = genieService.DURATION_LIMITS;
      assert.equal(genieService.validatePolicy({ ...VALID, duration_ms: min }).duration_ms, min);
      assert.equal(genieService.validatePolicy({ ...VALID, duration_ms: max }).duration_ms, max);
    });

    test('refuses a duration outside the range or not a whole number', () => {
      const { min, max } = genieService.DURATION_LIMITS;
      for (const bad of [min - 1, max + 1, 0, -650, 650.5, '650', null, undefined, NaN]) {
        assert.throws(
          () => genieService.validatePolicy({ ...VALID, duration_ms: bad }),
          (err) => {
            assert.equal(err.code, 'VALIDATION_FAILED', `duration ${String(bad)} must be refused`);
            assert.ok(err.messageBn, 'validation errors carry a Bengali message too');
            return true;
          }
        );
      }
    });

    test('refuses a quality that is not a preset', () => {
      for (const bad of ['ultra', '', 'BALANCED', null, 3]) {
        assert.throws(
          () => genieService.validatePolicy({ ...VALID, quality: bad }),
          (err) => err.code === 'VALIDATION_FAILED'
        );
      }
    });

    test('refuses a non-boolean switch (a truthy string is not "on")', () => {
      for (const bad of ['true', 1, null, undefined]) {
        assert.throws(
          () => genieService.validatePolicy({ ...VALID, enabled: bad }),
          (err) => err.code === 'VALIDATION_FAILED'
        );
      }
    });

    test('bounds and presets match the client engine that enforces them', () => {
      const src = fs.readFileSync(path.join(repoRoot, 'client/src/lib/genie.js'), 'utf8');

      const limits = src.match(/GENIE_LIMITS = Object\.freeze\(\{ minDurationMs: (\d+), maxDurationMs: (\d+) \}\)/);
      assert.ok(limits, 'client genie.js declares GENIE_LIMITS');
      assert.equal(Number(limits[1]), genieService.DURATION_LIMITS.min);
      assert.equal(Number(limits[2]), genieService.DURATION_LIMITS.max);

      const block = src.match(/const QUALITY_STRIPS = Object\.freeze\(\{([\s\S]*?)\}\);/);
      assert.ok(block, 'client genie.js declares QUALITY_STRIPS');
      const presets = [...block[1].matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]);
      assert.deepEqual(presets, [...genieService.QUALITIES], 'same presets, same order');

      const defaults = src.match(/GENIE_DEFAULTS = Object\.freeze\(\{ enabled: (\w+), duration_ms: (\d+), quality: '(\w+)' \}\)/);
      assert.ok(defaults, 'client genie.js declares GENIE_DEFAULTS');
      assert.equal(defaults[1] === 'true', genieService.DEFAULT_POLICY.enabled);
      assert.equal(Number(defaults[2]), genieService.DEFAULT_POLICY.duration_ms);
      assert.equal(defaults[3], genieService.DEFAULT_POLICY.quality);
    });
  });

  describe('updatePolicy — persistence, transaction and audit', () => {
    test('writes all three rows in one transaction and audits before/after', async () => {
      const db = createMockDb();
      const cache = createCache();
      const auditService = await import('../src/services/audit.service.js');
      await cache.set('genie:policy', JSON.stringify({ enabled: true }));

      const result = await genieService.updatePolicy(db, cache, auditService, {
        policy: { enabled: false, duration_ms: 400, quality: 'light' },
        reason: 'Turning it down for the low-end Android audience in Sylhet.',
        userId: 7,
        actorRole: 'super_admin',
      });

      assert.equal(result.enabled, false);
      assert.equal(result.duration_ms, 400);
      assert.equal(result.quality, 'light');

      assert.equal(JSON.parse(db.settings.get('genie.enabled').value_json), false);
      assert.equal(JSON.parse(db.settings.get('genie.duration_ms').value_json), 400);
      assert.equal(JSON.parse(db.settings.get('genie.quality').value_json), 'light');

      assert.deepEqual(db.txnOps, ['BEGIN', 'COMMIT'], 'the three rows move as one transaction');
      assert.ok(db.lockTaken >= 1, 'the settings group is locked before the read-modify-write');

      assert.equal(db.auditLog.length, 1, 'exactly one audit row per change');
      const entry = db.auditLog[0];
      assert.equal(entry.action, 'platform.genie.update');
      assert.equal(entry.actor_id, 7);
      assert.equal(entry.risk_tier, 'MEDIUM');
      const strip = ({ enabled, duration_ms: ms, quality }) => ({ enabled, duration_ms: ms, quality });
      assert.deepEqual(strip(entry.before_json), { enabled: true, duration_ms: 650, quality: 'balanced' });
      assert.deepEqual(strip(entry.after_json), { enabled: false, duration_ms: 400, quality: 'light' });
      assert.match(entry.after_json.meta?.reason ?? '', /Sylhet/, 'the reason travels with the row');

      assert.equal(await cache.get('genie:policy'), null, 'the cached policy is dropped');
    });

    test('a rejected policy mutates nothing, audits nothing and opens no transaction', async () => {
      const db = createMockDb();
      await assert.rejects(
        genieService.updatePolicy(db, createCache(), null, {
          policy: { enabled: true, duration_ms: 99999, quality: 'smooth' },
          reason: 'This reason is long enough to pass the length check.',
          userId: 7,
        }),
        (err) => err.code === 'VALIDATION_FAILED'
      );
      assert.equal(JSON.parse(db.settings.get('genie.duration_ms').value_json), 650);
      assert.equal(db.auditLog.length, 0);
      assert.deepEqual(db.txnOps, [], 'validation runs before the transaction is opened');
    });

    test('a reason under 10 characters is refused by the service itself', async () => {
      const db = createMockDb();
      await assert.rejects(
        genieService.updatePolicy(db, createCache(), null, { policy: VALID, reason: 'because', userId: 7 }),
        (err) => err.code === 'VALIDATION_FAILED' && /10 characters/.test(err.messageEn ?? err.message)
      );
      assert.equal(JSON.parse(db.settings.get('genie.quality').value_json), 'balanced');
      assert.equal(db.auditLog.length, 0);
    });
  });

  describe('getPolicy — reads and degradation', () => {
    test('reads the seeded policy', async () => {
      const policy = await genieService.getPolicy(createMockDb(), null);
      assert.equal(policy.enabled, true);
      assert.equal(policy.duration_ms, 650);
      assert.equal(policy.quality, 'balanced');
    });

    test('ignores a stored value that is out of range instead of serving it', async () => {
      const db = createMockDb();
      db.settings.get('genie.duration_ms').value_json = '90000';
      db.settings.get('genie.quality').value_json = '"ultra"';
      const policy = await genieService.getPolicy(db, null);
      assert.equal(policy.duration_ms, genieService.DEFAULT_POLICY.duration_ms);
      assert.equal(policy.quality, genieService.DEFAULT_POLICY.quality);
    });

    test('falls back to the shipped default when the table cannot be read', async () => {
      const policy = await genieService.getPolicy(createMockDb({ failReads: true }), null);
      assert.equal(policy.enabled, genieService.DEFAULT_POLICY.enabled);
      assert.equal(policy.duration_ms, genieService.DEFAULT_POLICY.duration_ms);
    });
  });

  describe('HTTP surface', () => {
    let app;
    let db;

    before(async () => {
      db = createMockDb();
      app = Fastify({ logger: false });
      app.decorate('db', db);
      app.decorate('cache', createCache());
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
      await app.register(genieRoutes, { prefix: '/api/v1' });
      await app.ready();
    });

    after(async () => {
      await app.close();
    });

    test('the public policy endpoint needs no authentication', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/genie/policy' });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(typeof body.policy.enabled, 'boolean');
      assert.equal(typeof body.policy.duration_ms, 'number');
      assert.ok(genieService.QUALITIES.includes(body.policy.quality));
      assert.deepEqual(body.qualities, genieService.QUALITIES);
      assert.equal(body.limits.min_duration_ms, genieService.DURATION_LIMITS.min);
      assert.equal('updated_by' in body.policy, false, 'the public shape leaks no staff identifiers');
    });

    test('the admin read returns policy, authority roster, history and can_update', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/platform/genie' });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.ok(body.policy);
      assert.ok(body.authority.roles.some((r) => r.key === 'super_admin'));
      assert.ok(Array.isArray(body.history));
      assert.equal(typeof body.can_update, 'boolean');
    });

    test('a PUT without a reason is rejected by the route schema', async () => {
      const res = await app.inject({ method: 'PUT', url: '/api/v1/admin/platform/genie', payload: VALID });
      assert.equal(res.statusCode, 400);
    });

    test('an unknown field never reaches the settings table', async () => {
      const before = [...db.settings.keys()].sort();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/platform/genie',
        payload: { ...VALID, reason: 'A perfectly good reason here.', strips: 500 },
      });
      // Fastify's default Ajv strips additional properties rather than rejecting; either outcome
      // is safe so long as the stray key is never persisted.
      assert.ok([200, 400].includes(res.statusCode));
      assert.deepEqual([...db.settings.keys()].sort(), before, 'no new setting row was created');
    });

    test('an out-of-range duration is refused with a bilingual error and changes nothing', async () => {
      const stored = db.settings.get('genie.duration_ms').value_json;
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/platform/genie',
        payload: { ...VALID, duration_ms: 20, reason: 'Trying an absurdly fast animation.' },
      });
      assert.equal(res.statusCode, 400, 'a business-rule failure is a 400, not a 500');
      const err = res.json().error;
      assert.equal(err.code, 'VALIDATION_FAILED');
      assert.ok(err.message_en && err.message_bn, 'both languages, per the API contract');
      assert.equal(db.settings.get('genie.duration_ms').value_json, stored, 'the stored value is untouched');
    });

    test('a valid PUT applies the policy and writes the audit row', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/platform/genie',
        payload: { ...VALID, reason: 'Smoother animation approved after the design review.' },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().policy.quality, 'smooth');
      assert.ok(db.auditLog.some((e) => e.action === 'platform.genie.update'));

      const pub = await app.inject({ method: 'GET', url: '/api/v1/genie/policy' });
      assert.equal(pub.json().policy.duration_ms, 900, 'the change is visible to visitors at once');
    });
  });

  describe('Permission catalog and migration contract', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/permission-catalog.json'), 'utf8'));
    const byKey = new Map(catalog.permissions.map((p) => [p.key, p]));

    test('the update key is delegable and MEDIUM — assignability is the feature', () => {
      const perm = byKey.get('platform.genie.update');
      assert.ok(perm, 'platform.genie.update is in the catalog');
      assert.equal(perm.delegable, true);
      assert.equal(perm.risk_tier, 'MEDIUM', 'CRITICAL would imply delegable:false');
      assert.deepEqual(perm.default_roles, ['super_admin']);
      assert.ok(perm.plain_en && perm.plain_bn, 'a requestable permission needs plain language');
    });

    test('the view key is held by the roles that see the page', () => {
      const perm = byKey.get('platform.genie.view');
      assert.ok(perm, 'platform.genie.view is in the catalog');
      assert.equal(perm.risk_tier, 'LOW');
      assert.ok(perm.default_roles.includes('super_admin') && perm.default_roles.includes('admin'));
    });

    test('the generated seed carries both keys (re-run scripts/generate-role-permission-seed.mjs)', () => {
      const seed = fs.readFileSync(path.join(repoRoot, 'server/src/db/seeds/001_roles_permissions.sql'), 'utf8');
      assert.match(seed, /\('platform\.genie\.view', 'platform'/);
      assert.match(seed, /\('platform\.genie\.update', 'platform'/);
      assert.match(seed, /\('super_admin', 'platform\.genie\.update'\)/);
    });

    test('the routes are guarded by exactly those two keys', () => {
      const src = fs.readFileSync(path.join(repoRoot, 'server/src/routes/genie.routes.js'), 'utf8');
      assert.match(src, /reqPerm\('platform\.genie\.view'\)/);
      assert.match(src, /reqPerm\('platform\.genie\.update'\)/);
    });

    test('the migration seeds exactly the shipped defaults', () => {
      const sql = fs.readFileSync(
        path.join(repoRoot, 'server/src/db/migrations/049_genie_effect_settings.sql'),
        'utf8'
      );
      assert.match(sql, /'genie\.enabled',\s*'true'::jsonb,\s*'BOOLEAN'/);
      assert.match(sql, new RegExp(`'genie\\.duration_ms',\\s*'${genieService.DEFAULT_POLICY.duration_ms}'::jsonb,\\s*'NUMBER'`));
      assert.match(sql, new RegExp(`'genie\\.quality',\\s*'"${genieService.DEFAULT_POLICY.quality}"'::jsonb,\\s*'STRING'`));
      assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/, 're-running must not reset a live platform');
    });
  });
});
