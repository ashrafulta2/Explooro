/**
 * navTiers.test.js — progressive navigation (Prompt 13.5).
 *
 * Invariants: every role's core set has 1 to 7 items, is derived from its journey (so the sidebar and
 * the journey cannot disagree), and leaves every other page under "More"; the command palette still
 * searches the whole tree; a user mid-journey starts in Simple and one who finished starts in Advanced;
 * every label is in both locales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CORE_NAV_LIMIT,
  PROGRESSIVE_DISCLOSURE_ROLES,
  SIMPLE_MODE_ITEMS,
  corePathsFor,
  coreNavItems,
  navItemsForRole,
  navTier,
  defaultUiMode,
} from '../src/config/navigation.ts';
import { JOURNEY_ROLES, DASHBOARD_ROUTES, journeyFor } from '../src/config/journeys.ts';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (p) => readFileSync(join(src, p), 'utf8');
const en = JSON.parse(read('locales/en.json'));
const bn = JSON.parse(read('locales/bn.json'));
const resolve = (dict, key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);

describe('nav tiers — the core set', () => {
  it('every role with a journey has Simple mode, and 1 to 7 core items', () => {
    assert.deepEqual([...PROGRESSIVE_DISCLOSURE_ROLES].sort(), [...JOURNEY_ROLES].sort());
    assert.equal(CORE_NAV_LIMIT, 7);
    for (const role of JOURNEY_ROLES) {
      const core = corePathsFor(role);
      assert.ok(core.length >= 1 && core.length <= CORE_NAV_LIMIT, `${role}: ${core.length} core items`);
      assert.equal(new Set(core).size, core.length, `${role} repeats a core path`);
    }
  });

  it('the core set is exactly the dashboard and the journey pages that are sidebar items, in order', () => {
    for (const role of JOURNEY_ROLES) {
      const sidebar = new Set(navItemsForRole(role).map((item) => item.path));
      const expected = [...new Set([DASHBOARD_ROUTES[role], ...journeyFor(role).map((s) => s.route)])].filter((p) => sidebar.has(p));
      assert.deepEqual(corePathsFor(role), expected.slice(0, CORE_NAV_LIMIT), role);
      // A journey page past the cap is still one click away under More; only the super admin's long
      // set-up journey reaches it today.
      if (expected.length > CORE_NAV_LIMIT) assert.equal(role, 'super_admin');
    }
  });

  it('Simple mode lists the core items, and navTier agrees with it', () => {
    for (const role of JOURNEY_ROLES) {
      assert.deepEqual(SIMPLE_MODE_ITEMS[role].map((i) => i.path), corePathsFor(role), role);
      assert.deepEqual(coreNavItems(role).map((i) => i.path), corePathsFor(role), role);
      for (const item of navItemsForRole(role)) {
        assert.equal(navTier(item, role), corePathsFor(role).includes(item.path) ? 'core' : 'more', `${role} ${item.path}`);
      }
    }
  });

  it('no page becomes unreachable: everything not core is under More, and More is not empty', () => {
    for (const role of JOURNEY_ROLES) {
      const all = navItemsForRole(role).map((i) => i.path);
      const more = all.filter((p) => navTier({ path: p }, role) === 'more');
      assert.deepEqual([...new Set([...corePathsFor(role), ...more])].sort(), [...new Set(all)].sort(), role);
      assert.ok(more.length > 0, `${role} has nothing under More`);
    }
  });

  it('a fresh Explooro partner sees at most 7 items, led by the dashboard', () => {
    const core = corePathsFor('saler');
    assert.ok(core.length <= 7);
    assert.equal(core[0], '/saler');
  });
});

describe('nav tiers — the shell', () => {
  it('a user mid-journey starts in Simple, one who finished in Advanced, an unknown one as before 13.5', () => {
    for (const role of JOURNEY_ROLES) {
      assert.equal(defaultUiMode(role, 'new'), 'simple');
      assert.equal(defaultUiMode(role, 'done'), 'advanced');
    }
    assert.equal(defaultUiMode('saler', 'unknown'), 'simple');
    assert.equal(defaultUiMode('supplier', 'unknown'), 'simple');
    assert.equal(defaultUiMode('admin', 'unknown'), 'advanced');
    assert.equal(defaultUiMode('customer', 'unknown'), 'advanced');
  });

  it('the sidebar decides the mode with defaultUiMode and the user toggle wins', () => {
    assert.match(read('components/shell/Sidebar.ts'), /uiMode\[role\] \?\? defaultUiMode\(role, journeyState\)/);
  });

  it('the command palette still searches the whole tree, not the core set', () => {
    const palette = read('components/shell/CommandPalette.ts');
    assert.match(palette, /navItems\.filter\(/);
    assert.doesNotMatch(palette, /coreNavItems|corePathsFor|SIMPLE_MODE_ITEMS/);
  });

  it('the mobile More sheet draws the sidebar in the user\'s own mode, not forced Advanced', () => {
    const mobile = read('components/shell/MobileNav.ts');
    assert.match(mobile, /uiMode: shell\.uiMode/);
    assert.doesNotMatch(mobile, /uiMode: \{ \[role\]: 'advanced' \}/);
  });

  it('every core item and the More/pin labels are in English and Bangla', () => {
    const keys = ['nav.tiers.more', 'nav.tiers.pin', 'nav.tiers.unpin', ...JOURNEY_ROLES.flatMap((r) => coreNavItems(r).map((i) => i.label_i18n_key))];
    const missing = keys.filter((k) => typeof resolve(en, k) !== 'string' || typeof resolve(bn, k) !== 'string');
    assert.deepEqual(missing, []);
    assert.ok(resolve(en, 'nav.tiers.pin').includes('{{item}}') && resolve(bn, 'nav.tiers.pin').includes('{{item}}'));
  });
});
