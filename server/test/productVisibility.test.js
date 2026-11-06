/**
 * productVisibility.test.js — the supplier's cost never reaches a shopper, Explooro partner or guest.
 *
 * WHY this file exists: GET /products/:id and GET /products are public and select `p.*`, so until
 * 2026-11-02 every guest could read a product's base_cost, wholesale_margin, partner_profit and the
 * full pricing breakdown (platform earning, pool share). Only the owning supplier and admins may
 * read them (their catalog editor does). productVisibility.service.ts decides; these tests fail if
 * any of those fields reaches anyone else, through the detail, the list, sourcing or search.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.ts';
import errorHandlerPlugin from '../src/plugins/errorHandler.ts';
import productRoutes from '../src/routes/product.routes.ts';
import { getProductDetail } from '../src/services/product.service.ts';
import * as serverRules from '../src/services/productVisibility.service.ts';
import * as mockRules from '../../client/src/mocks/productVisibility.ts';

const COST_FIELDS = ['base_cost', 'wholesale_margin', 'partner_profit', 'min_retail_price', 'supplier_phone'];
const PUBLIC_PRICING_KEYS = ['default_retail_price', 'retail_price'];

const SUPPLIER_ID = 2;
const GUEST = null;
const CUSTOMER = { id: 40, roles: ['customer'] };
const SALER = { id: 41, roles: ['saler'] };
const OTHER_SUPPLIER = { id: 42, roles: ['supplier'] };
const OWNER = { id: SUPPLIER_ID, roles: ['supplier'] };
const ADMIN = { id: 1, roles: ['admin'] };
const SUPER_ADMIN = { id: 9, roles: ['super_admin'] };

function productRow(overrides = {}) {
  return {
    id: 7,
    ref: 'PRD-7',
    slug: 'prd-7',
    // node-postgres hands BIGINT back as a string; the owner check must still match.
    supplier_id: String(SUPPLIER_ID),
    category_id: 1,
    title_en: 'Kettle',
    title_bn: 'কেটলি',
    stock_qty: 10,
    base_cost: '100.00',
    wholesale_margin: '10.00',
    partner_profit: '20.00',
    min_retail_price: '121.00',
    default_retail_price: '150.00',
    supplier_phone: '+8801700000000',
    status: 'ACTIVE',
    ...overrides,
  };
}

function detailDb() {
  return {
    async query(sql) {
      if (sql.includes('FROM team_purchases')) return { rows: [{ reserved: 0 }] };
      if (sql.includes('FROM product_variants')) return { rows: [{ id: 1, product_id: 7, stock_qty: 3, price_delta: '0' }] };
      if (/FROM products\b/.test(sql) && !sql.includes('product_images')) return { rows: [productRow()] };
      return { rows: [] };
    },
  };
}

function assertNoCosts(product, who) {
  for (const key of COST_FIELDS) {
    assert.equal(key in product, false, `${who} must not receive ${key}`);
  }
  if (product.pricing) {
    const extra = Object.keys(product.pricing).filter((key) => !PUBLIC_PRICING_KEYS.includes(key));
    assert.deepEqual(extra, [], `${who} must get no pricing breakdown`);
  }
}

describe('GET /products/:id detail', () => {
  for (const [who, viewer] of [
    ['a guest', GUEST],
    ['a customer', CUSTOMER],
    ['a Explooro partner', SALER],
    ['another supplier', OTHER_SUPPLIER],
  ]) {
    test(`${who} gets no cost, margin or pricing breakdown`, async () => {
      const p = await getProductDetail(detailDb(), '7', viewer);
      assertNoCosts(p, who);
      // What a shopper needs is still there.
      assert.equal(p.default_retail_price, '150.00');
      assert.equal(p.pricing.retail_price, 150);
      assert.equal(p.available_qty, 10);
      assert.equal(p.variants.length, 1);
      assert.ok(Array.isArray(p.images));
    });
  }

  for (const [who, viewer] of [
    ['the owning supplier', OWNER],
    ['an admin', ADMIN],
    ['a super admin', SUPER_ADMIN],
  ]) {
    test(`${who} keeps the cost fields the catalog editor reads`, async () => {
      const p = await getProductDetail(detailDb(), '7', viewer);
      assert.equal(p.base_cost, '100.00');
      assert.equal(p.wholesale_margin, '10.00');
      assert.equal(p.partner_profit, '20.00');
      assert.ok('platform_earning' in p.pricing);
    });
  }
});

/** A db answering the catalog list SELECT with one row of each supplier. */
function listDb() {
  return {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ');
      if (normalized.includes('FROM products p') && normalized.includes('JOIN categories c')) {
        return {
          rows: [
            productRow({ id: 7, price: '150.00' }),
            productRow({ id: 8, ref: 'PRD-8', supplier_id: '99', price: '150.00' }),
          ],
        };
      }
      return { rows: [] };
    },
  };
}

function buildApp(viewer) {
  const app = Fastify({ logger: false });
  app.decorate('db', listDb());
  app.decorate('authenticate', async () => {});
  app.decorate('requirePermission', () => async () => {});
  app.decorate('requireRestriction', () => async () => {});
  if (viewer) {
    app.addHook('onRequest', async (req) => {
      req.user = viewer;
    });
  }
  app.register(requestContextPlugin);
  app.register(errorHandlerPlugin);
  app.register(productRoutes, { prefix: '/api/v1' });
  return app;
}

async function getJson(viewer, url) {
  const app = buildApp(viewer);
  try {
    await app.ready();
    const res = await app.inject({ method: 'GET', url: `/api/v1${url}` });
    assert.equal(res.statusCode, 200, `${url}: ${res.body}`);
    return res.json();
  } finally {
    await app.close();
  }
}

describe('GET /products list and /sourcing/catalog', () => {
  test('a guest and a Explooro partner get no cost on any row', async () => {
    for (const [who, viewer] of [['a guest', GUEST], ['a Explooro partner', SALER]]) {
      const body = await getJson(viewer, '/products');
      assert.equal(body.data.products.length, 2);
      for (const p of body.data.products) assertNoCosts(p, who);
    }
  });

  test('a supplier keeps cost on their own rows only', async () => {
    const body = await getJson(OWNER, '/products');
    const own = body.data.products.find((p) => p.id === 7);
    const other = body.data.products.find((p) => p.id === 8);
    assert.equal(own.base_cost, '100.00');
    assertNoCosts(other, 'a supplier reading another supplier’s row');
  });

  test('an admin keeps cost on every row', async () => {
    const body = await getJson(ADMIN, '/products');
    for (const p of body.data.products) assert.equal(p.base_cost, '100.00');
  });

  test('the sourcing catalog sends no cost or per-product pool figure', async () => {
    const body = await getJson(SALER, '/sourcing/catalog');
    assert.equal(body.catalog.length, 2);
    for (const p of body.catalog) {
      assertNoCosts(p, 'a Explooro partner');
      assert.equal('sourcing_opportunity' in p, false);
    }
  });
});

describe('the client mock follows the same rule', () => {
  test('its field lists equal the server’s', () => {
    assert.deepEqual([...mockRules.PRIVATE_PRODUCT_FIELDS].sort(), [...serverRules.PRIVATE_PRODUCT_FIELDS].sort());
    assert.deepEqual([...mockRules.PUBLIC_PRICING_FIELDS].sort(), [...serverRules.PUBLIC_PRICING_FIELDS].sort());
  });

  test('a guest and a Explooro partner get no cost from the mock either', () => {
    const row = { ...productRow(), pricing: { retail_price: 150, base_cost: 100, platform_earning: 12 } };
    for (const viewer of [GUEST, SALER]) assertNoCosts(mockRules.productForViewer(row, viewer), 'a mock viewer');
    assert.equal(mockRules.productForViewer(row, ADMIN).base_cost, '100.00');
    assert.equal(mockRules.productForViewer(row, OWNER).base_cost, '100.00');
  });
});
