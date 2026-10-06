/**
 * proRebatePricing.test.js — the Saler Pro rebate inside resolveSplitPercentages.
 *
 * Invariants:
 *   - module OFF, no subscription, or a lapsed one => the split is EXACTLY what it was before;
 *   - the rebate moves points platform -> saler and the two always still sum to the same total;
 *   - it can never push the platform share below zero;
 *   - an admin's per-product override is never altered by a plan.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSplitPercentages } from '../src/services/pricing.service.js';
import { applyRebate } from '../src/services/subscriptionRebate.js';

/** Fake db answering only the queries the resolver makes. */
function fakeDb({ moduleOn = true, rebate = null, productRule = null } = {}) {
  return {
    async query(sql) {
      if (sql.includes('FROM commission_rules') && sql.includes("'PRODUCT'")) {
        return { rows: productRule ? [productRule] : [] };
      }
      if (sql.includes('FROM commission_rules')) return { rows: [] };
      if (sql.includes('platform_settings')) {
        return { rows: [{ value_json: { saler_split_pct: 40, platform_split_pct: 60 } }] };
      }
      if (sql.includes('FROM platform_modules')) {
        return { rows: [{ key: 'subscription_fees', is_enabled: moduleOn, default_enabled: false }] };
      }
      if (sql.includes('FROM module_targeting_rules')) return { rows: [] };
      if (sql.includes('FROM subscriptions')) {
        return { rows: rebate === null ? [] : [{ commission_rebate_pct: String(rebate) }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  };
}

describe('applyRebate', () => {
  const base = { salerSplitPct: 40, platformSplitPct: 60, ruleSource: 'PLATFORM_SETTINGS' };

  test('moves the points and keeps the total', () => {
    const out = applyRebate(base, 2);
    assert.equal(out.salerSplitPct, 42);
    assert.equal(out.platformSplitPct, 58);
    assert.equal(out.ruleSource, 'PLATFORM_SETTINGS+PRO_REBATE');
  });

  test('zero, negative or junk rebate returns the input untouched', () => {
    for (const r of [0, -1, null, undefined, 'abc', NaN]) assert.equal(applyRebate(base, r), base);
  });

  test('is capped at the platform share', () => {
    const out = applyRebate({ salerSplitPct: 90, platformSplitPct: 10, ruleSource: 'X' }, 25);
    assert.equal(out.platformSplitPct, 0);
    assert.equal(out.salerSplitPct, 100);
  });
});

describe('resolveSplitPercentages with a saler', () => {
  test('active subscription + module ON => 42/58', async () => {
    const out = await resolveSplitPercentages(fakeDb({ rebate: 2 }), { salerId: 7 });
    assert.equal(out.salerSplitPct, 42);
    assert.equal(out.platformSplitPct, 58);
  });

  test('the rebate is whatever the plan stores, not a constant', async () => {
    const out = await resolveSplitPercentages(fakeDb({ rebate: 3.5 }), { salerId: 7 });
    assert.equal(out.salerSplitPct, 43.5);
  });

  test('module OFF => identical to the pre-subscription result', async () => {
    const withSaler = await resolveSplitPercentages(fakeDb({ moduleOn: false, rebate: 2 }), { salerId: 7 });
    const without = await resolveSplitPercentages(fakeDb({ moduleOn: false, rebate: 2 }), {});
    assert.deepEqual(withSaler, without);
    assert.equal(withSaler.salerSplitPct, 40);
  });

  test('no live subscription => unchanged', async () => {
    const out = await resolveSplitPercentages(fakeDb({ rebate: null }), { salerId: 7 });
    assert.equal(out.salerSplitPct, 40);
    assert.equal(out.ruleSource, 'PLATFORM_SETTINGS');
  });

  test('no salerId => unchanged and the subscription tables are never queried', async () => {
    const db = fakeDb({ rebate: 2 });
    const seen = [];
    const spy = { query: (sql, p) => { seen.push(sql); return db.query(sql, p); } };
    const out = await resolveSplitPercentages(spy, {});
    assert.equal(out.salerSplitPct, 40);
    assert.equal(seen.some((s) => s.includes('FROM subscriptions')), false);
  });

  test('a product override is left alone', async () => {
    const productRule = { saler_split_pct: '50', platform_split_pct: '50' };
    const out = await resolveSplitPercentages(fakeDb({ rebate: 2, productRule }), { salerId: 7, productId: 1 });
    assert.equal(out.salerSplitPct, 50);
    assert.equal(out.ruleSource, 'PRODUCT_OVERRIDE');
  });

  test('a failing subscription lookup surfaces instead of paying the wrong split', async () => {
    const db = fakeDb({ rebate: 2 });
    const broken = { query: (sql, p) => (sql.includes('FROM subscriptions') ? Promise.reject(new Error('db down')) : db.query(sql, p)) };
    await assert.rejects(() => resolveSplitPercentages(broken, { salerId: 7 }), /db down/);
  });
});
