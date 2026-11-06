/**
 * setupChecklist.test.js — the setup checklist on every dashboard (Prompt 13.4).
 *
 * Invariants: under 80% done it is open, from 80% it folds to one line, at 100% it is gone unless
 * re-opened from Help; every role's dashboard mounts it and honours `?setup=1`; Help links exist;
 * every string it uses is in both locales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checklistState } from '../src/components/guide/SetupChecklist.ts';
import { DASHBOARD_ROUTES, JOURNEY_ROLES, CHECKLIST_COLLAPSE_AT } from '../src/config/journeys.ts';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (p) => readFileSync(join(src, p), 'utf8');
const en = JSON.parse(read('locales/en.json'));
const bn = JSON.parse(read('locales/bn.json'));
const resolve = (dict, key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);
const registered = new Set([...read('main.ts').matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]));

const data = (done, total, over = {}) => ({
  enabled: true,
  reason: null,
  journey: 'saler',
  progress: { done, total },
  current: null,
  upcoming: [],
  steps: Array.from({ length: total }, (_, i) => ({ id: `s${i}`, order: i + 1, status: i < done ? 'done' : 'todo' })),
  ...over,
});

describe('setup checklist — when it shows', () => {
  it('open under the fold threshold, folded from it, gone when finished', () => {
    assert.equal(CHECKLIST_COLLAPSE_AT, 0.8);
    assert.equal(checklistState(data(0, 7)), 'expanded');
    assert.equal(checklistState(data(5, 7)), 'expanded'); // 71%
    assert.equal(checklistState(data(4, 5)), 'collapsed'); // exactly 80%
    assert.equal(checklistState(data(6, 7)), 'collapsed');
    assert.equal(checklistState(data(7, 7)), 'hidden');
  });

  it('a finished list comes back only when re-opened from Help', () => {
    assert.equal(checklistState(data(7, 7), true), 'all_done');
    assert.equal(checklistState(data(3, 7), true), 'expanded');
  });

  it('nothing to draw: no answer, opted out, no journey, no steps', () => {
    assert.equal(checklistState(null), 'hidden');
    assert.equal(checklistState(data(0, 7, { enabled: false, reason: 'opted_out' })), 'hidden');
    assert.equal(checklistState(data(0, 0, { journey: null }), true), 'hidden');
    assert.equal(checklistState(data(0, 7, { steps: [] })), 'hidden');
  });
});

describe('setup checklist — where it lives', () => {
  it('every role has a dashboard, and it is a registered route', () => {
    assert.deepEqual(Object.keys(DASHBOARD_ROUTES).sort(), [...JOURNEY_ROLES].sort());
    assert.deepEqual(Object.values(DASHBOARD_ROUTES).filter((r) => !registered.has(r)), []);
  });

  it('all six dashboards mount it and honour ?setup=1, and none still mounts the bare card', () => {
    const pages = [
      'pages/customer/CustomerDashboardPage.ts',
      'pages/saler/SalerDashboardPage.ts',
      'pages/supplier/SupplierDashboardPage.ts',
      'pages/moderator/ModeratorDashboardPage.ts',
      'pages/editor/EditorDashboardPage.ts',
      'pages/admin/AdminDashboardPage.ts',
    ];
    for (const page of pages) {
      const text = read(page);
      assert.match(text, /mountSetupChecklist\(guideSlot, \{ forceOpen: query\.setup === '1' \}\)/, page);
      assert.doesNotMatch(text, /mountNextStepCard/, page);
    }
  });

  it("the Explooro partner's old onboarding widget is gone, so two lists never show at once", () => {
    assert.doesNotMatch(read('pages/saler/SalerDashboardPage.ts'), /renderOnboardingWidget/);
  });

  it('Help re-opens it: settings for every role, the supplier help page, the Explooro partner academy', () => {
    for (const page of ['pages/settings/NotificationPreferencesPage.ts', 'pages/supplier/SupplierHelpPage.ts', 'pages/AcademyPage.ts']) {
      assert.match(read(page), /setupChecklistLink\(\)/, page);
    }
  });

  it('every string it uses is in English and Bangla', () => {
    // Any quoted journey key, since several sit inside a ternary rather than directly in t('...').
    const keys = [...read('components/guide/SetupChecklist.ts').matchAll(/'(journey\.[a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(keys.length >= 10, 'the checklist reads its labels from journey.checklist');
    const missing = keys.filter((k) => typeof resolve(en, k) !== 'string' || !/[ঀ-৿]/.test(resolve(bn, k) || ''));
    assert.deepEqual(missing, []);
  });
});
