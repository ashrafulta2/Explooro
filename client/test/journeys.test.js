/**
 * journeys.test.js — every role's journey (Prompt 13.1) stays wired to real routes, real facts and
 * real translations, and docs/journeys.md keeps describing the same steps.
 *
 * Drift here is silent: a renamed route makes the Next-Step card a dead link, a missing key renders a
 * humanized slug, and an undefined fact leaves a step "not done" forever.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  JOURNEY_ROLES,
  STAFF_ROLES,
  JOURNEYS,
  JOURNEY_FACTS,
  BLOCK_REASONS,
  SKIP_RULES,
  NON_SIDEBAR_ROUTES,
  DEAD_ENDS,
  journeyFor,
} from '../src/config/journeys.ts';
import { navItems } from '../src/config/navigation.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(repo, 'client', 'src');
const en = JSON.parse(readFileSync(join(src, 'locales/en.json'), 'utf8'));
const bn = JSON.parse(readFileSync(join(src, 'locales/bn.json'), 'utf8'));
const doc = readFileSync(join(repo, 'docs', 'journeys.md'), 'utf8');
const resolve = (dict, key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);

// The router's table lives in main.ts; every `path: '...'` there is a registered route.
const registered = new Set([...readFileSync(join(src, 'main.ts'), 'utf8').matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]));
const navFor = (role) => navItems.filter((n) => (n.roles || [n.role]).includes(role));
const navItemFor = (role, path) => navFor(role).find((n) => n.path === path);
const reachable = (role, path) => Boolean(navItemFor(role, path)) || path in NON_SIDEBAR_ROUTES;

describe('journeys', () => {
  it('every role has a journey of 5 to 9 steps, ordered 1..n, with unique ids', () => {
    for (const role of JOURNEY_ROLES) {
      const steps = journeyFor(role);
      assert.ok(steps.length >= 5 && steps.length <= 9, `${role} has ${steps.length} steps`);
      assert.deepEqual(steps.map((s) => s.order), steps.map((_, i) => i + 1), role);
      assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, `${role} repeats a step id`);
    }
    assert.ok(JOURNEYS.every((s) => JOURNEY_ROLES.includes(s.role)));
  });

  it('every step route is registered and reachable by that role', () => {
    const bad = JOURNEYS.filter((s) => !registered.has(s.route) || !reachable(s.role, s.route)).map((s) => `${s.role}.${s.id}: ${s.route}`);
    assert.deepEqual(bad, []);
  });

  it('every non-sidebar route is registered', () => {
    assert.deepEqual(Object.keys(NON_SIDEBAR_ROUTES).filter((p) => !registered.has(p)), []);
  });

  it('a step on a page that belongs to a switchable module declares module_off', () => {
    const missing = JOURNEYS.filter((s) => {
      const item = navItemFor(s.role, s.route);
      return item && item.module !== 'core' && !(s.skipWhen || []).includes('module_off');
    }).map((s) => `${s.role}.${s.id}`);
    assert.deepEqual(missing, []);
  });

  it('every fact, block and skip rule is defined, and every defined fact is used', () => {
    for (const s of JOURNEYS) {
      assert.ok(s.doneWhen in JOURNEY_FACTS, `${s.role}.${s.id}: unknown fact ${s.doneWhen}`);
      for (const b of s.blockedBy || []) assert.ok(b in BLOCK_REASONS, `${s.role}.${s.id}: unknown block ${b}`);
      for (const r of s.skipWhen || []) assert.ok(r in SKIP_RULES, `${s.role}.${s.id}: unknown skip rule ${r}`);
    }
    const used = new Set(JOURNEYS.map((s) => s.doneWhen));
    assert.deepEqual(Object.keys(JOURNEY_FACTS).filter((f) => !used.has(f)), []);
  });

  it('not_delegated is used only by staff, and only on a page that needs a permission', () => {
    const bad = JOURNEYS.filter((s) => (s.skipWhen || []).includes('not_delegated')).filter((s) => {
      const item = navItemFor(s.role, s.route);
      return !STAFF_ROLES.includes(s.role) || !item || item.permission == null;
    }).map((s) => `${s.role}.${s.id}`);
    assert.deepEqual(bad, []);
  });

  it('customers are never asked for KYC', () => {
    assert.ok(!journeyFor('customer').some((s) => s.doneWhen.startsWith('kyc.')));
  });

  it('every title, next hint and dead-end hint exists in English and Bangla', () => {
    const keys = [...JOURNEYS.flatMap((s) => [s.title_key, s.nextHint_key]), ...DEAD_ENDS.map((d) => d.hint_key)];
    const missing = [];
    for (const key of keys) {
      const e = resolve(en, key);
      const b = resolve(bn, key);
      if (typeof e !== 'string' || !e.trim()) missing.push(`en: ${key}`);
      if (typeof b !== 'string' || !/[ঀ-৿]/.test(b)) missing.push(`bn: ${key}`);
    }
    assert.deepEqual(missing, []);
  });

  it('every block reason and every journey string the card and settings use exists in both locales', () => {
    const literal = (file) => [...readFileSync(join(src, file), 'utf8').matchAll(/t\('(journey\.[a-z_.]+)'/g)].map((m) => m[1]);
    const keys = [
      ...Object.keys(BLOCK_REASONS).map((r) => `journey.block.${r}`),
      ...literal('components/guide/NextStepCard.ts'),
      ...literal('pages/settings/NotificationPreferencesPage.ts'),
    ];
    assert.ok(keys.length > Object.keys(BLOCK_REASONS).length, 'the card uses journey strings');
    const missing = keys.filter((k) => typeof resolve(en, k) !== 'string' || !/[ঀ-৿]/.test(resolve(bn, k) || ''));
    assert.deepEqual(missing, []);
  });

  it('every dead end has a reachable follow-up and names a file that exists', () => {
    const bad = DEAD_ENDS.filter((d) => !registered.has(d.followUp) || !reachable(d.role, d.followUp) || !existsSync(join(src, d.where)))
      .map((d) => d.id);
    assert.deepEqual(bad, []);
    assert.equal(new Set(DEAD_ENDS.map((d) => d.id)).size, DEAD_ENDS.length);
  });

  it('the dead-end backlog covers checkout, KYC submit, add product, withdrawal and order ship', () => {
    const actions = DEAD_ENDS.map((d) => d.action);
    for (const required of ['order placed', 'KYC submitted', 'product added', 'withdrawal requested', 'order shipped']) {
      assert.ok(actions.includes(required), required);
    }
  });

  it('docs/journeys.md names every step and every dead end', () => {
    const missing = [
      ...JOURNEYS.filter((s) => !doc.includes(`\`${s.role}.${s.id}\``)).map((s) => `${s.role}.${s.id}`),
      ...DEAD_ENDS.filter((d) => !doc.includes(`\`${d.id}\``)).map((d) => d.id),
    ];
    assert.deepEqual(missing, []);
  });
});
