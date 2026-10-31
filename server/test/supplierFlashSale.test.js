// A supplier's own flash sale (migration 096, owner decision 2026-10-31).
// Invariants: the supplier pays the whole discount, the platform and partner pool keep their
// regular-price share, a product must sell at its price for min_listing_days first, and the admin's
// limits are enforced, not advisory.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { calculatePricingBreakdown, calculateSupplierFundedBreakdown } from '../src/services/pricing.service.ts';
import {
  DEFAULT_RULES, RULE_LIMITS, assertDealFitsRules, displayStatus, eligibleFrom, sanitizeRules, validateRules,
} from '../src/services/supplierFlashSale.service.ts';

const root = path.resolve(import.meta.dirname, '..');
const DAY = 24 * 3600_000;
// Supplier price ৳2,600 (base 2,400 + margin 200), retail ৳3,200, partner profit ৳300 a unit.
const product = { baseCost: '2400.00', wholesaleMargin: '200.00', partnerProfit: '300.00' };

describe('calculateSupplierFundedBreakdown', () => {
  test('platform and partner keep their regular share; the supplier pays the discount', () => {
    const regular = calculatePricingBreakdown({ ...product, retailPrice: '3200.00' });
    const deal = calculateSupplierFundedBreakdown({ ...product, regularRetailPrice: '3200.00', dealPrice: '2720.00' });

    assert.equal(deal.retail_price, 2720);
    assert.equal(deal.saler_earning, regular.saler_earning, 'partner share unchanged');
    assert.equal(deal.platform_earning, regular.platform_earning, 'platform share unchanged');
    assert.equal(deal.supplier_funded, 480);
    assert.equal(deal.supplier_payout, 2600 - 480);
    assert.equal(deal.regular_supplier_payout, 2600);
    // Every paisa the shopper pays is split, and the sub-order CHECK holds.
    assert.equal(deal.paisa.wholesale_cost + deal.paisa.net_retail_margin, deal.paisa.retail_price);
    assert.equal(deal.paisa.saler_earning + deal.paisa.platform_earning, deal.paisa.net_retail_margin);
  });

  test('the discount comes off the wholesale margin first, then the base cost', () => {
    const small = calculateSupplierFundedBreakdown({ ...product, regularRetailPrice: 3200, dealPrice: 3100 });
    assert.equal(small.wholesale_margin, 100);
    assert.equal(small.base_cost, 2400);
    const big = calculateSupplierFundedBreakdown({ ...product, regularRetailPrice: 3200, dealPrice: 2700 });
    assert.equal(big.wholesale_margin, 0);
    assert.equal(big.base_cost, 2100);
  });

  test('refuses a price that is not a discount, or that leaves the supplier nothing', () => {
    assert.throws(() => calculateSupplierFundedBreakdown({ ...product, regularRetailPrice: 3200, dealPrice: 3200 }), { code: 'VALIDATION_FAILED' });
    assert.throws(() => calculateSupplierFundedBreakdown({ ...product, regularRetailPrice: 3200, dealPrice: 0 }), { code: 'VALIDATION_FAILED' });
    // Platform + partner take ৳600, so ৳600 would pay the supplier ৳0.
    assert.throws(() => calculateSupplierFundedBreakdown({ ...product, regularRetailPrice: 3200, dealPrice: 600 }), (err) => {
      assert.equal(err.code, 'VALIDATION_FAILED');
      assert.equal(err.details.min_price, 600.01);
      return true;
    });
    assert.equal(calculateSupplierFundedBreakdown({ ...product, regularRetailPrice: 3200, dealPrice: '600.01' }).supplier_payout, 0.01);
  });
});

describe('supplier flash rules', () => {
  test('strict write: out of range is refused, never clamped', () => {
    assert.deepEqual(validateRules({ ...DEFAULT_RULES }), { ...DEFAULT_RULES });
    for (const [key, { min, max }] of Object.entries(RULE_LIMITS)) {
      assert.throws(() => validateRules({ ...DEFAULT_RULES, [key]: min - 1 }), { code: 'VALIDATION_FAILED' }, key);
      assert.throws(() => validateRules({ ...DEFAULT_RULES, [key]: max + 1 }), { code: 'VALIDATION_FAILED' }, key);
      assert.throws(() => validateRules({ ...DEFAULT_RULES, [key]: min + 0.5 }), { code: 'VALIDATION_FAILED' }, key);
    }
    assert.throws(() => validateRules({ ...DEFAULT_RULES, enabled: 'yes' }), { code: 'VALIDATION_FAILED' });
  });

  test('forgiving read: a bad stored field falls back to its default', () => {
    assert.deepEqual(sanitizeRules(null), { ...DEFAULT_RULES });
    assert.equal(sanitizeRules({ max_discount_pct: 500 }).max_discount_pct, DEFAULT_RULES.max_discount_pct);
    assert.equal(sanitizeRules({ min_listing_days: 0 }).min_listing_days, 0);
  });

  test('the migration seeds the same defaults the service ships', () => {
    const sql = fs.readFileSync(path.resolve(root, 'src/db/migrations/096_supplier_flash_sales.sql'), 'utf8');
    const seeded = JSON.parse(sql.match(/'(\{"enabled"[^']+)'::jsonb/)[1]);
    assert.deepEqual(seeded, { ...DEFAULT_RULES });
  });
});

describe('assertDealFitsRules', () => {
  const NOW = Date.parse('2026-10-31T12:00:00Z');
  const rules = { ...DEFAULT_RULES };
  const old = { default_retail_price: '3200.00', retail_price_since: new Date(NOW - 30 * DAY).toISOString() };
  const window = (h) => ({ startsAt: new Date(NOW), endsAt: new Date(NOW + h * 3600_000) });
  const ok = (over = {}) => assertDealFitsRules({ rules, product: old, discountPrice: 2720, ...window(24), liveDeals: 0, now: NOW, ...over });

  test('a deal inside every limit passes', () => {
    assert.doesNotThrow(() => ok());
  });

  test('a product must sell at its current price for min_listing_days first', () => {
    const fresh = { ...old, retail_price_since: new Date(NOW - 2 * DAY).toISOString() };
    assert.throws(() => ok({ product: fresh }), (err) => err.details?.reason === 'LISTING_TOO_NEW');
    assert.equal(eligibleFrom(fresh.retail_price_since, 7).getTime(), NOW + 5 * DAY);
    assert.doesNotThrow(() => ok({ product: fresh, rules: { ...rules, min_listing_days: 0 } }));
  });

  test('discount depth, duration and live-deal count are enforced', () => {
    assert.doesNotThrow(() => ok({ discountPrice: 1600 }), '50% off is the limit');
    assert.throws(() => ok({ discountPrice: 1599.99 }), (err) => err.details?.reason === 'DISCOUNT_TOO_DEEP');
    assert.throws(() => ok(window(73)), (err) => err.details?.reason === 'TOO_LONG');
    assert.throws(() => ok({ liveDeals: 5 }), (err) => err.details?.reason === 'TOO_MANY_DEALS');
    assert.throws(() => ok({ startsAt: new Date(NOW - DAY), endsAt: new Date(NOW + 3600_000) }), { code: 'VALIDATION_FAILED' });
  });

  test('switched off means no supplier deal at all', () => {
    assert.throws(() => ok({ rules: { ...rules, enabled: false } }), { code: 'FORBIDDEN' });
  });
});

test('a deal reads Live inside its window, Ended after it, whatever the stored status', () => {
  const NOW = Date.parse('2026-10-31T12:00:00Z');
  const deal = (h0, h1, status = 'SCHEDULED') => ({ status, starts_at: new Date(NOW + h0 * 3600_000), ends_at: new Date(NOW + h1 * 3600_000) });
  assert.equal(displayStatus(deal(-1, 2), NOW), 'ACTIVE');
  assert.equal(displayStatus(deal(1, 2), NOW), 'SCHEDULED');
  assert.equal(displayStatus(deal(-3, -1), NOW), 'COMPLETED');
  assert.equal(displayStatus(deal(-1, 2, 'CANCELLED'), NOW), 'CANCELLED');
});

describe('wiring', () => {
  test('checkout prices a SUPPLIER deal through the supplier-funded split', () => {
    const src = fs.readFileSync(path.resolve(root, 'src/services/checkout.service.ts'), 'utf8');
    assert.match(src, /deal\?\.funded_by === 'SUPPLIER'\s*\?\s*calculateSupplierFundedBreakdown/);
  });

  test('supplier routes are guarded by module, permission and restriction', () => {
    const src = fs.readFileSync(path.resolve(root, 'src/routes/promotion.routes.ts'), 'utf8');
    for (const route of ["app.get('/supplier/flash-sales'", "app.post('/supplier/flash-sales'", "app.post('/supplier/flash-sales/:id/stop'"]) {
      const at = src.indexOf(route);
      assert.ok(at > 0, route);
      const block = src.slice(at, src.indexOf('});', at));
      assert.match(block, /requireFlashSaleModule/, route);
      assert.match(block, /requireOwnFlash/, route);
      if (route.startsWith('app.post')) assert.match(block, /canSell/, route);
    }
  });

  test('the permission is in the catalog and the generated seed', () => {
    const catalog = JSON.parse(fs.readFileSync(path.resolve(root, '../docs/permission-catalog.json'), 'utf8'));
    const perm = catalog.permissions.find((p) => p.key === 'growth.flash_sale.manage_own');
    assert.ok(perm && perm.default_roles.includes('supplier'));
    const seed = fs.readFileSync(path.resolve(root, 'src/db/seeds/001_roles_permissions.sql'), 'utf8');
    assert.ok(seed.includes("('supplier', 'growth.flash_sale.manage_own')"));
  });
});
