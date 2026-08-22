/**
 * productPricing.test.js — Test suite for Prompt 4.3 (Product & Pricing APIs, Dynamic Split Engine).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin, { AppError } from '../src/plugins/errorHandler.js';
import productRoutes from '../src/routes/product.routes.js';
import {
  calculatePricingBreakdown,
  resolveSplitPercentages,
} from '../src/services/pricing.service.js';

function createMockDb() {
  const products = [
    {
      id: 1,
      ref: 'PRD-TEST-001',
      supplier_id: 101,
      category_id: 1,
      slug: 'cotton-panjabi',
      title_en: 'Cotton Panjabi',
      title_bn: 'সুতি পাঞ্জাবি',
      base_cost: '500.00',
      wholesale_margin: '0.00',
      default_retail_price: '700.00',
      stock_qty: 50,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      deleted_at: null,
      category_name_en: 'Fashion',
      category_name_bn: 'ফ্যাশন',
      category_slug: 'fashion',
    },
    {
      id: 2,
      ref: 'PRD-TEST-002',
      supplier_id: 101,
      category_id: 1,
      slug: 'silk-saree',
      title_en: 'Silk Saree',
      title_bn: 'সিল্ক শাড়ি',
      base_cost: '1000.00',
      wholesale_margin: '200.00',
      default_retail_price: '2000.00',
      stock_qty: 20,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      deleted_at: null,
      category_name_en: 'Fashion',
      category_name_bn: 'ফ্যাশন',
      category_slug: 'fashion',
    },
  ];

  const categories = [
    { id: 1, name_en: 'Fashion', name_bn: 'ফ্যাশন', slug: 'fashion', auto_approve: false, is_active: true },
    { id: 2, name_en: 'Groceries', name_bn: 'মুদি', slug: 'groceries', auto_approve: true, is_active: true },
  ];

  const stores = [
    { id: 1, saler_id: 201, ref: 'STR-001', slug: 'dhaka-fashion', shop_name: 'Dhaka Fashion' },
  ];

  const storeItems = [];
  const approvals = [];
  const commissionRules = [];
  let platformSettings = { 'commission.default_splits': { saler_split_pct: 40, platform_split_pct: 60 } };

  return {
    products,
    categories,
    stores,
    storeItems,
    approvals,
    commissionRules,
    platformSettings,

    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Commission rules query
      if (normalized.startsWith('SELECT saler_split_pct, platform_split_pct FROM commission_rules')) {
        if (normalized.includes("scope_type = 'PRODUCT'")) {
          const found = commissionRules.find((r) => r.scope_type === 'PRODUCT' && r.scope_ref === params[0]);
          return { rows: found ? [found] : [] };
        }
        if (normalized.includes("scope_type = 'CATEGORY'")) {
          const found = commissionRules.find((r) => r.scope_type === 'CATEGORY' && r.scope_ref === params[0]);
          return { rows: found ? [found] : [] };
        }
        if (normalized.includes("scope_type = 'GLOBAL'")) {
          const found = commissionRules.find((r) => r.scope_type === 'GLOBAL');
          return { rows: found ? [found] : [] };
        }
      }

      // Platform settings
      if (normalized.startsWith('SELECT value_json FROM platform_settings')) {
        const key = params[0] || 'commission.default_splits';
        const val = platformSettings[key];
        return { rows: val ? [{ value_json: val }] : [] };
      }

      // Categories
      if (normalized.startsWith('SELECT * FROM categories WHERE id = $1')) {
        const cat = categories.find((c) => c.id === parseInt(params[0], 10));
        return { rows: cat ? [cat] : [] };
      }

      // Insert product
      if (normalized.startsWith('INSERT INTO products')) {
        const newProduct = {
          id: products.length + 1,
          ref: params[0],
          supplier_id: params[1],
          category_id: params[2],
          slug: params[3],
          title_en: params[4],
          title_bn: params[5],
          description_en: params[6],
          description_bn: params[7],
          brand: params[8],
          base_cost: String(params[9]),
          wholesale_margin: String(params[10] || 0),
          default_retail_price: String(params[11]),
          min_retail_price: String(params[12]),
          stock_qty: params[13] || 0,
          low_stock_threshold: params[14] || 5,
          weight_grams: params[15],
          has_variants: params[16] || false,
          warranty_months: params[17] || 0,
          status: params[18] || 'DRAFT',
          created_at: new Date().toISOString(),
          deleted_at: null,
          category_name_en: 'Category',
          category_name_bn: 'ক্যাটাগরি',
        };
        products.push(newProduct);
        return { rows: [newProduct] };
      }

      // Product Approvals
      if (normalized.startsWith('INSERT INTO product_approvals')) {
        const approval = {
          id: approvals.length + 1,
          product_id: params[0],
          submitted_by: params[1],
          status: params[2],
          created_at: new Date().toISOString(),
        };
        approvals.push(approval);
        return { rows: [approval] };
      }

      // Get product by id
      if (normalized.startsWith('SELECT p.*') && normalized.includes('WHERE p.id = $1')) {
        const p = products.find((prod) => prod.id === parseInt(params[0], 10) && !prod.deleted_at);
        return { rows: p ? [p] : [] };
      }

      // List products
      if (normalized.startsWith('SELECT p.*')) {
        const active = products.filter((prod) => !prod.deleted_at);
        return { rows: active };
      }

      // Virtual stores
      if (normalized.startsWith('SELECT * FROM virtual_stores WHERE saler_id = $1')) {
        const s = stores.find((st) => st.saler_id === parseInt(params[0], 10));
        return { rows: s ? [s] : [] };
      }

      // Saler store items upsert
      if (normalized.startsWith('INSERT INTO saler_store_items')) {
        const item = {
          id: storeItems.length + 1,
          store_id: params[0],
          saler_id: params[1],
          product_id: params[2],
          custom_retail_price: params[3],
          collection_name: params[4],
          is_active: true,
        };
        storeItems.push(item);
        return { rows: [item] };
      }

      // List saler store items
      if (normalized.startsWith('SELECT ssi.*')) {
        return { rows: storeItems };
      }

      return { rows: [] };
    },
  };
}

describe('Product & Pricing APIs, Dynamic Split Engine (Prompt 4.3)', () => {
  let app;
  let mockDb;

  before(async () => {
    mockDb = createMockDb();
    app = Fastify({ logger: false });
    app.decorate('db', mockDb);
    app.decorate('requirePermission', (permKey) => async (req, reply) => {
      if (!req.user?.permissions?.includes(permKey) && req.user?.role !== 'super_admin') {
        return reply.status(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Denied' } });
      }
    });

    app.addHook('onRequest', (req, reply, done) => {
      // Default authorized context (Supplier)
      req.user = {
        id: 101,
        ref: 'USR-SUPP-001',
        role: 'supplier',
        permissions: ['catalog.product.create', 'catalog.product.update'],
        restrictions: [],
      };
      req.isModuleEnabled = (mod) => mod === 'product_moderation';
      done();
    });

    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    await app.register(productRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('Acceptance 1: Base 500, retail 700, split 40/60 → saler 80.00, platform 120.00, exactly, with no float error', () => {
    const result = calculatePricingBreakdown({
      baseCost: 500,
      wholesaleMargin: 0,
      retailPrice: 700,
      salerSplitPct: 40,
      platformSplitPct: 60,
    });

    assert.equal(result.base_cost, 500.0);
    assert.equal(result.wholesale_margin, 0.0);
    assert.equal(result.wholesale_cost, 500.0);
    assert.equal(result.retail_price, 700.0);
    assert.equal(result.net_retail_margin, 200.0);
    assert.equal(result.saler_earning, 80.0);
    assert.equal(result.platform_earning, 120.0);
    assert.equal(result.saler_earning + result.platform_earning, result.net_retail_margin);

    // Verify integer paisa values
    assert.equal(result.paisa.net_retail_margin, 20000);
    assert.equal(result.paisa.saler_earning, 8000);
    assert.equal(result.paisa.platform_earning, 12000);
  });

  test('Acceptance 2: Dynamic split resolution changes calculations when platform settings change without code deploy', async () => {
    // 1. Initial 40/60 split
    mockDb.platformSettings['commission.default_splits'] = { saler_split_pct: 40, platform_split_pct: 60 };
    const split1 = await resolveSplitPercentages(mockDb);
    assert.equal(split1.salerSplitPct, 40);
    assert.equal(split1.platformSplitPct, 60);

    // 2. Change platform settings dynamically to 50/50
    mockDb.platformSettings['commission.default_splits'] = { saler_split_pct: 50, platform_split_pct: 50 };
    const split2 = await resolveSplitPercentages(mockDb);
    assert.equal(split2.salerSplitPct, 50);
    assert.equal(split2.platformSplitPct, 50);

    // Verify recalculation reflects the new setting
    const calc = calculatePricingBreakdown({
      baseCost: 500,
      wholesaleMargin: 0,
      retailPrice: 700,
      salerSplitPct: split2.salerSplitPct,
      platformSplitPct: split2.platformSplitPct,
    });
    assert.equal(calc.saler_earning, 100.0);
    assert.equal(calc.platform_earning, 100.0);
  });

  test('Acceptance 3: Supplier with can_list_products=BLOCK receives 403 USER_RESTRICTED', async () => {
    const restrictedApp = Fastify({ logger: false });
    restrictedApp.decorate('db', mockDb);
    restrictedApp.decorate('requirePermission', () => async () => {});
    restrictedApp.decorate('requireRestriction', (capabilityKey) => async (req) => {
      const match = (req.user?.restrictions || []).find((r) => r.capability_key === capabilityKey);
      if (match && match.mode === 'BLOCK') {
        throw new AppError('USER_RESTRICTED', match.reason, match.reason);
      }
    });
    restrictedApp.addHook('onRequest', (req, reply, done) => {
      req.user = {
        id: 102,
        ref: 'USR-RESTRICTED-SUPP',
        role: 'supplier',
        permissions: ['catalog.product.create'],
        restrictions: [
          { capability_key: 'can_list_products', mode: 'BLOCK', reason: 'Unverified business license' },
        ],
      };
      req.isModuleEnabled = () => true;
      done();
    });

    restrictedApp.register(requestContextPlugin);
    restrictedApp.register(errorHandlerPlugin);
    await restrictedApp.register(productRoutes, { prefix: '/api/v1' });
    await restrictedApp.ready();

    const res = await restrictedApp.inject({
      method: 'POST',
      url: '/api/v1/products',
      payload: {
        title_en: 'Test Product',
        title_bn: 'টেস্ট প্রোডাক্ট',
        category_id: 1,
        base_cost: 100,
        default_retail_price: 150,
      },
    });

    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.error.code, 'USER_RESTRICTED');
    assert.ok(body.error.message_bn);

    await restrictedApp.close();
  });

  test('Acceptance 4: Sourcing catalog filters products by minimum margin percentage correctly', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sourcing/catalog?min_margin_pct=35',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.catalog));

    // Product 1: 200 / 700 = 28.57% (should be filtered out by min_margin_pct=35)
    // Product 2: 800 / 2000 = 40.0% (should be included)
    for (const item of body.catalog) {
      assert.ok(
        item.sourcing_opportunity.margin_pct >= 35 || item.sourcing_opportunity.saler_margin_pct >= 35,
        'Item margin percentage must meet or exceed threshold'
      );
    }
  });

  test('Acceptance 5: POST /api/v1/pricing/preview returns a full breakdown for the profit calculator UI', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/pricing/preview',
      payload: {
        base_cost: 1000,
        wholesale_margin: 200,
        retail_price: 1800,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.preview);
    assert.equal(body.preview.base_cost, 1000.0);
    assert.equal(body.preview.wholesale_margin, 200.0);
    assert.equal(body.preview.wholesale_cost, 1200.0);
    assert.equal(body.preview.retail_price, 1800.0);
    assert.equal(body.preview.net_retail_margin, 600.0);
    // 600 * 0.50 (from platform setting) = 300.00 saler / 300.00 platform
    assert.equal(body.preview.saler_earning + body.preview.platform_earning, 600.0);
  });

  test('Acceptance 6: New product enters product_approvals as PENDING when product_moderation is ON and auto_approve is false', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      payload: {
        category_id: 1, // Fashion (auto_approve: false)
        title_en: 'Premium Jamdani Saree',
        title_bn: 'প্রিমিয়াম জামদানি শাড়ি',
        base_cost: 3000,
        wholesale_margin: 500,
        default_retail_price: 4500,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.product.status, 'PENDING_APPROVAL');

    // Confirm entry in product_approvals
    const approval = mockDb.approvals.find((a) => a.product_id === body.product.id);
    assert.ok(approval, 'Approval entry must be recorded');
    assert.equal(approval.status, 'PENDING');
  });

  test('Saler add-to-store endpoint sets custom retail price and calculates saler profit', async () => {
    const salerApp = Fastify({ logger: false });
    salerApp.decorate('db', mockDb);
    salerApp.addHook('onRequest', (req, reply, done) => {
      req.user = {
        id: 201,
        ref: 'USR-SALER-001',
        role: 'saler',
        permissions: ['saler.store.manage'],
        restrictions: [],
      };
      done();
    });

    salerApp.register(requestContextPlugin);
    salerApp.register(errorHandlerPlugin);
    await salerApp.register(productRoutes, { prefix: '/api/v1' });
    await salerApp.ready();

    const res = await salerApp.inject({
      method: 'POST',
      url: '/api/v1/sourcing/add-to-store',
      payload: {
        product_id: 1,
        custom_retail_price: 850,
        collection_name: 'Eid Special 2026',
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.item.custom_retail_price, 850);
    assert.equal(body.item.collection_name, 'Eid Special 2026');
    // Retail 850, wholesale cost 500 -> margin 350 -> saler earning calculated
    assert.equal(body.item.pricing.retail_price, 850.0);
    assert.equal(body.item.pricing.net_retail_margin, 350.0);

    await salerApp.close();
  });
});
