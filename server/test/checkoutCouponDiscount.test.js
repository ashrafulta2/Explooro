/**
 * checkoutCouponDiscount.test.js — the discount checkout charges for a coupon (coupon.service.ts
 * computeCheckoutCouponDiscount / allocateDiscountBySupplier).
 *
 * Invariants: only in-scope lines count for min spend and discount; only parcels holding in-scope
 * items bear the discount; one order never takes more than the coupon's remaining budget; the
 * sub-order shares always add up to the whole discount.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCheckoutCouponDiscount, allocateDiscountBySupplier } from '../src/services/coupon.service.ts';

const LINES = [
  { productId: 1, categoryId: 10, supplierId: 101, salerId: 201, unitPricePaisa: 70000, qty: 1 },
  { productId: 2, categoryId: 20, supplierId: 102, salerId: 202, unitPricePaisa: 120000, qty: 1 },
  { productId: 3, categoryId: 20, supplierId: 102, salerId: 202, unitPricePaisa: 30000, qty: 2 },
];

const coupon = (over) => ({
  discount_type: 'PERCENT', discount_value: '10.00', max_discount: null, min_spend: '0.00',
  budget_cap: null, budget_used: '0.00', scope_type: 'PLATFORM', scope_ref: null, ...over,
});

describe('Checkout coupon discount', () => {
  test('a platform coupon covers the whole cart, split by item value', () => {
    const { discountPaisa, basisBySupplier } = computeCheckoutCouponDiscount({ coupon: coupon(), lines: LINES });
    assert.equal(discountPaisa, 25000); // 10% of ৳2,500
    assert.deepEqual([...basisBySupplier], [['101', 70000], ['102', 180000]]);
  });

  test('each scope type counts only its own lines', () => {
    const cases = [
      [{ scope_type: 'PRODUCT', scope_ref: '2' }, 12000],
      [{ scope_type: 'CATEGORY', scope_ref: '20' }, 18000],
      [{ scope_type: 'SUPPLIER', scope_ref: '101' }, 7000],
      [{ scope_type: 'SALER', scope_ref: '202' }, 18000],
    ];
    for (const [over, expected] of cases) {
      assert.equal(computeCheckoutCouponDiscount({ coupon: coupon(over), lines: LINES }).discountPaisa, expected, over.scope_type);
    }
  });

  test('min spend is measured on in-scope items, not the whole cart', () => {
    // Cart is ৳2,500 but Alpha's items are only ৳700
    assert.throws(
      () => computeCheckoutCouponDiscount({ coupon: coupon({ scope_type: 'SUPPLIER', scope_ref: '101', min_spend: '1000.00' }), lines: LINES }),
      (err) => err.code === 'COUPON_INVALID'
    );
  });

  test('a coupon with nothing in scope is refused', () => {
    assert.throws(
      () => computeCheckoutCouponDiscount({ coupon: coupon({ scope_type: 'SUPPLIER', scope_ref: '999' }), lines: LINES }),
      (err) => err.code === 'COUPON_INVALID'
    );
  });

  test('one order never overshoots the remaining budget', () => {
    const c = coupon({ discount_type: 'FIXED', discount_value: '500.00', budget_cap: '1000.00', budget_used: '880.00' });
    assert.equal(computeCheckoutCouponDiscount({ coupon: c, lines: LINES }).discountPaisa, 12000);
    assert.throws(
      () => computeCheckoutCouponDiscount({ coupon: { ...c, budget_used: '1000.00' }, lines: LINES }),
      (err) => err.code === 'COUPON_BUDGET_EXHAUSTED'
    );
  });

  test('percent coupons respect max_discount; fixed coupons never exceed in-scope items', () => {
    assert.equal(computeCheckoutCouponDiscount({ coupon: coupon({ discount_value: '50.00', max_discount: '300.00' }), lines: LINES }).discountPaisa, 30000);
    assert.equal(computeCheckoutCouponDiscount({ coupon: coupon({ discount_type: 'FIXED', discount_value: '5000.00', scope_type: 'SUPPLIER', scope_ref: '101' }), lines: LINES }).discountPaisa, 70000);
  });

  test('free shipping waives only the parcels that hold in-scope items', () => {
    const scoped = computeCheckoutCouponDiscount({
      coupon: coupon({ discount_type: 'FREE_SHIPPING', discount_value: '0.00', scope_type: 'SUPPLIER', scope_ref: '102' }),
      lines: LINES, shippingPerParcelPaisa: 6000,
    });
    assert.equal(scoped.discountPaisa, 6000);
    assert.deepEqual([...scoped.basisBySupplier], [['102', 6000]]);

    const capped = computeCheckoutCouponDiscount({
      coupon: coupon({ discount_type: 'FREE_SHIPPING', discount_value: '50.00' }), lines: LINES, shippingPerParcelPaisa: 6000,
    });
    assert.equal(capped.discountPaisa, 5000, 'a value caps the waiver');
  });

  test('buy-two-get-one makes the cheapest in-scope unit free, charged to its supplier', () => {
    const { discountPaisa, basisBySupplier } = computeCheckoutCouponDiscount({ coupon: coupon({ discount_type: 'BUY_X_GET_Y' }), lines: LINES });
    assert.equal(discountPaisa, 30000);
    assert.deepEqual([...basisBySupplier], [['102', 30000]]);
    // A single in-scope unit earns nothing
    const one = computeCheckoutCouponDiscount({ coupon: coupon({ discount_type: 'BUY_X_GET_Y', scope_type: 'PRODUCT', scope_ref: '1' }), lines: LINES });
    assert.equal(one.discountPaisa, 0);
  });

  test('sub-order shares always add up to the whole discount', () => {
    const basis = new Map([['101', 33333], ['102', 33333], ['103', 33334]]);
    for (const total of [1, 100, 9999, 10001]) {
      const shares = allocateDiscountBySupplier(total, basis);
      assert.equal([...shares.values()].reduce((a, b) => a + b, 0), total);
    }
    assert.equal(allocateDiscountBySupplier(500, new Map()).size, 0);
  });
});
