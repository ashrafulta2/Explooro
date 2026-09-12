/**
 * adPricing.test.js — the ad marketplace's pricing invariants.
 *
 * The stated invariants, one test each:
 *  1. A quote's total is subtotal − tier discount + service fee + VAT, to the paisa, with no
 *     float drift (৳0.35 × 1000 recipients must be exactly ৳350.00, not ৳349.99999).
 *  2. PREPAID formats charge now and reserve nothing to meter; METERED formats charge nothing now
 *     and expose a spend cap. A quote is never both.
 *  3. Commercial floors set by an admin are enforced, not advisory — a bid under the floor CPC or
 *     a booking under the minimum days is refused.
 *  4. A rate card is validated on write, so an out-of-range price can never be stored and then
 *     silently used to bill someone.
 *  5. A metered charge never exceeds the budget left, which is what stops a ৳500 campaign from
 *     spending ৳500.08 on its final click.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  quote,
  validateRateCard,
  meteredCharge,
  priceLabel,
  PREPAID_MODELS,
  METERED_MODELS,
} from '../src/services/adPricing.js';

const cpcProduct = {
  key: 'search_boost',
  pricing_model: 'CPC',
  rate_card: {
    floor_cpc: 1.0,
    suggested_cpc: 2.5,
    min_budget: 300,
    service_fee_percent: 0,
    vat_percent: 0,
    tier_discounts: { STARTER: 0, VERIFIED_TRADER: 5, ELITE_PARTNER: 10 },
  },
};

const dailyProduct = {
  key: 'category_banner',
  pricing_model: 'FLAT_DAILY',
  rate_card: {
    daily_rate: 450,
    min_days: 3,
    max_days: 30,
    slots_per_period: 4,
    service_fee_percent: 0,
    vat_percent: 0,
    tier_discounts: { STARTER: 0, VERIFIED_TRADER: 5, ELITE_PARTNER: 10 },
  },
};

const cpsProduct = {
  key: 'push_blast',
  pricing_model: 'CPS',
  rate_card: {
    cps_rate: 0.35,
    min_quantity: 1000,
    max_quantity: 200000,
    service_fee_percent: 0,
    vat_percent: 0,
    tier_discounts: { STARTER: 0, VERIFIED_TRADER: 5, ELITE_PARTNER: 10 },
  },
};

describe('adPricing — totals', () => {
  test('flat daily rental multiplies the admin rate by the booked days', () => {
    const q = quote(dailyProduct, { duration_days: 7 }, { tier: 'STARTER' });
    assert.equal(q.subtotal, '3150.00');   // 450 × 7
    assert.equal(q.total, '3150.00');
    assert.equal(q.charge_now, '3150.00');
  });

  test('tier discount comes off the subtotal before fees', () => {
    const q = quote(dailyProduct, { duration_days: 7 }, { tier: 'VERIFIED_TRADER' });
    assert.equal(q.discount_percent, '5.00');
    assert.equal(q.discount_amount, '157.50');  // 5% of 3150
    assert.equal(q.total, '2992.50');
  });

  test('service fee then VAT stack in that order, each on the running total', () => {
    const product = {
      ...dailyProduct,
      rate_card: { ...dailyProduct.rate_card, service_fee_percent: 10, vat_percent: 15 },
    };
    const q = quote(product, { duration_days: 3 }, { tier: 'STARTER' });
    // 450 × 3 = 1350 → fee 135 → VAT 15% of 1485 = 222.75 → 1707.75
    assert.equal(q.subtotal, '1350.00');
    assert.equal(q.service_fee, '135.00');
    assert.equal(q.vat, '222.75');
    assert.equal(q.total, '1707.75');
  });

  test('per-recipient pricing does not drift on fractional rates', () => {
    // 0.35 × 1000 is exactly 350 in paisa arithmetic; in floats it is 349.99999999999994.
    const q = quote(cpsProduct, { quantity: 1000 }, { tier: 'STARTER' });
    assert.equal(q.subtotal, '350.00');
    assert.equal(q.total, '350.00');
    assert.equal(q.estimate.reach, 1000);
  });

  test('every model classifies as exactly one of prepaid or metered', () => {
    for (const model of [...PREPAID_MODELS, ...METERED_MODELS]) {
      assert.equal(
        PREPAID_MODELS.includes(model) && METERED_MODELS.includes(model),
        false,
        `${model} claims to be both prepaid and metered`
      );
    }
  });

  test('a metered quote charges nothing now and exposes a spend cap instead', () => {
    const q = quote(cpcProduct, { total_budget: 1000, bid_amount: 2.5 }, { tier: 'STARTER' });
    assert.equal(q.billing_mode, 'METERED');
    assert.equal(q.charge_now, '0.00');
    assert.equal(q.budget_cap, '1000.00');
    assert.equal(q.estimate.clicks, 400);  // 1000 / 2.50
  });

  test('a prepaid quote charges now and exposes no spend cap', () => {
    const q = quote(dailyProduct, { duration_days: 3 }, { tier: 'STARTER' });
    assert.equal(q.billing_mode, 'PREPAID');
    assert.equal(q.charge_now, '1350.00');
    assert.equal(q.budget_cap, '0.00');
  });
});

describe('adPricing — admin floors are enforced, not advisory', () => {
  test('a bid below the admin floor CPC is refused', () => {
    assert.throws(
      () => quote(cpcProduct, { total_budget: 1000, bid_amount: 0.5 }, { tier: 'STARTER' }),
      (err) => err.code === 'BID_BELOW_FLOOR'
    );
  });

  test('a budget below the admin minimum is refused', () => {
    assert.throws(
      () => quote(cpcProduct, { total_budget: 100, bid_amount: 2.5 }, { tier: 'STARTER' }),
      (err) => err.code === 'BUDGET_TOO_LOW'
    );
  });

  test('a booking shorter than the admin minimum run is refused', () => {
    assert.throws(
      () => quote(dailyProduct, { duration_days: 1 }, { tier: 'STARTER' }),
      (err) => err.code === 'DURATION_TOO_SHORT'
    );
  });

  test('a booking longer than the admin maximum run is refused', () => {
    assert.throws(
      () => quote(dailyProduct, { duration_days: 60 }, { tier: 'STARTER' }),
      (err) => err.code === 'DURATION_TOO_LONG'
    );
  });

  test('an order below the admin minimum quantity is refused', () => {
    assert.throws(
      () => quote(cpsProduct, { quantity: 10 }, { tier: 'STARTER' }),
      (err) => err.code === 'QUANTITY_TOO_LOW'
    );
  });
});

describe('adPricing — rate card validation', () => {
  test('an out-of-range rate cannot be saved', () => {
    assert.throws(
      () => validateRateCard('CPC', { floor_cpc: 9999 }),
      (err) => err.code === 'RATE_OUT_OF_RANGE'
    );
  });

  test('a non-numeric rate cannot be saved', () => {
    assert.throws(
      () => validateRateCard('FLAT_DAILY', { daily_rate: 'free' }),
      (err) => err.code === 'INVALID_RATE'
    );
  });

  test('a suggested bid below the floor bid cannot be saved', () => {
    assert.throws(
      () => validateRateCard('CPC', { floor_cpc: 3, suggested_cpc: 1 }),
      (err) => err.code === 'INVALID_RATE'
    );
  });

  test('a tier discount over 50% cannot be saved', () => {
    assert.throws(
      () => validateRateCard('CPC', { tier_discounts: { ELITE_PARTNER: 80 } }),
      (err) => err.code === 'RATE_OUT_OF_RANGE'
    );
  });

  test('omitted fields fall back to defaults rather than becoming null', () => {
    const clean = validateRateCard('FLAT_DAILY', { daily_rate: 500 });
    assert.equal(clean.daily_rate, 500);
    assert.equal(typeof clean.min_days, 'number');
    assert.deepEqual(Object.keys(clean.tier_discounts).sort(), ['ELITE_PARTNER', 'STARTER', 'VERIFIED_TRADER']);
  });

  test('fields belonging to other pricing models are not carried onto the card', () => {
    const clean = validateRateCard('FLAT_DAILY', { daily_rate: 500, cpm_rate: 80, floor_cpc: 2 });
    assert.equal(clean.cpm_rate, undefined);
    assert.equal(clean.floor_cpc, undefined);
  });
});

describe('adPricing — metered charges never exceed the remaining budget', () => {
  test('a CPC click is capped at what is left of the budget', () => {
    assert.equal(meteredCharge('CPC', { bidAmount: 2.5, availableBudget: 1.2 }), '1.20');
    assert.equal(meteredCharge('CPC', { bidAmount: 2.5, availableBudget: 100 }), '2.50');
  });

  test('a CPM block costs the rate per thousand views', () => {
    assert.equal(meteredCharge('CPM', { cpmRate: 80, impressions: 1000, availableBudget: 500 }), '80.00');
  });

  test('an exhausted budget charges nothing', () => {
    assert.equal(meteredCharge('CPC', { bidAmount: 2.5, availableBudget: 0 }), '0.00');
    assert.equal(meteredCharge('CPM', { cpmRate: 80, impressions: 1000, availableBudget: -5 }), '0.00');
  });

  test('a sub-paisa CPM impression still bills at least one paisa', () => {
    // WHY: rounding a fractional impression to zero would let a campaign serve views for free.
    assert.equal(meteredCharge('CPM', { cpmRate: 5, impressions: 1, availableBudget: 500 }), '0.01');
  });
});

describe('adPricing — the card label and the quote agree', () => {
  test('the daily label quotes the same rate the quote multiplies', () => {
    assert.equal(priceLabel(dailyProduct).en, '৳450 per day');
    const q = quote(dailyProduct, { duration_days: 3 }, { tier: 'STARTER' });
    assert.equal(q.lines[0].unit_amount, '450.00');
  });

  test('the CPC label quotes the floor, which is also the value the floor check enforces', () => {
    assert.equal(priceLabel(cpcProduct).en, 'From ৳1.00 per click');
    assert.doesNotThrow(() => quote(cpcProduct, { total_budget: 500, bid_amount: 1.0 }, { tier: 'STARTER' }));
  });
});
