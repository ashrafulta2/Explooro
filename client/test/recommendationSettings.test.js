/**
 * recommendationSettings.test.js — personalized-feed governance, client side (Phase G).
 *
 * Covers:
 *  1. Nav guard == route guard for /admin/platform/recommendations, both permission AND module
 *     (docs/super-admin-audit.md §5 invariant 2); both keys exist in the catalog (invariant 4).
 *  2. en/bn parity, and every key the page can ask for exists (invariant 8: a missing key renders a
 *     humanized slug that looks like real copy).
 *  3. The pure helpers: what is "acceptable", what changed, how rail lists are edited.
 *  4. The mock handlers enforce the server's rules, so a mock-mode demo cannot pass where the real API
 *     would refuse.
 *  5. Page wiring: its stylesheet is not also imported by main.css; the reason gate uses the server's
 *     minimum; no bound is copied into the page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import catalog from '../../docs/permission-catalog.json' with { type: 'json' };
import { navItems } from '../src/config/navigation.js';
import {
  recommendationHandlers,
  MOCK_FIELDS,
  MOCK_RAIL_CATALOGUE,
  MOCK_RAIL_DEFAULTS,
} from '../src/mocks/handlers/recommendations.js';
import {
  parseNumber,
  fieldProblem,
  sectionProblems,
  diffFlat,
  diffRails,
  moveRail,
  removeRail,
  addRail,
  missingRails,
  toPercent,
  isPenalty,
} from '../src/services/recoSettings.js';

const clientRoot = path.resolve(import.meta.dirname, '..');
const read = (...p) => fs.readFileSync(path.join(clientRoot, ...p), 'utf8');
const ROUTE = '/admin/platform/recommendations';
const REASON = 'Raising trending after the Eid campaign review.';

const handler = (method, p) => recommendationHandlers.find((h) => h.method === method && h.path === p);
const getAll = () => handler('GET', ROUTE).handler().body;
const put = (section, body) => handler('PUT', `${ROUTE}/:section`).handler({ params: { section }, body });
const clone = (v) => JSON.parse(JSON.stringify(v));

// A section description shaped like the API's, built from the mock's.
const describe = (key) => getAll().sections.find((s) => s.key === key);

test('Personalized feed admin — client invariants', async (t) => {
  await t.test('1. Nav guard equals route guard, on both permission and module', () => {
    const navItem = navItems.find((i) => i.path === ROUTE);
    assert.ok(navItem, `navigation.js registers ${ROUTE}`);
    assert.equal(navItem.permission, 'platform.recommendation.view');
    assert.equal(navItem.module, 'core');
    assert.ok(navItem.roles.includes('super_admin') && navItem.roles.includes('admin'));

    const mainSrc = read('src', 'main.js');
    const routeBlock = mainSrc.slice(mainSrc.indexOf(`path: '${ROUTE}'`));
    const block = routeBlock.slice(0, routeBlock.indexOf('},') + 2);
    assert.match(block, /permission: 'platform\.recommendation\.view'/, 'route guard = nav guard');
    assert.match(block, /module: 'core'/, 'route module = nav module');
    assert.match(block, /RecommendationSettingsPage\.js/);
  });

  await t.test('1b. Both permission keys exist; the update key is delegable and not CRITICAL', () => {
    const byKey = new Map(catalog.permissions.map((p) => [p.key, p]));
    assert.ok(byKey.get('platform.recommendation.view'));
    const update = byKey.get('platform.recommendation.update');
    assert.ok(update, 'platform.recommendation.update is in docs/permission-catalog.json');
    assert.equal(update.delegable, true);
    assert.notEqual(update.risk_tier, 'CRITICAL');
  });

  await t.test('1c. The Platform sub-navigation links to the page, and the nav item has an icon', () => {
    assert.match(read('src', 'components', 'admin', 'PlatformSubnav.js'), /key: 'recommendations'[^}]*href: '\/admin\/platform\/recommendations'/);
    assert.match(read('src', 'components', 'ui', 'icons.js'), /'admin\.platform\.recommendations': '\w+'/);
  });

  await t.test('1d. The page is registered in the mock registry', () => {
    assert.match(read('src', 'mocks', 'index.js'), /\.\.\.recommendationHandlers/);
  });

  await t.test('2. Locale parity for admin_reco and the nav label', () => {
    assert.ok(enDict.admin_reco && bnDict.admin_reco);
    const walk = (a, b, prefix) => {
      for (const key of Object.keys(a)) {
        assert.ok(key in b, `bn is missing ${prefix}${key}`);
        if (a[key] && typeof a[key] === 'object') walk(a[key], b[key], `${prefix}${key}.`);
        else assert.equal(typeof b[key], 'string', `${prefix}${key} in bn must be a string`);
      }
    };
    walk(enDict.admin_reco, bnDict.admin_reco, 'admin_reco.');
    walk(bnDict.admin_reco, enDict.admin_reco, 'admin_reco.');
    assert.ok(enDict.nav.admin.recommendations && bnDict.nav.admin.recommendations);
  });

  await t.test('2b. Every placeholder in an English string is also in its Bangla string', () => {
    const slots = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort().join();
    const walk = (a, b, prefix) => {
      for (const key of Object.keys(a)) {
        if (a[key] && typeof a[key] === 'object') walk(a[key], b[key], `${prefix}${key}.`);
        else assert.equal(slots(b[key]), slots(a[key]), `${prefix}${key}`);
      }
    };
    walk(enDict.admin_reco, bnDict.admin_reco, 'admin_reco.');
  });

  await t.test('2c. Every static key the page asks for exists', () => {
    const src = read('src', 'pages', 'admin', 'RecommendationSettingsPage.js');
    const keys = [...src.matchAll(/t\(\s*'admin_reco\.([a-z_.]+)'/g)].map((m) => m[1]);
    assert.ok(keys.length > 40, 'the page uses its namespace');
    const has = (dict, dotted) => dotted.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), dict);
    for (const k of keys) {
      assert.equal(typeof has(enDict.admin_reco, k), 'string', `en admin_reco.${k}`);
      assert.equal(typeof has(bnDict.admin_reco, k), 'string', `bn admin_reco.${k}`);
    }
  });

  await t.test('2d. Every dynamic key exists: a label and a hint per field, a tab and an intro per section, rail titles, needs', () => {
    for (const lang of [enDict, bnDict]) {
      const r = lang.admin_reco;
      const sections = ['weights', 'tuning', 'rails', 'diversity', 'covisit', 'cache'];
      for (const s of sections) {
        assert.ok(r.tab[s], `tab.${s}`);
        assert.ok(r.intro[s], `intro.${s}`);
      }
      assert.ok(r.tab.results);
      for (const [section, fields] of Object.entries(MOCK_FIELDS)) {
        for (const f of fields) {
          const key = f.type === 'bool' ? `${section}_enabled` : f.key;
          assert.ok(r.field[key], `field.${key}`);
          assert.ok(r.hint[key], `hint.${key}`);
        }
      }
      for (const c of MOCK_RAIL_CATALOGUE) {
        assert.ok(lang.discover.rails[`${c.key}_title`], `discover.rails.${c.key}_title`);
        if (c.needs) assert.ok(r.needs[c.needs], `needs.${c.needs}`);
      }
      for (const k of ['feed', 'grid', 'search']) assert.ok(r.surface[k], `surface.${k}`);
      for (const k of ['rail_enabled', 'rail_limit', 'rail_window_days', 'min_items']) assert.ok(r.field[k], `field.${k}`);
    }
  });

  await t.test('3. fieldProblem: bounds, whole numbers, NaN and the "0 means off" exception', () => {
    const w = { type: 'number', min: 0, max: 20 };
    assert.equal(fieldProblem(w, 0), null);
    assert.equal(fieldProblem(w, 20), null);
    assert.equal(fieldProblem(w, 20.01), 'range');
    assert.equal(fieldProblem(w, -0.1), 'range');
    assert.equal(fieldProblem(w, NaN), 'number');
    assert.equal(fieldProblem(w, '3'), 'number');
    assert.equal(fieldProblem({ type: 'int', min: 1, max: 9 }, 2.5), 'whole');
    const explore = { type: 'int', min: 2, max: 50, allow_zero: true };
    assert.equal(fieldProblem(explore, 0), null);
    assert.equal(fieldProblem(explore, 1), 'range');
    assert.equal(fieldProblem(explore, 2), null);
    assert.equal(fieldProblem({ type: 'bool' }, true), null);
    assert.equal(fieldProblem({ type: 'bool' }, 1), 'number');
  });

  await t.test('3b. parseNumber: empty and junk are NaN, never 0', () => {
    for (const bad of ['', '   ', 'abc', null, undefined]) assert.ok(Number.isNaN(parseNumber(bad)), String(bad));
    assert.equal(parseNumber('2.5'), 2.5);
    assert.equal(parseNumber(' 7 '), 7);
    assert.equal(parseNumber(3), 3);
  });

  await t.test('3c. sectionProblems: defaults are clean; one bad field names itself; all-zero weights are refused', () => {
    for (const key of ['weights', 'tuning', 'rails', 'diversity', 'covisit', 'cache']) {
      const s = describe(key);
      assert.deepEqual(sectionProblems(s, clone(s.value)), [], key);
    }
    const w = describe('weights');
    const bad = clone(w.value);
    bad.trending = 99;
    assert.deepEqual(sectionProblems(w, bad), [{ path: 'trending', code: 'range' }]);

    const zero = clone(w.value);
    for (const k of Object.keys(zero)) if (!isPenalty(k)) zero[k] = 0;
    assert.deepEqual(sectionProblems(w, zero), [{ path: 'value', code: 'no_positive' }]);

    const rails = describe('rails');
    const r = clone(rails.value);
    r.rails[0].limit = 500;
    r.min_items = NaN;
    const paths = sectionProblems(rails, r).map((p) => p.path).sort();
    assert.deepEqual(paths, ['min_items', 'rails.continue_browsing.limit']);
  });

  await t.test('3d. diffFlat lists only the fields that moved, in form order', () => {
    const w = describe('weights');
    const draft = clone(w.value);
    draft.quality = 4;
    draft.affinity_category = 5;
    assert.deepEqual(diffFlat(w, w.value, draft), [
      { key: 'affinity_category', from: 3, to: 5 },
      { key: 'quality', from: 2, to: 4 },
    ]);
    assert.deepEqual(diffFlat(w, w.value, clone(w.value)), []);
  });

  await t.test('3e. diffRails: min_items, add, remove, enable, limit, window and order — and adding at the end is not a reorder', () => {
    const saved = clone(MOCK_RAIL_DEFAULTS);
    assert.deepEqual(diffRails(saved, clone(saved)), []);

    const d1 = clone(saved);
    d1.min_items = 6;
    d1.rails.find((r) => r.key === 'trending').enabled = false;
    d1.rails.find((r) => r.key === 'for_you').limit = 8;
    d1.rails.find((r) => r.key === 'new_arrivals').window_days = 14;
    assert.deepEqual(
      diffRails(saved, d1).map((c) => [c.kind, c.key ?? null]),
      [['min_items', null], ['limit', 'for_you'], ['enabled', 'trending'], ['window_days', 'new_arrivals']] // draft order
    );

    const removed = removeRail(saved, 'near_you');
    assert.deepEqual(diffRails(saved, removed), [{ kind: 'removed', key: 'near_you' }]);
    assert.deepEqual(diffRails(removed, saved).map((c) => c.kind), ['added'], 'putting it back at the end is an addition, not a reorder');

    const moved = moveRail(saved, 3, -1);
    assert.deepEqual(diffRails(saved, moved).map((c) => c.kind), ['order']);
  });

  await t.test('3f. Rail list edits are pure, bounded and keep the shipped defaults for an added rail', () => {
    const v = clone(MOCK_RAIL_DEFAULTS);
    assert.equal(moveRail(v, 0, -1), v, 'cannot move the first rail up');
    assert.equal(moveRail(v, v.rails.length - 1, 1), v, 'cannot move the last rail down');
    const moved = moveRail(v, 0, 1);
    assert.deepEqual(moved.rails.slice(0, 2).map((r) => r.key), ['also_viewed', 'continue_browsing']);
    assert.equal(v.rails[0].key, 'continue_browsing', 'the original is untouched');

    const trimmed = removeRail(removeRail(v, 'new_arrivals'), 'near_you');
    assert.deepEqual(missingRails(trimmed, MOCK_RAIL_CATALOGUE).map((c) => c.key), ['new_arrivals', 'near_you']);
    const back = addRail(trimmed, 'new_arrivals', MOCK_RAIL_DEFAULTS);
    assert.deepEqual(back.rails.at(-1), { key: 'new_arrivals', enabled: true, limit: 12, window_days: 30 });
    assert.equal(addRail(back, 'new_arrivals', MOCK_RAIL_DEFAULTS), back, 'a rail is never added twice');
    assert.equal(addRail(back, 'editors_picks', MOCK_RAIL_DEFAULTS), back, 'an unknown rail is ignored');
  });

  await t.test('3g. toPercent: a null ratio stays null (nothing to divide by is not 0%)', () => {
    assert.equal(toPercent(null), null);
    assert.equal(toPercent(undefined), null);
    assert.equal(toPercent(0), '0.0%');
    assert.equal(toPercent(0.1152), '11.5%');
    assert.equal(toPercent(0.5, 0), '50%');
  });

  await t.test('4. Mock read: every section, the roster, history, runtime and can_update', () => {
    const body = getAll();
    assert.deepEqual(body.sections.map((s) => s.key), ['weights', 'tuning', 'rails', 'diversity', 'covisit', 'cache']);
    assert.ok(body.authority.roles.length);
    assert.ok(body.runtime.node.pool);
    assert.equal(body.can_update, true);
    assert.equal(body.min_reason_length, 10);
    assert.ok(body.sections.every((s) => s.is_default));
  });

  await t.test('4b. Mock write refuses what the server refuses', () => {
    const w = describe('weights');
    const ok = clone(w.value);
    const status = (section, value, extra = {}) => put(section, { value, reason: REASON, ...extra }).status;

    assert.equal(status('weights', { ...ok, trending: 21 }), 400, 'above the maximum');
    assert.equal(status('weights', { ...ok, trending: '3' }), 400, 'a string is not a number');
    assert.equal(status('weights', { ...ok, nonsense: 1 }), 400, 'unknown key');
    const missing = clone(ok);
    delete missing.quality;
    assert.equal(status('weights', missing), 400, 'missing key');
    assert.equal(status('nope', ok), 400, 'unknown section');
    assert.equal(put('weights', { value: ok, reason: 'short' }).status, 400, 'reason under 10 characters');
    assert.equal(status('diversity', { ...describe('diversity').value, explore_every: 1 }), 400, 'explore_every 1 is not allowed');

    const rails = clone(describe('rails').value);
    rails.rails.push({ ...rails.rails[0] });
    assert.equal(status('rails', rails), 400, 'a rail twice');
    assert.equal(put('weights', { value: ok, reason: REASON }).status, 200, 'the same body with valid values is accepted');
    const err = put('weights', { value: { ...ok, trending: 99 }, reason: REASON }).body.error;
    assert.equal(err.code, 'VALIDATION_FAILED');
    assert.ok(err.message_en && err.message_bn);
  });

  await t.test('4c. Mock write: saved value comes back on the next read, history records it, a stale form is a 409', () => {
    const before = describe('cache');
    const next = { ...clone(before.value), pool_ttl_seconds: 120 };
    const res = put('cache', { value: next, reason: REASON, base_updated_at: before.updated_at });
    assert.equal(res.status, 200);
    const after = describe('cache');
    assert.equal(after.value.pool_ttl_seconds, 120);
    assert.equal(after.is_default, false);
    assert.ok(after.updated_at);

    const latest = getAll().history[0];
    assert.equal(latest.after_json.section, 'cache');
    assert.equal(latest.before_json.value.pool_ttl_seconds, 60);
    assert.match(latest.after_json.meta.reason, /Eid campaign/);

    const stale = put('cache', { value: { ...next, pool_ttl_seconds: 200 }, reason: REASON, base_updated_at: before.updated_at });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'CONFLICT');
    assert.equal(describe('cache').value.pool_ttl_seconds, 120, 'a refused write changes nothing');
  });

  await t.test('4d. Mock funnel: ratios are null, not 0, when there is nothing to divide by', () => {
    const body = handler('GET', `${ROUTE}/funnel`).handler({ query: { days: '30' } }).body;
    assert.equal(body.window.days, 30);
    const empty = body.surfaces.find((s) => s.impressions === 0);
    assert.equal(empty.ctr, null);
    assert.equal(empty.cart_rate, null);
    const real = body.surfaces.find((s) => s.source === 'rail:trending');
    assert.equal(real.ctr, Number((real.clicks / real.impressions).toFixed(4)));
  });

  await t.test('5. The page imports its own stylesheet and main.css does not (a double import ships it twice)', () => {
    const page = read('src', 'pages', 'admin', 'RecommendationSettingsPage.js');
    assert.match(page, /import '\.\.\/\.\.\/styles\/components\/reco-settings\.css'/);
    assert.doesNotMatch(read('src', 'styles', 'main.css'), /reco-settings/);
  });

  await t.test('5b. The reason gate uses the minimum the server sends, and the page copies no bound', () => {
    const page = read('src', 'pages', 'admin', 'RecommendationSettingsPage.js');
    assert.match(page, /trim\(\)\.length < minReason\(\)/);
    assert.match(page, /data\?\.min_reason_length \?\? FALLBACK_MIN_REASON/);
    // A bound copied into the page would drift from the service that enforces it.
    assert.doesNotMatch(page, /\b(max|min)\s*[:=]\s*\d{2,}/);
  });

  await t.test('5c. Save is gated on the section being dirty and valid, and on the reason', () => {
    const page = read('src', 'pages', 'admin', 'RecommendationSettingsPage.js');
    assert.match(page, /live\.saveBtn\?\.setDisabled\(!changed \|\| list\.length > 0 \|\| isSaving\)/);
    assert.match(page, /base_updated_at: meta\[key\]\.updated_at \?\? null/);
    assert.match(page, /err\?\.code === 'CONFLICT'/);
  });

  await t.test('5d. Nothing typed by a person reaches innerHTML unescaped', () => {
    const page = read('src', 'pages', 'admin', 'RecommendationSettingsPage.js');
    const templates = [...page.matchAll(/innerHTML = `([\s\S]*?)`;/g)].map((m) => m[1]);
    assert.ok(templates.length >= 4);
    for (const tpl of templates) {
      for (const m of tpl.matchAll(/\$\{([^}]+)\}/g)) {
        const expr = m[1].trim();
        assert.ok(
          // `rows` is only ever built from esc() / diffRow() pieces (diffRow escapes its arguments).
          /^esc\(/.test(expr) || /^rows(\.join\(''\))?$/.test(expr) || /^reason \?/.test(expr) || /^until \?/.test(expr) || /^diffRow\(/.test(expr),
          `unescaped interpolation: ${expr}`
        );
      }
    }
  });
});
