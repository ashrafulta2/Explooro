/**
 * marginShare.test.js — the split printed under a price breakdown must match its earnings rows.
 *
 * WHY: the product page printed the configured split (40/60) under rows whose money went 67/33,
 * because a supplier's partner_profit, not the split, decides the reward pool's side.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePricingBreakdown } from '../src/services/pricing.service.ts';

test('share pcts follow partner_profit, not the configured split', () => {
  const r = calculatePricingBreakdown({ baseCost: 600, retailPrice: 900, salerSplitPct: 40, platformSplitPct: 60, partnerProfit: 200 });
  assert.equal(r.saler_split_pct, 40);
  assert.equal(r.pool_share_pct, 66.67);
  assert.equal(r.platform_share_pct, 33.33);
});

test('share pcts equal the split when no partner_profit is set', () => {
  const r = calculatePricingBreakdown({ baseCost: 500, retailPrice: 700, salerSplitPct: 40, platformSplitPct: 60 });
  assert.equal(r.pool_share_pct, 40);
  assert.equal(r.platform_share_pct, 60);
});

test('a zero margin gives zero shares, never NaN', () => {
  const r = calculatePricingBreakdown({ baseCost: 500, retailPrice: 500 });
  assert.equal(r.pool_share_pct, 0);
  assert.equal(r.platform_share_pct, 0);
});

test('tiered mode carries the shares too', () => {
  const r = calculatePricingBreakdown({ baseCost: 1000, retailPrice: 1300, mode: 'tiered' });
  assert.equal(r.pool_share_pct + r.platform_share_pct, 100);
});
