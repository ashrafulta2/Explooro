/**
 * productVariant.test.js — the supplier's variant list (services/productVariant.service.ts).
 *
 * Invariants: a variant is its size + colour, so saving one twice updates instead of duplicating;
 * a combination left out is switched off, never deleted; no variant sells below the product price.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comboKey,
  defaultSku,
  normalizeVariantInput,
  planVariantChanges,
} from '../src/services/productVariant.service.ts';

describe('normalizeVariantInput', () => {
  test('trims values and drops empty dimensions', () => {
    const [v] = normalizeVariantInput([{ attributes: { size: ' M ', color: '' }, stock_qty: 4, price_delta: '50' }]);
    assert.deepEqual(v.attributes, { size: 'M' });
    assert.equal(v.stock_qty, 4);
    assert.equal(v.price_delta, 50);
    assert.equal(v.sku, null);
  });

  test('refuses a row with neither size nor colour', () => {
    assert.throws(() => normalizeVariantInput([{ attributes: {}, stock_qty: 1 }]), /size or a colour/);
  });

  test('refuses the same combination twice, ignoring case', () => {
    assert.throws(
      () => normalizeVariantInput([{ attributes: { size: 'M', color: 'Red' } }, { attributes: { size: 'm', color: 'red' } }]),
      /already in the list/
    );
  });

  test('refuses rows that fill different fields (size only next to size + colour)', () => {
    assert.throws(
      () => normalizeVariantInput([{ attributes: { size: 'M' } }, { attributes: { size: 'XXL', color: 'Red' } }]),
      /same fields/
    );
  });

  test('refuses a negative extra price', () => {
    assert.throws(() => normalizeVariantInput([{ attributes: { size: 'M' }, price_delta: -10 }]), /0 or more/);
  });

  test('refuses fractional or negative stock', () => {
    assert.throws(() => normalizeVariantInput([{ attributes: { size: 'M' }, stock_qty: 1.5 }]), /whole number/);
    assert.throws(() => normalizeVariantInput([{ attributes: { size: 'M' }, stock_qty: -1 }]), /whole number/);
  });

  test('refuses a malformed or repeated SKU', () => {
    assert.throws(() => normalizeVariantInput([{ attributes: { size: 'M' }, sku: 'has space' }]), /SKU/);
    assert.throws(
      () => normalizeVariantInput([{ attributes: { size: 'M' }, sku: 'A-1' }, { attributes: { size: 'L' }, sku: 'a-1' }]),
      /used twice/
    );
  });

  test('refuses something that is not a list', () => {
    assert.throws(() => normalizeVariantInput({ size: 'M' }), /list/);
  });

  test('an empty list is allowed (it removes every variant)', () => {
    assert.deepEqual(normalizeVariantInput([]), []);
  });
});

describe('planVariantChanges', () => {
  const existing = [
    { id: 1, attributes_json: { size: 'M', color: 'Red' }, is_active: true },
    { id: 2, attributes_json: { size: 'L', color: 'Red' }, is_active: true },
    { id: 3, attributes_json: { size: 'XL', color: 'Red' }, is_active: false },
  ];

  test('matches by combination, inserts new ones, switches off the rest', () => {
    const wanted = normalizeVariantInput([
      { attributes: { size: 'm', color: 'red' }, stock_qty: 5 },
      { attributes: { size: 'XL', color: 'Red' }, stock_qty: 2 },
      { attributes: { size: 'S', color: 'Red' }, stock_qty: 1 },
    ]);
    const plan = planVariantChanges(existing, wanted);
    assert.deepEqual(plan.updates.map((u) => u.id), [1, 3]); // 3 comes back on instead of a duplicate
    assert.deepEqual(plan.inserts.map((i) => i.attributes.size), ['S']);
    assert.deepEqual(plan.deactivate, [2]);
  });

  test('saving the same list twice changes nothing the second time', () => {
    const wanted = normalizeVariantInput([{ attributes: { size: 'M', color: 'Red' }, stock_qty: 5 }]);
    const first = planVariantChanges(existing, wanted);
    const afterFirst = existing.map((r) => ({ ...r, is_active: first.updates.some((u) => u.id === r.id) }));
    const second = planVariantChanges(afterFirst, wanted);
    assert.equal(second.inserts.length, 0);
    assert.deepEqual(second.deactivate, []);
  });
});

describe('defaultSku', () => {
  test('reads as the product ref plus the combination', () => {
    assert.equal(defaultSku('PRD-8F2K', { size: 'M', color: 'Navy Blue' }), 'PRD-8F2K-M-NAVY-BLUE');
  });

  test('two Bangla colours do not get the same SKU', () => {
    const a = defaultSku('PRD-8F2K', { size: 'M', color: 'লাল' });
    const b = defaultSku('PRD-8F2K', { size: 'M', color: 'নীল' });
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9][A-Za-z0-9_-]*$/);
  });

  test('comboKey ignores case and surrounding spaces', () => {
    assert.equal(comboKey({ size: ' M', color: 'RED' }), comboKey({ size: 'm', color: 'red ' }));
  });
});
