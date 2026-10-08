/**
 * salerIncentives.test.js — the progress bar must say how far a saler is to the NEXT tier, not to zero,
 * and must never overflow or go negative.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressPercent } from '../src/pages/saler/SalerIncentivesPage.js';

const tiers = [{ min_volume: 10000, rebate_pct: 1 }, { min_volume: 50000, rebate_pct: 2 }];

test('before the first tier, progress is measured from zero to the first tier', () => {
  assert.equal(progressPercent({ volume: '5000', current_tier: null, next_tier: tiers[0] }), 50);
});

test('between tiers, progress is measured from the tier reached to the next', () => {
  // 30,000 is half way from 10,000 to 50,000
  assert.equal(progressPercent({ volume: '30000', current_tier: tiers[0], next_tier: tiers[1] }), 50);
});

test('at the top tier the bar is full', () => {
  assert.equal(progressPercent({ volume: '90000', current_tier: tiers[1], next_tier: null }), 100);
});

test('the bar is clamped to 0..100', () => {
  assert.equal(progressPercent({ volume: '0', current_tier: null, next_tier: tiers[0] }), 0);
  assert.equal(progressPercent({ volume: '99999', current_tier: tiers[0], next_tier: tiers[1] }), 100);
  assert.equal(progressPercent({ volume: '-5', current_tier: null, next_tier: tiers[0] }), 0);
});
