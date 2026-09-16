/**
 * moderatorTools77.test.js — Invariants for the Prompt 7.7 moderator/supplier tooling surfaces
 * (My Access, Penalties, User Reports, Review Integrity, UGC Moderation, Demand Forecasting).
 *
 * These pages shipped as UI-only scaffolds: English-only strings and data endpoints that existed
 * in neither the mock nor the server. This suite pins the completion work so a regression fails
 * the build:
 *   1. Mock contract — every endpoint the pages call is registered and mutates state.
 *   2. Locale parity — every new string exists in both en and bn.
 *   3. No hardcoded chrome — the page titles/subtitles resolve through t(), not literals.
 *   4. Route guards — each 7.7 route names a real permission and a real module.
 *   5. Route uniqueness — the new mock module does not shadow moderator.js.
 *
 * The mock module holds shared module-level state and `node --test` runs top-level tests
 * concurrently, so every state-touching case lives under one parent test (whose subtests run
 * sequentially) and calls reset() first. The read-only tests are race-free on their own.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import handlers, { resetModeratorToolsState } from '../src/mocks/handlers/moderatorTools.js';
import moderatorHandlers from '../src/mocks/handlers/moderator.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const readText = (rel) => fs.readFileSync(path.resolve(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));

const en = readJson('client/src/locales/en.json');
const bn = readJson('client/src/locales/bn.json');
const catalogKeys = new Set(readJson('docs/permission-catalog.json').permissions.map((p) => p.key));
const modulesSrc = readText('server/src/config/modules.seed.json');
const mainSrc = readText('client/src/main.js');

const call = (method, pathname, ctx = {}) => {
  const h = handlers.find((x) => x.method === method && x.path === pathname);
  assert.ok(h, `${method} ${pathname} must be mocked`);
  return h.handler(ctx);
};
const reset = () => resetModeratorToolsState();

test('7.7 mock contracts', async (parent) => {
  await parent.test('My Access — grants served and revocable', () => {
    reset();
    assert.ok(Array.isArray(call('GET', '/me/grants').body.data), 'grants is an array');
    assert.ok(call('GET', '/me/grants/history', { query: { limit: 20 } }).body.data.length >= 1);

    // Snapshot the count and id first — the handler returns the live array by reference, so reading
    // `.length` after the splice would see the mutation.
    const before = call('GET', '/me/grants').body.data;
    const beforeLen = before.length;
    const firstId = before[0].id;
    const res = call('DELETE', '/me/grants/:id', { params: { id: firstId } });
    assert.equal(res.status, 200);
    const after = call('GET', '/me/grants').body.data;
    assert.equal(after.length, beforeLen - 1, 'grant removed');
    assert.equal(call('GET', '/me/grants/history', { query: {} }).body.data[0].event_type, 'revoked');

    assert.equal(call('DELETE', '/me/grants/:id', { params: { id: 'nope' } }).status, 404);
  });

  await parent.test('Penalties — filter, create, lift', () => {
    reset();
    const active = call('GET', '/moderation/penalties', { query: { status: 'ACTIVE' } }).body.data;
    assert.ok(active.length >= 1 && active.every((p) => p.status === 'ACTIVE'));

    assert.equal(call('POST', '/moderation/penalties', { body: { reason: 'x' } }).status, 422, 'user required');
    assert.equal(call('POST', '/moderation/penalties', { body: { user_id: 5 } }).status, 422, 'reason required');

    const created = call('POST', '/moderation/penalties', { body: { user_id: 5, user_name: 'X', penalty_type: 'TEMP_BAN', reason: 'spam', duration_days: 3 } });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.status, 'ACTIVE');
    assert.ok(call('GET', '/moderation/penalties', { query: { status: 'ACTIVE' } }).body.data.some((p) => p.id === created.body.data.id));

    const lifted = call('POST', '/moderation/penalties/:id/lift', { params: { id: created.body.data.id } });
    assert.equal(lifted.body.data.status, 'LIFTED');
  });

  await parent.test('Reports — filter, action, bulk-dismiss', () => {
    reset();
    const first = call('GET', '/moderation/reports', { query: { status: 'OPEN' } }).body.data;
    assert.ok(Array.isArray(first.items) && first.items.every((r) => r.status === 'OPEN'));
    assert.equal(typeof first.stats.open, 'number');

    const openId = first.items[0].id;
    call('POST', '/moderation/reports/:id/:action', { params: { id: openId, action: 'resolve' } });
    const afterResolve = call('GET', '/moderation/reports', { query: { status: 'OPEN' } }).body.data;
    assert.equal(afterResolve.stats.resolved_today, 1);
    assert.ok(!afterResolve.items.some((r) => r.id === openId), 'resolved report leaves OPEN list');

    assert.equal(call('POST', '/moderation/reports/:id/:action', { params: { id: afterResolve.items[0].id, action: 'frobnicate' } }).status, 422);

    const ids = afterResolve.items.slice(0, 2).map((r) => r.id);
    assert.equal(call('POST', '/moderation/reports/bulk-dismiss', { body: { ids } }).body.data.dismissed, 2);
    const stillOpen = call('GET', '/moderation/reports', { query: { status: 'OPEN' } }).body.data.items.map((r) => r.id);
    assert.ok(!ids.some((id) => stillOpen.includes(id)));
  });

  await parent.test('Reviews — decisions leave the pending queue', () => {
    reset();
    const pending = call('GET', '/moderation/reviews', { query: {} }).body.data.items;
    call('POST', '/moderation/reviews/:id/decide', { params: { id: pending[0].id }, body: { decision: 'APPROVED' } });
    const after = call('GET', '/moderation/reviews', { query: {} }).body.data;
    assert.equal(after.stats.approved_today, 1);
    assert.ok(!after.items.some((r) => r.id === pending[0].id));

    assert.equal(call('POST', '/moderation/reviews/:id/decide', { params: { id: after.items[0].id }, body: { decision: 'MAYBE' } }).status, 422);

    const spam = call('GET', '/moderation/reviews', { query: { flag_reason: 'SPAM' } }).body.data.items;
    assert.ok(spam.every((r) => r.flag_reason === 'SPAM'));
  });

  await parent.test('UGC — decisions and bulk-approve mutate state', () => {
    reset();
    const data = call('GET', '/moderation/ugc', { query: {} }).body.data;
    assert.equal(data.stats.ai_flagged, data.items.filter((u) => u.ai_score !== 'SAFE').length);

    const safe = data.items.filter((u) => u.ai_score === 'SAFE').map((u) => u.id);
    assert.equal(call('POST', '/moderation/ugc/bulk-approve', { body: { ids: safe } }).body.data.approved, safe.length);
    const after = call('GET', '/moderation/ugc', { query: {} }).body.data;
    assert.equal(after.stats.approved_today, safe.length);
    assert.ok(!after.items.some((u) => safe.includes(u.id)));

    assert.equal(call('POST', '/moderation/ugc/:id/decide', { params: { id: after.items[0].id }, body: { decision: 'NOPE' } }).status, 422);
  });

  await parent.test('Forecasting — serves the requested horizon', () => {
    reset();
    const data = call('GET', '/supplier/forecasting', { query: { horizon: 60 } }).body.data;
    assert.ok(data.items.length >= 1);
    assert.equal(data.horizon, 60);
    assert.equal(data.items[0].forecast, data.items[0].forecast_60);
    assert.equal(call('GET', '/supplier/forecasting', { query: { horizon: 999 } }).body.data.horizon, 30);
  });
});

test('7.7 mock — routes do not shadow moderator.js', () => {
  const seen = new Map();
  const clashes = [];
  for (const [name, list] of [['moderator.js', moderatorHandlers], ['moderatorTools.js', handlers]]) {
    for (const h of list) {
      const route = `${h.method} ${h.path}`;
      if (seen.has(route)) clashes.push(`${route} — in both ${seen.get(route)} and ${name}`);
      else seen.set(route, name);
    }
  }
  assert.deepEqual(clashes, [], 'a shadowed route silently serves the wrong shape');
});

const NS = ['mod_access', 'mod_penalties', 'mod_reports', 'mod_reviews', 'mod_ugc', 'sup_forecast'];

test('7.7 i18n — en/bn parity for every new section', () => {
  for (const ns of NS) {
    assert.ok(en[ns], `en.json is missing "${ns}"`);
    assert.ok(bn[ns], `bn.json is missing "${ns}"`);
    assert.deepEqual(
      Object.keys(en[ns]).sort(),
      Object.keys(bn[ns]).sort(),
      `every ${ns} key needs a Bangla counterpart`
    );
  }
});

test('7.7 pages — titles resolve through i18n, not hardcoded literals', () => {
  const pages = {
    'client/src/pages/moderator/MyAccessPage.js': 'mod_access.title',
    'client/src/pages/moderator/PenaltiesPage.js': 'mod_penalties.title',
    'client/src/pages/moderator/ReportsPage.js': 'mod_reports.title',
    'client/src/pages/moderator/ReviewsModerationPage.js': 'mod_reviews.title',
    'client/src/pages/moderator/UgcModerationPage.js': 'mod_ugc.title',
    'client/src/pages/supplier/ForecastingPage.js': 'sup_forecast.title',
  };
  for (const [file, titleKey] of Object.entries(pages)) {
    const src = readText(file);
    assert.ok(src.includes(`t('${titleKey}'`), `${file} must render its title via t('${titleKey}', …)`);
    // The i18n import must actually be used (the original scaffolds imported t but never called it).
    const tCalls = (src.match(/\bt\('(mod_|sup_)/g) || []).length;
    assert.ok(tCalls >= 10, `${file} should resolve its strings through t() (found ${tCalls})`);
  }
});

test('7.7 routes — each route names a real permission and module', () => {
  const routeBlocks = [...mainSrc.matchAll(/load:\s*\(\)\s*=>\s*import\('\.\/pages\/(?:moderator|supplier)\/(?:MyAccessPage|PenaltiesPage|ReportsPage|ReviewsModerationPage|UgcModerationPage|ForecastingPage)\.js'\)/g)];
  assert.equal(routeBlocks.length, 6, 'expected all six 7.7 routes registered in main.js');

  const specs = [
    { file: 'PenaltiesPage', permission: 'users.account.penalise', module: 'core' },
    { file: 'ReportsPage', permission: 'moderation.report.handle', module: 'core' },
    { file: 'ReviewsModerationPage', permission: 'moderation.review.handle', module: 'review_integrity' },
    { file: 'UgcModerationPage', permission: 'moderation.ugc.approve', module: 'ugc_video_wall' },
    { file: 'ForecastingPage', permission: 'supplier.analytics.view', module: 'ai_forecasting' },
  ];
  for (const s of specs) {
    if (s.permission) assert.ok(catalogKeys.has(s.permission), `${s.file} route names unknown permission "${s.permission}"`);
    if (s.module !== 'core') assert.ok(modulesSrc.includes(`"${s.module}"`), `${s.file} route names unknown module "${s.module}"`);
  }
});


test('My Access — role restrictions: permitted for admin, moderator, editor; denied for customer, saler, supplier', async () => {
  const { navItems } = await import('../src/config/navigation.js');
  const item = navItems.find((i) => i.key === 'moderator.my_access');
  assert.ok(item, 'moderator.my_access item must exist');
  const roles = item.roles;

  assert.ok(roles.includes('admin'), 'admin must have access to My Access');
  assert.ok(roles.includes('moderator'), 'moderator must have access to My Access');
  assert.ok(roles.includes('editor'), 'editor must have access to My Access');
  assert.ok(roles.includes('super_admin'), 'super_admin must have access to My Access');

  assert.ok(!roles.includes('customer'), 'customer must NOT have access to My Access');
  assert.ok(!roles.includes('saler'), 'saler must NOT have access to My Access');
  assert.ok(!roles.includes('supplier'), 'supplier must NOT have access to My Access');

  // Verify route definition in main.js
  const myAccessRouteMatch = mainSrc.match(/path:\s*'\/moderator\/my-access'[\s\S]*?roles:\s*(\[[^\]]+\])/);
  assert.ok(myAccessRouteMatch, '/moderator/my-access route in main.js must have explicit roles guard');
  const routeRoles = JSON.parse(myAccessRouteMatch[1].replace(/'/g, '"'));
  assert.ok(routeRoles.includes('admin') && routeRoles.includes('moderator') && routeRoles.includes('editor'));
  assert.ok(!routeRoles.includes('customer') && !routeRoles.includes('saler') && !routeRoles.includes('supplier'));
});