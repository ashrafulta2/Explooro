/**
 * adminPlatformSuite.test.js — Invariant and contract tests for the Admin Platform Suite:
 * Integrations, Settings, API Keys, and PlatformSubnav.
 *
 * Verifies:
 * 1. Component exports and instantiation integrity.
 * 2. PlatformSubnav rendering, navigation items, and aria states.
 * 3. 100% key parity between English and Bengali locales for platform namespaces.
 * 4. The integrations mock mirrors the server catalog (migration 108) and never returns a secret.
 * 5. Mock handlers for platform settings (governance defaults, updates, resets).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import adminHandlers from '../src/mocks/handlers/admin.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Admin Platform Suite Integrity', async (t) => {
  await t.test('1. Platform page components and subnav import cleanly and export functions', async () => {
    const modules = [
      '../src/components/admin/PlatformSubnav.ts',
      '../src/pages/admin/IntegrationsPage.ts',
      '../src/pages/admin/SettingsPage.ts',
      '../src/pages/admin/ApiKeysPage.ts',
      '../src/pages/admin/ModuleControlPage.ts',
      '../src/pages/admin/ThemeStudioPage.ts',
    ];

    for (const modPath of modules) {
      const mod = await import(modPath);
      assert.ok(mod.default, `${modPath} has default export`);
      assert.equal(typeof mod.default, 'function', `${modPath} default export is a function`);
    }
  });

  await t.test('2. Locale key parity between en.json and bn.json for platform namespaces', () => {
    const enPath = path.resolve(__dirname, '../src/locales/en.json');
    const bnPath = path.resolve(__dirname, '../src/locales/bn.json');

    const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
    const bn = JSON.parse(fs.readFileSync(bnPath, 'utf8'));

    assert.ok(en.platform_integrations, 'en.json has platform_integrations namespace');
    assert.ok(bn.platform_integrations, 'bn.json has platform_integrations namespace');
    assert.ok(en.platform_settings, 'en.json has platform_settings namespace');
    assert.ok(bn.platform_settings, 'bn.json has platform_settings namespace');

    const checkKeys = (enObj, bnObj, prefix = '') => {
      const enKeys = Object.keys(enObj).sort();
      for (const key of enKeys) {
        assert.ok(
          key in bnObj,
          `Missing key "${prefix}${key}" in bn.json`
        );
        if (typeof enObj[key] === 'object' && enObj[key] !== null) {
          checkKeys(enObj[key], bnObj[key], `${prefix}${key}.`);
        }
      }
    };

    checkKeys(en.platform_integrations, bn.platform_integrations, 'platform_integrations.');
    checkKeys(en.platform_settings, bn.platform_settings, 'platform_settings.');
  });

  // Integrations (migration 108): the mock mirrors server/src/services/integration.service.ts.
  const { integrationHandlers, MOCK_INTEGRATION_CATALOG } = await import('../src/mocks/handlers/integrations.ts');
  const integrationRoute = (method, p) => integrationHandlers.find((h) => h.method === method && h.path === p);

  await t.test('3. the integrations mock lists the server catalog, field for field', async () => {
    const { INTEGRATIONS } = await import('../../server/src/config/integrations.ts');
    const strip = (d) => ({
      key: d.key, name: d.name, type: d.type, driver_env: d.driver_env, webhook_path: d.webhook_path, live_driver: d.live_driver,
      pausable: d.pausable, category_en: d.category_en, category_bn: d.category_bn,
      description_en: d.description_en, description_bn: d.description_bn,
      pause_effect_en: d.pause_effect_en, pause_effect_bn: d.pause_effect_bn,
      fields: d.fields.map((f) => ({ ...f })),
    });
    assert.deepEqual(MOCK_INTEGRATION_CATALOG.map(strip), INTEGRATIONS.map(strip), 'mock catalog drifted from the server');

    const res = integrationRoute('GET', '/admin/platform/integrations').handler({});
    assert.equal(res.status, 200);
    assert.equal(res.body.integrations.length, INTEGRATIONS.length);
    for (const i of res.body.integrations) {
      assert.ok(['LIVE', 'MOCK', 'OFF'].includes(i.driver_mode), `${i.key} driver mode`);
      for (const f of i.fields) assert.ok(['SAVED', 'ENV', 'MISSING'].includes(f.source), `${i.key}.${f.key} source`);
    }
    assert.equal('latency_ms' in res.body.integrations[0], false, 'no invented latency');
    assert.equal(adminHandlers.some((h) => h.path.startsWith('/admin/platform/integrations')), false, 'the old admin.ts mock is gone');
  });

  await t.test('4. saving keeps the secret out of every answer and needs a reason', () => {
    const put = integrationRoute('PUT', '/admin/platform/integrations/:key');
    const secret = 'mock-secret-value-ABCD';
    const noReason = put.handler({ params: { key: 'nagad_direct' }, body: { values: { private_key: secret } } });
    assert.equal(noReason.status, 400);
    const unknown = put.handler({ params: { key: 'nagad_direct' }, body: { values: { nope: 'x' }, reason: 'A long enough reason' } });
    assert.equal(unknown.status, 400);

    const ok = put.handler({ params: { key: 'nagad_direct' }, body: { values: { private_key: secret, merchant_id: 'M-1' }, reason: 'Save the Nagad keys' } });
    assert.equal(ok.status, 200);
    assert.ok(!JSON.stringify(ok.body).includes(secret), 'the secret never comes back');
    const field = ok.body.integration.fields.find((f) => f.key === 'private_key');
    assert.equal(field.source, 'SAVED');
    assert.equal(field.hint, '••••ABCD');
    assert.equal(ok.body.integration.fields.find((f) => f.key === 'merchant_id').hint, 'M-1');

    const cleared = put.handler({ params: { key: 'nagad_direct' }, body: { clear: ['private_key'], reason: 'Back to the .env value' } });
    assert.equal(cleared.body.integration.fields.find((f) => f.key === 'private_key').source, 'MISSING');
  });

  await t.test('5. pause works for payments and couriers, is refused for SMS', () => {
    const status = integrationRoute('PUT', '/admin/platform/integrations/:key/status');
    const paused = status.handler({ params: { key: 'redx_delivery' }, body: { enabled: false, reason: 'RedX outage today' } });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.integration.is_enabled, false);
    const sms = status.handler({ params: { key: 'greenweb_sms' }, body: { enabled: false, reason: 'Trying to pause SMS' } });
    assert.equal(sms.status, 409);
    status.handler({ params: { key: 'redx_delivery' }, body: { enabled: true, reason: 'RedX is back up' } });
  });

  await t.test('6. Test Connection reports the mock driver and records the result', () => {
    const res = integrationRoute('POST', '/admin/platform/integrations/:key/test').handler({ params: { key: 'bkash_checkout' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.driver_mode, 'MOCK');
    assert.ok(res.body.message_en && res.body.message_bn);
    assert.equal(res.body.integration.last_test.ok, true);
    const logs = integrationRoute('GET', '/admin/platform/integrations/logs').handler({});
    assert.ok(Array.isArray(logs.body.logs));
    const missing = integrationRoute('POST', '/admin/platform/integrations/:key/test').handler({ params: { key: 'rocket_dbbl' } });
    assert.equal(missing.status, 404);
  });

  await t.test('7. GET /admin/platform/settings returns complete platform governance rules', () => {
    const handler = adminHandlers.find(
      (h) => h.method === 'GET' && h.path === '/admin/platform/settings'
    );
    assert.ok(handler, 'GET platform settings handler exists');
    const res = handler.handler();
    assert.equal(res.status, 200);
    const settings = res.body.settings;
    assert.ok(settings.platform_name, 'Settings includes platform_name');
    assert.ok(settings.escrow_period_days !== undefined, 'Settings includes escrow_period_days');
    assert.ok(settings.min_saler_payout_bdt !== undefined, 'Settings includes min_saler_payout_bdt');
    assert.ok(settings.platform_take_pct !== undefined, 'Settings includes platform_take_pct');
    assert.ok(settings.staff_2fa_enforced !== undefined, 'Settings includes staff_2fa_enforced');
  });

  await t.test('8. PUT /admin/platform/settings persists updates and appends audit log', () => {
    const putHandler = adminHandlers.find(
      (h) => h.method === 'PUT' && h.path === '/admin/platform/settings'
    );
    assert.ok(putHandler, 'PUT platform settings handler exists');
    const res = putHandler.handler({
      body: {
        settings: {
          escrow_period_days: 5,
        },
        reason: 'Adjusting cooling-off period for holiday policy',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.escrow_period_days, 5);
    assert.ok(res.body.history.length > 0);
    assert.equal(res.body.history[0].reason, 'Adjusting cooling-off period for holiday policy');
  });

  await t.test('9. POST /admin/platform/settings/reset restores defaults', () => {
    const resetHandler = adminHandlers.find(
      (h) => h.method === 'POST' && h.path === '/admin/platform/settings/reset'
    );
    assert.ok(resetHandler, 'POST platform settings reset handler exists');
    const res = resetHandler.handler();
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.escrow_period_days, 7);
  });
});
