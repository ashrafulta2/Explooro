/**
 * splitSimulator.test.js — the Profit Split simulator quotes the split a sale really gets.
 *
 * Invariants: the three parts add up to the retail price; the partner pool gets the admin's share of
 * the margin unless that would leave the platform under its floor; the supplier payout matches the
 * supplier product form; the page no longer offers the dead category/tier inputs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { simulateSplit } from '../src/pages/admin/splitSimulator.ts';

const policy = { partnerSharePct: 40, platformFloorPct: 10 };

test('৳1,500 at 20%: supplier 1,200, pool 120, platform 180', () => {
  const r = simulateSplit({ price: 1500, marginPct: 20, ...policy });
  assert.equal(r.supplier, 1200);
  assert.equal(r.partnerPool, 120);
  assert.equal(r.platform, 180);
  assert.equal(r.platformFloor, 120);
  assert.equal(r.partnerCapped, false);
  assert.equal(r.supplier + r.partnerPool + r.platform, 1500);
  assert.equal(r.pct.supplier + r.pct.partnerPool + r.pct.platform, 100);
});

test('a thin margin cuts the pool so the platform keeps its floor', () => {
  // 1,000 at 15%: payout 850, margin 150, floor 85 → room for 65, and 40% is 60, so no cut.
  const notCapped = simulateSplit({ price: 1000, marginPct: 15, ...policy });
  assert.equal(notCapped.partnerPool, 60);
  // 1,000 at 12%: payout 880, margin 120, floor 88 → 40% is 48 but only 32 fits.
  const capped = simulateSplit({ price: 1000, marginPct: 12, ...policy });
  assert.equal(capped.partnerPool, 32);
  assert.equal(capped.platform, 88);
  assert.equal(capped.partnerCapped, true);
});

test('a margin below the floor gives the pool nothing', () => {
  const r = simulateSplit({ price: 1000, marginPct: 5, ...policy });
  assert.equal(r.partnerPool, 0);
  assert.equal(r.platform, 50);
  assert.equal(r.marginBelowFloor, true);
});

test('paisa stay exact on odd prices', () => {
  const r = simulateSplit({ price: 999.99, marginPct: 17, ...policy });
  assert.equal(Math.round((r.supplier + r.partnerPool + r.platform) * 100), 99999);
});

test('impossible inputs return null instead of a split', () => {
  assert.equal(simulateSplit({ price: 0, marginPct: 20, ...policy }), null);
  assert.equal(simulateSplit({ price: 100, marginPct: 100, ...policy }), null);
  assert.equal(simulateSplit({ price: 100, marginPct: NaN, ...policy }), null);
});

test('the page uses this engine and dropped the dead inputs', () => {
  const page = fs.readFileSync(path.resolve(import.meta.dirname, '../src/pages/admin/ProfitSplitsPage.ts'), 'utf8');
  // WHY no import-shaped string here: tsMigration.test.js would resolve it against test/.
  assert.ok(page.includes('splitSimulator.ts') && page.includes('simulateSplit({'));
  for (const gone of ['calculateSimulation', 'sim-select-category', 'sim-select-tier', 'global-saler-profit-input', 'global-extra-platform-input', 'global-min-margin']) {
    assert.ok(!page.includes(gone), `${gone} should be gone`);
  }
});
