/**
 * catalogAvailableStock.test.js — the shopper's product page reads stock net of open-team
 * reservations, while the raw count stays on the row for the admin editor.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProduct } from '../src/services/catalog.api.js';

const base = { id: 1, ref: 'PRD-1', stock_qty: 10, images: [], variants: [] };

test('stock_qty becomes available_qty when the server sent it', () => {
  const p = normalizeProduct({ ...base, available_qty: 4, reserved_qty: 6 });
  assert.equal(p.stock_qty, 4);
  assert.equal(p.reserved_qty, 6);
});

test('available_qty of 0 is honoured, not replaced by the raw count', () => {
  assert.equal(normalizeProduct({ ...base, available_qty: 0 }).stock_qty, 0);
});

test('without available_qty (older API, mock fixtures) the raw count is used', () => {
  assert.equal(normalizeProduct(base).stock_qty, 10);
});

test('each variant uses its own available_qty', () => {
  const p = normalizeProduct({
    ...base,
    available_qty: 2,
    variants: [
      { id: 1, stock_qty: 8, available_qty: 2 },
      { id: 2, stock_qty: 0, available_qty: 0 },
      { id: 3, stock_qty: 5 },
    ],
  });
  assert.deepEqual(p.variants.map((v) => v.stock_qty), [2, 0, 5]);
});
