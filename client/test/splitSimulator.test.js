/**
 * splitSimulator.test.js — the Profit Split simulator quotes the split a sale really gets.
 *
 * Invariants: retail is the supplier price plus the markup, rounded up; the three parts add up to the
 * retail price; the partner pool gets the admin's share of the margin unless that would leave the
 * platform under its floor; the page no longer offers the dead category/tier inputs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { simulateSplit } from '../src/pages/admin/splitSimulator.ts';

const policy = { roundToBdt: 10, partnerSharePct: 70, platformFloorPct: 10 };

test('৳1,000 at 15%: retail 1,150, the 10% floor leaves the pool 50', () => {
  const r = simulateSplit({ supplierPrice: 1000, markupPct: 15, ...policy });
  assert.equal(r.retail, 1150);
  assert.equal(r.supplier, 1000);
  assert.equal(r.margin, 150);
  // 70% of 150 is 105, but the platform keeps its ৳100 floor, so only 50 fits.
  assert.equal(r.partnerPool, 50);
  assert.equal(r.platform, 100);
  assert.equal(r.partnerCapped, true);
  assert.equal(r.supplier + r.partnerPool + r.platform, r.retail);
  assert.equal(r.pct.supplier + r.pct.partnerPool + r.pct.platform, 100);
});

test('a wide markup pays the pool its full 70%', () => {
  // 1,000 at 50%: margin 500, 70% is 350, platform 150 is above its 100 floor.
  const r = simulateSplit({ supplierPrice: 1000, markupPct: 50, ...policy });
  assert.equal(r.partnerPool, 350);
  assert.equal(r.platform, 150);
  assert.equal(r.partnerCapped, false);
});

test('retail rounds up to the step, and the extra widens the margin', () => {
  // 999 x 1.15 = 1,148.85 → 1,150.
  const r = simulateSplit({ supplierPrice: 999, markupPct: 15, ...policy });
  assert.equal(r.retail, 1150);
  assert.equal(r.margin, 151);
  const exact = simulateSplit({ supplierPrice: 999, markupPct: 15, ...policy, roundToBdt: 0 });
  assert.equal(exact.retail, 1148.85);
});

test('a markup below the floor gives the pool nothing', () => {
  const r = simulateSplit({ supplierPrice: 1000, markupPct: 5, ...policy, roundToBdt: 0 });
  assert.equal(r.partnerPool, 0);
  assert.equal(r.platform, 50);
  assert.equal(r.marginBelowFloor, true);
});

test('paisa stay exact on odd prices', () => {
  const r = simulateSplit({ supplierPrice: 777.77, markupPct: 17, ...policy, roundToBdt: 0 });
  assert.equal(Math.round((r.supplier + r.partnerPool + r.platform) * 100), Math.round(r.retail * 100));
});

test('impossible inputs return null instead of a split', () => {
  assert.equal(simulateSplit({ supplierPrice: 0, markupPct: 15, ...policy }), null);
  assert.equal(simulateSplit({ supplierPrice: 100, markupPct: -1, ...policy }), null);
  assert.equal(simulateSplit({ supplierPrice: 100, markupPct: NaN, ...policy }), null);
});

test('the page uses this engine and dropped the dead inputs', () => {
  const page = fs.readFileSync(path.resolve(import.meta.dirname, '../src/pages/admin/ProfitSplitsPage.ts'), 'utf8');
  // WHY no import-shaped string here: tsMigration.test.js would resolve it against test/.
  assert.ok(page.includes('splitSimulator.ts') && page.includes('simulateSplit({'));
  for (const gone of ['calculateSimulation', 'sim-select-category', 'sim-select-tier', 'global-saler-profit-input', 'global-extra-platform-input', 'global-min-margin']) {
    assert.ok(!page.includes(gone), `${gone} should be gone`);
  }
});
