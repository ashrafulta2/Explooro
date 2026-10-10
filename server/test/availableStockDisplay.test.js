/**
 * availableStockDisplay.test.js — what a shopper is shown as "in stock" subtracts the units open
 * team purchases are counting on, in search (and so the concierge) and on the public storefront.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { withAvailableStock, reservedUnitsSql } from '../src/services/teamStockReservation.service.js';
import { executeSearch } from '../src/services/search.service.js';
import { getPublicStore } from '../src/services/store.service.js';

// Reservation query: product 1 has 3 units held by open teams, product 2 none.
function reservationDb(extra = async () => null) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push(sql);
      const handled = await extra(sql, params);
      if (handled) return handled;
      if (sql.includes('FROM team_purchases')) return { rows: [{ product_id: 1, reserved: 3 }] };
      return { rows: [] };
    },
  };
}

describe('withAvailableStock', () => {
  test('subtracts reserved units, keeps the raw figure, and never goes below zero', async () => {
    const out = await withAvailableStock(reservationDb(), [
      { id: 1, stock_qty: 10 },
      { id: 2, stock_qty: 4 },
    ]);
    assert.deepEqual(out.map((r) => r.stock_qty), [7, 4]);
    assert.equal(out[0].stock_on_hand, 10);
    assert.equal(out[0].reserved_qty, 3);
    assert.equal(out[1].reserved_qty, 0);

    const over = await withAvailableStock(reservationDb(), [{ id: 1, stock_qty: 2 }]);
    assert.equal(over[0].stock_qty, 0);
  });

  test('rows without a stock figure or id pass through, and no query runs for an empty list', async () => {
    const db = reservationDb();
    assert.deepEqual(await withAvailableStock(db, []), []);
    assert.equal(db.calls.length, 0);
    const rows = [{ id: 1 }, { stock_qty: 5 }];
    assert.deepEqual(await withAvailableStock(db, rows), rows);
  });

  test('idKey selects the product id column', async () => {
    const out = await withAvailableStock(reservationDb(), [{ product_id: 1, stock_qty: 5 }], { idKey: 'product_id' });
    assert.equal(out[0].stock_qty, 2);
  });

  test('the SQL fragment counts only ACTIVE, unexpired teams for the given alias', () => {
    const sql = reservedUnitsSql('prod');
    assert.match(sql, /tp\.product_id = prod\.id/);
    assert.match(sql, /status = 'ACTIVE'/);
    assert.match(sql, /expires_at > now\(\)/);
  });
});

describe('search', () => {
  test('results carry the reservation-adjusted stock, and "in stock only" subtracts it in SQL', async () => {
    const db = reservationDb(async (sql) => {
      if (sql.includes('FROM products p')) return { rows: [{ id: 1, stock_qty: 5, base_cost: 10, wholesale_margin: 0, default_retail_price: 20 }] };
      return null;
    });
    const res = await executeSearch(db, null, { query: 'x', filters: { inStock: true } });
    assert.equal(res.products[0].stock_qty, 2);
    const productSql = db.calls.find((s) => s.includes('FROM products p'));
    assert.match(productSql, /p\.stock_qty - COALESCE\(\(SELECT SUM\(tp\.required_members\)/);
  });
});

describe('public storefront', () => {
  test('an item whose last units are reserved shows 0 available', async () => {
    const db = reservationDb(async (sql) => {
      if (sql.includes('FROM virtual_stores')) {
        return { rows: [{ id: 9, slug: 's', shop_name: 'S', is_active: true, has_physical_shop: false, business_hours_json: null }] };
      }
      if (sql.includes('store_items')) {
        return { rows: [{ item_id: 1, product_id: 1, product_ref: 'P1', product_slug: 'p1', title_en: 'T', default_retail_price: '20', stock_qty: 3, collection_name: null }] };
      }
      return null;
    });
    let store;
    try {
      store = await getPublicStore(db, 's');
    } catch (err) {
      // The mock only needs to prove the reservation is applied; if the storefront needs more rows
      // than this stub supplies, say so rather than silently passing.
      assert.fail(`storefront stub incomplete: ${err.message}`);
    }
    const item = store.shelves.flatMap((sh) => sh.items)[0];
    assert.equal(item.stock_qty, 0);
  });
});

describe('catalog listing', () => {
  const row = { id: 1, stock_qty: 10, base_cost: 100, wholesale_margin: 0, default_retail_price: 200, variants: [{ id: 7, stock_qty: 9 }, { id: 8, stock_qty: 2 }] };
  const makeDb = () =>
    reservationDb(async (sql) => {
      if (sql.includes('FROM products p') && !sql.startsWith('SELECT product_id')) return { rows: [{ ...row }] };
      return null;
    });

  test('netStock subtracts reservations and caps variants; without it the count stays raw', async () => {
    const { listCatalog } = await import('../src/services/product.service.js');
    const net = (await listCatalog(makeDb(), { netStock: true }))[0];
    assert.equal(net.stock_qty, 7);
    assert.equal(net.stock_on_hand, 10);
    assert.deepEqual(net.variants.map((v) => v.stock_qty), [7, 2]);

    const raw = (await listCatalog(makeDb(), {}))[0];
    assert.equal(raw.stock_qty, 10);
    assert.equal(raw.reserved_qty, undefined);
  });

  test('the "in stock" filter subtracts reservations in SQL', async () => {
    const db = makeDb();
    const { listCatalog } = await import('../src/services/product.service.js');
    await listCatalog(db, { inStock: true });
    assert.match(db.calls.find((s) => s.includes('FROM products p')), /p\.stock_qty - COALESCE/);
  });
});

describe('sourcing catalog', () => {
  test('stock_available is net of open-team reservations', async () => {
    const { listSourcingCatalog } = await import('../src/services/product.service.js');
    const db = reservationDb(async (sql) => {
      if (sql.includes('FROM products p') && !sql.startsWith('SELECT product_id')) {
        return { rows: [{ id: 1, stock_qty: 10, base_cost: 100, wholesale_margin: 0, default_retail_price: 200 }] };
      }
      return null;
    });
    const items = await listSourcingCatalog(db, {});
    assert.equal(items[0].sourcing_opportunity.stock_available, 7);
  });
});

describe('saler management views', () => {
  test('getSalerStoreItems shows stock net of reservations', async () => {
    const { getSalerStoreItems } = await import('../src/services/product.service.js');
    const db = reservationDb(async (sql) => {
      if (sql.includes('FROM virtual_stores')) return { rows: [{ id: 9 }] };
      if (sql.includes('store_items')) {
        return { rows: [{ item_id: 1, product_id: 1, category_id: 1, base_cost: 100, wholesale_margin: 0, default_retail_price: 200, stock_qty: 10 }] };
      }
      return null;
    });
    const items = await getSalerStoreItems(db, 5);
    assert.equal(items[0].stock_qty, 7);
  });
});
