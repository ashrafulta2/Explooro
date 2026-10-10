/**
 * catalogListing.test.js — The query contract of GET /products, the public marketplace grid.
 *
 * WHY this file exists: the landing page has always sent `sort`, `category`, `tier`, `in_stock`,
 * `min_rating`, `min_margin` and `cursor` — the names the mock driver reads — while the live
 * controller only ever destructured `sort_by`, `category_slug`, `supplier_tier` and `offset`.
 * Every one of those controls worked in mock mode and silently did nothing against the real API.
 * The sort dropdown was the visible symptom: an unread `sort` fell through to `newest`, so
 * "Price: Low to High" reordered nothing.
 *
 * Each suite below pins one half of the repaired contract so a regression fails the build:
 *
 *   1. Sort — the dropdown's four values reach the ORDER BY, under either param name.
 *   2. Filters — category (by name or slug), in_stock, min_rating and tier reach the WHERE.
 *   3. Pagination — the cursor envelope docs/api-contract.md §4.1 mandates for feeds.
 *   4. Margin — filtered against the same number the product card badges.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import productRoutes from '../src/routes/product.routes.js';

/** base_cost 100 / retail 200 at the 40% default saler split ⇒ saler_margin_pct 20. */
function makeRow(id, overrides = {}) {
  return {
    id,
    ref: `EXP-P-${id}`,
    supplier_id: 500,
    category_id: 1,
    title_en: `Product ${id}`,
    title_bn: `প্রোডাক্ট ${id}`,
    base_cost: '100.00',
    wholesale_margin: '0.00',
    default_retail_price: '200.00',
    price: '200.00',
    stock_qty: 10,
    rating_avg: '4.50',
    sold_count: 3,
    status: 'ACTIVE',
    primary_image_key: null,
    ...overrides,
  };
}

/**
 * A mock db that answers the catalog SELECT by actually honouring the LIMIT/OFFSET it was handed,
 * so the pagination suite exercises the real over-fetch-by-one arithmetic rather than canned rows.
 * Everything else (commission rules, platform_settings) returns no rows, so pricing falls to its
 * documented 40/60 default split.
 */
function createMockDb(rows = []) {
  return {
    catalogQueries: [],
    rows,
    countQueries: [],
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT COUNT(DISTINCT p.id)')) {
        this.countQueries.push({ sql: normalized, params });
        return { rows: [{ total: this.rows.length }] };
      }
      if (normalized.includes('FROM products p') && normalized.includes('JOIN categories c')) {
        this.catalogQueries.push({ sql: normalized, params });
        // The catalog query always binds limit then offset as its final two parameters.
        const limit = Number(params[params.length - 2]);
        const offset = Number(params[params.length - 1]);
        return { rows: this.rows.slice(offset, offset + limit) };
      }
      return { rows: [] };
    },
  };
}

function buildApp(db) {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('authenticate', async () => {});
  app.decorate('requirePermission', () => async () => {});
  app.decorate('requireRestriction', () => async () => {});
  app.register(requestContextPlugin);
  app.register(errorHandlerPlugin);
  return app;
}

/** Issues one GET /products and hands back the parsed body plus the SQL it produced. */
async function listProducts(app, db, qs = '') {
  db.catalogQueries.length = 0;
  db.countQueries.length = 0;
  const res = await app.inject({ method: 'GET', url: `/api/v1/products${qs}` });
  assert.equal(res.statusCode, 200, `GET /products${qs} should succeed`);
  return { body: res.json(), query: db.catalogQueries.at(-1) };
}

/**
 * Everything after the statement's own WHERE. The last WHERE is the real one — the primary-image
 * subselect in the column list carries its own WHERE and its own ORDER BY, so naive splitting
 * reads the image ordering instead of the catalog's.
 */
function tailOf(query) {
  const idx = query.sql.lastIndexOf(' WHERE ');
  assert.ok(idx > -1, 'the catalog query must have a WHERE clause');
  return query.sql.slice(idx + ' WHERE '.length);
}

/** The WHERE clause of the captured catalog SQL — filters only, no column expressions. */
function whereClause(query) {
  return tailOf(query).split(' ORDER BY ')[0];
}

/** The ORDER BY clause of the captured catalog SQL. */
function orderBy(query) {
  return tailOf(query).split(' ORDER BY ')[1]?.split(' LIMIT ')[0] ?? '';
}

describe('GET /products — sort', () => {
  let app;
  let db;

  before(async () => {
    db = createMockDb([makeRow(1)]);
    app = buildApp(db);
    await app.register(productRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('the grid dropdown sends `sort`, and every one of its values reaches the ORDER BY', async () => {
    // The four values client/src/pages/HomePage.js's sortOptions can produce. Before the fix all
    // four produced `p.created_at DESC`, because only `sort_by` was read.
    const expected = {
      price_asc: 'p.default_retail_price ASC',
      price_desc: 'p.default_retail_price DESC',
      rating: 'p.rating_avg DESC',
      newest: 'p.created_at DESC',
    };
    for (const [value, clause] of Object.entries(expected)) {
      const { query } = await listProducts(app, db, `?sort=${value}`);
      assert.equal(orderBy(query), clause, `sort=${value}`);
    }
  });

  test('`sort_by` keeps working, and wins when both are sent', async () => {
    const byLegacy = await listProducts(app, db, '?sort_by=price_desc');
    assert.equal(orderBy(byLegacy.query), 'p.default_retail_price DESC');

    const both = await listProducts(app, db, '?sort_by=rating&sort=price_asc');
    assert.equal(orderBy(both.query), 'p.rating_avg DESC');
  });

  test('"Featured" (no sort param at all) falls back to newest, as it always did', async () => {
    const { query } = await listProducts(app, db, '');
    assert.equal(orderBy(query), 'p.created_at DESC');
  });
});

describe('GET /products — filters the grid actually sends', () => {
  let app;
  let db;

  before(async () => {
    db = createMockDb([makeRow(1)]);
    app = buildApp(db);
    await app.register(productRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('`category` resolves a category NAME, which is what the pills are keyed by', async () => {
    const { query } = await listProducts(app, db, '?category=Home%20%26%20Kitchen');
    assert.match(whereClause(query), /c\.slug ILIKE \$\d+ OR c\.name_en ILIKE \$\d+/);
    assert.ok(query.params.includes('Home & Kitchen'), 'the pill label must be bound as a param');
  });

  test('`category=all` is the no-filter sentinel, not a category to look up', async () => {
    const { query } = await listProducts(app, db, '?category=all');
    assert.doesNotMatch(whereClause(query), /name_en ILIKE/);
  });

  test('`in_stock=1` excludes sold-out rows in SQL, not after the page was cut', async () => {
    const { query } = await listProducts(app, db, '?in_stock=1');
    assert.match(whereClause(query), /tp\.expires_at > now\(\)\), 0\) > 0/);

    const off = await listProducts(app, db, '');
    assert.doesNotMatch(whereClause(off.query), /tp\.expires_at > now\(\)\), 0\) > 0/);
  });

  test('`min_rating` counts an unrated product as 0 rather than dropping it on NULL', async () => {
    const { query } = await listProducts(app, db, '?min_rating=4');
    assert.match(whereClause(query), /COALESCE\(p\.rating_avg, 0\) >= \$\d+/);
    assert.ok(query.params.includes(4));
  });

  test('`tier` is an alias for `supplier_tier` and maps the client vocabulary to the DB enum', async () => {
    const { query } = await listProducts(app, db, '?tier=verified,elite');
    const tiers = query.params.find((p) => Array.isArray(p));
    assert.deepEqual(tiers, ['VERIFIED_TRADER', 'ELITE_PARTNER']);
  });

  test('`flash_sale` accepts the spellings a query string can carry', async () => {
    for (const value of ['1', 'true', 'yes']) {
      const { query } = await listProducts(app, db, `?flash_sale=${value}`);
      assert.match(whereClause(query), /fs\.id IS NOT NULL/, `flash_sale=${value}`);
    }
    const off = await listProducts(app, db, '?flash_sale=0');
    assert.doesNotMatch(whereClause(off.query), /fs\.id IS NOT NULL/);
  });
});

describe('GET /products — cursor pagination (docs/api-contract.md §4.1)', () => {
  let app;
  let db;

  before(async () => {
    db = createMockDb([1, 2, 3, 4, 5].map((id) => makeRow(id)));
    app = buildApp(db);
    await app.register(productRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('a feed page answers has_more without a COUNT, by over-fetching exactly one row', async () => {
    const { body, query } = await listProducts(app, db, '?limit=2');
    assert.equal(Number(query.params[query.params.length - 2]), 3, 'limit + 1');
    assert.equal(body.data.products.length, 2, 'the extra row must not be served');
    assert.equal(body.meta.count, 2);
    assert.equal(body.meta.cursor.has_more, true);
    assert.ok(body.meta.cursor.next, 'a next cursor is required while has_more is true');
  });

  test('walking the cursor covers every product exactly once and then stops', async () => {
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 10; page += 1) {
      const qs = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const { body } = await listProducts(app, db, qs);
      seen.push(...body.data.products.map((p) => p.id));
      if (!body.meta.cursor.has_more) {
        assert.equal(body.meta.cursor.next, null, 'the last page must not offer a next cursor');
        break;
      }
      cursor = body.meta.cursor.next;
    }
    assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  });

  test('a malformed cursor restarts the feed instead of 500-ing a public page', async () => {
    const { body } = await listProducts(app, db, '?limit=2&cursor=not-base64-at-all');
    assert.deepEqual(body.data.products.map((p) => p.id), [1, 2]);
  });

  test('`limit` is clamped to the contract maximum of 100', async () => {
    const { query } = await listProducts(app, db, '?limit=5000');
    assert.equal(Number(query.params[query.params.length - 2]), 101, '100 + the over-fetch row');
  });

  test('the "N products" total counts the whole filtered catalog, not the loaded page', async () => {
    const { body } = await listProducts(app, db, '?limit=2');
    assert.equal(body.meta.total, 5, 'five products match, two were served');
    assert.equal(body.meta.count, 2);
  });

  test('only the first page pays for the COUNT — a deep scroll must not repeat it', async () => {
    const first = await listProducts(app, db, '?limit=2');
    assert.equal(db.countQueries.length, 1);

    const second = await listProducts(app, db, `?limit=2&cursor=${encodeURIComponent(first.body.meta.cursor.next)}`);
    assert.equal(db.countQueries.length, 0, 'no COUNT on a cursor page');
    assert.equal(second.body.meta.total, undefined, 'and no total is claimed without one');
  });

  test('the COUNT shares the page query filters, so the label can never contradict the grid', async () => {
    await listProducts(app, db, '?in_stock=1&min_rating=4&category=Clothing');
    const count = db.countQueries.at(-1);
    assert.match(count.sql, /tp\.expires_at > now\(\)\), 0\) > 0/);
    assert.match(count.sql, /COALESCE\(p\.rating_avg, 0\) >= \$\d+/);
    assert.match(count.sql, /c\.name_en ILIKE \$\d+/);
    // No pagination bound into the total — that is the whole point of it.
    assert.doesNotMatch(count.sql, /LIMIT|OFFSET/);
  });
});

describe('GET /products — min_margin', () => {
  let app;
  let db;

  before(async () => {
    db = createMockDb([
      makeRow(1), // retail 200 over cost 100 ⇒ saler_margin_pct 20
      makeRow(2, { default_retail_price: '100.00', price: '100.00' }), // no margin at all
    ]);
    app = buildApp(db);
    await app.register(productRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('filters on the same number the product card badges, so no card contradicts the filter', async () => {
    const unfiltered = await listProducts(app, db, '');
    assert.deepEqual(unfiltered.body.data.products.map((p) => p.id), [1, 2]);
    assert.equal(unfiltered.body.data.products[0].pricing.saler_margin_pct, 20);
    assert.equal(unfiltered.body.data.products[1].pricing.saler_margin_pct, 0);

    const { body } = await listProducts(app, db, '?min_margin=10');
    assert.deepEqual(body.data.products.map((p) => p.id), [1]);
    assert.equal(body.meta.count, 1);
  });

  test('no total is claimed once margin has been applied in JS, rather than a wrong one', async () => {
    const { body } = await listProducts(app, db, '?min_margin=10');
    // The SQL COUNT cannot see the margin filter, so 2 would be a lie. The grid falls back to
    // counting what it loaded.
    assert.equal(body.meta.total, undefined);
  });

  test('a threshold nothing meets empties the page without breaking the envelope', async () => {
    const { body } = await listProducts(app, db, '?min_margin=90');
    assert.deepEqual(body.data.products, []);
    assert.equal(body.meta.cursor.has_more, false);
  });
});
