/**
 * referralEstimate.test.js — the Referral Hub calculator quotes the live programme rules, not literals.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estimateEarnings, programOf, DEFAULT_PROGRAM } from '../src/pages/saler/referralEstimate.js';

test('a percentage programme scales with spend, tier 2 on a 1.5x network', () => {
  const out = estimateEarnings({ tier_1_rate_pct: 5, tier_2_rate_pct: 2 }, 10, 4000);
  assert.equal(out.direct, 2000);
  assert.equal(out.sub, 15 * 4000 * 0.02);
  assert.equal(out.total, 3200);
});

test('changing the saved rates changes the quote', () => {
  const a = estimateEarnings({ tier_1_rate_pct: 5, tier_2_rate_pct: 2 }, 10, 4000).total;
  const b = estimateEarnings({ tier_1_rate_pct: 10, tier_2_rate_pct: 0 }, 10, 4000).total;
  assert.equal(b, 4000);
  assert.notEqual(a, b);
});

test('a rate of 0 is honoured, not replaced by a default', () => {
  assert.equal(estimateEarnings({ tier_1_rate_pct: 0, tier_2_rate_pct: 0 }, 10, 4000).total, 0);
});

test('a fixed-bonus programme ignores spend and pays the configured taka per person', () => {
  const out = estimateEarnings({ qualifying_event: 'SIGNUP', signup_bonus_bdt: 50, tier_1_rate_pct: 5, tier_2_rate_pct: 2 }, 10, 99999);
  assert.equal(out.direct, 500);
  assert.equal(out.sub, 15 * 50 * (2 / 5));
});

test('a fixed-bonus event with no bonus set pays nothing', () => {
  assert.equal(estimateEarnings({ qualifying_event: 'KYC_VERIFIED' }, 10, 4000).total, 0);
});

test('max_tier_depth 1 drops the second tier', () => {
  assert.equal(estimateEarnings({ tier_1_rate_pct: 5, tier_2_rate_pct: 2, max_tier_depth: 1 }, 10, 4000).sub, 0);
});

test('programOf falls back to the defaults when the server sent no programme', () => {
  assert.deepEqual(programOf(null), DEFAULT_PROGRAM);
  assert.equal(programOf({ program: { tier_1_rate_pct: 8 } }).tier_1_rate_pct, 8);
  assert.equal(programOf({ program: { tier_1_rate_pct: 8 } }).holding_period_days, 7);
});
