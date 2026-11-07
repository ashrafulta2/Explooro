/**
 * integrations.test.js — gateway credentials at /admin/platform/integrations (migration 108).
 *
 * Covers what the feature claims:
 *  1. The catalog: unique keys, every field's .env variable documented in .env.example, every
 *     driver switch known to config/env.ts or .env.example, and the migration creates the table.
 *  2. A saved credential is stored only encrypted: the plain value is in neither the stored row,
 *     the audit row nor the API answer. The page sees a hint (a secret's last four characters).
 *  3. The drivers use a saved value first and fall back to .env when it is cleared or unreadable.
 *  4. Validation: unknown field, nothing to change, set-and-clear, short reason.
 *  5. Pause: refused for SMS/WhatsApp; a paused courier takes no new booking; payment pause is
 *     wired into the one place checkout asks.
 *  6. Test Connection reports mock / off / missing credentials honestly and never invents latency.
 *  7. HTTP: view vs manage permissions, 404 for an unknown key, no plain secret in any answer.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.ts';
import errorHandlerPlugin from '../src/plugins/errorHandler.ts';
import integrationRoutes from '../src/routes/integration.routes.ts';
import * as service from '../src/services/integration.service.ts';
import * as store from '../src/integrations/credentialStore.ts';
import { INTEGRATIONS, driverModeOf, integrationByKey } from '../src/config/integrations.ts';
import { BkashPaymentDriver } from '../src/integrations/payments/bkash.ts';
import { getCourierAdapter } from '../src/integrations/courier/index.ts';
import { assertCourierNotPaused, courierPaused } from '../src/services/shipment.service.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const KEY = randomBytes(32).toString('base64');
const SECRET = 'live-bkash-app-secret-9f3K2x';

/** integration_settings + audit_logs + payment_webhook_events stand-in. */
function createMockDb() {
  const rows = new Map();
  const audits = [];
  const txn = [];
  const db = {
    rows,
    audits,
    txn,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        txn.push(q);
        return { rows: [] };
      }
      if (q.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
      if (q.includes('FROM integration_settings WHERE integration_key = $1 FOR UPDATE')) {
        const r = rows.get(params[0]);
        return { rows: r ? [{ ...r }] : [] };
      }
      if (q.includes('FROM integration_settings ORDER BY')) {
        return { rows: [...rows.values()].map((r) => ({ ...r })) };
      }
      if (q.startsWith('INSERT INTO integration_settings (integration_key, is_enabled')) {
        const [key, isEnabled, enc, hints, updatedBy] = params;
        const prev = rows.get(key) ?? {};
        const row = {
          ...prev,
          integration_key: key,
          is_enabled: isEnabled,
          credentials_encrypted: enc,
          credential_hints: JSON.parse(hints),
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
        };
        rows.set(key, row);
        return { rows: [{ ...row }] };
      }
      if (q.startsWith('INSERT INTO integration_settings (integration_key, last_test_at')) {
        const [key, ok, message] = params;
        const prev = rows.get(key) ?? { integration_key: key, is_enabled: true, credentials_encrypted: null, credential_hints: {} };
        const row = { ...prev, last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_message: message };
        rows.set(key, row);
        return { rows: [{ ...row }] };
      }
      if (q.includes('FROM payment_webhook_events') && q.includes('COUNT(*)')) return { rows: [{ total: 3, valid: 2 }] };
      if (q.includes('FROM payment_webhook_events')) return { rows: [{ id: 1, gateway: 'BKASH', provider_event_id: 'e1', signature_valid: true }] };
      if (q.startsWith('INSERT INTO audit_logs')) {
        audits.push({ action: params[2], before: params[5], after: params[6], risk: params[8] });
        return { rows: [{ id: audits.length }] };
      }
      throw new Error(`unexpected query: ${q.slice(0, 80)}`);
    },
  };
  return db;
}

const fakeAudit = (sink) => ({ record: async (_db, row) => sink.push(row) });

const ENV_KEYS = ['BKASH_APP_SECRET', 'BKASH_APP_KEY', 'PAYMENT_DRIVER', 'COURIER_DRIVER'];
let savedEnv;
beforeEach(() => {
  store.resetCredentialStore();
});
before(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  store.resetCredentialStore();
});

describe('1. the catalog', () => {
  test('keys are unique and match what the migration allows', () => {
    const keys = INTEGRATIONS.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const k of keys) assert.match(k, /^[a-z0-9_]{2,64}$/);
  });

  test('every credential field names a .env variable documented in .env.example', () => {
    const example = read('.env.example');
    for (const def of INTEGRATIONS) {
      assert.ok(def.fields.length > 0, `${def.key} has fields`);
      assert.ok(example.includes(`${def.driver_env}=`), `${def.driver_env} documented`);
      for (const f of def.fields) {
        assert.ok(example.includes(`${f.env}=`), `${def.key}.${f.key}: ${f.env} is documented in .env.example`);
      }
    }
  });

  test('every driver reads its saved credentials through the store', () => {
    // A field the catalog offers but no driver reads would be saved and silently ignored.
    const sources = [
      'server/src/integrations/payments/bkash.ts',
      'server/src/integrations/payments/nagad.ts',
      'server/src/integrations/payments/sslcommerz.ts',
      'server/src/integrations/courier/steadfast.ts',
      'server/src/integrations/courier/pathao.ts',
      'server/src/integrations/courier/redx.ts',
      'server/src/integrations/sms/index.ts',
      'server/src/integrations/whatsapp/cloud-api.ts',
      'server/src/controllers/whatsappWebhook.controller.ts',
    ].map(read).join('\n');
    for (const def of INTEGRATIONS) {
      for (const f of def.fields) {
        const pattern = new RegExp(`'${def.key}'[^)]*'${f.key}'|cred\\('${f.key}'`);
        assert.match(sources, pattern, `${def.key}.${f.key} is read by a driver`);
      }
    }
  });

  test('migration 108 creates integration_settings with an encrypted column', () => {
    const sql = read('server/src/db/migrations/108_integration_settings.sql');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS integration_settings/);
    assert.match(sql, /credentials_encrypted\s+TEXT/);
    assert.match(sql, /credential_hints\s+JSONB/);
  });

  test('driver mode follows the .env switch', () => {
    const bkash = integrationByKey('bkash_checkout');
    assert.equal(driverModeOf(bkash, { PAYMENT_DRIVER: 'none' }), 'OFF');
    assert.equal(driverModeOf(bkash, { PAYMENT_DRIVER: 'mock' }), 'MOCK');
    assert.equal(driverModeOf(bkash, {}), 'MOCK');
    assert.equal(driverModeOf(bkash, { PAYMENT_DRIVER: 'live' }), 'LIVE');
    const sms = integrationByKey('greenweb_sms');
    assert.equal(driverModeOf(sms, { SMS_DRIVER: 'greenweb' }), 'LIVE');
    assert.equal(driverModeOf(sms, { SMS_DRIVER: 'mock' }), 'MOCK');
  });
});

describe('2-4. saving credentials', () => {
  test('hints never reveal a secret', () => {
    assert.equal(service.hintFor(true, SECRET), `••••${SECRET.slice(-4)}`);
    assert.equal(service.hintFor(true, 'short'), '••••');
    assert.equal(service.hintFor(false, 'EXPLOORO_01'), 'EXPLOORO_01');
    assert.equal(service.hintFor(true, ''), null);
  });

  test('a saved secret is stored encrypted, audited as a hint, and used by the driver', async () => {
    const db = createMockDb();
    const audits = [];
    delete process.env.BKASH_APP_SECRET;
    const res = await service.updateCredentials(db, fakeAudit(audits), {
      key: 'bkash_checkout',
      values: { app_secret: SECRET, app_key: 'bk_app_key_123' },
      reason: 'Rotating the bKash key this quarter',
      userId: 7,
      encryptionKey: KEY,
    });

    const row = db.rows.get('bkash_checkout');
    assert.ok(row.credentials_encrypted, 'something was stored');
    assert.ok(!row.credentials_encrypted.includes(SECRET), 'the stored text is not the plain secret');
    assert.ok(!JSON.stringify(row.credential_hints).includes(SECRET));
    assert.equal(row.credential_hints.app_secret, `••••${SECRET.slice(-4)}`);
    assert.equal(row.credential_hints.app_key, 'bk_app_key_123');

    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'platform.integration.update');
    assert.equal(audits[0].riskTier, 'CRITICAL');
    assert.ok(!JSON.stringify(audits[0]).includes(SECRET), 'the audit row carries no plain secret');
    assert.deepEqual(audits[0].meta.changed_fields.sort(), ['app_key', 'app_secret']);

    assert.ok(!JSON.stringify(res).includes(SECRET), 'the API answer carries no plain secret');
    const secretField = res.integration.fields.find((f) => f.key === 'app_secret');
    assert.equal(secretField.source, 'SAVED');

    // The store was reloaded after the save, so a driver built now uses the saved value.
    assert.equal(new BkashPaymentDriver().appSecret, SECRET);
  });

  test('an empty box leaves a value as it is; clear falls back to .env', async () => {
    const db = createMockDb();
    const audits = [];
    process.env.BKASH_APP_SECRET = 'from-env-secret-value';
    await service.updateCredentials(db, fakeAudit(audits), {
      key: 'bkash_checkout', values: { app_secret: SECRET }, reason: 'First save of the bKash key', encryptionKey: KEY,
    });
    await service.updateCredentials(db, fakeAudit(audits), {
      key: 'bkash_checkout', values: { app_secret: '', app_key: 'k2' }, reason: 'Change only the app key', encryptionKey: KEY,
    });
    assert.equal(store.storedCredential('bkash_checkout', 'app_secret'), SECRET, 'empty box kept the secret');
    assert.equal(store.storedCredential('bkash_checkout', 'app_key'), 'k2');

    await service.updateCredentials(db, fakeAudit(audits), {
      key: 'bkash_checkout', clear: ['app_secret'], reason: 'Go back to the .env value', encryptionKey: KEY,
    });
    assert.equal(store.storedCredential('bkash_checkout', 'app_secret'), undefined);
    assert.equal(store.credential('bkash_checkout', 'app_secret', 'BKASH_APP_SECRET'), 'from-env-secret-value');
    assert.equal(new BkashPaymentDriver().appSecret, 'from-env-secret-value');
  });

  test('an unreadable row (wrong key) falls back to .env without losing the other rows', () => {
    const other = randomBytes(32).toString('base64');
    const logged = [];
    process.env.BKASH_APP_KEY = 'env-app-key';
    store.applyIntegrationRows(
      [
        { integration_key: 'bkash_checkout', is_enabled: true, credentials_encrypted: 'bm90LWNpcGhlcnRleHQtYXQtYWxsLW5vdC1ldmVuLWNsb3Nl' },
        { integration_key: 'redx_delivery', is_enabled: false, credentials_encrypted: null },
      ],
      other,
      { error: (o) => logged.push(o) }
    );
    assert.equal(store.credential('bkash_checkout', 'app_key', 'BKASH_APP_KEY'), 'env-app-key');
    assert.equal(store.isIntegrationPaused('redx_delivery'), true);
    assert.equal(logged.length, 1);
  });

  test('validation refuses what cannot be right', async () => {
    const db = createMockDb();
    const audits = [];
    const base = { key: 'bkash_checkout', reason: 'A valid reason here', encryptionKey: KEY };
    const code = (c) => (e) => e.code === c;
    await assert.rejects(service.updateCredentials(db, fakeAudit(audits), { ...base, values: { nope: 'x' } }), code('VALIDATION_FAILED'));
    await assert.rejects(service.updateCredentials(db, fakeAudit(audits), { ...base, values: { app_key: '  ' } }), code('VALIDATION_FAILED'));
    await assert.rejects(service.updateCredentials(db, fakeAudit(audits), { ...base, values: { app_key: 'a' }, clear: ['app_key'] }), code('VALIDATION_FAILED'));
    await assert.rejects(service.updateCredentials(db, fakeAudit(audits), { ...base, values: { app_key: 'a' }, reason: 'short' }), code('VALIDATION_FAILED'));
    await assert.rejects(service.updateCredentials(db, fakeAudit(audits), { ...base, key: 'rocket', values: { app_key: 'a' } }), code('NOT_FOUND'));
    await assert.rejects(
      service.updateCredentials(db, fakeAudit(audits), { ...base, values: { app_key: 'x'.repeat(service.VALUE_LIMITS.maxLength + 1) } }),
      code('VALIDATION_FAILED')
    );
    assert.equal(db.rows.size, 0, 'nothing was written');
    assert.equal(audits.length, 0, 'nothing was audited');
  });
});

describe('5. pause', () => {
  test('SMS and WhatsApp cannot be paused', async () => {
    const db = createMockDb();
    for (const key of ['greenweb_sms', 'whatsapp_cloud']) {
      await assert.rejects(
        service.setEnabled(db, fakeAudit([]), { key, enabled: false, reason: 'Trying to pause it', encryptionKey: KEY }),
        (e) => e.code === 'CONFLICT' && e.details?.reason === 'NOT_PAUSABLE'
      );
    }
  });

  test('a paused courier refuses new bookings; resuming lets them through again', async () => {
    const db = createMockDb();
    const audits = [];
    assert.equal(courierPaused('STEADFAST'), false);
    await service.setEnabled(db, fakeAudit(audits), { key: 'steadfast_courier', enabled: false, reason: 'Steadfast outage today', encryptionKey: KEY });
    assert.equal(courierPaused('STEADFAST'), true);
    assert.equal(courierPaused('PATHAO'), false, 'only that courier');
    assert.throws(() => assertCourierNotPaused('STEADFAST'), (e) => e.code === 'CONFLICT' && e.details.reason === 'COURIER_PAUSED');
    assert.equal(audits[0].action, 'platform.integration.pause');
    assert.deepEqual(audits[0].beforeJson, { is_enabled: true });
    assert.deepEqual(audits[0].afterJson, { is_enabled: false });

    // Pausing again changes nothing and audits nothing.
    await service.setEnabled(db, fakeAudit(audits), { key: 'steadfast_courier', enabled: false, reason: 'Steadfast outage today', encryptionKey: KEY });
    assert.equal(audits.length, 1);

    await service.setEnabled(db, fakeAudit(audits), { key: 'steadfast_courier', enabled: true, reason: 'Steadfast is back up', encryptionKey: KEY });
    assert.equal(courierPaused('STEADFAST'), false);
    assert.equal(audits[1].action, 'platform.integration.resume');
  });

  test('pausing keeps saved credentials', async () => {
    const db = createMockDb();
    await service.updateCredentials(db, fakeAudit([]), { key: 'redx_delivery', values: { api_token: 'redx-token-123456' }, reason: 'Save the RedX token', encryptionKey: KEY });
    await service.setEnabled(db, fakeAudit([]), { key: 'redx_delivery', enabled: false, reason: 'Pause RedX for now', encryptionKey: KEY });
    assert.equal(store.storedCredential('redx_delivery', 'api_token'), 'redx-token-123456');
    assert.equal(getCourierAdapter('REDX').token, 'redx-token-123456');
  });

  test('checkout and pickups ask the pause switch', () => {
    assert.match(read('server/src/services/paymentMethods.service.ts'), /isIntegrationPaused\(gateway\.key\)/);
    assert.match(read('server/src/services/reversePickup.service.ts'), /isIntegrationPaused\(pausedAs\.key\)/);
    assert.match(read('server/src/services/manualOperations.service.ts'), /courierPaused\(adapter\.name\)/);
  });
});

describe('6. Test Connection', () => {
  test('reports the driver honestly and stores the result', async () => {
    const db = createMockDb();
    const audits = [];

    let r = await service.testIntegration(db, fakeAudit(audits), { key: 'bkash_checkout', env: { PAYMENT_DRIVER: 'mock' } });
    assert.equal(r.ok, true);
    assert.equal(r.driver_mode, 'MOCK');
    assert.match(r.message_en, /Mock driver/);

    r = await service.testIntegration(db, fakeAudit(audits), { key: 'bkash_checkout', env: { PAYMENT_DRIVER: 'none' } });
    assert.equal(r.ok, false);
    assert.equal(r.driver_mode, 'OFF');

    r = await service.testIntegration(db, fakeAudit(audits), { key: 'bkash_checkout', env: { PAYMENT_DRIVER: 'live', BKASH_APP_KEY: 'k' } });
    assert.equal(r.ok, false);
    assert.ok(r.missing.includes('app_secret'));
    assert.match(r.message_en, /BKASH_APP_SECRET/);

    const fullEnv = { PAYMENT_DRIVER: 'live' };
    for (const f of integrationByKey('sslcommerz_cards').fields) fullEnv[f.env] = 'value-long-enough-1234';
    r = await service.testIntegration(db, fakeAudit(audits), { key: 'sslcommerz_cards', env: fullEnv });
    assert.equal(r.ok, true);
    assert.match(r.message_en, /No live call/);
    assert.equal('latency_ms' in r, false, 'no invented latency');

    assert.equal(db.rows.get('sslcommerz_cards').last_test_ok, true);
    assert.equal(audits.length, 4);
    assert.ok(audits.every((a) => a.action === 'platform.integration.test'));
  });
});

describe('7. HTTP surface', () => {
  let app;
  let db;
  let perms;

  before(async () => {
    db = createMockDb();
    app = Fastify({ logger: false });
    app.decorate('db', db);
    app.decorate('config', { auth: { piiEncryptionKey: KEY }, core: { publicApiUrl: 'https://api.example.test' } });
    app.decorate('authenticate', async (req) => {
      req.user = { id: 9, roles: ['admin'] };
      req.userPermissions = new Set(perms);
    });
    app.decorate('requirePermission', (key) => async (req, reply) => {
      if (!perms.includes(key)) return reply.status(403).send({ error: { code: 'PERMISSION_DENIED', key } });
    });
    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    await app.register(integrationRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('view lists every service with its webhook URL; it cannot save', async () => {
    perms = ['platform.integration.view'];
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/platform/integrations' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.integrations.length, INTEGRATIONS.length);
    assert.equal(body.can_manage, false);
    assert.equal(body.metrics.webhooks_24h, 3);
    const bkash = body.integrations.find((i) => i.key === 'bkash_checkout');
    assert.equal(bkash.webhook_url, 'https://api.example.test/api/v1/payments/webhook/bkash');

    const put = await app.inject({
      method: 'PUT', url: '/api/v1/admin/platform/integrations/bkash_checkout',
      payload: { values: { app_key: 'x' }, reason: 'Should be refused' },
    });
    assert.equal(put.statusCode, 403);
  });

  test('manage saves; the answer and the next list carry no plain secret', async () => {
    perms = ['platform.integration.view', 'platform.integration.manage'];
    const put = await app.inject({
      method: 'PUT', url: '/api/v1/admin/platform/integrations/bkash_checkout',
      payload: { values: { app_secret: SECRET }, reason: 'Save the live bKash secret' },
    });
    assert.equal(put.statusCode, 200, put.body);
    assert.ok(!put.body.includes(SECRET));
    assert.equal(db.audits.at(-1).action, 'platform.integration.update');
    assert.ok(!String(db.audits.at(-1).after).includes(SECRET));

    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/platform/integrations' });
    assert.ok(!list.body.includes(SECRET));
    assert.equal(list.json().can_manage, true);
  });

  test('unknown key is 404, a malformed one is a 400, extra body fields are dropped', async () => {
    perms = ['platform.integration.view', 'platform.integration.manage'];
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/admin/platform/integrations/rocket_dbbl/test', payload: {} });
    assert.equal(unknown.statusCode, 404);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/admin/platform/integrations/Bad-Key!/test', payload: {} });
    assert.equal(bad.statusCode, 400);
    const extra = await app.inject({
      method: 'PUT', url: '/api/v1/admin/platform/integrations/redx_delivery/status',
      payload: { enabled: false, reason: 'Pause RedX for now', status: 'X' },
    });
    // Fastify's validator strips properties a schema does not name (removeAdditional), so the
    // stray field never reaches the service.
    assert.equal(extra.statusCode, 200, extra.body);
    assert.equal('status' in db.rows.get('redx_delivery'), false);
    await app.inject({
      method: 'PUT', url: '/api/v1/admin/platform/integrations/redx_delivery/status',
      payload: { enabled: true, reason: 'Resume RedX again' },
    });
  });

  test('status and test need manage; logs need view', async () => {
    perms = ['platform.integration.view'];
    const status = await app.inject({
      method: 'PUT', url: '/api/v1/admin/platform/integrations/redx_delivery/status',
      payload: { enabled: false, reason: 'Pause RedX for now' },
    });
    assert.equal(status.statusCode, 403);
    const t = await app.inject({ method: 'POST', url: '/api/v1/admin/platform/integrations/redx_delivery/test', payload: {} });
    assert.equal(t.statusCode, 403);
    const logs = await app.inject({ method: 'GET', url: '/api/v1/admin/platform/integrations/logs?limit=5' });
    assert.equal(logs.statusCode, 200);
    assert.equal(logs.json().logs.length, 1);
  });
});
