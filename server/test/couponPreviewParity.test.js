/**
 * couponPreviewParity.test.js — the coupon preview (validateCoupon, POST /promotions/coupons/validate
 * and the live-stream quote) shows the discount checkout charges (computeCheckoutCouponDiscount).
 *
 * Invariant: for every scope type and every discount type, the preview's discount equals checkout's
 * to the paisa, and a coupon checkout refuses is one the preview reports as invalid with the reason
 * the client and live stream already understand.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCoupon, computeCheckoutCouponDiscount } from '../src/services/coupon.service.ts';
import { toPaisa } from '../src/services/pricing.service.ts';

// A two-supplier cart whose cheapest unit (৳150, product 4) sits outside every non-platform scope
// below, so a BUY_X_GET_Y that looked at the whole cart would give the wrong unit away.
const ITEMS = [
  { productId: 1, categoryId: 10, supplierId: 101, salerId: 201, price: 700.5, qty: 1 },
  { productId: 2, categoryId: 20, supplierId: 102, salerId: 202, price: 1200, qty: 1 },
  { productId: 3, categoryId: 20, supplierId: 102, salerId: 202, price: 300.33, qty: 2 },
  { productId: 4, categoryId: 30, supplierId: 103, salerId: 203, price: 150, qty: 1 },
];
const SHIPPING_PER_PARCEL = 60;

// The same mapping checkout.service.ts applies to cart rows.
const checkoutLines = (items) => items.map((i) => ({
  productId: i.productId, categoryId: i.categoryId, supplierId: i.supplierId, salerId: i.salerId,
  unitPricePaisa: toPaisa(i.price), qty: Number(i.qty),
}));

const SCOPES = [
  { scope_type: 'PLATFORM', scope_ref: null },
  { scope_type: 'PRODUCT', scope_ref: '3' },
  { scope_type: 'CATEGORY', scope_ref: '20' },
  { scope_type: 'SUPPLIER', scope_ref: '102' },
  { scope_type: 'SALER', scope_ref: '201' },
];
const DISCOUNTS = [
  { discount_type: 'PERCENT', discount_value: '12.50', max_discount: null },
  { discount_type: 'PERCENT', discount_value: '30.00', max_discount: '99.99' },
  { discount_type: 'FIXED', discount_value: '250.00', max_discount: null },
  { discount_type: 'FREE_SHIPPING', discount_value: '0.00', max_discount: null },
  { discount_type: 'FREE_SHIPPING', discount_value: '45.00', max_discount: null },
  { discount_type: 'BUY_X_GET_Y', discount_value: '1.00', max_discount: null },
];

const makeCoupon = (over) => ({
  id: 7, code: 'PARITY', min_spend: '0.00', budget_cap: null, budget_used: '0.00',
  usage_limit: null, usage_count: 0, per_user_limit: 5, first_order_only: false,
  funded_by: 'PLATFORM', funded_by_user_id: null, is_active: true,
  starts_at: new Date(Date.now() - 60000), expires_at: new Date(Date.now() + 86400000),
  ...over,
});

const dbFor = (coupon, { perParcelSetting = null } = {}) => ({
  query: async (sql) => {
    if (sql.includes('FROM coupons')) return { rows: [coupon] };
    if (sql.includes('FROM coupon_redemptions')) return { rows: [{ count: 0 }] };
    if (sql.includes('FROM platform_settings') && perParcelSetting != null) {
      return { rows: [{ key: 'delivery.per_parcel_charge', value_json: perParcelSetting }] };
    }
    return { rows: [] };
  },
});

const preview = (coupon, extra = {}) => validateCoupon(dbFor(coupon), {
  code: coupon.code, userId: 9, items: ITEMS, subtotal: 0, shippingPerParcel: SHIPPING_PER_PARCEL, ...extra,
});

const charged = (coupon) => computeCheckoutCouponDiscount({
  coupon, lines: checkoutLines(ITEMS), shippingPerParcelPaisa: toPaisa(SHIPPING_PER_PARCEL),
}).discountPaisa;

describe('Coupon preview matches checkout', () => {
  for (const scope of SCOPES) {
    for (const discount of DISCOUNTS) {
      const label = `${scope.scope_type} × ${discount.discount_type} ${discount.discount_value}${discount.max_discount ? ` cap ${discount.max_discount}` : ''}`;
      test(label, async () => {
        const coupon = makeCoupon({ ...scope, ...discount });
        const res = await preview(coupon);
        const expected = charged(coupon);
        assert.equal(res.valid, true);
        assert.equal(res.discountPaisa, expected);
        assert.equal(toPaisa(res.discountAmount), expected);
        assert.equal(res.attribution.discountAmount, res.discountAmount);
      });
    }
  }

  test('BUY_X_GET_Y frees the cheapest in-scope unit, not the cheapest unit in the cart', async () => {
    const res = await preview(makeCoupon({ scope_type: 'SUPPLIER', scope_ref: '102', discount_type: 'BUY_X_GET_Y', discount_value: '1.00' }));
    assert.equal(res.discountPaisa, 30033); // ৳300.33, not the out-of-scope ৳150 unit
  });

  test('FREE_SHIPPING frees only the parcels holding in-scope items', async () => {
    const res = await preview(makeCoupon({ scope_type: 'CATEGORY', scope_ref: '20', discount_type: 'FREE_SHIPPING', discount_value: '0.00' }));
    assert.equal(res.discountPaisa, 6000); // one parcel (supplier 102) of three
  });

  test('without a per-parcel figure FREE_SHIPPING reads the delivery policy, as checkout does', async () => {
    const coupon = makeCoupon({ discount_type: 'FREE_SHIPPING', discount_value: '0.00' });
    const res = await validateCoupon(dbFor(coupon, { perParcelSetting: 80 }), { code: 'PARITY', items: ITEMS, subtotal: 0 });
    assert.equal(res.discountPaisa, 3 * 8000);
  });

  test('the remaining budget clamps the preview exactly as it clamps the order', async () => {
    const coupon = makeCoupon({ discount_type: 'FIXED', discount_value: '250.00', budget_cap: '1000.00', budget_used: '899.99' });
    const res = await preview(coupon);
    assert.equal(res.discountPaisa, charged(coupon));
    assert.equal(res.discountPaisa, 10001);
  });

  describe('a coupon checkout refuses is invalid in the preview, with the reason callers know', () => {
    test('no in-scope item', async () => {
      const res = await preview(makeCoupon({ scope_type: 'PRODUCT', scope_ref: '999', discount_type: 'PERCENT', discount_value: '10.00' }));
      assert.deepEqual(res, { valid: false, reason: 'NO_ELIGIBLE_ITEMS_FOR_SCOPE' });
    });

    test('min spend counts only in-scope items', async () => {
      // Cart is ৳2,651.16 but supplier 101's in-scope items are ৳700.50, under the ৳1,000 minimum.
      const res = await preview(makeCoupon({ scope_type: 'SUPPLIER', scope_ref: '101', min_spend: '1000.00', discount_type: 'FIXED', discount_value: '50.00' }));
      assert.deepEqual(res, { valid: false, reason: 'MIN_SPEND_NOT_MET', minSpend: 1000, eligibleSubtotal: 700.5 });
    });

    test('budget used up', async () => {
      const res = await preview(makeCoupon({ discount_type: 'FIXED', discount_value: '50.00', budget_cap: '100.00', budget_used: '100.00' }));
      assert.deepEqual(res, { valid: false, reason: 'COUPON_BUDGET_EXHAUSTED' });
    });
  });

  test('a bare subtotal with no lines is still judged against a platform coupon', async () => {
    const coupon = makeCoupon({ discount_type: 'PERCENT', discount_value: '10.00' });
    const res = await validateCoupon(dbFor(coupon), { code: 'PARITY', subtotal: 1234.56 });
    assert.equal(res.discountPaisa, 12345);
  });
});
