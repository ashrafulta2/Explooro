/**
 * productVariant.db.test.js — PUT /products/:id/variants against real Postgres.
 *
 * The unit tests (productVariant.test.js) cover the pure rules; this runs the actual SQL in
 * product.repository.ts: the row locks, the inserts and updates, switching rows off, the stock sync,
 * the photo checks and the audit row. Opt-in, skipped without a database:
 *
 *   VARIANT_TEST_DATABASE_URL=postgresql://… npm test -w server -- test/productVariant.db.test.js
 *
 * WHY it is safe on a shared dev database: everything runs on ONE connection inside BEGIN and ends in
 * ROLLBACK, and each case sits behind a SAVEPOINT, so not a single row survives the run. It needs a
 * migrated + seeded database (005_demo_catalog.sql seeds products with variants and photos).
 */

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import '../src/config/loadEnvFile.ts';
import { saveVariants } from '../src/services/productVariant.service.ts';
import { clearVariantPhotosNotIn } from '../src/repositories/product.repository.ts';

const DB_URL = process.env.VARIANT_TEST_DATABASE_URL;

describe('variant save — real Postgres', { skip: DB_URL ? false : 'set VARIANT_TEST_DATABASE_URL to a migrated + seeded database' }, () => {
  let client;
  // The service sees an object with query() and no connect(), so it runs on our open transaction
  // instead of taking its own pooled connection (productVariant.service.ts inTransaction).
  const db = { query: (...args) => client.query(...args) };
  const q = async (sql, params) => (await client.query(sql, params)).rows;

  let product; // a seeded product with active variants and at least one photo
  let otherSku; // a variant SKU that belongs to a different product

  before(async () => {
    const pg = createRequire(import.meta.url)('pg');
    client = new pg.Client({ connectionString: DB_URL, ssl: /sslmode=require/i.test(DB_URL) ? { rejectUnauthorized: false } : false });
    await client.connect();
    await client.query('BEGIN');
    [product] = await q(
      `SELECT p.id, p.ref, p.supplier_id, p.stock_qty
         FROM products p
        WHERE p.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active)
          AND EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)
        ORDER BY p.id LIMIT 1`
    );
    assert.ok(product, 'the database needs a seeded product with active variants and a photo');
    [{ sku: otherSku }] = await q(`SELECT sku FROM product_variants WHERE product_id <> $1 ORDER BY id LIMIT 1`, [product.id]);
  });

  after(async () => {
    if (!client) return;
    await client.query('ROLLBACK');
    await client.end();
  });

  beforeEach(() => client.query('SAVEPOINT variant_case'));
  afterEach(() => client.query('ROLLBACK TO SAVEPOINT variant_case'));

  const active = () =>
    q(`SELECT id, sku, attributes_json, price_delta, stock_qty, image_id FROM product_variants WHERE product_id = $1 AND is_active ORDER BY id`, [product.id]);
  const productRow = async () => (await q(`SELECT stock_qty, has_variants FROM products WHERE id = $1`, [product.id]))[0];
  const ownerSave = (variants) => saveVariants(db, product.ref, Number(product.supplier_id), variants);

  test('updates a matching row, inserts a new one, switches off the one left out', async () => {
    const stored = await active();
    const [keep, ...dropped] = stored;
    const before = (await q(`SELECT COUNT(*)::int AS n FROM product_variants WHERE product_id = $1`, [product.id]))[0].n;

    const res = await ownerSave([
      { attributes: keep.attributes_json, stock_qty: 7, price_delta: 0 },
      { attributes: { ...keep.attributes_json, size: 'ZZ-TEST' }, stock_qty: 4, price_delta: 25 },
    ]);

    const now = await active();
    assert.equal(now.length, 2);
    assert.equal(Number(now.find((v) => Number(v.id) === Number(keep.id)).stock_qty), 7, 'the matching row was updated in place');
    const added = now.find((v) => v.attributes_json.size === 'ZZ-TEST');
    assert.ok(added, 'the new combination was inserted');
    assert.equal(Number(added.price_delta), 25);
    assert.match(added.sku, new RegExp(`^${product.ref}-`), 'a blank SKU gets the product ref');
    for (const d of dropped) {
      const [row] = await q(`SELECT is_active FROM product_variants WHERE id = $1`, [d.id]);
      assert.equal(row.is_active, false, 'a combination left out is switched off, not deleted');
    }
    const total = (await q(`SELECT COUNT(*)::int AS n FROM product_variants WHERE product_id = $1`, [product.id]))[0].n;
    assert.equal(total, before + 1, 'exactly one row was added and none deleted');

    const p = await productRow();
    assert.equal(p.stock_qty, 11, 'product stock is the active variants\' total');
    assert.equal(p.has_variants, true);
    assert.equal(res.stock_qty, 11);
  });

  test('saving the same list twice adds nothing the second time', async () => {
    const list = [{ attributes: { size: 'ZZ-A' }, stock_qty: 2 }, { attributes: { size: 'ZZ-B' }, stock_qty: 3 }];
    await ownerSave(list);
    const first = await active();
    await ownerSave(list);
    const second = await active();
    assert.deepEqual(second.map((v) => v.id), first.map((v) => v.id));
  });

  test('a combination removed earlier comes back as the same row', async () => {
    const [first] = await active();
    await ownerSave([{ attributes: { size: 'ZZ-ONLY' }, stock_qty: 1 }]);
    await ownerSave([{ attributes: first.attributes_json, stock_qty: 5 }]);
    const now = await active();
    assert.deepEqual(now.map((v) => Number(v.id)), [Number(first.id)]);
  });

  test('an empty list switches every variant off and leaves the stock alone', async () => {
    const stockBefore = (await productRow()).stock_qty;
    await ownerSave([]);
    assert.equal((await active()).length, 0);
    const p = await productRow();
    assert.equal(p.has_variants, false);
    assert.equal(p.stock_qty, stockBefore);
  });

  test('writes one audit row with the list before and after', async () => {
    await ownerSave([{ attributes: { size: 'ZZ-AUDIT' }, stock_qty: 9 }]);
    const rows = await q(
      `SELECT * FROM audit_logs WHERE action = 'catalog.product.variants.update' ORDER BY created_at DESC LIMIT 1`
    );
    assert.equal(rows.length, 1);
    const row = rows[0];
    const after = typeof row.after_json === 'string' ? JSON.parse(row.after_json) : (row.after_json ?? row.after);
    assert.ok(JSON.stringify(after).includes('ZZ-AUDIT'), 'the after snapshot holds the new list');
  });

  test('a variant photo must be one of the product photos, and is stored', async () => {
    const [{ media_id: own }] = await q(`SELECT media_id FROM product_images WHERE product_id = $1 ORDER BY display_order LIMIT 1`, [product.id]);
    await ownerSave([{ attributes: { color: 'ZZ-RED' }, stock_qty: 1, image_media_id: Number(own) }]);
    const [row] = await active();
    assert.equal(Number(row.image_id), Number(own));

    const [foreign] = await q(
      `SELECT id FROM media_assets WHERE id NOT IN (SELECT media_id FROM product_images WHERE product_id = $1) ORDER BY id LIMIT 1`,
      [product.id]
    );
    if (foreign) {
      await assert.rejects(
        ownerSave([{ attributes: { color: 'ZZ-RED' }, stock_qty: 1, image_media_id: Number(foreign.id) }]),
        /not one of this product/
      );
    }
  });

  test('a photo removed from the product is unlinked from its variants', async () => {
    const [{ media_id: own }] = await q(`SELECT media_id FROM product_images WHERE product_id = $1 LIMIT 1`, [product.id]);
    await ownerSave([{ attributes: { color: 'ZZ-BLUE' }, stock_qty: 1, image_media_id: Number(own) }]);
    await clearVariantPhotosNotIn(db, product.id, []);
    const [row] = await active();
    assert.equal(row.image_id, null);
  });

  test('more than size and colour: a weight-only list saves', async () => {
    await ownerSave([{ attributes: { weight: '500 g' }, stock_qty: 2 }, { attributes: { weight: '1 kg' }, stock_qty: 1 }]);
    const now = await active();
    assert.deepEqual(now.map((v) => v.attributes_json.weight).sort(), ['1 kg', '500 g']);
  });

  test('a SKU another product already uses is a 409 CONFLICT, not a 500', async () => {
    await assert.rejects(ownerSave([{ attributes: { size: 'ZZ-DUP' }, sku: otherSku, stock_qty: 1 }]), (err) => err.code === 'CONFLICT');
  });

  test('someone who does not own the product is refused before any write', async () => {
    await assert.rejects(saveVariants(db, product.ref, -1, [{ attributes: { size: 'ZZ-X' } }]), (err) => err.code === 'FORBIDDEN');
  });
});

// ── HTTP: the real routes, guards and controllers over the same kind of rolled-back transaction ──

describe('variant + variant-option routes — real Postgres over HTTP', { skip: DB_URL ? false : 'set VARIANT_TEST_DATABASE_URL to a migrated + seeded database' }, () => {
  let client;
  let app;
  const db = { query: (...args) => client.query(...args) };
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  let product;
  let superAdminId;
  let customerId;

  before(async () => {
    const pg = createRequire(import.meta.url)('pg');
    client = new pg.Client({ connectionString: DB_URL, ssl: /sslmode=require/i.test(DB_URL) ? { rejectUnauthorized: false } : false });
    await client.connect();
    await client.query('BEGIN');
    [product] = await q(
      `SELECT p.id, p.ref, p.supplier_id, p.category_id FROM products p
        WHERE p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active)
        ORDER BY p.id LIMIT 1`
    );
    const roleUser = async (key) =>
      (await q(`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.key = $1 ORDER BY u.id LIMIT 1`, [key]))[0]?.id;
    superAdminId = Number(await roleUser('super_admin'));
    customerId = Number(await roleUser('customer'));
    assert.ok(product && superAdminId && customerId, 'needs a seeded product, a super admin and a customer');

    const Fastify = (await import('fastify')).default;
    const { default: requestContextPlugin } = await import('../src/plugins/requestContext.ts');
    const { default: errorHandlerPlugin } = await import('../src/plugins/errorHandler.ts');
    const { default: requirePermissionPlugin } = await import('../src/middlewares/requirePermission.ts');
    const { default: productRoutes } = await import('../src/routes/product.routes.ts');
    const { default: variantOptionsRoutes } = await import('../src/routes/variantOptions.routes.ts');
    const { createMemoryCache } = await import('../src/config/cache-drivers/memory.ts');

    app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', createMemoryCache());
    // Stands in for the JWT plugin only: who is calling. Everything after it (permission, restriction,
    // ownership, the SQL) is the real code reading the real tables.
    app.addHook('onRequest', async (req) => {
      const id = req.headers['x-test-user'];
      if (id) {
        const roles = (await q(`SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`, [Number(id)])).map((r) => r.key);
        req.user = { id: Number(id), roles };
      }
    });
    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    app.register(requirePermissionPlugin);
    await app.register(productRoutes, { prefix: '/api/v1' });
    await app.register(variantOptionsRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    if (!client) return;
    await client.query('ROLLBACK');
    await client.end();
  });

  beforeEach(() => client.query('SAVEPOINT http_case'));
  afterEach(() => client.query('ROLLBACK TO SAVEPOINT http_case'));

  const call = (method, url, { user = null, body = undefined } = {}) =>
    app.inject({ method, url: `/api/v1${url}`, headers: user ? { 'x-test-user': String(user) } : {}, payload: body });
  const putVariants = (user, variants) => call('PUT', `/products/${product.ref}/variants`, { user, body: { variants } });

  test('owner saves: 200, the response envelope, and the rows', async () => {
    const res = await putVariants(product.supplier_id, [{ attributes: { size: 'ZZ-HTTP' }, stock_qty: 3 }]);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.data.product_ref, product.ref);
    assert.deepEqual(body.data.variants.map((v) => v.attributes.size), ['ZZ-HTTP']);
    assert.equal(body.data.stock_qty, 3);
  });

  test('signed out: 401, nothing written', async () => {
    const res = await putVariants(null, [{ attributes: { size: 'ZZ-HTTP' } }]);
    assert.equal(res.statusCode, 401);
    assert.equal((await q(`SELECT 1 FROM product_variants WHERE attributes_json->>'size' = 'ZZ-HTTP'`)).length, 0);
  });

  test('a product the caller does not own: 403', async () => {
    const res = await putVariants(customerId, [{ attributes: { size: 'ZZ-HTTP' } }]);
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'FORBIDDEN');
  });

  test('staff may edit any supplier variants', async () => {
    const res = await putVariants(superAdminId, [{ attributes: { size: 'ZZ-STAFF' }, stock_qty: 1 }]);
    assert.equal(res.statusCode, 200, res.body);
  });

  test('a bad row: 400 VALIDATION_FAILED', async () => {
    const res = await putVariants(product.supplier_id, [{ attributes: { size: 'M' }, stock_qty: -1 }]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_FAILED');
  });

  test('a supplier blocked from listing products is stopped by the restriction guard', async () => {
    await q(
      `INSERT INTO user_restrictions (subject_type, subject_ref, capability_key, mode, reason, applied_by)
       VALUES ('USER', $1, 'can_list_products', 'BLOCK', 'Test block from productVariant.db.test.js', $2)`,
      [String(product.supplier_id), superAdminId]
    );
    const res = await putVariants(product.supplier_id, [{ attributes: { size: 'ZZ-HTTP' } }]);
    assert.notEqual(res.statusCode, 200);
    assert.equal(res.json().error.code, 'USER_RESTRICTED');
  });

  test('the category rule end to end: admin narrows it, the form list follows, the save refuses the rest', async () => {
    const before = await call('GET', `/catalog/variant-options?category_id=${product.category_id}`, { user: product.supplier_id });
    assert.equal(before.statusCode, 200, before.body);
    assert.ok(before.json().data.options.includes('size'), 'nothing set yet: every option');

    const admin = await call('GET', '/admin/catalog/variant-options', { user: superAdminId });
    assert.equal(admin.statusCode, 200, admin.body);
    const saved = await call('PUT', '/admin/catalog/variant-options', {
      user: superAdminId,
      body: { categories: { [product.category_id]: ['weight'] }, reason: 'Test: only weight here', base_updated_at: admin.json().data.updated_at },
    });
    assert.equal(saved.statusCode, 200, saved.body);

    const after = await call('GET', `/catalog/variant-options?category_id=${product.category_id}`, { user: product.supplier_id });
    assert.deepEqual(after.json().data.options, ['weight']);

    const refused = await putVariants(product.supplier_id, [{ attributes: { size: 'M' }, stock_qty: 1 }]);
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().error.message_en, /does not offer "size"/);
    const ok = await putVariants(product.supplier_id, [{ attributes: { weight: '1 kg' }, stock_qty: 1 }]);
    assert.equal(ok.statusCode, 200, ok.body);

    const audit = await q(`SELECT after_json FROM audit_logs WHERE action = 'catalog.variant_options.update' ORDER BY id DESC LIMIT 1`);
    // The audit service keeps the reason beside the value (meta), so compare the setting itself.
    assert.deepEqual(audit[0].after_json.categories, { [product.category_id]: ['weight'] });
    assert.equal(audit[0].after_json.meta?.reason, 'Test: only weight here');
  });

  test('admin page: a customer is refused, a stale save is 409, a short reason is 400', async () => {
    assert.equal((await call('GET', '/admin/catalog/variant-options', { user: customerId })).statusCode, 403);

    const stale = await call('PUT', '/admin/catalog/variant-options', {
      user: superAdminId,
      body: { categories: {}, reason: 'Test: stale version', base_updated_at: '2000-01-01T00:00:00.000Z' },
    });
    assert.equal(stale.statusCode, 409, stale.body);

    const short = await call('PUT', '/admin/catalog/variant-options', { user: superAdminId, body: { categories: {}, reason: 'short' } });
    assert.equal(short.statusCode, 400);
  });
});
