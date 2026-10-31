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
