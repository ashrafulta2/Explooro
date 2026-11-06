/**
 * guidedExperience.test.js — /admin/platform/guided-experience (Prompt 13.7).
 *
 * The nav guard equals the route guard (docs/super-admin-audit.md §5 invariant 1), every string the
 * page reads exists in both locales, and the mock's report reconciles with the raw events it was
 * built from, the same way the real page checks the server's.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { navItemsForRole } from '../src/config/navigation.ts';
import { JOURNEYS } from '../src/config/journeys.ts';
import { buildMockReport } from '../src/mocks/handlers/guidedExperience.ts';
import { reconcile } from '../src/services/guidanceReport.ts';

const ROUTE = '/admin/platform/guided-experience';
const src = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
const en = JSON.parse(src('locales/en.json'));
const bn = JSON.parse(src('locales/bn.json'));
const get = (d, k) => k.split('.').reduce((n, p) => (n == null ? n : n[p]), d);

describe('guided experience page wiring', () => {
  it('the nav item and the route ask for the same permission and module', () => {
    const item = navItemsForRole('super_admin').find((i) => i.path === ROUTE);
    assert.ok(item, 'super admin sidebar has the page');
    assert.equal(item.permission, 'platform.guidance.view');
    assert.equal(item.module, 'core');
    const main = src('main.ts');
    const block = main.slice(main.indexOf(`path: '${ROUTE}'`), main.indexOf(`path: '${ROUTE}'`) + 400);
    assert.match(block, /permission: 'platform\.guidance\.view'/);
    assert.match(block, /module: 'core'/);
    assert.ok(navItemsForRole('admin').some((i) => i.path === ROUTE), 'admins hold the LOW view key too');
  });

  it('every string the page reads exists in English and Bangla', () => {
    const page = src('pages/admin/GuidedExperiencePage.ts') + src('services/guidanceReport.ts');
    const keys = new Set([...page.matchAll(/\bt\(\s*'([a-z0-9_.]+)'/g)].map((m) => m[1]));
    for (const m of page.matchAll(/'(admin_guidance\.[a-z_.]+)'/g)) keys.add(m[1]);
    for (const role of new Set(JOURNEYS.map((s) => s.role))) keys.add(`admin_guidance.role.${role}`);
    keys.add('nav.admin.guided_experience');
    assert.ok(keys.size > 30, `only ${keys.size} keys found`);
    for (const k of keys) {
      assert.equal(typeof get(en, k), 'string', `en: ${k}`);
      assert.equal(typeof get(bn, k), 'string', `bn: ${k}`);
    }
    for (const s of JOURNEYS) {
      assert.equal(typeof get(en, `journey.${s.role}.${s.id}.title`), 'string', `step title ${s.role}.${s.id}`);
    }
  });
});

describe('the seeded preview', () => {
  const report = buildMockReport();

  it('reconciles: per-step rows add up to the raw event totals', () => {
    const r = reconcile(report);
    assert.equal(r.ok, true, JSON.stringify({ r, totals: report.totals }));
    assert.ok(report.totals.reached_events > 100, 'enough seeded events to read');
  });

  it('flags exactly the steps above the configured threshold, worst first', () => {
    const pct = report.settings.abandon_threshold_pct;
    const expected = report.journeys.flatMap((j) => j.steps.filter((s) => s.abandon_rate !== null && s.abandon_rate > pct).map((s) => `${j.role}.${s.id}`));
    assert.deepEqual(report.flagged.map((f) => `${f.role}.${f.id}`).sort(), expected.sort());
    assert.ok(report.flagged.length > 0, 'the preview shows at least one step to fix');
    const rates = report.flagged.map((f) => f.abandon_rate);
    assert.deepEqual(rates, [...rates].sort((a, b) => b - a));
  });

  it('no step finishes more people than reached it', () => {
    for (const j of report.journeys) for (const s of j.steps) assert.ok(s.completed <= s.reached, `${j.role}.${s.id}`);
  });
});
