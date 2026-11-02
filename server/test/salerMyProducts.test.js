/**
 * salerMyProducts.test.js — My Products endpoints: GET / PATCH / DELETE /saler/products.
 *
 * Until 2026-11-02 only the client mock answered these, so My Products was empty in live mode. The
 * invariants checked here:
 *  1. The list includes hidden items (the partner must be able to re-show one), is paginated, and
 *     its summary counts the whole shelf, not the page.
 *  2. Stock is net of open team reservations, in the list and in the summary.
 *  3. Nothing behind the shopper's price reaches the partner: no supplier cost or margin, no
 *     `partner_profit` (the per-product reward pool amount), no custom price.
 *  4. A price in a PATCH is refused with 422 PRICE_LOCKED; only `is_active` may change.
 *  5. A partner can only touch items in their own store (another store's item is a 404).
 *  6. The routes are behind the virtual_storefront module and saler.store.manage.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.ts';
import errorHandlerPlugin from '../src/plugins/errorHandler.ts';
import storeRoutes from '../src/routes/store.routes.ts';
import * as storeService from '../src/services/store.service.ts';

const PARTNER = 201;
const OTHER_PARTNER = 202;

function product(id, overrides = {}) {
  return {
    product_id: id,
    product_ref: `PRD-${id}`,
    product_slug: `product-${id}`,
    title_en: `Product ${id}`,
    title_bn: `প্রোডাক্ট ${id}`,
    base_cost: '500.00',
    wholesale_margin: '50.00',
    default_retail_price: '700.00',
    partner_profit: '60.00',
    stock_qty: 10,
    category_name_en: 'Clothing',
    category_name_bn: 'পোশাক',
    supplier_name_en: 'Dhaka Weavers',
    images: [{ id: 1, storage_key: `products/${id}.jpg`, is_primary: true }],
    ...overrides,
  };
}

/** A small in-memory database answering exactly the queries the store repository sends. */
function createDb() {
  const state = {
    stores: [
      { id: 11, saler_id: PARTNER, slug: 'tanvir-trends' },
      { id: 12, saler_id: OTHER_PARTNER, slug: 'other-shop' },
    ],
    items: [
      { item_id: 101, store_id: 11, is_active: true, custom_retail_price: null, collection_name: 'A', ...product(1) },
      { item_id: 102, store_id: 11, is_active: false, custom_retail_price: null, collection_name: 'A', ...product(2, { stock_qty: 3 }) },
      { item_id: 103, store_id: 11, is_active: true, custom_retail_price: null, collection_name: 'B', ...product(3, { stock_qty: 0 }) },
      { item_id: 201, store_id: 12, is_active: true, custom_retail_price: null, collection_name: 'A', ...product(1) },
    ],
    // Open teams hold 3 units of product 2: its 3 on hand are all spoken for.
    reserved: new Map([[2, 3]]),
    // Units this partner sold of each product (cancelled orders are the SQL's job, not the mock's).
    sold: new Map([[1, 7]]),
    queries: [],
  };

  const db = {
    state,
    async query(sql, params = []) {
      state.queries.push(sql);
      if (sql.includes('FROM virtual_stores vs') && sql.includes('vs.saler_id = $1')) {
        return { rows: state.stores.filter((s) => s.saler_id === params[0]) };
      }
      if (sql.includes('FROM team_purchases')) {
        const ids = params[0].map(Number);
        return { rows: ids.filter((id) => state.reserved.has(id)).map((id) => ({ product_id: id, reserved: state.reserved.get(id) })) };
      }
      if (sql.includes('FROM sub_orders so')) {
        assert.equal(params[0], PARTNER, 'sales are counted for the signed-in partner only');
        const ids = params[1].map(Number);
        return { rows: ids.filter((id) => state.sold.has(id)).map((id) => ({ product_id: id, units: state.sold.get(id) })) };
      }
      if (sql.includes('SELECT ssi.product_id, p.stock_qty')) {
        return { rows: state.items.filter((i) => i.store_id === params[0]).map((i) => ({ product_id: i.product_id, stock_qty: i.stock_qty })) };
      }
      if (sql.includes('FROM saler_store_items ssi') && sql.includes('json_agg')) {
        let rows = state.items.filter((i) => i.store_id === params[0]);
        if (sql.includes('ssi.is_active = true')) rows = rows.filter((i) => i.is_active);
        if (params.length === 3) rows = rows.slice(params[2], params[2] + params[1]);
        return { rows: rows.map((r) => ({ ...r })) };
      }
      if (sql.includes('UPDATE saler_store_items SET is_active')) {
        const item = state.items.find((i) => i.store_id === params[0] && i.item_id === params[1]);
        if (!item) return { rows: [] };
        item.is_active = params[2];
        return { rows: [{ id: item.item_id, product_id: item.product_id, is_active: item.is_active }] };
      }
      if (sql.includes('DELETE FROM saler_store_items')) {
        const idx = state.items.findIndex((i) => i.store_id === params[0] && i.item_id === params[1]);
        if (idx === -1) return { rows: [] };
        const [item] = state.items.splice(idx, 1);
        return { rows: [{ id: item.item_id, product_id: item.product_id }] };
      }
      return { rows: [] };
    },
  };
  return db;
}

async function buildApp(db, { permissions = ['saler.store.manage'], moduleOn = true } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('authenticate', async (req) => {
    req.user = { id: PARTNER, ref: 'USR-SALER-001', role: 'saler', permissions, restrictions: [] };
  });
  app.decorate('requireModule', (key) => async (req, reply) => {
    if (!moduleOn) return reply.code(403).send({ error: { code: 'MODULE_DISABLED', module: key } });
  });
  app.decorate('requirePermission', (key) => async (req, reply) => {
    if (!req.user.permissions.includes(key)) return reply.code(403).send({ error: { code: 'FORBIDDEN', permission: key } });
  });
  app.register(requestContextPlugin);
  app.register(errorHandlerPlugin);
  await app.register(storeRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

describe('GET /saler/products', () => {
  test('lists hidden items too, with stock net of team reservations and the partner\'s own sales', async () => {
    const app = await buildApp(createDb());
    const res = await app.inject({ method: 'GET', url: '/api/v1/saler/products' });
    assert.equal(res.statusCode, 200, res.body);
    const { data } = res.json();

    assert.deepEqual(data.products.map((p) => p.id), [101, 102, 103], 'own store only, hidden item included');
    const [first, hidden, empty] = data.products;
    assert.equal(first.product_id, 1);
    assert.equal(first.default_retail_price, 700);
    assert.equal(first.stock_qty, 10);
    assert.equal(first.sales_count, 7);
    assert.equal(first.category, 'Clothing');
    assert.equal(first.supplier_name, 'Dhaka Weavers');
    assert.equal(first.is_active, true);
    assert.match(first.image_url, /products\/1\.jpg$/);

    assert.equal(hidden.is_active, false);
    assert.equal(hidden.stock_qty, 0, '3 on hand, 3 held by open teams');
    assert.equal(empty.sales_count, 0);

    assert.equal(data.total_count, 3);
    assert.deepEqual(data.summary, { total_curated: 3, in_stock_count: 1, out_of_stock_count: 2 });
    await app.close();
  });

  test('never sends what is behind the shopper\'s price: no cost, margin, pool amount or custom price', async () => {
    const app = await buildApp(createDb());
    const { data } = (await app.inject({ method: 'GET', url: '/api/v1/saler/products' })).json();
    const forbidden = ['base_cost', 'wholesale_margin', 'base_wholesale_price', 'partner_profit', 'custom_retail_price', 'min_retail_price', 'pricing'];
    for (const p of data.products) {
      for (const key of forbidden) assert.equal(key in p, false, `${key} must not reach a shop partner`);
    }
    assert.equal('avg_margin_pct' in data.summary, false);
    await app.close();
  });

  test('pages the list but counts the summary over the whole shelf', async () => {
    const app = await buildApp(createDb());
    const { data } = (await app.inject({ method: 'GET', url: '/api/v1/saler/products?limit=1&offset=1' })).json();
    assert.deepEqual(data.products.map((p) => p.id), [102]);
    assert.equal(data.limit, 1);
    assert.equal(data.offset, 1);
    assert.equal(data.total_count, 3);
    assert.equal(data.summary.total_curated, 3);
    await app.close();
  });

  test('clamps the page size to the maximum', async () => {
    const db = createDb();
    const data = await storeService.listMyProducts(db, PARTNER, { limit: '100000', offset: '-4' });
    assert.equal(data.limit, storeService.MY_PRODUCTS_PAGE.maxLimit);
    assert.equal(data.offset, 0);
  });

  test('a partner with no store yet gets an empty shelf, not an error', async () => {
    const db = createDb();
    db.state.stores = [];
    const data = await storeService.listMyProducts(db, PARTNER);
    assert.deepEqual(data.products, []);
    assert.equal(data.total_count, 0);
  });
});

describe('PATCH /saler/products/:id', () => {
  test('shows and hides an item', async () => {
    const db = createDb();
    const app = await buildApp(db);
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/saler/products/102', payload: { is_active: true } });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data.product, { id: 102, product_id: 2, is_active: true });
    assert.equal(db.state.items.find((i) => i.item_id === 102).is_active, true);
    await app.close();
  });

  test('refuses a partner price with 422 PRICE_LOCKED and changes nothing', async () => {
    const db = createDb();
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/saler/products/101',
      payload: { is_active: false, custom_retail_price: 650 },
    });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().error.code, 'PRICE_LOCKED');
    assert.equal(db.state.items.find((i) => i.item_id === 101).is_active, true);
    await app.close();
  });

  test('refuses a body with no boolean is_active', async () => {
    const app = await buildApp(createDb());
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/saler/products/101', payload: { is_active: 'yes' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_FAILED');
    await app.close();
  });

  test('another partner\'s item is a 404 and stays untouched', async () => {
    const db = createDb();
    const app = await buildApp(db);
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/saler/products/201', payload: { is_active: false } });
    assert.equal(res.statusCode, 404);
    assert.equal(db.state.items.find((i) => i.item_id === 201).is_active, true);
    await app.close();
  });
});

describe('DELETE /saler/products/:id', () => {
  test('removes the item from the partner\'s own store', async () => {
    const db = createDb();
    const app = await buildApp(db);
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/saler/products/103' });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data, { success: true, id: 103, product_id: 3 });
    assert.equal(db.state.items.some((i) => i.item_id === 103), false);
    await app.close();
  });

  test('another partner\'s item, or a non-numeric id, is a 404', async () => {
    const db = createDb();
    const app = await buildApp(db);
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/saler/products/201' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/saler/products/abc' })).statusCode, 404);
    assert.equal(db.state.items.some((i) => i.item_id === 201), true);
    await app.close();
  });
});

describe('guards', () => {
  test('without saler.store.manage every endpoint is refused', async () => {
    const db = createDb();
    const app = await buildApp(db, { permissions: [] });
    for (const [method, url] of [['GET', '/saler/products'], ['PATCH', '/saler/products/101'], ['DELETE', '/saler/products/101']]) {
      const res = await app.inject({ method, url: `/api/v1${url}`, payload: method === 'PATCH' ? { is_active: false } : undefined });
      assert.equal(res.statusCode, 403, `${method} ${url}`);
    }
    assert.equal(db.state.items.length, 4);
    await app.close();
  });

  test('with virtual_storefront off every endpoint is refused', async () => {
    const app = await buildApp(createDb(), { moduleOn: false });
    for (const [method, url] of [['GET', '/saler/products'], ['PATCH', '/saler/products/101'], ['DELETE', '/saler/products/101']]) {
      const res = await app.inject({ method, url: `/api/v1${url}`, payload: method === 'PATCH' ? { is_active: false } : undefined });
      assert.equal(res.statusCode, 403, `${method} ${url}`);
      assert.equal(res.json().error.code, 'MODULE_DISABLED');
    }
    await app.close();
  });
});
