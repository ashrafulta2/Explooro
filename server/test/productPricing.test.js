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

  const mediaAssets = [
    { id: 501, owner_id: 101, purpose: 'PRODUCT', deleted_at: null },
    { id: 502, owner_id: 101, purpose: 'PRODUCT', deleted_at: null },
    { id: 503, owner_id: 999, purpose: 'PRODUCT', deleted_at: null }, // someone else's
    { id: 504, owner_id: 101, purpose: 'AVATAR', deleted_at: null }, // wrong purpose
    { id: 505, owner_id: 900, purpose: 'PRODUCT', deleted_at: null }, // uploaded by the admin (id 900)
  ];
  const productImages = [];
  const auditLogs = [];
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
    productImages,
    auditLogs,

    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Owned product media lookup (findOwnedProductMedia)
      if (normalized.startsWith('SELECT id FROM media_assets')) {
        const [ids, ownerId] = params;
        const rows = mediaAssets
          .filter((m) => ids.includes(m.id) && m.owner_id === ownerId && m.purpose === 'PRODUCT' && !m.deleted_at)
          .map((m) => ({ id: m.id }));
        return { rows };
      }

      // Attachable media on edit: caller's own PRODUCT uploads, or photos already on this product
      if (normalized.startsWith('SELECT m.id FROM media_assets m')) {
        const [ids, ownerId, productId] = params;
        const onProduct = new Set(productImages.filter((pi) => pi.product_id === productId).map((pi) => pi.media_id));
        const rows = mediaAssets
          .filter((m) => ids.includes(m.id) && m.purpose === 'PRODUCT' && !m.deleted_at && (m.owner_id === ownerId || onProduct.has(m.id)))
          .map((m) => ({ id: m.id }));
        return { rows };
      }

      if (normalized.startsWith('SELECT media_id FROM product_images')) {
        return { rows: productImages.filter((pi) => pi.product_id === params[0]).map((pi) => ({ media_id: pi.media_id })) };
      }

      if (normalized.startsWith('DELETE FROM product_images')) {
        for (let i = productImages.length - 1; i >= 0; i -= 1) {
          if (productImages[i].product_id === params[0]) productImages.splice(i, 1);
        }
        return { rows: [] };
      }

      if (normalized.startsWith('UPDATE products SET stock_qty = stock_qty + $2')) {
        const p = products.find((prod) => prod.id === params[0] && !prod.deleted_at);
        if (!p) return { rows: [] };
        p.stock_qty += params[1];
        return { rows: [{ id: p.id, ref: p.ref, stock_qty: p.stock_qty }] };
      }

      if (normalized.startsWith('UPDATE products SET')) {
        const p = products.find((prod) => prod.id === params[0]);
        const cols = [...normalized.matchAll(/(\w+) = \$(\d+)/g)].filter(([, col]) => col !== 'id');
        for (const [, col, idx] of cols) p[col] = params[Number(idx) - 1];
        return { rows: [p] };
      }

      if (normalized.startsWith('INSERT INTO audit_logs')) {
        auditLogs.push(params);
        return { rows: [{ id: auditLogs.length }] };
      }

      // Get product by ref
      if (normalized.startsWith('SELECT p.*') && normalized.includes('WHERE p.ref = $1')) {
        const p = products.find((prod) => prod.ref === params[0] && !prod.deleted_at);
        return { rows: p ? [p] : [] };
      }

      // Attach product images (insertProductImages) — first id is primary, order preserved
      if (normalized.startsWith('INSERT INTO product_images')) {
        const [productId, ids] = params;
        const rows = ids.map((mediaId, i) => {
          const row = { id: productImages.length + 1, product_id: productId, media_id: mediaId, display_order: i, is_primary: i === 0 };
          productImages.push(row);
          return row;
        });
        return { rows };
      }

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

      // Latest approval for a product (getLatestProductApprovalStatus)
      if (normalized.startsWith('SELECT status FROM product_approvals')) {
        const latest = approvals.filter((a) => a.product_id === params[0]).at(-1);
        return { rows: latest ? [{ status: latest.status }] : [] };
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

  test('Global default has one home: a stale GLOBAL commission_rules row never shadows the platform setting', async () => {
    mockDb.commissionRules.push({ scope_type: 'GLOBAL', scope_ref: null, saler_split_pct: 30, platform_split_pct: 70 });
    mockDb.platformSettings['commission.default_splits'] = { saler_split_pct: 55, platform_split_pct: 45 };
    const split = await resolveSplitPercentages(mockDb);
    assert.equal(split.salerSplitPct, 55);
    assert.equal(split.platformSplitPct, 45);
    assert.equal(split.ruleSource, 'PLATFORM_SETTINGS');
    mockDb.commissionRules.length = 0;
    mockDb.platformSettings['commission.default_splits'] = { saler_split_pct: 40, platform_split_pct: 60 };
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

  describe('Product photos (media_ids) on create', () => {
    const base = {
      category_id: 2,
      title_en: 'Hilsa Pack',
      title_bn: 'ইলিশ প্যাক',
      base_cost: 800,
      default_retail_price: 1000,
    };

    test('attaches the caller\'s uploaded photos in order, the first as primary', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/products', payload: { ...base, media_ids: [502, '501'] } });
      assert.equal(res.statusCode, 201);
      const { product } = res.json();
      assert.deepEqual(
        product.images.map((i) => [i.media_id, i.display_order, i.is_primary]),
        [[502, 0, true], [501, 1, false]]
      );
    });

    for (const [label, mediaIds] of [
      ['another user\'s photo', [501, 503]],
      ['a non-PRODUCT asset', [504]],
      ['a non-numeric id', ['abc']],
      ['more than the gallery limit', [1, 2, 3, 4, 5, 6, 7, 8, 9]],
    ]) {
      test(`rejects ${label} with 400 and creates nothing`, async () => {
        const before = mockDb.products.length;
        const res = await app.inject({ method: 'POST', url: '/api/v1/products', payload: { ...base, media_ids: mediaIds } });
        assert.equal(res.statusCode, 400);
        assert.equal(res.json().error.code, 'VALIDATION_FAILED');
        assert.equal(mockDb.products.length, before, 'no half-created product');
      });
    }
  });

  describe('Editing a product (PATCH /products/:idOrRef)', () => {
    // The real authenticate plugin sets `roles` (array), never `role`.
    async function appAs(user) {
      const a = Fastify({ logger: false });
      a.decorate('db', mockDb);
      a.addHook('onRequest', (req, reply, done) => {
        req.user = { restrictions: [], ...user };
        done();
      });
      a.register(requestContextPlugin);
      a.register(errorHandlerPlugin);
      await a.register(productRoutes, { prefix: '/api/v1' });
      await a.ready();
      return a;
    }

    test('the owner edits by ref: fields, photos and an audit row with before/after', async () => {
      const auditsBefore = mockDb.auditLogs.length;
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/products/PRD-TEST-001',
        payload: { title_en: 'Cotton Panjabi (Eid)', default_retail_price: 750, media_ids: [501] },
      });
      assert.equal(res.statusCode, 200, res.body);
      const { product } = res.json();
      assert.equal(product.title_en, 'Cotton Panjabi (Eid)');
      assert.deepEqual(product.images.map((i) => [i.media_id, i.is_primary]), [[501, true]]);
      assert.equal(mockDb.auditLogs.length, auditsBefore + 1, 'one audit_logs row per edit');
    });

    test('an admin keeps the supplier\'s photo, adds their own upload, and the order sets the primary', async () => {
      const admin = await appAs({ id: 900, roles: ['super_admin'] });
      const res = await admin.inject({
        method: 'PATCH',
        url: '/api/v1/products/PRD-TEST-001',
        payload: { media_ids: [505, 501] },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual(res.json().product.images.map((i) => [i.media_id, i.is_primary]), [[505, true], [501, false]]);

      // A photo that is neither on this product nor uploaded by the admin is refused.
      const bad = await admin.inject({ method: 'PATCH', url: '/api/v1/products/PRD-TEST-001', payload: { media_ids: [503] } });
      assert.equal(bad.statusCode, 400);
      assert.deepEqual(
        mockDb.productImages.filter((pi) => pi.product_id === 1).map((pi) => pi.media_id),
        [505, 501],
        'a rejected edit leaves the existing photos untouched'
      );
      await admin.close();
    });

    test('removing every photo is refused', async () => {
      const res = await app.inject({ method: 'PATCH', url: '/api/v1/products/PRD-TEST-001', payload: { media_ids: [] } });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error.code, 'VALIDATION_FAILED');
    });

    test('a supplier cannot edit another supplier\'s product', async () => {
      const other = await appAs({ id: 777, roles: ['supplier'] });
      const res = await other.inject({ method: 'PATCH', url: '/api/v1/products/PRD-TEST-002', payload: { title_en: 'Hijacked' } });
      assert.equal(res.statusCode, 403);
      await other.close();
    });

    test('restock adds to the stored stock (not a client-side total) and audits it', async () => {
      const product = mockDb.products.find((p) => p.ref === 'PRD-TEST-002');
      product.stock_qty = 20;
      const auditsBefore = mockDb.auditLogs.length;
      // Simulate a sale landing after the admin's page loaded stock=20.
      product.stock_qty -= 3;
      const res = await app.inject({ method: 'POST', url: '/api/v1/products/PRD-TEST-002/restock', payload: { quantity: 50 } });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().product.stock_qty, 67, '17 left after the sale + 50, not 20 + 50');
      assert.equal(mockDb.auditLogs.length, auditsBefore + 1);

      for (const quantity of [0, -5, 2.5, 'ten', undefined]) {
        const bad = await app.inject({ method: 'POST', url: '/api/v1/products/PRD-TEST-002/restock', payload: { quantity } });
        assert.equal(bad.statusCode, 400, `quantity ${quantity}`);
      }

      const other = await appAs({ id: 777, roles: ['supplier'] });
      const denied = await other.inject({ method: 'POST', url: '/api/v1/products/PRD-TEST-002/restock', payload: { quantity: 5 } });
      assert.equal(denied.statusCode, 403);
      await other.close();
    });

    test('an unknown ref is 404, not a NaN lookup', async () => {
      const res = await app.inject({ method: 'PATCH', url: '/api/v1/products/PRD-NOPE', payload: { title_en: 'X' } });
      assert.equal(res.statusCode, 404);
    });

    describe('status changes', () => {
      const owner = { id: 101, roles: ['supplier'] };
      const staff = { id: 900, roles: ['admin'] };
      const product = () => mockDb.products.find((p) => p.ref === 'PRD-TEST-002');

      // Puts product 2 in `status` with the given approval history (oldest first).
      function setUp(status, approvalStatuses = []) {
        product().status = status;
        for (let i = mockDb.approvals.length - 1; i >= 0; i -= 1) {
          if (mockDb.approvals[i].product_id === 2) mockDb.approvals.splice(i, 1);
        }
        for (const s of approvalStatuses) {
          mockDb.approvals.push({ id: mockDb.approvals.length + 1, product_id: 2, submitted_by: 101, status: s });
        }
      }

      async function patchStatus(user, status) {
        const a = await appAs(user);
        const res = await a.inject({ method: 'PATCH', url: '/api/v1/products/PRD-TEST-002', payload: { status } });
        await a.close();
        return res;
      }

      after(() => setUp('ACTIVE'));

      for (const [from, to, history] of [
        ['ACTIVE', 'PAUSED', []],
        ['PAUSED', 'ACTIVE', ['APPROVED']],
        ['PAUSED', 'ACTIVE', []],
        ['PENDING_APPROVAL', 'ARCHIVED', ['PENDING']],
        ['REJECTED', 'ARCHIVED', ['REJECTED']],
        ['ACTIVE', 'ACTIVE', []],
      ]) {
        const label = history.length ? `latest approval ${history.at(-1)}` : 'never moderated';
        test(`the owner may move ${from} → ${to} (${label})`, async () => {
          setUp(from, history);
          const res = await patchStatus(owner, to);
          assert.equal(res.statusCode, 200, res.body);
          assert.equal(product().status, to);
        });
      }

      for (const [from, to, history] of [
        ['PENDING_APPROVAL', 'ACTIVE', ['PENDING']],
        ['REJECTED', 'ACTIVE', ['REJECTED']],
        ['DRAFT', 'ACTIVE', []],
        ['PAUSED', 'ACTIVE', ['PENDING']],
        ['PAUSED', 'ACTIVE', ['APPROVED', 'REJECTED']],
        ['ARCHIVED', 'ACTIVE', ['APPROVED']],
        ['ARCHIVED', 'PAUSED', ['APPROVED']],
        ['PENDING_APPROVAL', 'PAUSED', ['PENDING']],
        ['REJECTED', 'PENDING_APPROVAL', ['REJECTED']],
      ]) {
        test(`the owner is refused ${from} → ${to} (history: ${history.join(', ') || 'none'})`, async () => {
          setUp(from, history);
          const auditsBefore = mockDb.auditLogs.length;
          const res = await patchStatus(owner, to);
          assert.equal(res.statusCode, 403, res.body);
          const { error } = res.json();
          assert.equal(error.code, 'FORBIDDEN');
          assert.ok(error.message_bn, 'Bangla message present');
          assert.equal(product().status, from, 'status unchanged');
          assert.equal(mockDb.auditLogs.length, auditsBefore, 'nothing written');
        });
      }

      test('a refused status change also discards the other fields in the same request', async () => {
        setUp('PENDING_APPROVAL', ['PENDING']);
        const title = product().title_en;
        const a = await appAs(owner);
        const res = await a.inject({
          method: 'PATCH',
          url: '/api/v1/products/PRD-TEST-002',
          payload: { title_en: 'Sneaked through', status: 'ACTIVE' },
        });
        await a.close();
        assert.equal(res.statusCode, 403);
        assert.equal(product().title_en, title);
      });

      test('staff (roles array) may set ACTIVE on a pending product, and it is audited before/after', async () => {
        setUp('PENDING_APPROVAL', ['PENDING']);
        const auditsBefore = mockDb.auditLogs.length;
        const res = await patchStatus(staff, 'ACTIVE');
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(product().status, 'ACTIVE');
        assert.equal(mockDb.auditLogs.length, auditsBefore + 1, 'one audit_logs row');
        const row = mockDb.auditLogs.at(-1);
        assert.ok(row.includes('catalog.product.update'));
        const [before, after] = row.filter((v) => typeof v === 'string' && v.startsWith('{')).map((v) => JSON.parse(v));
        assert.equal(before.status, 'PENDING_APPROVAL', 'before state recorded');
        assert.equal(after.status, 'ACTIVE', 'after state recorded');
      });
    });
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

  test('Tiered Mode: Base 1000, 10% platform, 20% saler, 20% extra markup split', () => {
    // 1. Standard Default Retail (1000 + 100 + 200 = 1300)
    const def = calculatePricingBreakdown({
      baseCost: 1000,
      wholesaleMargin: 0,
      retailPrice: 1300,
      mode: 'tiered',
      platformDefaultProfitPct: 10,
      salerDefaultProfitPct: 20,
      extraMarkupPlatformPct: 20,
    });
    assert.equal(def.min_retail_price, 1100.0);
    assert.equal(def.default_retail_price, 1300.0);
    assert.equal(def.platform_earning, 100.0);
    assert.equal(def.saler_earning, 200.0);
    assert.equal(def.pricing_state, 'standard');
    assert.equal(def.wholesale_cost + def.platform_earning + def.saler_earning, 1300.0);

    // 2. Discounted Retail (1200) -> Only saler profit decreases, platform profit 100% protected!
    const disc = calculatePricingBreakdown({
      baseCost: 1000,
      wholesaleMargin: 0,
      retailPrice: 1200,
      mode: 'tiered',
      platformDefaultProfitPct: 10,
      salerDefaultProfitPct: 20,
      extraMarkupPlatformPct: 20,
    });
    assert.equal(disc.platform_earning, 100.0, 'Platform profit must not decrease');
    assert.equal(disc.saler_earning, 100.0, 'Saler absorbs entire 100 discount (200 - 100)');
    assert.equal(disc.pricing_state, 'discount');
    assert.equal(disc.wholesale_cost + disc.platform_earning + disc.saler_earning, 1200.0);

    // 3. Min Retail Floor (1100) -> Saler profit drops to 0, platform profit still protected at 100
    const minFloor = calculatePricingBreakdown({
      baseCost: 1000,
      wholesaleMargin: 0,
      retailPrice: 1100,
      mode: 'tiered',
      platformDefaultProfitPct: 10,
      salerDefaultProfitPct: 20,
      extraMarkupPlatformPct: 20,
    });
    assert.equal(minFloor.platform_earning, 100.0);
    assert.equal(minFloor.saler_earning, 0.0);
    assert.equal(minFloor.pricing_state, 'discount');

    // 4. Boost / Extra Markup Retail (1500) -> Extra 200 split 20% platform (40) / 80% saler (160)
    const boost = calculatePricingBreakdown({
      baseCost: 1000,
      wholesaleMargin: 0,
      retailPrice: 1500,
      mode: 'tiered',
      platformDefaultProfitPct: 10,
      salerDefaultProfitPct: 20,
      extraMarkupPlatformPct: 20,
    });
    assert.equal(boost.platform_earning, 140.0, 'Platform gets 100 default + 40 extra split');
    assert.equal(boost.saler_earning, 360.0, 'Saler gets 200 default + 160 extra split');
    assert.equal(boost.pricing_state, 'boost');
    assert.equal(boost.wholesale_cost + boost.platform_earning + boost.saler_earning, 1500.0);

    // 5. Below Floor (1050) throws AppError or rejects
    assert.throws(
      () =>
        calculatePricingBreakdown({
          baseCost: 1000,
          wholesaleMargin: 0,
          retailPrice: 1050,
          mode: 'tiered',
          platformDefaultProfitPct: 10,
          salerDefaultProfitPct: 20,
          extraMarkupPlatformPct: 20,
        }),
      (err) => err.code === 'VALIDATION_FAILED'
    );
  });
});
