/**
 * teamStockReservation.test.js — units that open team purchases are counting on are not for sale elsewhere.
 *
 * Invariants:
 *  1. The reservation is derived from ACTIVE, unexpired teams only (nothing to release or drift).
 *  2. A new team cannot start on units another open team already holds.
 *  3. The quote reports "in stock" net of those units.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as reservation from '../src/services/teamStockReservation.service.js';
import * as teamPurchaseService from '../src/services/teamPurchase.service.js';

const mockCache = { get: async () => null, set: async () => {} };
const RECIPIENT = { recipientName: 'Karim Uddin', addressLine: 'House 45, Road 7, Dhanmondi, Dhaka' };

function makeDb({ stock, reserved }) {
  const db = {
    calls: [],
    query: async (sql, params = []) => {
      db.calls.push({ sql, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('FROM platform_modules')) {
        return { rows: [{ key: 'group_buying', is_enabled: true, default_enabled: true, settings_json: {} }] };
      }
      if (sql.includes('FROM team_purchases') && sql.includes('SUM(required_members)')) return { rows: [{ reserved }] };
      if (sql.includes('FROM products')) {
        return { rows: [{ id: 501, default_retail_price: '2000.00', base_cost: '1200.00', wholesale_margin: '100.00', status: 'ACTIVE', stock_qty: stock }] };
      }
      if (sql.includes('INSERT INTO team_purchases')) {
        return { rows: [{ id: 1, ref: params[0], product_id: params[1], required_members: params[3], group_price: params[4], shipping_charge: params[6], status: 'ACTIVE' }] };
      }
      if (sql.includes('INSERT INTO team_purchase_members')) return { rows: [{ id: 10, payment_hold_status: 'HELD' }] };
      return { rows: [] };
    },
    connect: async () => ({ query: db.query, release: () => {} }),
  };
  return db;
}

describe('team stock reservation', () => {
  test('counts only ACTIVE, unexpired teams and can ignore one team', async () => {
    const db = makeDb({ stock: 10, reserved: 5 });
    assert.equal(await reservation.getReservedForProduct(db, 501, { excludeTeamId: 9 }), 5);
    const sql = db.calls.at(-1).sql;
    assert.match(sql, /status = 'ACTIVE'/);
    assert.match(sql, /expires_at > now\(\)/);
    assert.deepEqual(db.calls.at(-1).params, [501, 9]);
  });

  test('the batch form returns a zero for products with no open team', async () => {
    const db = { query: async () => ({ rows: [{ product_id: '7', reserved: 3 }] }) };
    const map = await reservation.getReservedByProduct(db, [7, 8, '7']);
    assert.equal(map.get(7), 3);
    assert.equal(map.get(8), 0);
    assert.equal((await reservation.getReservedByProduct(db, [])).size, 0);
  });

  test('a team cannot start on units another open team already holds', async () => {
    // 6 in stock, 5 held by open teams: only 1 free, a team needs 2
    const db = makeDb({ stock: 6, reserved: 5 });
    await assert.rejects(
      teamPurchaseService.createTeamPurchase(db, mockCache, { userId: 10, productId: 501, requiredMembers: 2, ...RECIPIENT, paymentMethod: 'COD' }),
      (err) => err.code === 'INSUFFICIENT_STOCK'
    );
    assert.ok(!db.calls.some((c) => c.sql.includes('INSERT INTO team_purchases')));
  });

  test('a team can start when the free units cover it', async () => {
    const db = makeDb({ stock: 8, reserved: 5 });
    const out = await teamPurchaseService.createTeamPurchase(db, mockCache, { userId: 10, productId: 501, requiredMembers: 3, ...RECIPIENT, paymentMethod: 'COD' });
    assert.equal(out.team.required_members, 3);
  });

  test('the quote says out of stock when open teams hold everything', async () => {
    const held = await teamPurchaseService.getQuote(makeDb({ stock: 6, reserved: 5 }), { productId: 501 });
    assert.equal(held.in_stock, false);
    const free = await teamPurchaseService.getQuote(makeDb({ stock: 6, reserved: 0 }), { productId: 501 });
    assert.equal(free.in_stock, true);
  });
});
