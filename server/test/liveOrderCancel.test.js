/**
 * liveOrderCancel.test.js — cancelling a live-stream order takes it back out of the stream's sales.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as orderService from '../src/services/order.service.js';

function makeDb({ liveStreamId }) {
  const log = [];
  const order = {
    id: 9, ref: 'ORD-X', customer_id: 100, total_amount: '1210.00', discount_amount: '0.00',
    coupon_id: null, live_stream_id: liveStreamId, placed_at: new Date().toISOString(),
  };
  const db = {
    log,
    async connect() { return { query: db.query, release() {} }; },
    async query(sql, params) {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return { rows: [] };
      if (sql.includes('FROM orders o') && sql.includes('WHERE o.id')) return { rows: [order] };
      if (sql.includes('FROM sub_orders')) return { rows: [{ id: 5, order_id: 9, status: 'PLACED' }] };
      if (sql.includes('FROM order_items')) return { rows: [{ id: 6, sub_order_id: 5, product_id: 6, qty: 1 }] };
      if (sql.includes('UPDATE live_streams')) { log.push(['reverse', params]); return { rows: [{ total_sales_count: 0, total_sales_amount: 0 }] }; }
      if (sql.includes('UPDATE products')) { log.push(['restock', params]); return { rows: [] }; }
      return { rows: [] };
    },
  };
  return db;
}

const user = { userId: 100, roles: ['customer'], permissions: [] };

describe('cancelOrder and live stream sales', () => {
  test('a live order is taken back out of its stream totals', async () => {
    const db = makeDb({ liveStreamId: 1 });
    await orderService.cancelOrder(db, 9, user);
    const reversed = db.log.find((l) => l[0] === 'reverse');
    assert.ok(reversed, 'stream sales were not reversed');
    assert.deepEqual(reversed[1], [1, 1210]);
  });

  test('an ordinary order does not touch any stream', async () => {
    const db = makeDb({ liveStreamId: null });
    await orderService.cancelOrder(db, 9, user);
    assert.equal(db.log.some((l) => l[0] === 'reverse'), false);
  });
});
