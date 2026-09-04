/**
 * catalogStats.test.js — GET /admin/catalog/stats, the KPI strip behind the Super Admin catalog
 * dashboard (docs/super-admin-audit.md §4, traceability row 71).
 *
 * The invariant worth protecting: the panel's numbers describe the whole catalog, not the page of
 * products the browser happens to have loaded, and they are gated by the same permission as the
 * catalog itself.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import productRoutes from '../src/routes/product.routes.js';

/**
 * A mock db that answers the two aggregate queries by actually aggregating, so the test exercises
 * the shaping in the service rather than asserting on canned rows.
 */
function createMockDb({ products, settings = {} } = {}) {
  return {
    settings,
    queries: [],
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      this.queries.push(normalized);

      if (normalized.startsWith('SELECT value_json FROM platform_settings')) {
        const value = this.settings['catalog.low_stock_threshold'];
        return { rows: value === undefined ? [] : [{ value_json: value }] };
      }

      if (normalized.includes('AS total_products')) {
        const threshold = params[0];
        const status = params[1];
        const rows = products.filter((p) => !p.deleted_at && (!status || p.status === status));
        const isVerified = (p) => p.tier === 'VERIFIED_TRADER' || p.tier === 'ELITE_PARTNER';
        const sum = rows.reduce(
          (acc, p) => acc + parseFloat(p.default_retail_price) * Math.max(p.stock_qty ?? 0, 0),
          0
        );
        return {
          rows: [
            {
              total_products: rows.length,
              in_stock_count: rows.filter((p) => (p.stock_qty ?? 0) > 0).length,
              low_stock_count: rows.filter(
                (p) => (p.stock_qty ?? 0) > 0 && (p.stock_qty ?? 0) <= (p.low_stock_threshold ?? threshold)
              ).length,
              out_of_stock_count: rows.filter((p) => (p.stock_qty ?? 0) <= 0).length,
              flash_sale_count: rows.filter((p) => p.on_flash_sale).length,
              total_categories: new Set(rows.map((p) => p.category_id)).size,
              total_suppliers: new Set(rows.map((p) => p.supplier_id)).size,
              verified_suppliers_count: new Set(rows.filter(isVerified).map((p) => p.supplier_id)).size,
              // NUMERIC comes back from node-postgres as a string; the service must coerce it.
              total_potential_inventory_value: sum.toFixed(2),
            },
          ],
        };
      }

      if (normalized.includes('AS product_count')) {
        const status = params[0];
        const rows = products.filter((p) => !p.deleted_at && (!status || p.status === status));
        const byCategory = new Map();
        for (const p of rows) {
          byCategory.set(p.category_name_en, (byCategory.get(p.category_name_en) || 0) + 1);
        }
        return {
          rows: [...byCategory].map(([category_name_en, product_count]) => ({
            category_name_en,
            product_count,
          })),
        };
      }

      return { rows: [] };
    },
  };
}

const PRODUCTS = [
  // supplier 101 is a verified trader with three ACTIVE products
  { id: 1, supplier_id: 101, tier: 'VERIFIED_TRADER', category_id: 1, category_name_en: 'Fashion', status: 'ACTIVE', stock_qty: 50, default_retail_price: '700.00', deleted_at: null },
  { id: 2, supplier_id: 101, tier: 'VERIFIED_TRADER', category_id: 1, category_name_en: 'Fashion', status: 'ACTIVE', stock_qty: 4, default_retail_price: '2000.00', deleted_at: null, on_flash_sale: true },
  { id: 3, supplier_id: 101, tier: 'VERIFIED_TRADER', category_id: 2, category_name_en: 'Groceries', status: 'ACTIVE', stock_qty: 0, default_retail_price: '150.00', deleted_at: null },
  // supplier 102 is unverified
  { id: 4, supplier_id: 102, tier: 'STARTER', category_id: 2, category_name_en: 'Groceries', status: 'ACTIVE', stock_qty: 9, default_retail_price: '100.00', deleted_at: null },
  // a product with its own, tighter threshold: 9 units is NOT low for it
  { id: 5, supplier_id: 102, tier: 'STARTER', category_id: 2, category_name_en: 'Groceries', status: 'ACTIVE', stock_qty: 9, default_retail_price: '100.00', low_stock_threshold: 3, deleted_at: null },
  // excluded: not ACTIVE, and soft-deleted
  { id: 6, supplier_id: 103, tier: 'ELITE_PARTNER', category_id: 3, category_name_en: 'Electronics', status: 'DRAFT', stock_qty: 5, default_retail_price: '5000.00', deleted_at: null },
  { id: 7, supplier_id: 104, tier: 'ELITE_PARTNER', category_id: 3, category_name_en: 'Electronics', status: 'ACTIVE', stock_qty: 5, default_retail_price: '5000.00', deleted_at: '2026-01-01' },
];

function buildApp(db, user) {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('authenticate', async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: { code: 'AUTH_REQUIRED' } });
  });
  app.decorate('requirePermission', (permKey) => async (req, reply) => {
    if (!req.user?.permissions?.includes(permKey)) {
      return reply.status(403).send({ error: { code: 'PERMISSION_DENIED' } });
    }
  });
  app.addHook('onRequest', (req, reply, done) => {
    req.user = user;
    done();
  });
  app.register(requestContextPlugin);
  app.register(errorHandlerPlugin);
  return app;
}

describe('GET /admin/catalog/stats — Super Admin catalog KPIs', () => {
  let app;
  let db;

  before(async () => {
    db = createMockDb({ products: PRODUCTS });
    app = buildApp(db, {
      id: 1,
      role: 'super_admin',
      permissions: ['catalog.product.view_all'],
    });
    await app.register(productRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('counts the whole catalog, not a page of it, and scopes to ACTIVE by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/catalog/stats' });
    assert.equal(res.statusCode, 200);

    const { stats } = res.json().data;
    // 5 ACTIVE, non-deleted products: the DRAFT and the soft-deleted one are excluded.
    assert.equal(stats.total_products, 5);
    assert.equal(stats.in_stock_count, 4);
    assert.equal(stats.out_of_stock_count, 1);
    assert.equal(stats.flash_sale_count, 1);
    assert.equal(stats.total_categories, 2);
    assert.equal(stats.status_scope, 'ACTIVE');
  });

  test('a product own low_stock_threshold overrides the catalog-wide one', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/catalog/stats' });
    const { stats } = res.json().data;

    // Product 2 (4 units) and 4 (9 units) are low against the default 10.
    // Product 5 also holds 9 units but declares a threshold of 3, so it is NOT low.
    assert.equal(stats.low_stock_count, 2);
    assert.equal(stats.low_stock_threshold, 10);
  });

  test('verified_suppliers_count counts suppliers, not their products', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/catalog/stats' });
    const { stats } = res.json().data;

    // Supplier 101 is verified and owns three of the five products — the KPI reads "1".
    assert.equal(stats.verified_suppliers_count, 1);
    assert.equal(stats.total_suppliers, 2);
  });

  test('inventory value arrives as a number, not the NUMERIC string node-postgres returns', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/catalog/stats' });
    const { stats } = res.json().data;

    // 700*50 + 2000*4 + 150*0 + 100*9 + 100*9 = 35000 + 8000 + 0 + 900 + 900
    assert.equal(typeof stats.total_potential_inventory_value, 'number');
    assert.equal(stats.total_potential_inventory_value, 44800);
  });

  test('categories_breakdown is keyed by category name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/catalog/stats' });
    const { stats } = res.json().data;

    assert.deepEqual(stats.categories_breakdown, { Fashion: 2, Groceries: 3 });
  });

  test('platform_settings overrides the low-stock threshold without a deploy', async () => {
    const settingsDb = createMockDb({
      products: PRODUCTS,
      settings: { 'catalog.low_stock_threshold': 5 },
    });
    const settingsApp = buildApp(settingsDb, {
      id: 1,
      role: 'super_admin',
      permissions: ['catalog.product.view_all'],
    });
    await settingsApp.register(productRoutes, { prefix: '/api/v1' });
    await settingsApp.ready();

    const res = await settingsApp.inject({ method: 'GET', url: '/api/v1/admin/catalog/stats' });
    const { stats } = res.json().data;

    assert.equal(stats.low_stock_threshold, 5);
    // Only product 2 (4 units) is now low; product 4's 9 units clears the tighter cutoff.
    assert.equal(stats.low_stock_count, 1);

    await settingsApp.close();
  });

  test('status=ALL widens the scope beyond ACTIVE', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/catalog/stats?status=ALL' });
    const { stats } = res.json().data;

    // The DRAFT product joins; the soft-deleted one never does.
    assert.equal(stats.total_products, 6);
    assert.equal(stats.status_scope, 'ALL');
  });

  test('an account without catalog.product.view_all is refused', async () => {
    const deniedApp = buildApp(createMockDb({ products: PRODUCTS }), {
      id: 9,
      role: 'customer',
      permissions: [],
    });
    await deniedApp.register(productRoutes, { prefix: '/api/v1' });
    await deniedApp.ready();

    const res = await deniedApp.inject({ method: 'GET', url: '/api/v1/admin/catalog/stats' });
    assert.equal(res.statusCode, 403);

    await deniedApp.close();
  });

  test('an anonymous request is refused before any query runs', async () => {
    const anonDb = createMockDb({ products: PRODUCTS });
    const anonApp = buildApp(anonDb, undefined);
    await anonApp.register(productRoutes, { prefix: '/api/v1' });
    await anonApp.ready();

    const res = await anonApp.inject({ method: 'GET', url: '/api/v1/admin/catalog/stats' });
    assert.equal(res.statusCode, 401);
    assert.equal(anonDb.queries.length, 0);

    await anonApp.close();
  });
});
