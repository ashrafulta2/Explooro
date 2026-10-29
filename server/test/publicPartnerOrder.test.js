/**
 * publicPartnerOrder.test.js — POST /public/orders: a partner places a COD order for a customer.
 *
 * WHY: the controller used to call orderService.createOrder, which never existed, so every partner
 * order crashed; it then answered 501 until the design was decided (2026-10-30, see
 * partnerOrder.service.ts). The checkout itself (locks, stock, split) with passed-in lines is
 * covered in checkout.test.js; this file covers the partner contract around it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPartnerOrder } from '../src/controllers/publicApi.controller.ts';
import {
  parsePartnerOrder,
  scopedIdempotencyKey,
  isSameRequest,
  buildLines,
  toPublicOrder,
  placePartnerOrder,
  IDEMPOTENCY_KEY_MAX,
} from '../src/services/partnerOrder.service.ts';

const writeKey = { ref: 'AK-1', userId: 7, scopes: ['orders.create'] };
const validBody = {
  customer: { name: 'Rahim', phone: '01700000000' },
  shipping_address: { division: 'Dhaka', district: 'Dhaka', address_line: 'House 1, Road 2' },
  items: [{ product_id: 1, quantity: 1 }],
};

function refusal(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return assert.fail('expected a refusal');
}

test('a key without the orders.create scope is refused with 403 before anything else', async () => {
  await assert.rejects(
    createPartnerOrder({ apiKey: { ...writeKey, scopes: ['catalog.products.read'] }, body: validBody, headers: {} }, {}),
    (err) => err.statusCode === 403
  );
});

test('the payload is checked: items, customer, phone, address, quantity', () => {
  const cases = [
    { ...validBody, items: [] },
    { ...validBody, customer: { name: 'Rahim' } },
    { ...validBody, customer: { name: 'Rahim', phone: '12345' } },
    { ...validBody, shipping_address: { division: 'Dhaka' } },
    { ...validBody, items: [{ product_id: 1, quantity: 0 }] },
    { ...validBody, items: [{ product_id: 1, quantity: 1.5 }] },
    { ...validBody, items: [{ product_id: 'x', quantity: 1 }] },
  ];
  for (const body of cases) {
    const err = refusal(() => parsePartnerOrder(body));
    assert.equal(err.statusCode, 400, JSON.stringify(body));
    assert.ok(err.messageBn, 'Bangla message is set');
  }
});

test('only Cash on Delivery is accepted', () => {
  assert.equal(parsePartnerOrder(validBody).paymentMethod, 'COD');
  assert.equal(parsePartnerOrder({ ...validBody, payment_method: 'cod' }).paymentMethod, 'COD');
  const err = refusal(() => parsePartnerOrder({ ...validBody, payment_method: 'BKASH' }));
  assert.equal(err.statusCode, 400);
  assert.equal(err.details.field, 'payment_method');
});

test('the phone is normalised and repeated lines of one product are merged', () => {
  const parsed = parsePartnerOrder({
    ...validBody,
    items: [{ product_id: 1, quantity: 2 }, { product_id: 1, quantity: 3 }, { product_id: 1, variant_id: 4, quantity: 1 }],
  });
  assert.equal(parsed.customer.phone, '+8801700000000');
  assert.deepEqual(parsed.items, [
    { productId: 1, variantId: null, qty: 5 },
    { productId: 1, variantId: 4, qty: 1 },
  ]);
});

test('the Idempotency-Key is required, bounded, and scoped to the API key', () => {
  assert.equal(refusal(() => scopedIdempotencyKey('AK-1', undefined)).code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(refusal(() => scopedIdempotencyKey('AK-1', '  ')).code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(refusal(() => scopedIdempotencyKey('AK-1', 'k'.repeat(IDEMPOTENCY_KEY_MAX + 1))).statusCode, 400);
  assert.equal(scopedIdempotencyKey('AK-1', 'abc'), 'api:AK-1:abc');
  assert.notEqual(scopedIdempotencyKey('AK-1', 'abc'), scopedIdempotencyKey('AK-2', 'abc'), 'two partners never collide');
});

// ── Lines ─────────────────────────────────────────────────────────────────────────────────────

function catalogDb({ carries = true } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes('FROM products p')) {
        const rows = [
          { id: 1, title_en: 'Saree', title_bn: 'শাড়ি', default_retail_price: '700.00', supplier_id: 101, partner_carries: carries },
          { id: 2, title_en: 'Panjabi', title_bn: 'পাঞ্জাবি', default_retail_price: '1200.00', supplier_id: 102, partner_carries: carries },
        ];
        return { rows: rows.filter((r) => params[0].includes(r.id)) };
      }
      if (sql.includes('FROM product_variants')) {
        return { rows: [{ id: 4, product_id: 1, price_delta: '-50.00' }].filter((v) => params[0].includes(v.id)) };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('lines are priced from the product (plus the variant delta), never from the request', async () => {
  const lines = await buildLines(catalogDb(), {
    items: [{ productId: 1, variantId: 4, qty: 2 }, { productId: 2, variantId: null, qty: 1 }],
    partnerId: 7,
    buyerId: 50,
  });
  assert.equal(lines[0].unit_price, 650);
  assert.equal(lines[1].unit_price, 1200);
  assert.equal(lines[1].supplier_id, 102);
});

test('the partner is credited only on products they carry, and never on their own purchase', async () => {
  const items = [{ productId: 1, variantId: null, qty: 1 }];
  const [carried] = await buildLines(catalogDb(), { items, partnerId: 7, buyerId: 50 });
  assert.equal(carried.saler_id, 7);
  assert.equal(carried.attribution_source, 'STOREFRONT');

  const [notCarried] = await buildLines(catalogDb({ carries: false }), { items, partnerId: 7, buyerId: 50 });
  assert.equal(notCarried.saler_id, null);

  const [own] = await buildLines(catalogDb(), { items, partnerId: 7, buyerId: 7 });
  assert.equal(own.saler_id, null, 'the partner ordered for their own phone');
});

test('an unknown product, or a variant of another product, is 404', async () => {
  await assert.rejects(
    buildLines(catalogDb(), { items: [{ productId: 99, variantId: null, qty: 1 }], partnerId: 7, buyerId: 50 }),
    (err) => err.statusCode === 404 && err.details.product_id === 99
  );
  await assert.rejects(
    buildLines(catalogDb(), { items: [{ productId: 2, variantId: 4, qty: 1 }], partnerId: 7, buyerId: 50 }),
    (err) => err.statusCode === 404 && err.details.variant_id === 4
  );
});

// ── Response and replay ───────────────────────────────────────────────────────────────────────

const storedOrder = {
  id: 9, ref: 'ORD-X', customer_id: 50, idempotency_key: 'api:AK-1:abc',
  items_amount: '700.00', shipping_amount: '60.00', discount_amount: '0.00', total_amount: '760.00',
  currency: 'BDT', payment_method: 'COD', payment_status: 'PENDING', is_otp_verified: false,
  recipient_name: 'Rahim', recipient_phone: '+8801700000000', division: 'Dhaka', district: 'Dhaka',
  upazila: null, address_line: 'House 1, Road 2', placed_at: '2026-10-30T00:00:00Z',
  sub_orders: [{
    id: 3, ref: 'ORD-X-1', status: 'PLACED', supplier_name: 'Aarong', shipping_amount: '60.00', total_amount: '760.00',
    subtotal_base: '500.00', net_retail_margin: '200.00', saler_commission: '80.00', platform_margin: '120.00',
    items: [{ product_id: 1, product_ref: 'PRD-1', variant_id: null, qty: 1, title_snapshot: 'Saree', base_price: '500.00', retail_price: '700.00', line_total: '700.00' }],
  }],
};

test('the response carries no supplier cost or margin split', () => {
  const out = toPublicOrder(storedOrder);
  assert.equal(out.total_amount, 760);
  assert.equal(out.sub_orders[0].items[0].unit_price, 700);
  const json = JSON.stringify(out);
  for (const secret of ['base_price', 'subtotal_base', 'net_retail_margin', 'saler_commission', 'platform_margin', 'customer_id']) {
    assert.ok(!json.includes(secret), `${secret} must not leave through the public API`);
  }
});

test('a repeat is the same request only with the same customer and the same lines', () => {
  const same = parsePartnerOrder(validBody);
  assert.equal(isSameRequest(storedOrder, same, 50), true);
  assert.equal(isSameRequest(storedOrder, same, 51), false, 'another customer');
  assert.equal(isSameRequest(storedOrder, parsePartnerOrder({ ...validBody, items: [{ product_id: 1, quantity: 2 }] }), 50), false);
});

/** A pool that knows one customer and one order already placed under the key. */
function replayDb() {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push(sql);
      if (sql.includes('FROM users WHERE phone = $1')) return { rows: params[0] === '+8801700000000' ? [{ id: 50 }] : [] };
      if (sql.includes('FROM orders WHERE idempotency_key = $1')) {
        return { rows: params[0] === storedOrder.idempotency_key ? [storedOrder] : [] };
      }
      if (sql.includes('FROM sub_orders so')) return { rows: [{ ...storedOrder.sub_orders[0], items: undefined }] };
      if (sql.includes('FROM order_items oi')) return { rows: storedOrder.sub_orders[0].items.map((i) => ({ ...i, sub_order_id: 3 })) };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('a retry with the same key and body returns the first order and places nothing', async () => {
  const db = replayDb();
  const result = await placePartnerOrder(db, null, { apiKey: writeKey, body: validBody, idempotencyKey: 'abc' });
  assert.equal(result.isReplay, true);
  assert.equal(result.order.ref, 'ORD-X');
  assert.ok(!db.queries.some((q) => /INSERT INTO orders|FOR UPDATE/.test(q)), 'no checkout ran');
});

test('the same key with a different body is 409 IDEMPOTENCY_MISMATCH', async () => {
  await assert.rejects(
    placePartnerOrder(replayDb(), null, {
      apiKey: writeKey,
      body: { ...validBody, items: [{ product_id: 1, quantity: 3 }] },
      idempotencyKey: 'abc',
    }),
    (err) => err.code === 'IDEMPOTENCY_MISMATCH' && err.statusCode === 409 && err.details.order_ref === 'ORD-X'
  );
});

test('the same string under another API key is a different key, not a replay', async () => {
  // AK-2 has no order under "abc", so the call goes on to build lines (and this fake has no catalog).
  await assert.rejects(
    placePartnerOrder(replayDb(), null, { apiKey: { ...writeKey, ref: 'AK-2' }, body: validBody, idempotencyKey: 'abc' }),
    /unexpected query: .*FROM products p/s
  );
});
