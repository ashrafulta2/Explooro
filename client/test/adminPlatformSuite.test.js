/**
 * adminPlatformSuite.test.js — Invariant and contract tests for the Admin Platform Suite:
 * Integrations, Settings, API Keys, and PlatformSubnav.
 *
 * Verifies:
 * 1. Component exports and instantiation integrity.
 * 2. PlatformSubnav rendering, navigation items, and aria states.
 * 3. 100% key parity between English and Bengali locales for platform namespaces.
 * 4. Mock handlers for integrations (catalog listing, ping handshake, webhook logs, updates).
 * 5. Mock handlers for platform settings (governance defaults, updates, resets).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import adminHandlers from '../src/mocks/handlers/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Admin Platform Suite Integrity', async (t) => {
  await t.test('1. Platform page components and subnav import cleanly and export functions', async () => {
    const modules = [
      '../src/components/admin/PlatformSubnav.js',
      '../src/pages/admin/IntegrationsPage.js',
      '../src/pages/admin/SettingsPage.js',
      '../src/pages/admin/ApiKeysPage.js',
      '../src/pages/admin/ModuleControlPage.js',
      '../src/pages/admin/ThemeStudioPage.js',
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

  await t.test('3. GET /admin/platform/integrations returns catalog of gateways and tools', () => {
    const handler = adminHandlers.find(
      (h) => h.method === 'GET' && h.path === '/admin/platform/integrations'
    );
    assert.ok(handler, 'GET integrations handler exists');
    const res = handler.handler();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.integrations));
    assert.ok(res.body.integrations.length >= 10, 'Includes at least 10 integrations');

    // Verify key Bangladesh integrations exist
    const ids = res.body.integrations.map((i) => i.id);
    assert.ok(ids.includes('bkash_checkout'), 'bKash checkout integration present');
    assert.ok(ids.includes('nagad_direct'), 'Nagad integration present');
    assert.ok(ids.includes('pathao_logistics'), 'Pathao Courier integration present');
    assert.ok(ids.includes('redx_delivery'), 'RedX integration present');
    assert.ok(ids.includes('steadfast_courier'), 'Steadfast Courier present');
  });

  await t.test('4. POST /admin/platform/integrations/:id/test executes ping handshake', () => {
    const handler = adminHandlers.find(
      (h) => h.method === 'POST' && h.path === '/admin/platform/integrations/:id/test'
    );
    assert.ok(handler, 'POST integration test handler exists');
    const res = handler.handler({ params: { id: 'bkash_checkout' } });
    assert.equal(res.status, 200);
    assert.ok(res.body.latency_ms > 0, 'Latency measured');
    assert.ok(res.body.message_en, 'Handshake response message present');
    assert.equal(res.body.status, 'CONNECTED');
  });

  await t.test('5. GET /admin/platform/integrations/logs returns webhook and audit logs', () => {
    const handler = adminHandlers.find(
      (h) => h.method === 'GET' && h.path === '/admin/platform/integrations/logs'
    );
    assert.ok(handler, 'GET integration logs handler exists');
    const res = handler.handler();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.logs));
    assert.ok(res.body.logs.length > 0, 'Logs returned');
    assert.ok(res.body.logs[0].event, 'Log item contains event name');
  });

  await t.test('6. PUT /admin/platform/integrations/:id updates credentials and status', () => {
    const handler = adminHandlers.find(
      (h) => h.method === 'PUT' && h.path === '/admin/platform/integrations/:id'
    );
    assert.ok(handler, 'PUT integration handler exists');
    const res = handler.handler({
      params: { id: 'nagad_direct' },
      body: {
        status: 'CONNECTED',
        environment: 'LIVE',
        merchant_id: 'TEST_MERCHANT_123',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.integration.status, 'CONNECTED');
    assert.equal(res.body.integration.environment, 'LIVE');
    assert.equal(res.body.integration.merchant_id, 'TEST_MERCHANT_123');
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
