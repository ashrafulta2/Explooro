/**
 * productDetailAvailableStock.test.js — product detail keeps stock_qty raw (the admin editor writes it
 * back on save) and adds available_qty / reserved_qty for shoppers, variants capped by the product.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getProductDetail } from '../src/services/product.service.js';

function detailDb({ stock, reserved, variants }) {
  return {
    async query(sql) {
      if (sql.includes('FROM team_purchases')) return { rows: [{ reserved }] };
      if (sql.includes('FROM product_variants')) return { rows: variants };
      if (/FROM products\b/.test(sql) && !sql.includes('product_images')) {
        return { rows: [{ id: 7, ref: 'PRD-7', supplier_id: 2, category_id: 1, stock_qty: stock, base_cost: '100', wholesale_margin: '10', default_retail_price: '150', status: 'ACTIVE' }] };
      }
      return { rows: [] };
    },
  };
}

test('stock_qty stays raw; available_qty and reserved_qty are added', async () => {
  const p = await getProductDetail(detailDb({ stock: 10, reserved: 6, variants: [] }), '7');
  assert.equal(p.stock_qty, 10);
  assert.equal(p.reserved_qty, 6);
  assert.equal(p.available_qty, 4);
});

test('available_qty never goes below zero when teams hold more than is on hand', async () => {
  const p = await getProductDetail(detailDb({ stock: 3, reserved: 8, variants: [] }), '7');
  assert.equal(p.available_qty, 0);
});

test('a variant offers the smaller of its own stock and what the product has left', async () => {
  const p = await getProductDetail(detailDb({
    stock: 10,
    reserved: 6,
    variants: [{ id: 1, product_id: 7, stock_qty: 9 }, { id: 2, product_id: 7, stock_qty: 1 }],
  }), '7');
  assert.deepEqual(p.variants.map((v) => v.available_qty), [4, 1]);
  assert.deepEqual(p.variants.map((v) => v.stock_qty), [9, 1]);
});
