/**
 * attribution.test.js — a sale credits the shop partner whose storefront or link brought the
 * shopper, and only when that touch is fresh, names a partner who sells the product, and the
 * shopper is not that partner (attribution.service.ts).
 *
 * WHY a fake db that matches SQL: the service is raw SQL against four tables, and the rules are
 * decided by what those lookups answer. The fake answers them the way Postgres would.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WINDOW_DAYS, WINDOW_LIMITS, isWithinWindow, landingPathFor, normalizeTouch,
  pickParcelSaler, resolveTouch, resolveWindowDays,
} from '../src/services/attribution.service.ts';
import { addItemToCart } from '../src/services/cart.service.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-17T10:00:00Z');
const SALER = 202;
const PRODUCT = 1;

function fakeDb({ windowDays = 7, carries = true } = {}) {
  return {
    async query(sql, params = []) {
      if (/FROM platform_settings/.test(sql)) return { rows: [{ value_json: { window_days: windowDays } }] };
      if (/FROM virtual_stores/.test(sql)) return { rows: params[0] === 'rina-fashion' ? [{ saler_id: SALER }] : [] };
      if (/FROM short_links/.test(sql)) return { rows: params[0] === 'a1b2c3' ? [{ id: 9, saler_id: SALER }] : [] };
      if (/FROM saler_store_items/.test(sql)) {
        return { rows: carries && params[0] === SALER && params[1] === PRODUCT ? [{ custom_retail_price: '950.00' }] : [] };
      }
      return { rows: [] };
    },
  };
}

const touch = (type, ref, ageDays) => ({ type, ref, at: new Date(NOW.getTime() - ageDays * DAY).toISOString() });

describe('attribution rules', () => {
  test('a storefront visit credits the store owner', async () => {
    const credit = await resolveTouch(fakeDb(), { touch: touch('STORE', 'Rina-Fashion', 1), productId: PRODUCT, buyerId: 9, now: NOW });
    assert.deepEqual(credit, { salerId: SALER, shortLinkId: null, source: 'STOREFRONT' });
  });

  test('a short link click credits the link owner and names the link', async () => {
    const credit = await resolveTouch(fakeDb(), { touch: touch('LINK', 'a1b2c3', 0), productId: PRODUCT, buyerId: null, now: NOW });
    assert.deepEqual(credit, { salerId: SALER, shortLinkId: 9, source: 'SHORT_LINK' });
  });

  test('a touch older than the admin window no longer counts', async () => {
    const db = fakeDb({ windowDays: 3 });
    assert.ok(await resolveTouch(db, { touch: touch('LINK', 'a1b2c3', 2.9), productId: PRODUCT, now: NOW }));
    assert.equal(await resolveTouch(db, { touch: touch('LINK', 'a1b2c3', 3.1), productId: PRODUCT, now: NOW }), null);
  });

  test('the shop partner buying through their own link earns nothing', async () => {
    assert.equal(await resolveTouch(fakeDb(), { touch: touch('LINK', 'a1b2c3', 0), productId: PRODUCT, buyerId: SALER, now: NOW }), null);
  });

  test('a partner who does not sell the product is not credited for it', async () => {
    assert.equal(await resolveTouch(fakeDb({ carries: false }), { touch: touch('STORE', 'rina-fashion', 0), productId: PRODUCT, now: NOW }), null);
  });

  test('unknown stores, unknown links and malformed touches credit nobody', async () => {
    const db = fakeDb();
    assert.equal(await resolveTouch(db, { touch: touch('STORE', 'no-such-store', 0), productId: PRODUCT, now: NOW }), null);
    assert.equal(await resolveTouch(db, { touch: touch('LINK', 'zzzzzz', 0), productId: PRODUCT, now: NOW }), null);
    assert.equal(normalizeTouch({ type: 'USER', ref: '202', at: NOW.toISOString() }), null, 'a raw user id is never a touch');
    assert.equal(normalizeTouch({ type: 'LINK', ref: 'x'.repeat(121), at: NOW.toISOString() }), null);
    assert.equal(normalizeTouch({ type: 'LINK', ref: 'a1b2c3', at: 'yesterday-ish' }), null);
  });

  test('a touch dated in the future does not count', () => {
    assert.equal(isWithinWindow(new Date(NOW.getTime() + DAY), NOW, 7), false);
  });

  test('the window falls back to the seeded default when the setting is missing or out of bounds', () => {
    assert.equal(resolveWindowDays(undefined), DEFAULT_WINDOW_DAYS);
    assert.equal(resolveWindowDays({ window_days: WINDOW_LIMITS.max + 1 }), DEFAULT_WINDOW_DAYS);
    assert.equal(resolveWindowDays({ window_days: 30 }), 30);
    const sql = fs.readFileSync(path.resolve(__dirname, '../src/db/migrations/076_order_attribution.sql'), 'utf8');
    assert.match(sql, new RegExp(`"window_days":\\s*${DEFAULT_WINDOW_DAYS}\\b`), 'code default equals the migration seed');
  });
});

describe('one parcel pays one shop partner', () => {
  test('the partner whose lines are worth most wins a mixed parcel', () => {
    const parcel = pickParcelSaler([
      { salerId: 1, shortLinkId: 4, source: 'SHORT_LINK', lineTotalPaisa: 50000 },
      { salerId: 2, shortLinkId: null, source: 'STOREFRONT', lineTotalPaisa: 30000 },
      { salerId: 2, shortLinkId: null, source: 'STOREFRONT', lineTotalPaisa: 30000 },
    ]);
    assert.deepEqual(parcel, { salerId: 2, shortLinkId: null, source: 'STOREFRONT' });
  });

  test('an unattributed line never wins over an attributed one, and a tie goes to the first line', () => {
    assert.equal(pickParcelSaler([{ salerId: null, lineTotalPaisa: 900000 }, { salerId: 7, lineTotalPaisa: 100 }]).salerId, 7);
    assert.equal(pickParcelSaler([{ salerId: 3, lineTotalPaisa: 100 }, { salerId: 4, lineTotalPaisa: 100 }]).salerId, 3);
    assert.deepEqual(pickParcelSaler([{ salerId: null, lineTotalPaisa: 100 }]), { salerId: null, shortLinkId: null, source: null });
  });
});

describe('short link landing path', () => {
  test('carries the link code and drops the old saler_ref user id', () => {
    assert.equal(landingPathFor('/products/12?saler_ref=202&source=whatsapp', 'a1b2c3'), '/products/12?source=whatsapp&ref=a1b2c3');
    assert.equal(landingPathFor('', 'a1b2c3'), '/?ref=a1b2c3');
  });
});

describe('add-to-cart records the touch on the line', () => {
  function cartDb() {
    const base = fakeDb();
    const writes = [];
    return {
      writes,
      async query(sql, params = []) {
        if (/FROM carts WHERE user_id/.test(sql)) return { rows: [{ id: 1, user_id: 9, status: 'ACTIVE' }] };
        if (/SELECT id, default_retail_price, stock_qty, status FROM products/.test(sql)) {
          return { rows: [{ id: PRODUCT, default_retail_price: '1200.00', stock_qty: 10, status: 'ACTIVE' }] };
        }
        if (/INSERT INTO cart_items/.test(sql)) {
          writes.push({ salerId: params[3], priceAtAdd: params[6], shortLinkId: params[7], source: params[8], sql });
          return { rows: [{}] };
        }
        return base.query(sql, params);
      },
    };
  }

  test('a fresh link touch sets the partner, their price and the link on the cart line', async () => {
    const db = cartDb();
    await addItemToCart(db, { userId: 9, productId: PRODUCT, qty: 1, touch: touch('LINK', 'a1b2c3', 0) }).catch(() => {});
    assert.equal(db.writes[0].salerId, SALER);
    assert.equal(Number(db.writes[0].priceAtAdd), 950);
    assert.equal(db.writes[0].shortLinkId, 9);
    assert.equal(db.writes[0].source, 'SHORT_LINK');
    assert.match(db.writes[0].sql, /saler_id = EXCLUDED\.saler_id/, 'adding again through another partner moves the line to them');
  });

  test('an explicit saler_id is dropped when it is the shopper themself', async () => {
    const db = cartDb();
    await addItemToCart(db, { userId: SALER, productId: PRODUCT, qty: 1, salerId: SALER }).catch(() => {});
    assert.equal(db.writes[0].salerId, null);
    assert.equal(Number(db.writes[0].priceAtAdd), 1200);
  });
});
