/**
 * publicPartnerOrder.test.js — POST /public/orders answers a clear 501, never a 500 crash.
 *
 * WHY: the controller called orderService.createOrder, which order.service.ts has never exported, so
 * every partner order threw a TypeError and the API answered 500 INTERNAL_ERROR. Found when the file
 * moved to TypeScript. Until partner ordering is designed the endpoint refuses with NOT_IMPLEMENTED,
 * after the same scope and payload checks it will keep once ordering works.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPartnerOrder } from '../src/controllers/publicApi.controller.ts';

const writeKey = { ref: 'AK-1', userId: 7, scopes: ['orders.create'] };
const validBody = { customer: { name: 'Rahim', phone: '01700000000' }, items: [{ product_id: 1, qty: 1 }] };

async function rejection(req) {
  try {
    await createPartnerOrder(req, {});
  } catch (err) {
    return err;
  }
  assert.fail('createPartnerOrder resolved; it must refuse');
}

test('a valid partner order is refused with 501 NOT_IMPLEMENTED, not a TypeError', async () => {
  const err = await rejection({ apiKey: writeKey, body: validBody });
  assert.equal(err.code, 'NOT_IMPLEMENTED');
  assert.equal(err.statusCode, 501);
  assert.ok(err.messageBn, 'Bangla message is set');
});

test('scope and payload are still checked before the 501', async () => {
  const noScope = await rejection({ apiKey: { ...writeKey, scopes: ['catalog.products.read'] }, body: validBody });
  assert.equal(noScope.statusCode, 403);
  const noItems = await rejection({ apiKey: writeKey, body: { ...validBody, items: [] } });
  assert.equal(noItems.statusCode, 400);
  const noPhone = await rejection({ apiKey: writeKey, body: { ...validBody, customer: { name: 'Rahim' } } });
  assert.equal(noPhone.statusCode, 400);
});
