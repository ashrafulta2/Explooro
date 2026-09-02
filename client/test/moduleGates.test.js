/**
 * moduleGates.test.js — locks the invariant that every module key a route is gated on has an
 * entry in appStore's DEMO_MODULES.
 *
 * WHY this exists: core/router.js's hasModule() is strict (`ctx.modules[key] === true`), so a
 * module key that is merely ABSENT reads as disabled and the route silently redirects to `/` with
 * no console error and no 404 — the failure mode looks like "the admin page renders the home
 * page". `supplier_verification` shipped that way and took out five routes, including
 * /admin/verification. featureFlags.js's isFeatureEnabled() defaults an unknown key to *true*, so
 * the sidebar happily renders a link the router then refuses — which is what makes it invisible.
 *
 * Parsed from source rather than imported because main.js's route table is built inside an async
 * bootstrap that touches `window`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appStoreSrc = readFileSync(join(root, 'src/state/appStore.js'), 'utf8');
const mainSrc = readFileSync(join(root, 'src/main.js'), 'utf8');

function demoModuleKeys() {
  const block = appStoreSrc.match(/const DEMO_MODULES = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'DEMO_MODULES object literal not found in appStore.js');
  return new Set([...block[1].matchAll(/^\s*([a-z0-9_]+):\s*(?:true|false)\s*,/gm)].map((m) => m[1]));
}

/** Every `{ path, …, module }` route literal in main.js, as `{ path, module }`. */
function routeModuleGates() {
  return [...mainSrc.matchAll(/path: '([^']+)',[\s\S]{0,400}?module: '([^']+)'/g)].map((m) => ({
    path: m[1],
    module: m[2],
  }));
}

describe('Route module gates resolve against the client module registry', () => {
  it('every route module key has an explicit DEMO_MODULES entry', () => {
    const known = demoModuleKeys();
    const gates = routeModuleGates();

    assert.ok(gates.length > 100, `expected to parse the full route table, got ${gates.length}`);

    const orphans = gates.filter((g) => g.module !== 'core' && !known.has(g.module));
    assert.deepEqual(
      orphans,
      [],
      `These routes are gated on a module key absent from DEMO_MODULES, so router.js's strict\n` +
        `hasModule() redirects them to "/" with no error:\n` +
        orphans.map((o) => `  ${o.path} -> module '${o.module}'`).join('\n')
    );
  });

  it('supplier_verification is registered (regression: /admin/verification redirected to home)', () => {
    assert.ok(demoModuleKeys().has('supplier_verification'));
  });
});
