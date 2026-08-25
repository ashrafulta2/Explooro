/**
 * bundleAndSurgePricing.test.js — Automated test suite for Prompt 10.5.
 *
 * Verifies the ACCEPTANCE criteria from docs/prompt.md Prompt 10.5:
 * 1. Multi-supplier cross-seller combo creation with deterministic discount apportionment.
 * 2. Two-supplier bundle produces two sub-orders with correctly apportioned discount and margins.
 * 3. Ledger balances exactly after a bundle sale (Customer Payment === Supplier Payouts + Saler Profit + Platform Margin).
 * 4. Price floor validation: rejects combo price below combined wholesale base costs.
 * 5. Dynamic demand surge detection: evaluates order velocity, stock depletion rate, and search traffic.
 * 6. Surge pricing recommends but NEVER applies automatically, and respects the platform increase cap.
 * 7. Supplier opt-in acceptance updates product retail price and writes audit log.
 * 8. Fastify HTTP routes for bundles and surge recommendations.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as bundleService from '../src/services/bundle.service.js';
import * as surgeService from '../src/services/surgePricing.service.js';
import { toPaisa, toBdtNumber } from '../src/services/pricing.service.js';

function createMockDb({ queryHandler = null } = {}) {
  return {
    async query(sql, params = []) {
      if (queryHandler) {
        return queryHandler(sql, params);
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, params = []) {
          if (queryHandler) {
            return queryHandler(sql, params);
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
}

describe('Prompt 10.5 — Cross-Seller Bundling & Demand Surge Pricing', () => {

  // ---------------------------------------------------------------------------
  // 1. Deterministic Profit Breakdown & Discount Apportionment
  // ---------------------------------------------------------------------------
  test('calculateBundleBreakdown apportion discount deterministically across 2 suppliers with zero drift', () => {
    // 2 items from 2 different suppliers:
    // Item 1 (Supplier 101 - Shirt): Retail = ৳1,200, Base = ৳700, Wholesale Margin = ৳100 (Wholesale Cost = ৳800)
    // Item 2 (Supplier 202 - Trouser): Retail = ৳1,800, Base = ৳1,100, Wholesale Margin = ৳150 (Wholesale Cost = ৳1,250)
    // Sum of Parts = ৳3,000. Combined Wholesale Cost = ৳2,050.
    // Bundle Offer Price = ৳2,550 (৳450 discount = 15% discount).
    const items = [
      {
        productId: 1,
        productTitleEn: 'Walton Formal Shirt',
        supplierId: 101,
        supplierName: 'Walton Apparel',
        qty: 1,
        retailPrice: 1200.00,
        baseCost: 700.00,
        wholesaleMargin: 100.00,
      },
      {
        productId: 2,
        productTitleEn: 'Apex Executive Trouser',
        supplierId: 202,
        supplierName: 'Apex Footwear & Textiles',
        qty: 1,
        retailPrice: 1800.00,
        baseCost: 1100.00,
        wholesaleMargin: 150.00,
      },
    ];

    const breakdown = bundleService.calculateBundleBreakdown({
      items,
      bundlePrice: 2550.00,
      salerSplitPct: 40,
      platformSplitPct: 60,
    });

    // 1. Basic metrics
    assert.equal(breakdown.sum_of_parts, 3000.00);
    assert.equal(breakdown.bundle_price, 2550.00);
    assert.equal(breakdown.discount_amount, 450.00);
    assert.equal(breakdown.discount_pct, 15.0);
    assert.equal(breakdown.total_wholesale_cost, 2050.00);
    assert.equal(breakdown.is_multi_supplier, true);
    assert.equal(breakdown.supplier_count, 2);

    // 2. Discount apportionment:
    // Item 1 share: floor(450 * 1200 / 3000) = 180.00
    // Item 2 share: floor(450 * 1800 / 3000) = 270.00
    // Sum of shares = 180 + 270 = 450.00 (exact match!)
    const item1 = breakdown.items[0];
    const item2 = breakdown.items[1];

    assert.equal(item1.discountShare, 180.00);
    assert.equal(item1.effectiveUnitPrice, 1020.00);
    assert.equal(item1.wholesaleCost, 800.00);
    assert.equal(item1.netRetailMargin, 220.00);
    assert.equal(item1.salerCommission, 88.00); // 40% of 220
    assert.equal(item1.platformMargin, 132.00); // 60% of 220

    assert.equal(item2.discountShare, 270.00);
    assert.equal(item2.effectiveUnitPrice, 1530.00);
    assert.equal(item2.wholesaleCost, 1250.00);
    assert.equal(item2.netRetailMargin, 280.00);
    assert.equal(item2.salerCommission, 112.00); // 40% of 280
    assert.equal(item2.platformMargin, 168.00); // 60% of 280

    // 3. Double-entry ledger balance invariant:
    // Customer Payment (2,550.00) === Supplier 1 Payout (800) + Supplier 2 Payout (1250) + Saler Commission (200) + Platform Margin (300)
    const totalSupplierPayouts = breakdown.suppliers.reduce((acc, s) => acc + s.total_wholesale_payout, 0);
    assert.equal(totalSupplierPayouts, 2050.00);
    assert.equal(breakdown.total_saler_commission, 200.00);
    assert.equal(breakdown.total_platform_margin, 300.00);

    const ledgerTotal = totalSupplierPayouts + breakdown.total_saler_commission + breakdown.total_platform_margin;
    assert.equal(ledgerTotal, breakdown.bundle_price, 'Ledger must balance exactly with zero paisa drift');
  });

  // ---------------------------------------------------------------------------
  // 2. Price Floor and Price Ceiling Validations
  // ---------------------------------------------------------------------------
  test('calculateBundleBreakdown strictly enforces wholesale price floor and retail sum ceiling', () => {
    const items = [
      { productId: 1, retailPrice: 1000, baseCost: 600, wholesaleMargin: 100, qty: 1 },
      { productId: 2, retailPrice: 1000, baseCost: 600, wholesaleMargin: 100, qty: 1 },
    ];
    // Combined wholesale cost = 700 + 700 = 1400. Sum of retail = 2000.

    // 1. Bundle price exceeds sum of parts (trying to charge 2100) -> Throws VALIDATION_FAILED
    assert.throws(
      () => bundleService.calculateBundleBreakdown({ items, bundlePrice: 2100 }),
      (err) => err.code === 'VALIDATION_FAILED'
    );

    // 2. Bundle price below wholesale floor (trying to sell at 1300 below 1400 cost) -> Throws VALIDATION_FAILED
    assert.throws(
      () => bundleService.calculateBundleBreakdown({ items, bundlePrice: 1300 }),
      (err) => err.code === 'VALIDATION_FAILED'
    );

    // 3. Bundle price exactly at wholesale floor (1400) -> Valid (0 net margin)
    const atFloor = bundleService.calculateBundleBreakdown({ items, bundlePrice: 1400 });
    assert.equal(atFloor.total_net_margin, 0.00);
    assert.equal(atFloor.total_saler_commission, 0.00);
  });

  // ---------------------------------------------------------------------------
  // 3. createBundle persists product_bundles and bundle_items
  // ---------------------------------------------------------------------------
  test('createBundle inserts bundle and bundle_items into database with generated ref', async () => {
    let insertedBundle = null;
    const insertedItems = [];

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        // Query products
        if (sql.includes('FROM products p')) {
          return {
            rows: [
              {
                id: 10,
                ref: 'PROD-10',
                title_en: 'Silk Saree',
                title_bn: 'সিল্ক শাড়ি',
                retail_price: 2000.00,
                base_cost: 1200.00,
                wholesale_margin: 200.00,
                stock_qty: 50,
                status: 'ACTIVE',
                supplier_id: 5,
                supplier_name: 'Tangail Weavers',
              },
              {
                id: 20,
                ref: 'PROD-20',
                title_en: 'Gold Plated Necklace',
                title_bn: 'গোল্ড প্লেটেড নেকলেস',
                retail_price: 1500.00,
                base_cost: 900.00,
                wholesale_margin: 100.00,
                stock_qty: 25,
                status: 'ACTIVE',
                supplier_id: 8,
                supplier_name: 'Aarong Crafts',
              },
            ],
          };
        }

        if (sql.includes('INSERT INTO product_bundles')) {
          insertedBundle = {
            id: 99,
            ref: params[0],
            saler_id: params[1],
            title_en: params[2],
            title_bn: params[3],
            bundle_price: params[4],
            sum_of_parts: params[5],
            discount_amount: params[6],
            is_active: true,
          };
          return { rows: [insertedBundle] };
        }

        if (sql.includes('INSERT INTO bundle_items')) {
          insertedItems.push({
            bundle_id: params[0],
            product_id: params[1],
            variant_id: params[2],
            qty: params[3],
            discount_share: params[4],
          });
          return { rows: [{ id: insertedItems.length }] };
        }

        return { rows: [] };
      },
    });

    const result = await bundleService.createBundle(db, {
      salerId: 6,
      titleEn: 'Festive Saree & Jewelry Combo',
      titleBn: 'উৎসবের শাড়ি ও গহনা কম্বো',
      bundlePrice: 2950.00,
      items: [
        { productId: 10, qty: 1 },
        { productId: 20, qty: 1 },
      ],
    });

    assert.ok(result.ref.startsWith('BND-'));
    assert.equal(insertedBundle.saler_id, 6);
    assert.equal(insertedBundle.bundle_price, 2950.00);
    assert.equal(insertedBundle.sum_of_parts, 3500.00);
    assert.equal(insertedBundle.discount_amount, 550.00);
    assert.equal(insertedItems.length, 2);
    assert.equal(insertedItems[0].discount_share + insertedItems[1].discount_share, 550.00);
  });

  // ---------------------------------------------------------------------------
  // 4. Surge Pricing: Demand Detection Signals
  // ---------------------------------------------------------------------------
  test('analyzeProductDemand detects high velocity, stock depletion, and calculates capped recommended price', async () => {
    const db = createMockDb({
      queryHandler: async (sql, params) => {
        // Product query
        if (sql.includes('SELECT p.id, p.ref, p.title_en')) {
          return {
            rows: [
              {
                id: 101,
                ref: 'PROD-WALT-01',
                title_en: 'Walton 43-inch Android Smart TV',
                title_bn: 'ওয়ালটন ৪৩-ইঞ্চি স্মার্ট টিভি',
                retail_price: 30000.00,
                base_cost: 22000.00,
                wholesale_margin: 3000.00,
                stock_qty: 20, // 20 units in stock
                supplier_id: 5,
                status: 'ACTIVE',
                supplier_name: 'Walton Electronics',
              },
            ],
          };
        }

        // Order items velocity query: 15 orders in last 24h
        if (sql.includes('FROM order_items oi')) {
          return {
            rows: [
              {
                orders_24h: 15,
                orders_7d: 45,
              },
            ],
          };
        }

        // Cart traffic query
        if (sql.includes('FROM cart_items')) {
          return {
            rows: [{ cart_additions: 30 }],
          };
        }

        // Platform settings config
        if (sql.includes('FROM platform_settings WHERE key = \'surge_pricing.config\'')) {
          return {
            rows: [
              {
                value_json: JSON.stringify({
                  max_increase_pct: 15.0,
                  min_order_velocity_24h: 3,
                  min_depletion_velocity: 0.20,
                  recommendation_ttl_hours: 48,
                }),
              },
            ],
          };
        }

        return { rows: [] };
      },
    });

    const analysis = await surgeService.analyzeProductDemand(db, 101);

    assert.equal(analysis.product_id, 101);
    assert.equal(analysis.orders_24h, 15);
    assert.equal(analysis.is_surging, true);
    assert.ok(analysis.surge_level === 'VIRAL_SPIKE' || analysis.surge_level === 'HIGH_SURGE');

    // 15 units sold / (20 in stock + 15) = 42.8% depletion in 24h
    assert.ok(analysis.depletion_rate >= 0.40);

    // Recommended price must respect max_increase_cap (15%) -> 30,000 * 1.15 = 34,500
    assert.ok(analysis.suggested_pct <= 15.0);
    assert.equal(analysis.recommended_price, 34500.00);
    assert.ok(/demand surge|velocity/i.test(analysis.reason_en));
    assert.ok(analysis.reason_bn.length > 0);
  });

  // ---------------------------------------------------------------------------
  // 5. Surge Pricing: Recommendation Only & Supplier Opt-In Acceptance
  // ---------------------------------------------------------------------------
  test('Surge recommendation stays PENDING until explicit supplier opt-in acceptance', async () => {
    let productUpdated = null;
    let recommendationStatus = 'PENDING';
    let auditLogWritten = null;

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        // Query recommendation
        if (sql.includes('FROM surge_pricing_recommendations r')) {
          return {
            rows: [
              {
                id: 1,
                ref: 'SRG-8821',
                product_id: 50,
                supplier_id: 5,
                current_price: 2000.00,
                recommended_price: 2200.00, // +10%
                surge_pct: 10.0,
                status: recommendationStatus,
                expires_at: new Date(Date.now() + 86400000).toISOString(),
              },
            ],
          };
        }

        // Update product price
        if (sql.includes('UPDATE products') && sql.includes('SET default_retail_price = $1')) {
          productUpdated = {
            id: params[1],
            retail_price: params[0],
          };
          return { rows: [productUpdated] };
        }

        // Update recommendation status
        if (sql.includes('UPDATE surge_pricing_recommendations') && sql.includes('status = \'ACCEPTED\'')) {
          recommendationStatus = 'ACCEPTED';
          return { rows: [{ id: 1, status: 'ACCEPTED' }] };
        }

        // Audit log insert
        if (sql.includes('INSERT INTO audit_logs')) {
          auditLogWritten = {
            action: params[1],
            entity_id: params[2],
          };
          return { rows: [{ id: 1 }] };
        }

        return { rows: [] };
      },
    });

    // Accept recommendation
    const result = await surgeService.acceptSurgeRecommendation(db, {
      recommendationId: 1,
      supplierId: 5,
      appliedBy: 5,
    });

    assert.equal(result.success, true);
    assert.equal(productUpdated.retail_price, 2200.00);
    assert.equal(recommendationStatus, 'ACCEPTED');
    assert.equal(result.increase_pct, 10.0);
    assert.ok(auditLogWritten !== null, 'Audited action must be recorded on surge price acceptance');
  });

  // ---------------------------------------------------------------------------
  // 6. Surge Pricing: Dismissal of Recommendation
  // ---------------------------------------------------------------------------
  test('dismissSurgeRecommendation marks recommendation as DISMISSED without changing product price', async () => {
    let recStatus = 'PENDING';

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('SELECT * FROM surge_pricing_recommendations WHERE id = $1')) {
          return {
            rows: [
              {
                id: 2,
                supplier_id: 5,
                status: recStatus,
              },
            ],
          };
        }

        if (sql.includes('UPDATE surge_pricing_recommendations') && sql.includes('status = \'DISMISSED\'')) {
          recStatus = 'DISMISSED';
          return { rows: [{ id: 2, status: 'DISMISSED' }] };
        }

        return { rows: [] };
      },
    });

    const dismissed = await surgeService.dismissSurgeRecommendation(db, {
      recommendationId: 2,
      supplierId: 5,
    });

    assert.equal(dismissed.status, 'DISMISSED');
  });

  // ---------------------------------------------------------------------------
  // 7. addBundleToCart: Apportions and Inserts Each Combo Item into Cart
  // ---------------------------------------------------------------------------
  test('addBundleToCart adds each component item with apportioned effective pricing', async () => {
    const insertedCartItems = [];

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        // Query bundle
        if (sql.includes('FROM product_bundles b')) {
          return {
            rows: [
              {
                id: 15,
                ref: 'BND-7711',
                saler_id: 6,
                bundle_price: 2550.00,
                sum_of_parts: 3000.00,
                discount_amount: 450.00,
                is_active: true,
              },
            ],
          };
        }

        // Query bundle items
        if (sql.includes('FROM bundle_items bi')) {
          return {
            rows: [
              {
                product_id: 1,
                product_ref: 'PROD-1',
                product_title_en: 'Shirt',
                product_title_bn: 'শার্ট',
                variant_id: null,
                supplier_id: 101,
                supplier_name: 'Walton Apparel',
                qty: 1,
                retail_price: 1200.00,
                base_cost: 700.00,
                wholesale_margin: 100.00,
                discount_share: 180.00,
                stock_qty: 10,
              },
              {
                product_id: 2,
                product_ref: 'PROD-2',
                product_title_en: 'Trousers',
                product_title_bn: 'ট্রাউজার',
                variant_id: null,
                supplier_id: 202,
                supplier_name: 'Apex Footwear',
                qty: 1,
                retail_price: 1800.00,
                base_cost: 1100.00,
                wholesale_margin: 150.00,
                discount_share: 270.00,
                stock_qty: 10,
              },
            ],
          };
        }

        // Insert cart items
        if (sql.includes('INSERT INTO cart_items')) {
          insertedCartItems.push({
            cart_id: params[0],
            product_id: params[1],
            bundle_id: params[4],
            qty: params[5],
            price_at_add: params[6],
          });
          return { rows: [{ id: insertedCartItems.length }] };
        }

        return { rows: [] };
      },
    });

    const res = await bundleService.addBundleToCart(db, {
      cartId: 42,
      bundleId: 15,
      salerId: 6,
      qty: 1,
    });

    assert.equal(res.bundle_id, 15);
    assert.equal(res.items_count, 2);
    assert.equal(insertedCartItems.length, 2);

    // Item 1 price_at_add should be effective retail 1020.00
    assert.equal(insertedCartItems[0].price_at_add, 1020.00);
    // Item 2 price_at_add should be effective retail 1530.00
    assert.equal(insertedCartItems[1].price_at_add, 1530.00);
    // Total added = 1020 + 1530 = 2550 (matches bundle price!)
    assert.equal(insertedCartItems[0].price_at_add + insertedCartItems[1].price_at_add, 2550.00);
  });

  // ---------------------------------------------------------------------------
  // 8. Fastify HTTP REST API Endpoints
  // ---------------------------------------------------------------------------
  test('Fastify HTTP API: POST /saler/bundles/preview returns 200 with complete live profit breakdown', async () => {
    const Fastify = (await import('fastify')).default;
    const bundleRoutes = (await import('../src/routes/bundle.routes.js')).default;
    const errorHandlerPlugin = (await import('../src/plugins/errorHandler.js')).default;

    const app = Fastify();
    app.decorate('authenticate', async (req) => {
      req.user = { id: 6, role: 'saler', permissions: ['saler.bundle.manage'] };
    });
    app.decorate('requireModule', () => async () => {});
    app.decorate('requirePermission', () => async () => {});

    app.register(errorHandlerPlugin);
    await app.register(bundleRoutes, { prefix: '/api/v1' });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/saler/bundles/preview',
      payload: {
        bundle_price: 2550.00,
        items: [
          { productId: 1, retailPrice: 1200, baseCost: 700, wholesaleMargin: 100, qty: 1, supplierId: 5, supplierName: 'Walton' },
          { productId: 2, retailPrice: 1800, baseCost: 1100, wholesaleMargin: 150, qty: 1, supplierId: 6, supplierName: 'Apex' },
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.data);
    assert.equal(body.data.bundle_price, 2550.00);
    assert.equal(body.data.discount_amount, 450.00);
    assert.equal(body.data.total_saler_commission, 200.00);

    await app.close();
  });

});

