/**
 * campaigns.js — Mock API handlers for Campaign & Promotion Manager (Prompt 9.2).
 */

let mockFlashSales = [
  {
    id: 1,
    ref: 'FS-2026-EID-01',
    product_id: 101,
    product_title_en: 'Walton Primo S9 Pro 128GB Smartphone',
    product_title_bn: 'ওয়ালটন প্রিমো এস৯ প্রো ১২৮জিবি স্মার্টফোন',
    product_thumbnail: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600',
    original_price: 18500,
    discount_price: 14999,
    allocated_qty: 100,
    sold_qty: 68,
    reserved_qty: 4,
    per_user_limit: 1,
    starts_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    ends_at: new Date(Date.now() + 10 * 3600 * 1000).toISOString(),
    status: 'ACTIVE',
    funding_party: 'PLATFORM_SPONSORED',
  },
  {
    id: 2,
    ref: 'FS-2026-JAMDANI-02',
    product_id: 204,
    product_title_en: 'Heritage Dhakai Jamdani Saree',
    product_title_bn: 'ঐতিহ্যবাহী ঢাকাই জামদানি শাড়ি',
    product_thumbnail: 'https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?w=600',
    original_price: 6500,
    discount_price: 4800,
    allocated_qty: 50,
    sold_qty: 50,
    reserved_qty: 0,
    per_user_limit: 2,
    starts_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    ends_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    status: 'COMPLETED',
    funding_party: 'SUPPLIER_FUNDED',
  },
];

let mockCoupons = [
  {
    id: 1,
    code: 'EIDMUBARAK2026',
    discount_type: 'PERCENT',
    discount_value: 15,
    max_discount_amount: 1500,
    min_spend_amount: 3000,
    budget_cap: 100000,
    spent_amount: 42350,
    redemption_count: 282,
    per_user_limit: 1,
    scope_type: 'PLATFORM',
    starts_at: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
    is_active: true,
  },
  {
    id: 2,
    code: 'FREESHIPDHAKA',
    discount_type: 'FREE_SHIPPING',
    discount_value: 120,
    max_discount_amount: 120,
    min_spend_amount: 1000,
    budget_cap: 50000,
    spent_amount: 28440,
    redemption_count: 237,
    per_user_limit: 3,
    scope_type: 'CATEGORY',
    category_name: 'Dhaka Delivery',
    starts_at: new Date(Date.now() - 10 * 86400 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 20 * 86400 * 1000).toISOString(),
    is_active: true,
  },
  {
    id: 3,
    code: 'HERITAGE20',
    discount_type: 'PERCENT',
    discount_value: 20,
    max_discount_amount: 800,
    min_spend_amount: 2500,
    budget_cap: 30000,
    spent_amount: 12400,
    redemption_count: 45,
    per_user_limit: 1,
    scope_type: 'SALER',
    store_name: 'Heritage Crafts BD',
    starts_at: new Date(Date.now() - 3 * 86400 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 2 * 86400 * 1000).toISOString(), // Expiring soon
    is_active: true,
  },
  {
    id: 4,
    code: 'JAMDANI500',
    discount_type: 'FIXED',
    discount_value: 500,
    max_discount_amount: 500,
    min_spend_amount: 4000,
    budget_cap: 25000,
    spent_amount: 8500,
    redemption_count: 17,
    per_user_limit: 1,
    scope_type: 'CATEGORY',
    category_name: 'Sarees & Traditional Wear',
    starts_at: new Date(Date.now() - 5 * 86400 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 10 * 86400 * 1000).toISOString(),
    is_active: true,
  },
  {
    id: 5,
    code: 'NEWYEAR2026',
    discount_type: 'PERCENT',
    discount_value: 10,
    max_discount_amount: 500,
    min_spend_amount: 1500,
    budget_cap: 20000,
    spent_amount: 20000,
    redemption_count: 120,
    per_user_limit: 1,
    scope_type: 'PLATFORM',
    starts_at: new Date(Date.now() - 60 * 86400 * 1000).toISOString(),
    expires_at: new Date(Date.now() - 15 * 86400 * 1000).toISOString(),
    is_active: false,
    is_used: true,
  },
];

export const campaignHandlers = [
  {
    method: 'GET',
    path: '/admin/growth/campaigns/flash-sales',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            flash_sales: mockFlashSales,
          },
          flash_sales: mockFlashSales,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/admin/growth/campaigns/flash-sales',
    handler({ body }) {
      const newDeal = {
        id: Date.now(),
        ref: `FS-${Date.now().toString(36).toUpperCase()}`,
        product_id: body?.product_id || 101,
        product_title_en: body?.product_title || 'Promotional Flash Deal Item',
        original_price: body?.original_price || 2000,
        discount_price: body?.discount_price || 1500,
        allocated_qty: body?.allocated_qty || 50,
        sold_qty: 0,
        reserved_qty: 0,
        per_user_limit: body?.per_user_limit || 1,
        starts_at: body?.starts_at || new Date().toISOString(),
        ends_at: body?.ends_at || new Date(Date.now() + 86400000).toISOString(),
        status: 'ACTIVE',
      };
      mockFlashSales.unshift(newDeal);
      return {
        status: 200,
        body: {
          data: newDeal,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/admin/growth/campaigns/flash-sales/:id/emergency-stop',
    handler({ params }) {
      const deal = mockFlashSales.find((f) => f.id === Number(params.id));
      if (deal) {
        deal.status = 'EMERGENCY_STOPPED';
      }
      return {
        status: 200,
        body: {
          data: deal,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/admin/growth/coupons',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            coupons: mockCoupons,
          },
          coupons: mockCoupons,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/promotions/coupons',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            coupons: mockCoupons,
          },
          coupons: mockCoupons,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/promotions/coupons/validate',
    handler({ body }) {
      const code = String(body?.code || '').trim().toUpperCase();
      const coupon = mockCoupons.find((c) => c.code.toUpperCase() === code);
      if (!coupon || !coupon.is_active) {
        return {
          status: 400,
          body: {
            valid: false,
            reason: 'INVALID_OR_EXPIRED_COUPON',
          },
        };
      }
      return {
        status: 200,
        body: {
          valid: true,
          coupon,
          discountAmount: coupon.discount_type === 'PERCENT' ? 150 : (coupon.discount_value || 100),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/promotions/coupons/claim',
    handler({ body }) {
      const code = String(body?.code || '').trim().toUpperCase();
      const existing = mockCoupons.find((c) => c.code.toUpperCase() === code);
      if (existing) {
        existing.is_active = true;
        existing.is_used = false;
        return {
          status: 200,
          body: {
            success: true,
            coupon: existing,
          },
        };
      }
      // If code starts with valid pattern e.g. SAVE, EID, PROMO
      const newCoupon = {
        id: Date.now(),
        code,
        discount_type: 'PERCENT',
        discount_value: 10,
        max_discount_amount: 500,
        min_spend_amount: 1000,
        budget_cap: 10000,
        spent_amount: 0,
        redemption_count: 0,
        per_user_limit: 1,
        scope_type: 'PLATFORM',
        starts_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
        is_active: true,
      };
      mockCoupons.unshift(newCoupon);
      return {
        status: 200,
        body: {
          success: true,
          coupon: newCoupon,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/admin/growth/coupons',
    handler({ body }) {
      const newCoupon = {
        id: Date.now(),
        code: (body?.code || 'COUPON2026').toUpperCase(),
        discount_type: body?.discount_type || 'PERCENT',
        discount_value: body?.discount_value || 10,
        max_discount_amount: body?.max_discount_amount || 500,
        min_spend_amount: body?.min_spend_amount || 1000,
        budget_cap: body?.budget_cap || 20000,
        spent_amount: 0,
        redemption_count: 0,
        per_user_limit: 1,
        is_active: true,
      };
      mockCoupons.unshift(newCoupon);
      return {
        status: 200,
        body: {
          data: newCoupon,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/admin/growth/coupons/:id/toggle',
    handler({ params }) {
      const coupon = mockCoupons.find((c) => c.id === Number(params.id));
      if (coupon) {
        coupon.is_active = !coupon.is_active;
      }
      return {
        status: 200,
        body: {
          data: coupon,
        },
      };
    },
  },
];

export default campaignHandlers;
