/**
 * supplierFlashSale.db.test.js — a supplier's own flash sale against real Postgres (migration 096).
 *
 * The unit tests (supplierFlashSale.test.js) cover the pure rules; this runs the real SQL: the
 * retail-price trigger, the ownership check, the insert with funded_by, the audit row and the stop.
 * Opt-in, skipped without a database:
 *
 *   FLASH_TEST_DATABASE_URL=postgresql://… npm test -w server -- test/supplierFlashSale.db.test.js
 *
 * Safe on a shared dev database: one connection, BEGIN … ROLLBACK, a SAVEPOINT per case.
 */

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import '../src/config/loadEnvFile.ts';
import { createOwnDeal, getOverview, quote, stopOwnDeal } from '../src/services/supplierFlashSale.service.ts';

const DB_URL = process.env.FLASH_TEST_DATABASE_URL;

describe('supplier flash sale — real Postgres', { skip: DB_URL ? false : 'set FLASH_TEST_DATABASE_URL to a migrated + seeded database' }, () => {
  let client;
  const db = { query: (...args) => client.query(...args) };
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  let product; // a live product with stock, no live deal
  let supplier;
  let stranger; // another supplier

  before(async () => {
    const pg = createRequire(import.meta.url)('pg');
    client = new pg.Client({ connectionString: DB_URL, ssl: /sslmode=require/i.test(DB_URL) ? { rejectUnauthorized: false } : false });
    await client.connect();
    await client.query('BEGIN');
    [product] = await q(
      `SELECT p.* FROM products p
        WHERE p.status = 'ACTIVE' AND p.stock_qty >= 5 AND p.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM flash_sales fs WHERE fs.product_id = p.id AND fs.status IN ('ACTIVE','SCHEDULED'))
        ORDER BY p.id LIMIT 1`
    );
    assert.ok(product, 'the database needs a seeded live product with stock');
    supplier = { id: Number(product.supplier_id), role: 'supplier' };
    [stranger] = await q(
      `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE r.key = 'supplier' AND u.id <> $1 LIMIT 1`,
      [supplier.id]
    );
  });

  after(async () => {
    if (!client) return;
    await client.query('ROLLBACK');
    await client.end();
  });

  beforeEach(() => client.query('SAVEPOINT flash_case'));
  afterEach(() => client.query('ROLLBACK TO SAVEPOINT flash_case'));

  const backdate = (days) => q(`UPDATE products SET retail_price_since = now() - ($2 || ' days')::interval WHERE id = $1`, [product.id, String(days)]);
  const hoursFromNow = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const dealPrice = () => (Math.round(Number(product.default_retail_price) * 0.9 * 100) / 100).toFixed(2);
  const body = (over = {}) => ({ product_id: product.id, discount_price: dealPrice(), allocated_qty: 3, per_user_limit: 1, ends_at: hoursFromNow(24), ...over });

  test('a retail change restarts the clock; an unchanged write does not', async () => {
    await backdate(30);
    const [{ retail_price_since: old }] = await q(`SELECT retail_price_since FROM products WHERE id = $1`, [product.id]);
    await q(`UPDATE products SET default_retail_price = default_retail_price, title_en = title_en WHERE id = $1`, [product.id]);
    const [{ retail_price_since: same }] = await q(`SELECT retail_price_since FROM products WHERE id = $1`, [product.id]);
    assert.equal(new Date(same).getTime(), new Date(old).getTime());
    await q(`UPDATE products SET default_retail_price = default_retail_price + 10 WHERE id = $1`, [product.id]);
    const [{ retail_price_since: moved }] = await q(`SELECT retail_price_since FROM products WHERE id = $1`, [product.id]);
    assert.ok(new Date(moved).getTime() > new Date(old).getTime());
  });

  test('a product too new for the rules is refused', async () => {
    await backdate(1);
    await assert.rejects(() => createOwnDeal(db, supplier, body()), (err) => err.details?.reason === 'LISTING_TOO_NEW');
  });

  test('the supplier starts a deal: SUPPLIER-funded, audited, and the quote matches', async () => {
    await backdate(30);
    const { pricing, problem } = await quote(db, supplier, { product_id: product.id, discount_price: dealPrice() });
    assert.equal(problem, null);
    assert.equal(pricing.supplier_funded, Math.round((Number(product.default_retail_price) - Number(dealPrice())) * 100) / 100);

    const { flash_sale: deal } = await createOwnDeal(db, supplier, body());
    assert.equal(deal.funded_by, 'SUPPLIER');
    assert.equal(Number(deal.original_price), Number(product.default_retail_price));
    const [audit] = await q(`SELECT action, actor_id, target_ref FROM audit_logs WHERE action = 'growth.flash_sale.create_own' ORDER BY id DESC LIMIT 1`);
    assert.equal(Number(audit.actor_id), supplier.id);
    assert.equal(audit.target_ref, String(deal.id));

    const overview = await getOverview(db, supplier);
    assert.ok(overview.deals.some((d) => Number(d.id) === Number(deal.id)));
    const row = overview.products.find((p) => Number(p.id) === Number(product.id));
    if (row) assert.equal(row.eligible, false, 'a product with a live deal cannot get a second one');

    const stopped = await stopOwnDeal(db, supplier, deal.id);
    assert.equal(stopped.status, 'CANCELLED');
    await assert.rejects(() => stopOwnDeal(db, supplier, deal.id), { code: 'CONFLICT' });
  });

  test('another supplier cannot discount or stop this product', async () => {
    if (!stranger) return;
    await backdate(30);
    await assert.rejects(() => createOwnDeal(db, { id: Number(stranger.id) }, body()), { code: 'NOT_FOUND' });
    const { flash_sale: deal } = await createOwnDeal(db, supplier, body());
    await assert.rejects(() => stopOwnDeal(db, { id: Number(stranger.id) }, deal.id), { code: 'NOT_FOUND' });
  });
});
