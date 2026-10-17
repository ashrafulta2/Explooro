/**
 * adDestination.test.js — The invariants stated in adDestination.service.ts.
 *
 *   1. A format that needs a product refuses a creative without one.
 *   2. A shop partner's ad for a product in their store lands on /product/:id?store=<slug>.
 *   3. A supplier's ad for their own product lands on the plain /product/:id.
 *   4. Anyone else's product is refused; staff (isPrivileged) skip only that ownership check.
 *   5. With a product attached, the client's destination_url is ignored.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCreativeTarget, productDestination } from '../src/services/adDestination.service.ts';

const PARTNER = 7;
const SUPPLIER = 9;

/** A db whose queries are answered by substring match on the SQL. */
function fakeDb({ product = { id: 42, supplier_id: SUPPLIER, status: 'ACTIVE' }, storeSlug = null } = {}) {
  return {
    async query(sql) {
      if (sql.includes('FROM saler_store_items')) return { rows: storeSlug ? [{ slug: storeSlug }] : [] };
      if (sql.includes('FROM products')) return { rows: product ? [product] : [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

const needsProduct = { requires_product: true };
const noProduct = { requires_product: false };

describe('resolveCreativeTarget', () => {
  test('a format that needs a product refuses a creative without one', async () => {
    await assert.rejects(
      resolveCreativeTarget(fakeDb(), { userId: PARTNER, adProduct: needsProduct, productId: null }),
      { code: 'PRODUCT_REQUIRED' }
    );
  });

  test('a format without a product keeps the given destination, or the home page', async () => {
    const given = await resolveCreativeTarget(fakeDb(), { userId: PARTNER, adProduct: noProduct, destinationUrl: '/store/rina' });
    assert.deepEqual(given, { productId: null, destinationUrl: '/store/rina' });
    const none = await resolveCreativeTarget(fakeDb(), { userId: PARTNER, adProduct: noProduct });
    assert.deepEqual(none, { productId: null, destinationUrl: '/' });
  });

  test("a shop partner's ad carries their store, so the sale credits them", async () => {
    const target = await resolveCreativeTarget(fakeDb({ storeSlug: 'rina-fashion' }), {
      userId: PARTNER, adProduct: needsProduct, productId: 42,
    });
    assert.deepEqual(target, { productId: 42, destinationUrl: '/product/42?store=rina-fashion' });
  });

  test("a supplier's ad lands on the plain product page", async () => {
    const target = await resolveCreativeTarget(fakeDb(), { userId: SUPPLIER, adProduct: needsProduct, productId: 42 });
    assert.deepEqual(target, { productId: 42, destinationUrl: '/product/42' });
  });

  test('a product the advertiser neither sells nor supplies is refused', async () => {
    await assert.rejects(
      resolveCreativeTarget(fakeDb(), { userId: PARTNER, adProduct: needsProduct, productId: 42 }),
      { code: 'AD_PRODUCT_NOT_OWNED' }
    );
  });

  test('staff skip the ownership check only', async () => {
    const target = await resolveCreativeTarget(fakeDb(), {
      userId: 1, adProduct: needsProduct, productId: 42, isPrivileged: true,
    });
    assert.equal(target.destinationUrl, '/product/42');
    await assert.rejects(
      resolveCreativeTarget(fakeDb({ product: { id: 42, supplier_id: SUPPLIER, status: 'DRAFT' } }), {
        userId: 1, adProduct: needsProduct, productId: 42, isPrivileged: true,
      }),
      { code: 'AD_PRODUCT_NOT_SELLABLE' }
    );
  });

  test('a missing product is not found', async () => {
    await assert.rejects(
      resolveCreativeTarget(fakeDb({ product: null }), { userId: SUPPLIER, adProduct: needsProduct, productId: 42 }),
      { code: 'NOT_FOUND' }
    );
  });

  test("with a product attached, the client's destination_url is ignored", async () => {
    const target = await resolveCreativeTarget(fakeDb({ storeSlug: 'rina-fashion' }), {
      userId: PARTNER, adProduct: needsProduct, productId: 42, destinationUrl: '/store/someone-else',
    });
    assert.equal(target.destinationUrl, '/product/42?store=rina-fashion');
  });
});

describe('productDestination', () => {
  test('encodes the slug and drops it when absent', () => {
    assert.equal(productDestination(5), '/product/5');
    assert.equal(productDestination(5, 'a b'), '/product/5?store=a%20b');
  });
});
