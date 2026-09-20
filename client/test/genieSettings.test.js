/**
 * genieSettings.test.js — popup genie-effect governance, client side.
 *
 * Covers:
 *  1. Nav guard == route guard for /admin/platform/genie, both permission AND module
 *     (docs/super-admin-audit.md §5 invariant 2), and both permission keys exist in the catalog
 *     (invariant 4).
 *  2. en/bn parity for every key the page renders (invariant 8: a missing key does not fail
 *     loudly, it renders a humanized slug that looks like real copy).
 *  3. The mock handlers enforce the same rules as the server, so a mock-mode demo cannot pass where
 *     the real API would reject.
 *  4. applyGeniePolicy adopts a policy in the engine, survives unusable storage, and ignores junk.
 *  5. The page's own stylesheet is NOT also imported by main.css (a double import ships the same
 *     CSS twice with no warning), and the page shows its Save gate before the API is called.
 *  6. The boot path applies the cached policy without awaiting the network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import catalog from '../../docs/permission-catalog.json' with { type: 'json' };
import { navItems } from '../src/config/navigation.js';
import { genieHandlers } from '../src/mocks/handlers/genie.js';
import { applyGeniePolicy } from '../src/services/genieSettings.js';
import { getGenieConfig, configureGenie, GENIE_DEFAULTS, GENIE_LIMITS } from '../src/lib/genie.js';

const clientRoot = path.resolve(import.meta.dirname, '..');
const read = (...p) => fs.readFileSync(path.join(clientRoot, ...p), 'utf8');
const ROUTE = '/admin/platform/genie';
const LONG_REASON = 'Slowing it down for the Eid campaign review.';

const putHandler = genieHandlers.find((h) => h.method === 'PUT');
const publicHandler = genieHandlers.find((h) => h.path === '/genie/policy');

test('Popup genie effect — client invariants', async (t) => {
  await t.test('1. Nav guard equals route guard, on both permission and module', () => {
    const navItem = navItems.find((i) => i.path === ROUTE);
    assert.ok(navItem, `navigation.js registers ${ROUTE}`);
    assert.equal(navItem.permission, 'platform.genie.view');
    assert.equal(navItem.module, 'core');
    assert.ok(navItem.roles.includes('super_admin') && navItem.roles.includes('admin'));

    const mainSrc = read('src', 'main.js');
    const routeBlock = mainSrc.slice(mainSrc.indexOf(`path: '${ROUTE}'`));
    const block = routeBlock.slice(0, routeBlock.indexOf('},') + 2);
    assert.match(block, /permission: 'platform\.genie\.view'/, 'route guard = nav guard');
    assert.match(block, /module: 'core'/, 'route module = nav module');
    assert.match(block, /GenieSettingsPage\.js/);
  });

  await t.test('1b. Both permission keys exist and the update key is delegable but not CRITICAL', () => {
    const byKey = new Map(catalog.permissions.map((p) => [p.key, p]));
    assert.ok(byKey.get('platform.genie.view'), 'platform.genie.view is in docs/permission-catalog.json');
    const update = byKey.get('platform.genie.update');
    assert.ok(update, 'platform.genie.update is in docs/permission-catalog.json');
    assert.equal(update.delegable, true, 'a Super Admin must be able to assign this');
    assert.notEqual(update.risk_tier, 'CRITICAL', 'CRITICAL cannot be granted by any path');
  });

  await t.test('1c. The Platform sub-navigation links to the page', () => {
    assert.match(read('src', 'components', 'admin', 'PlatformSubnav.js'), /key: 'genie'[^}]*href: '\/admin\/platform\/genie'/);
  });

  await t.test('2. Locale key parity for the admin_genie namespace and the nav label', () => {
    assert.ok(enDict.admin_genie && bnDict.admin_genie, 'both dictionaries have admin_genie');
    const walk = (a, b, prefix) => {
      for (const key of Object.keys(a)) {
        assert.ok(key in b, `Missing key "${prefix}${key}"`);
        assert.ok(String(b[key]).length > 0, `Empty translation for "${prefix}${key}"`);
      }
    };
    walk(enDict.admin_genie, bnDict.admin_genie, 'bn admin_genie.');
    walk(bnDict.admin_genie, enDict.admin_genie, 'en admin_genie.');
    assert.ok(enDict.nav.admin.genie && bnDict.nav.admin.genie, 'the sidebar label exists in both');
  });

  await t.test('2b. Every key the page references resolves in both dictionaries', () => {
    const pageSrc = read('src', 'pages', 'admin', 'GenieSettingsPage.js');
    const literal = [...pageSrc.matchAll(/t\(\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/g)].map((m) => m[1]);
    // The smoothness options build their key from the preset name.
    const dynamic = ['light', 'balanced', 'smooth'].map((q) => `admin_genie.quality_${q}_desc`);
    assert.ok(literal.length > 30, 'the page translates its copy rather than hardcoding English');

    const lookup = (dict, dotted) => dotted.split('.').reduce((acc, part) => acc?.[part], dict);
    for (const key of new Set([...literal, ...dynamic])) {
      assert.equal(typeof lookup(enDict, key), 'string', `en.json is missing ${key}`);
      assert.equal(typeof lookup(bnDict, key), 'string', `bn.json is missing ${key}`);
    }
  });

  await t.test('3. The mock covers all three endpoints', () => {
    const routes = genieHandlers.map((h) => `${h.method} ${h.path}`);
    assert.deepEqual(routes.sort(), ['GET /admin/platform/genie', 'GET /genie/policy', 'PUT /admin/platform/genie']);
  });

  await t.test('3b. The mock refuses what the API refuses, with a bilingual 400', () => {
    const base = { enabled: true, duration_ms: 800, quality: 'smooth', reason: LONG_REASON };
    for (const [why, patch] of [
      ['duration below range', { duration_ms: GENIE_LIMITS.minDurationMs - 1 }],
      ['duration above range', { duration_ms: GENIE_LIMITS.maxDurationMs + 1 }],
      ['fractional duration', { duration_ms: 650.5 }],
      ['unknown quality', { quality: 'ultra' }],
      ['non-boolean switch', { enabled: 'yes' }],
      ['short reason', { reason: 'nope' }],
    ]) {
      const res = putHandler.handler({ body: { ...base, ...patch } });
      assert.equal(res.status, 400, why);
      assert.equal(res.body.error.code, 'VALIDATION_FAILED', why);
      assert.ok(res.body.error.message_en && res.body.error.message_bn, `${why}: both languages`);
    }
  });

  await t.test('3c. A valid mock PUT is reflected by the public endpoint and by history', () => {
    const put = putHandler.handler({
      body: { enabled: false, duration_ms: 900, quality: 'light', reason: LONG_REASON },
    });
    assert.equal(put.status, 200);
    assert.deepEqual(publicHandler.handler().body.policy, { enabled: false, duration_ms: 900, quality: 'light' });
    assert.equal('updated_by' in publicHandler.handler().body.policy, false, 'public shape leaks no staff ids');

    const admin = genieHandlers.find((h) => h.method === 'GET' && h.path === '/admin/platform/genie').handler();
    assert.equal(admin.body.history[0].action, 'platform.genie.update');
    assert.deepEqual(admin.body.history[0].after_json.quality, 'light');
    assert.match(admin.body.history[0].after_json.meta.reason, /Eid/);
    assert.equal(admin.body.history[0].before_json.duration_ms, GENIE_DEFAULTS.duration_ms);
  });

  await t.test('4. applyGeniePolicy drives the engine, and survives unusable storage', () => {
    try {
      // localStorage does not exist in Node — the write must fail quietly, not throw.
      const now = applyGeniePolicy({ enabled: true, duration_ms: 1000, quality: 'smooth' });
      assert.deepEqual(now, { enabled: true, duration_ms: 1000, quality: 'smooth' });
      assert.deepEqual(getGenieConfig(), now);

      applyGeniePolicy(null);
      applyGeniePolicy('junk');
      assert.deepEqual(getGenieConfig(), now, 'junk input leaves the last good policy in force');

      assert.equal(applyGeniePolicy({ duration_ms: 1 }, { cache: false }).duration_ms, GENIE_LIMITS.minDurationMs);
    } finally {
      configureGenie(GENIE_DEFAULTS);
    }
  });

  await t.test('5. The stylesheet is imported by the page only, not by main.css', () => {
    const page = read('src', 'pages', 'admin', 'GenieSettingsPage.js');
    assert.match(page, /import '\.\.\/\.\.\/styles\/components\/genie-settings\.css'/);
    assert.doesNotMatch(read('src', 'styles', 'main.css'), /genie-settings\.css/);
  });

  await t.test('5b. Save is gated by a reason and previews never persist', () => {
    const page = read('src', 'pages', 'admin', 'GenieSettingsPage.js');
    assert.match(page, /MIN_REASON_LENGTH = 10/);
    assert.match(page, /disabled: true,[\s\S]{0,200}btn_confirm_save|btn_confirm_save[\s\S]{0,200}disabled: true/, 'confirm starts disabled');
    assert.match(page, /trim\(\)\.length < MIN_REASON_LENGTH/, 'the gate is the same minimum the API enforces');
    assert.match(page, /applyGeniePolicy\(draft, \{ cache: false \}\)/, 'preview applies without caching');
    assert.match(page, /onClose: \(\) => applyGeniePolicy\(policy, \{ cache: false \}\)/, 'preview restores the saved policy');
  });

  await t.test('5c. Untrusted text (reasons, grantee names) is escaped before it reaches innerHTML', () => {
    const page = read('src', 'pages', 'admin', 'GenieSettingsPage.js');
    assert.match(page, /esc\(reason\)/);
    assert.match(page, /esc\(name\)/);
    assert.doesNotMatch(page, /\$\{reason\}/, 'no raw reason interpolation');
  });

  await t.test('6. Boot applies the cached policy synchronously and never awaits the network', () => {
    const boot = read('src', 'main.js');
    assert.match(boot, /^\s*initGenieSettings\(\);/m, 'called, not awaited');
    assert.doesNotMatch(boot, /await initGenieSettings/);

    const svc = read('src', 'services', 'genieSettings.js');
    assert.match(svc, /if \(cached\) configureGenie\(cached\);\s*\n\s*refreshGenieSettings\(\);/);
    assert.match(svc, /await import\('\.\.\/core\/api\.js'\)/, 'api stays out of the static import graph');
  });
});
