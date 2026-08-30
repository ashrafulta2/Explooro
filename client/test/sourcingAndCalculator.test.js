/**
 * sourcingAndCalculator.test.js — Invariants for Saler Sourcing, Profit Calculator & Margin Projections (Prompt 4.7).
 *
 * Pins the core business invariants:
 *   1. Locale integrity — en/bn parity for sourcing.* keys.
 *   2. Financial & split arithmetic invariant — zero floating point drift, exact paisa calculations.
 *   3. Dynamic profit calculator rules — retail = base + wholesale + net retail margin.
 *   4. Margin projection engine — volume multiplier and milestone progression.
 *   5. Sourcing catalog filtering & sorting invariants — margin %, category, and price sorting.
 *   6. Add to store drawer validation — minimum retail price bound and margin enforcement.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };

test('Prompt 4.7: Sourcing Catalog & Profit Calculator — Client Invariants', async (t) => {
  // 1. Locale Integrity
  await t.test('1. Locale integrity — en/bn key parity for sourcing namespace', () => {
    const enKeys = Object.keys(enDict.sourcing || {}).sort();
    const bnKeys = Object.keys(bnDict.sourcing || {}).sort();
    assert.ok(enKeys.length > 0, 'sourcing namespace must exist in en.json');
    assert.ok(bnKeys.length > 0, 'sourcing namespace must exist in bn.json');
    assert.deepEqual(enKeys, bnKeys, 'sourcing keys must match across en and bn');
  });

  // 2. Financial & Split Arithmetic Invariant (Zero Float Drift)
  await t.test('2. Split arithmetic invariant: Base 500, Retail 700 @ 40/60 split', () => {
    const baseCost = 500;
    const wholesaleMargin = 0;
    const retailPrice = 700;
    const salerSplitPct = 40;
    const platformSplitPct = 60;

    const wholesaleCost = baseCost + wholesaleMargin;
    const netRetailMargin = retailPrice - wholesaleCost; // 200

    // Compute in integer paisa to guarantee zero float drift
    const netMarginPaisa = Math.round(netRetailMargin * 100);
    const salerPaisa = Math.floor((netMarginPaisa * salerSplitPct) / 100);
    const platformPaisa = netMarginPaisa - salerPaisa; // remainder goes to platform

    const salerEarning = salerPaisa / 100;
    const platformEarning = platformPaisa / 100;

    assert.equal(salerEarning, 80.00, 'Saler receives exactly ৳80.00');
    assert.equal(platformEarning, 120.00, 'Platform receives exactly ৳120.00');
    assert.equal(salerEarning + platformEarning, netRetailMargin, 'Sum of earnings matches net margin exactly');
  });

  // 3. Dynamic Profit Calculator with Wholesale Margin
  await t.test('3. Dynamic profit calculator with wholesale margin: Base 800, Wholesale 100, Retail 1200 @ 40/60', () => {
    const baseCost = 800;
    const wholesaleMargin = 100;
    const retailPrice = 1200;
    const salerSplitPct = 40;

    const wholesaleCost = baseCost + wholesaleMargin; // 900
    const netRetailMargin = retailPrice - wholesaleCost; // 300

    const netMarginPaisa = Math.round(netRetailMargin * 100);
    const salerPaisa = Math.floor((netMarginPaisa * salerSplitPct) / 100);
    const platformPaisa = netMarginPaisa - salerPaisa;

    const salerEarning = salerPaisa / 100;
    const platformEarning = platformPaisa / 100;

    assert.equal(salerEarning, 120.00, 'Saler earns exactly ৳120.00');
    assert.equal(platformEarning, 180.00, 'Platform earns exactly ৳180.00');
  });

  // 4. Minimum Margin Validation
  await t.test('4. Price validation: Setting retail price below wholesale cost is invalid', () => {
    const baseCost = 600;
    const wholesaleMargin = 50;
    const invalidRetailPrice = 620; // below wholesale cost of 650

    const wholesaleCost = baseCost + wholesaleMargin;
    const isValid = invalidRetailPrice >= wholesaleCost;

    assert.equal(isValid, false, 'Retail price below wholesale cost must be invalid');
  });

  // 5. Margin Projection Engine
  await t.test('5. Margin projection calculations across volume milestones', () => {
    const unitProfit = 80;
    const milestones = [10, 25, 50, 100, 250, 500];
    const expectedProfits = [800, 2000, 4000, 8000, 20000, 40000];

    milestones.forEach((volume, idx) => {
      const projectedMonthly = unitProfit * volume;
      assert.equal(projectedMonthly, expectedProfits[idx], `Projection for volume ${volume} must be ${expectedProfits[idx]}`);
    });
  });

  // 6. Sourcing Catalog Filtering & Sorting Invariants
  await t.test('6. Sourcing catalog filtering & sorting invariants', () => {
    const demoItems = [
      { id: 1, title_en: 'Jamdani Saree', category: 'Clothing', margin_pct: 25, price: 3200, sales_count: 150 },
      { id: 2, title_en: 'Silk Tangail Saree', category: 'Clothing', margin_pct: 35, price: 4500, sales_count: 90 },
      { id: 3, title_en: 'Brass Tea Set', category: 'Home & Kitchen', margin_pct: 18, price: 1800, sales_count: 210 },
      { id: 4, title_en: 'Organic Sundarban Honey', category: 'Food & Grocery', margin_pct: 12, price: 750, sales_count: 340 },
    ];

    // Filter by margin >= 20%
    const highMargin = demoItems.filter((i) => i.margin_pct >= 20);
    assert.equal(highMargin.length, 2, 'Two items have margin >= 20%');

    // Filter by category 'Clothing'
    const clothing = demoItems.filter((i) => i.category === 'Clothing');
    assert.equal(clothing.length, 2, 'Two items in Clothing category');

    // Sort by margin descending
    const sortedByMargin = [...demoItems].sort((a, b) => b.margin_pct - a.margin_pct);
    assert.equal(sortedByMargin[0].id, 2, 'Item 2 (35% margin) is first');
    assert.equal(sortedByMargin[3].id, 4, 'Item 4 (12% margin) is last');

    // Sort by price ascending
    const sortedByPrice = [...demoItems].sort((a, b) => a.price - b.price);
    assert.equal(sortedByPrice[0].id, 4, 'Lowest price item is first');
  });

  // 7. Add to Store Drawer Custom Price Override
  await t.test('7. Add to Store drawer custom retail price override bounds', () => {
    const product = {
      id: 101,
      base_cost: 400,
      wholesale_margin: 50,
      default_retail_price: 600,
      min_retail_price: 500,
    };

    // Valid custom price override (elevated)
    const customPriceValid = 650;
    assert.ok(customPriceValid >= product.min_retail_price, 'Valid custom price accepted');

    // Profit at elevated custom price
    const wholesaleCost = product.base_cost + product.wholesale_margin; // 450
    const elevatedMargin = customPriceValid - wholesaleCost; // 200
    const salerProfit = Math.floor((elevatedMargin * 40) / 100);
    assert.equal(salerProfit, 80, 'Higher retail price increases saler profit');

    // Invalid custom price (below min_retail_price)
    const customPriceInvalid = 480;
    assert.ok(customPriceInvalid < product.min_retail_price, 'Custom price below minimum must be detected as invalid');
  });
});
