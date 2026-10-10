/**
 * liveInStreamBuy.test.js — the live-stream 1-click order (executeInStreamBuy).
 *
 * Invariants: it cannot oversell (stock is locked and net of open-team reservations), it writes the
 * same orders / sub_orders / order_items shape as checkout, it bills the stream's special price (else
 * the listed price) plus the configured delivery charge, and it refuses undeliverable input.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as liveService from '../src/services/liveStream.service.js';

const PRODUCT = {
  id: 101,
  ref: 'PRD-101',
  title_en: 'Tangail Cotton Saree',
  title_bn: 'টাঙ্গাইল শাড়ি',
  status: 'ACTIVE',
  base_cost: '800.00',
  wholesale_margin: '200.00',
  default_retail_price: '1150.00',
  stock_qty: 10,
  supplier_id: 7,
  category_id: 3,
};

/**
 * Dispatch order matters: the stream-products query and the product-lock query both name `products`,
 * and the sale-stats UPDATE names live_streams, so the most specific matches come first.
 */
function makeDb({ stock = 10, reserved = 0, unitPrice = '1150.00', streamStatus = 'LIVE', inStream = true, product = PRODUCT, existingOrder = null, maxCod = null } = {}) {
  const log = { writes: [], orderParams: null, subOrderParams: null, itemParams: null, stockUpdate: null, began: 0, committed: 0, rolledBack: 0 };
  const db = {
    log,
    async connect() {
      return { query: db.query, release() {} };
    },
    async query(sql, params) {
      if (sql.includes('FROM orders WHERE idempotency_key')) {
        return { rows: existingOrder ? [existingOrder] : [] };
      }
      if (sql.includes('FROM trust_scores')) {
        return { rows: [{ user_id: 100, score: 80, tier: 'TRUSTED' }] };
      }
      if (sql.includes('max_cod_order_value')) {
        return { rows: maxCod ? [{ value_json: { amount: maxCod } }] : [] };
      }
      if (sql.startsWith('BEGIN')) { log.began += 1; return { rows: [] }; }
      if (sql.startsWith('COMMIT')) { log.committed += 1; return { rows: [] }; }
      if (sql.startsWith('ROLLBACK')) { log.rolledBack += 1; return { rows: [] }; }
      if (sql.includes('FROM live_stream_products')) {
        return { rows: inStream ? [{ product_id: 101, special_price: null, unit_price: unitPrice }] : [] };
      }
      if (sql.includes('UPDATE live_streams') && sql.includes('total_sales_count')) {
        return { rows: [{ total_sales_count: 1, total_sales_amount: 1210 }] };
      }
      if (sql.includes('FROM live_streams')) {
        return { rows: [{ id: 50, status: streamStatus, host_id: 10, title: 'Show' }] };
      }
      if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
        return { rows: [{ ...product, stock_qty: stock }] };
      }
      if (sql.includes('FROM products')) {
        return { rows: [{ id: 101, status: product.status, stock_qty: stock }] };
      }
      if (sql.includes('FROM team_purchases')) {
        return { rows: [{ reserved }] };
      }
      if (sql.includes('FROM product_batches')) return { rows: [] };
      if (sql.includes('UPDATE products')) {
        log.writes.push('deduct');
        log.stockUpdate = params;
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO orders')) {
        log.writes.push('order');
        log.orderParams = params;
        return { rows: [{ id: 2001, ref: params[0], total_amount: params[2], live_stream_id: params[22], idempotency_key: params[15], is_otp_verified: params[11] }] };
      }
      if (sql.includes('INSERT INTO sub_orders')) {
        log.writes.push('sub_order');
        log.subOrderParams = params;
        return { rows: [{ id: 3001 }] };
      }
      if (sql.includes('INSERT INTO order_items')) {
        log.writes.push('item');
        log.itemParams = params;
        return { rows: [{ id: 4001 }] };
      }
      return { rows: [] };
    },
  };
  return db;
}

const buyer = { id: 100, full_name: 'Tanvir Ahmed', phone: '01711111111' };
const base = {
  streamId: 50,
  user: buyer,
  productId: 101,
  qty: 1,
  recipientName: 'Tanvir Ahmed',
  recipientPhone: '01711111111',
  division: 'Dhaka',
  district: 'Dhaka',
  addressLine: 'House 12, Road 4, Dhanmondi',
  paymentMethod: 'COD',
  idempotencyKey: 'key-1',
};

describe('executeInStreamBuy', () => {
  test('writes order, sub-order and order item in one transaction and decrements stock', async () => {
    const db = makeDb();
    const res = await liveService.executeInStreamBuy(db, null, base);

    assert.deepEqual(db.log.writes, ['deduct', 'order', 'sub_order', 'item']);
    assert.equal(db.log.began, 1);
    assert.equal(db.log.committed, 1);
    assert.equal(db.log.rolledBack, 0);
    assert.deepEqual(db.log.stockUpdate.slice(0, 2), [1, 101]);
    // items 1150 + default delivery charge 60
    assert.equal(db.log.orderParams[3], 1150);
    assert.equal(db.log.orderParams[4], 60);
    assert.equal(db.log.orderParams[2], 1210);
    assert.equal(res.order.live_stream_id, 50);
    // sub-order: supplier from the product, host as saler, totals consistent
    assert.equal(db.log.subOrderParams[2], 7);
    assert.equal(db.log.subOrderParams[3], 10);
    const [, , , , , , , netRetail, saler, platform] = db.log.subOrderParams;
    assert.equal(Number((Number(saler) + Number(platform)).toFixed(2)), Number(netRetail));
    assert.equal(db.log.subOrderParams[12], 1210);
    // item snapshot
    assert.equal(db.log.itemParams[6], 1);
    assert.equal(db.log.itemParams[9], 1150);
  });

  test('bills the stream price the server resolved, times quantity', async () => {
    const db = makeDb({ unitPrice: '1100.00' });
    await liveService.executeInStreamBuy(db, null, { ...base, qty: 2 });
    assert.equal(db.log.orderParams[3], 2200);
    assert.equal(db.log.orderParams[2], 2260);
    assert.equal(db.log.itemParams[9], 2200);
  });

  test('refuses to oversell: stock below quantity is INSUFFICIENT_STOCK and nothing is written', async () => {
    const db = makeDb({ stock: 1 });
    await assert.rejects(
      liveService.executeInStreamBuy(db, null, { ...base, qty: 2 }),
      (e) => e.code === 'INSUFFICIENT_STOCK'
    );
    assert.deepEqual(db.log.writes, []);
    assert.equal(db.log.rolledBack, 1);
    assert.equal(db.log.committed, 0);
  });

  test('stock held by open team purchases is not for sale', async () => {
    const db = makeDb({ stock: 5, reserved: 4 });
    await assert.rejects(
      liveService.executeInStreamBuy(db, null, { ...base, qty: 2 }),
      (e) => e.code === 'INSUFFICIENT_STOCK' && e.details?.available === 1
    );
    assert.deepEqual(db.log.writes, []);

    const ok = makeDb({ stock: 5, reserved: 4 });
    await liveService.executeInStreamBuy(ok, null, { ...base, qty: 1 });
    assert.deepEqual(ok.log.writes, ['deduct', 'order', 'sub_order', 'item']);
  });

  test('a product that is not on the stream cannot be bought through it', async () => {
    const db = makeDb({ inStream: false });
    await assert.rejects(
      liveService.executeInStreamBuy(db, null, base),
      (e) => e.code === 'PRODUCT_NOT_IN_STREAM'
    );
    assert.equal(db.log.began, 0);
  });

  test('a stream that is not LIVE is closed to orders', async () => {
    const db = makeDb({ streamStatus: 'ENDED' });
    await assert.rejects(
      liveService.executeInStreamBuy(db, null, base),
      (e) => e.code === 'STREAM_NOT_LIVE'
    );
  });

  test('missing recipient details are rejected, never invented', async () => {
    for (const patch of [{ recipientName: '' }, { recipientPhone: undefined }, { recipientPhone: '12345' }, { addressLine: '  ' }, { division: undefined }]) {
      const db = makeDb();
      await assert.rejects(
        liveService.executeInStreamBuy(db, null, { ...base, ...patch }),
        (e) => e.code === 'VALIDATION_FAILED',
        JSON.stringify(patch)
      );
      assert.deepEqual(db.log.writes, []);
    }
  });

  test('quantity must be a positive whole number', async () => {
    for (const qty of [0, -1, 1.5, 'abc']) {
      await assert.rejects(
        liveService.executeInStreamBuy(makeDb(), null, { ...base, qty }),
        (e) => e.code === 'VALIDATION_FAILED'
      );
    }
  });

  test('a price below the wholesale floor is refused instead of billed', async () => {
    const db = makeDb({ unitPrice: '500.00' });
    await assert.rejects(
      liveService.executeInStreamBuy(db, null, base),
      (e) => e.code === 'VALIDATION_FAILED'
    );
    assert.equal(db.log.rolledBack, 1);
    assert.equal(db.log.committed, 0);
  });

  test('an Idempotency-Key is required', async () => {
    const db = makeDb();
    await assert.rejects(
      liveService.executeInStreamBuy(db, null, { ...base, idempotencyKey: undefined }),
      (e) => e.code === 'IDEMPOTENCY_KEY_REQUIRED'
    );
    assert.equal(db.log.began, 0);
  });

  test('a repeated key replays the first order and writes nothing', async () => {
    const db = makeDb({ existingOrder: { id: 2001, ref: 'ORD-OLD', created_at: 'then' } });
    const res = await liveService.executeInStreamBuy(db, null, base);
    assert.equal(res.isReplay, true);
    assert.equal(res.order.ref, 'ORD-OLD');
    assert.deepEqual(db.log.writes, []);
    assert.equal(db.log.began, 0);
  });

  test('the order records the key and the trust score it was placed under', async () => {
    const db = makeDb();
    await liveService.executeInStreamBuy(db, null, base);
    assert.equal(db.log.orderParams[15], 'key-1');
    assert.equal(db.log.orderParams[12], 80);
  });

  test('a COD order above the platform COD limit needs the SMS code first and takes no stock', async () => {
    const db = makeDb({ maxCod: 100 });
    let sent = 0;
    const counters = new Map();
    const cache = {
      async get() { return null; },
      async set() {},
      async del() {},
      async incr(k) { counters.set(k, (counters.get(k) || 0) + 1); return counters.get(k); },
      async expire() {},
      async ttl() { return 1000; },
    };
    await assert.rejects(
      liveService.executeInStreamBuy(db, cache, { ...base, smsSender: async () => { sent += 1; }, isDevelopment: true }),
      (e) => e.code === 'COD_OTP_REQUIRED'
    );
    assert.equal(sent, 1);
    assert.deepEqual(db.log.writes, []);
    assert.equal(db.log.rolledBack, 1);
  });

  test('the COD gate does not apply to a prepaid method', async () => {
    const db = makeDb({ maxCod: 100 });
    await liveService.executeInStreamBuy(db, null, { ...base, paymentMethod: 'BKASH' });
    assert.deepEqual(db.log.writes, ['deduct', 'order', 'sub_order', 'item']);
  });

  test('a racing duplicate key (unique violation) replays the winner instead of failing', async () => {
    const db = makeDb();
    const real = db.query;
    let lookups = 0;
    db.query = async (sql, params) => {
      if (sql.includes('FROM orders WHERE idempotency_key')) {
        lookups += 1;
        // first lookup: nothing yet; after the loss, the winner's order is visible
        return { rows: lookups === 1 ? [] : [{ id: 2001, ref: 'ORD-WIN', created_at: 'then' }] };
      }
      if (sql.includes('INSERT INTO orders')) {
        const err = new Error('duplicate key value violates unique constraint "orders_idempotency_key_key"');
        err.code = '23505';
        err.constraint = 'orders_idempotency_key_key';
        throw err;
      }
      return real(sql, params);
    };
    const res = await liveService.executeInStreamBuy(db, null, base);
    assert.equal(res.isReplay, true);
    assert.equal(res.order.ref, 'ORD-WIN');
    assert.equal(db.log.rolledBack, 1);
  });

  test('other database errors are not swallowed', async () => {
    const db = makeDb();
    const real = db.query;
    db.query = async (sql, params) => {
      if (sql.includes('INSERT INTO orders')) {
        const err = new Error('boom');
        err.code = '23503';
        throw err;
      }
      return real(sql, params);
    };
    await assert.rejects(liveService.executeInStreamBuy(db, null, base), /boom/);
  });
});

describe('assertSpecialPricesAboveFloor', () => {
  const dbWithFloor = (floor) => ({
    async query() {
      return { rows: [{ id: 5, title_en: 'Jamdani', floor_price: floor }] };
    },
  });

  test('refuses a special price below base cost + wholesale margin', async () => {
    await assert.rejects(
      liveService.assertSpecialPricesAboveFloor(dbWithFloor('4800.00'), [{ productId: 5, specialPrice: 3200 }]),
      (e) => e.code === 'VALIDATION_FAILED' && e.details?.floor_price === 4800
    );
  });

  test('accepts a price at or above the floor, and entries without a special price', async () => {
    await liveService.assertSpecialPricesAboveFloor(dbWithFloor('4800.00'), [{ productId: 5, special_price: 4800 }]);
    await liveService.assertSpecialPricesAboveFloor(dbWithFloor('4800.00'), [5, { productId: 5 }]);
  });

  test('an unknown product is refused', async () => {
    const db = { async query() { return { rows: [] }; } };
    await assert.rejects(
      liveService.assertSpecialPricesAboveFloor(db, [{ productId: 9, specialPrice: 100 }]),
      (e) => e.code === 'PRODUCT_NOT_FOUND'
    );
  });
});

describe('quoteInStreamBuy', () => {
  function quoteDb({ stock = 10, reserved = 0, unitPrice = '1150.00', inStream = true, status = 'ACTIVE', variant = null } = {}) {
    return {
      async query(sql) {
        if (sql.includes('FROM live_stream_products')) {
          return { rows: inStream ? [{ product_id: 101, special_price: null, unit_price: unitPrice }] : [] };
        }
        if (sql.includes('FROM live_streams')) return { rows: [{ id: 50, status: 'LIVE', host_id: 10 }] };
        if (sql.includes('FROM product_variants')) return { rows: variant ? [variant] : [] };
        if (sql.includes('FROM products')) return { rows: [{ id: 101, status, stock_qty: stock }] };
        if (sql.includes('FROM team_purchases')) return { rows: [{ reserved }] };
        return { rows: [] };
      },
    };
  }
  const args = { streamId: 50, productId: 101, qty: 2 };

  test('returns the price the order would bill, the delivery charge and the total', async () => {
    const q = await liveService.quoteInStreamBuy(quoteDb(), null, args);
    assert.equal(q.unit_price, 1150);
    assert.equal(q.items_amount, 2300);
    assert.equal(q.shipping_amount, 60);
    assert.equal(q.total_amount, 2360);
    assert.equal(q.in_stock, true);
  });

  test('quote and order agree on the same inputs', async () => {
    const db = makeDb({ unitPrice: '1100.00' });
    const q = await liveService.quoteInStreamBuy(db, null, args);
    await liveService.executeInStreamBuy(db, null, { ...base, qty: 2 });
    assert.equal(q.total_amount, Number(db.log.orderParams[2]));
    assert.equal(q.items_amount, Number(db.log.orderParams[3]));
  });

  test('stock is net of open-team reservations and flags a short quantity', async () => {
    const q = await liveService.quoteInStreamBuy(quoteDb({ stock: 5, reserved: 4 }), null, args);
    assert.equal(q.available_stock, 1);
    assert.equal(q.in_stock, false);
  });

  test('a variant price_delta is added, as at order time', async () => {
    const q = await liveService.quoteInStreamBuy(
      quoteDb({ variant: { price_delta: '50.00', stock_qty: 10, is_active: true } }), null, { ...args, qty: 1, variantId: 9 });
    assert.equal(q.unit_price, 1200);
  });

  test('refuses a product that is not on the stream and a bad quantity', async () => {
    await assert.rejects(liveService.quoteInStreamBuy(quoteDb({ inStream: false }), null, args), (e) => e.code === 'PRODUCT_NOT_IN_STREAM');
    await assert.rejects(liveService.quoteInStreamBuy(quoteDb(), null, { ...args, qty: 0 }), (e) => e.code === 'VALIDATION_FAILED');
  });
});

describe('live commerce error codes map to client errors, not 500', () => {
  test('each code the live service throws has an HTTP status below 500', async () => {
    const { AppError } = await import('../src/plugins/errorHandler.js');
    const expected = {
      STREAM_NOT_FOUND: 404, PRODUCT_NOT_FOUND: 404, PRODUCT_NOT_IN_STREAM: 404,
      STREAM_NOT_LIVE: 409, PRODUCT_UNPRICED: 409, INSUFFICIENT_STOCK: 409,
      IDEMPOTENCY_KEY_REQUIRED: 400, COD_OTP_REQUIRED: 422,
    };
    for (const [code, status] of Object.entries(expected)) {
      assert.equal(new AppError(code, 'x', 'x').statusCode, status, code);
    }
  });

  test('every AppError code thrown in liveStream.service.js is mapped', async () => {
    const { AppError } = await import('../src/plugins/errorHandler.js');
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/services/liveStream.service.js', import.meta.url), 'utf8');
    const codes = [...new Set([...src.matchAll(/new AppError\('([A-Z_]+)'/g)].map((m) => m[1]))];
    const unmapped = codes.filter((c) => new AppError(c, 'x', 'x').statusCode === 500 && c !== 'INTERNAL_ERROR');
    assert.deepEqual(unmapped, []);
  });
});
