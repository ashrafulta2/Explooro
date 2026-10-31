/**
 * cartSalerPrice.test.js — a shop partner's own price (saler_store_items.custom_retail_price) must be the
 * price the shopper is charged in the cart, not the supplier's default_retail_price.
 *
 * WHY a fake db that reads the SQL: cart.repository.ts is raw SQL, so the price a cart line carries is
 * decided by which tables the query joins. The fake answers `getCartItemsWithDetails` the way
 * Postgres would for the SQL it was given: custom price only if the query actually joins
 * saler_store_items on the line's shop partner. Before the fix the query never mentions that table, so the
 * line is priced at the supplier default and these tests fail.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addItemToCart, getCart } from '../src/services/cart.service.ts';

const PRODUCT = {
  id: 1,
  ref: 'PRD-TEST-001',
  supplier_id: 101,
  base_cost: '500.00',
  wholesale_margin: '100.00',
  default_retail_price: '1200.00',
  stock_qty: 50,
  status: 'ACTIVE',
};
const SALER_ID = 202;
const CUSTOM_PRICE = 1000;

function createFakeDb({ customPrice = CUSTOM_PRICE } = {}) {
  const cart = { id: 1, user_id: 9, guest_token: null, status: 'ACTIVE', last_activity_at: new Date() };
  const items = [];
  const writes = [];

  return {
    items,
    writes,
    async query(sql, params = []) {
      if (/FROM carts WHERE user_id/.test(sql)) return { rows: [cart] };
      if (/SELECT id, default_retail_price, stock_qty, status FROM products/.test(sql)) {
        return { rows: [PRODUCT] };
      }
      if (/INSERT INTO cart_items/.test(sql)) {
        const [, productId, variantId, salerId, bundleId, qty, priceAtAdd] = params;
        const row = {
          id: items.length + 1, cart_id: 1, product_id: productId, variant_id: variantId,
          saler_id: salerId, bundle_id: bundleId, qty, price_at_add: priceAtAdd, added_at: new Date(),
        };
        items.push(row);
        writes.push(row);
        return { rows: [row] };
      }
      if (/FROM cart_items ci/.test(sql)) {
        const joinsStoreItems = /saler_store_items/.test(sql);
        return {
          rows: items.map((ci) => ({
            ...ci,
            product_ref: PRODUCT.ref,
            product_title_en: 'Cotton Panjabi',
            product_title_bn: 'সুতি পাঞ্জাবি',
            product_slug: 'cotton-panjabi',
            product_status: 'ACTIVE',
            current_product_retail_price:
              joinsStoreItems && ci.saler_id === SALER_ID ? String(customPrice) : PRODUCT.default_retail_price,
            current_product_base_price: PRODUCT.base_cost,
            current_product_stock_qty: PRODUCT.stock_qty,
            supplier_id: PRODUCT.supplier_id,
            supplier_name: 'Supplier',
            supplier_phone: null,
            variant_attributes: null,
            variant_sku: null,
            variant_price_override: null,
            variant_stock_qty: null,
            variant_is_active: null,
            primary_image_url: null,
          })),
        };
      }
      return { rows: [] };
    },
  };
}

describe('cart prices a saler-sourced line at the shop partner custom price', () => {
  test('addItemToCart records the shop partner price as price_at_add', async () => {
    const db = createFakeDb();
    // addItemToCart looks the shop partner's store item up directly; answer it as Postgres would.
    const realQuery = db.query.bind(db);
    db.query = async (sql, params) => {
      if (/FROM saler_store_items/.test(sql) && !/FROM cart_items/.test(sql)) {
        return params[0] === SALER_ID && params[1] === PRODUCT.id
          ? { rows: [{ custom_retail_price: String(CUSTOM_PRICE) }] }
          : { rows: [] };
      }
      return realQuery(sql, params);
    };

    await addItemToCart(db, { userId: 9, productId: 1, salerId: SALER_ID, qty: 1 });

    assert.equal(Number(db.writes[0].price_at_add), CUSTOM_PRICE);
  });

  test('getCart charges the shop partner custom price, not the supplier default', async () => {
    const db = createFakeDb();
    db.items.push({
      id: 1, cart_id: 1, product_id: 1, variant_id: null, saler_id: SALER_ID, bundle_id: null,
      qty: 2, price_at_add: String(CUSTOM_PRICE), added_at: new Date(),
    });

    const cart = await getCart(db, { userId: 9 });

    assert.equal(cart.items[0].unit_price, '1000.00');
    assert.equal(cart.subtotal, '2000.00');
    assert.equal(cart.items[0].warnings.some((w) => w.code === 'PRICE_CHANGED'), false);
  });

  test('a line with no shop partner still uses the supplier default price', async () => {
    const db = createFakeDb();
    db.items.push({
      id: 1, cart_id: 1, product_id: 1, variant_id: null, saler_id: null, bundle_id: null,
      qty: 1, price_at_add: PRODUCT.default_retail_price, added_at: new Date(),
    });

    const cart = await getCart(db, { userId: 9 });

    assert.equal(cart.items[0].unit_price, '1200.00');
  });
});

describe('cart estimates delivery for the shopper\'s area, not always the default zone', () => {
  const ZONES = {
    default_zone: 'outside_dhaka',
    zones: [
      { key: 'inside_dhaka', name_en: 'Inside Dhaka', name_bn: 'ঢাকার ভিতরে', charge: 60, team_charge: 60, days_min: 1, days_max: 2, districts: ['dhaka_city'] },
      { key: 'outside_dhaka', name_en: 'Outside Dhaka', name_bn: 'ঢাকার বাইরে', charge: 120, team_charge: 120, days_min: 3, days_max: 5, districts: [] },
    ],
  };

  /** A cart of one no-saler line, with a delivery.zones policy and an optional default address. */
  function estimateDb({ defaultDistrict = null } = {}) {
    const db = createFakeDb();
    const line = { id: 1, cart_id: 1, product_id: 1, variant_id: null, saler_id: null, bundle_id: null,
      qty: 1, price_at_add: PRODUCT.default_retail_price, added_at: new Date() };
    db.items.push(line);
    const base = db.query.bind(db);
    db.query = async (sql, params = []) => {
      if (sql.includes('FROM platform_settings') && params[0] === 'delivery.zones') {
        return { rows: [{ key: 'delivery.zones', value_json: ZONES }] };
      }
      if (sql.includes('FROM user_addresses')) {
        return { rows: defaultDistrict ? [{ district: defaultDistrict, is_default: true }] : [] };
      }
      return base(sql, params);
    };
    return db;
  }

  test('an explicit district prices the estimate for that zone', async () => {
    assert.equal((await getCart(estimateDb(), { userId: 9, district: 'dhaka_city' })).estimated_shipping, '60.00');
    assert.equal((await getCart(estimateDb(), { userId: 9, district: 'sylhet_city' })).estimated_shipping, '120.00');
  });

  test('with no district it falls back to the default saved address, then the default zone', async () => {
    const fromAddress = await getCart(estimateDb({ defaultDistrict: 'dhaka_city' }), { userId: 9 });
    assert.equal(fromAddress.estimated_shipping, '60.00');
    assert.equal(fromAddress.estimated_shipping_district, 'dhaka_city');

    const noAddress = await getCart(estimateDb(), { userId: 9 });
    assert.equal(noAddress.estimated_shipping, '120.00', 'the default zone');
    assert.equal(noAddress.estimated_shipping_zone, 'outside_dhaka');
  });
});
