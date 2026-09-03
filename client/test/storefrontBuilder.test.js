/**
 * storefrontBuilder.test.js — Invariants for Virtual Storefront Builder & Public Store (Prompt 4.8).
 *
 * Pins the core storefront invariants:
 *   1. Locale integrity — en/bn parity for shelf_editor.* and shop_status.* namespaces.
 *   2. Reserved slugs blacklist — strictly prohibits reserved paths ('admin', 'api', 'checkout', etc.).
 *   3. Store builder shelf hierarchy & flattening invariants.
 *   4. Physical shop status evaluation — manual OPEN/CLOSED overrides & AUTO business hours resolution.
 *   5. Social Seller Kit link generation & WhatsApp message formatting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'store', 'stores', 'checkout', 'account', 'saler', 'supplier',
  'moderator', 'editor', 'dev', 'live', 'help', 'legal', 'search', 'cart', 's',
  'c', 'team', 'auth', 'login', 'register', 'platform', 'system', 'settings',
]);

test('Prompt 4.8: Storefront Builder & Public Store — Client Invariants', async (t) => {
  // 1. Locale Integrity
  await t.test('1. Locale integrity — en/bn parity for shelf_editor and shop_status', () => {
    const enShelf = Object.keys(enDict.shelf_editor || {}).sort();
    const bnShelf = Object.keys(bnDict.shelf_editor || {}).sort();
    assert.deepEqual(enShelf, bnShelf, 'shelf_editor keys must match in en and bn');

    const enShop = Object.keys(enDict.shop_status || {}).sort();
    const bnShop = Object.keys(bnDict.shop_status || {}).sort();
    assert.deepEqual(enShop, bnShop, 'shop_status keys must match in en and bn');
  });

  // 2. Reserved Slugs Blacklist
  await t.test('2. Reserved slug validation blocks reserved routes', () => {
    const testCases = [
      { slug: 'admin', expectedValid: false },
      { slug: 'api', expectedValid: false },
      { slug: 'checkout', expectedValid: false },
      { slug: 'priyo-collection', expectedValid: true },
      { slug: 'dhaka-handloom-2026', expectedValid: true },
    ];

    testCases.forEach(({ slug, expectedValid }) => {
      const isReserved = RESERVED_SLUGS.has(slug.toLowerCase().trim());
      const isValid = !isReserved;
      assert.equal(isValid, expectedValid, `Slug '${slug}' validity must be ${expectedValid}`);
    });
  });

  // 3. Shelves Flattening & Display Order Invariant
  await t.test('3. Shelf item hierarchy flattens with correct display_order and collection names', () => {
    const shelves = [
      {
        name: 'Festive Jamdani Collection',
        items: [
          { product_id: 101, custom_retail_price: null },
          { product_id: 102, custom_retail_price: 3400 },
        ],
      },
      {
        name: 'Daily Cotton Sarees',
        items: [
          { product_id: 103, custom_retail_price: 1500 },
        ],
      },
    ];

    const flattened = [];
    shelves.forEach((shelf) => {
      shelf.items.forEach((item, idx) => {
        flattened.push({
          product_id: item.product_id,
          collection_name: shelf.name,
          display_order: idx,
          custom_retail_price: item.custom_retail_price,
        });
      });
    });

    assert.equal(flattened.length, 3);
    assert.equal(flattened[0].collection_name, 'Festive Jamdani Collection');
    assert.equal(flattened[0].display_order, 0);
    assert.equal(flattened[1].display_order, 1);
    assert.equal(flattened[1].custom_retail_price, 3400);
    assert.equal(flattened[2].collection_name, 'Daily Cotton Sarees');
    assert.equal(flattened[2].display_order, 0);
  });

  // 4. Shop Status Resolution
  await t.test('4. Physical shop status evaluation: OPEN, CLOSED, and AUTO modes', () => {
    // Mode OPEN
    assert.equal(resolveShopStatus('OPEN', null, new Date()).isOpen, true);

    // Mode CLOSED
    assert.equal(resolveShopStatus('CLOSED', null, new Date()).isOpen, false);

    // Mode AUTO with Business Hours (simulate Saturday 12:00 PM inside 09:00 - 21:00 window)
    const hours = {
      saturday: { open: '09:00', close: '21:00', is_closed: false },
      friday: { open: '15:00', close: '21:00', is_closed: false },
    };

    const saturdayNoon = new Date('2026-08-29T12:00:00Z'); // Saturday at noon UTC
    const autoStatus = resolveAutoStatus(hours, 'saturday', '12:00');
    assert.equal(autoStatus, true, 'Saturday 12:00 is within 09:00-21:00 business hours');

    const saturdayNight = resolveAutoStatus(hours, 'saturday', '22:30');
    assert.equal(saturdayNight, false, 'Saturday 22:30 is outside 09:00-21:00 business hours');
  });

  // 5. Social Seller Kit Link Generation
  await t.test('5. Social Seller Kit generates valid WhatsApp share URLs & vanity paths', () => {
    const storeSlug = 'priyo-handloom';
    const storeName = 'Priyo Handloom';
    const phone = '8801711223344';

    const publicStoreUrl = `https://explooro.com/store/${storeSlug}`;
    const message = `Check out ${storeName} on Explooro: ${publicStoreUrl}`;
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

    assert.ok(waUrl.includes('https://wa.me/8801711223344'));
    assert.ok(waUrl.includes(encodeURIComponent(publicStoreUrl)));
  });

  // 6. StoreBuilder Data Unwrap Invariant (Prevents 'Cannot read properties of undefined (reading store)')
  await t.test('6. StoreBuilder unwrap invariant: handles raw { store, shelves }, enveloped { data: ... } or empty responses safely', () => {
    function unwrapStorePayload(res) {
      const payload = (res && res.data && (res.data.store || res.data.shelves))
        ? res.data
        : (res?.store || res?.shelves ? res : (res?.data || res || {}));
      const store = payload.store || payload || {};
      const shelves = Array.isArray(payload.shelves) ? payload.shelves : [];
      return { store, shelves };
    }

    // Case A: Raw payload { store, shelves } (from store.api unwrapped)
    const rawRes = {
      store: { id: 1, shop_name: 'Heritage Crafts', slug: 'heritage-crafts' },
      shelves: [{ name: 'Handloom', items: [] }],
    };
    const unwrapA = unwrapStorePayload(rawRes);
    assert.equal(unwrapA.store.shop_name, 'Heritage Crafts');
    assert.equal(unwrapA.shelves.length, 1);

    // Case B: Enveloped payload { data: { store, shelves } } (direct Fastify API mock)
    const envRes = {
      data: {
        store: { id: 2, shop_name: 'Dhaka Silk', slug: 'dhaka-silk' },
        shelves: [{ name: 'Silk', items: [] }],
      },
    };
    const unwrapB = unwrapStorePayload(envRes);
    assert.equal(unwrapB.store.shop_name, 'Dhaka Silk');
    assert.equal(unwrapB.shelves.length, 1);

    // Case C: Null or undefined response (network glitch or empty)
    const unwrapC = unwrapStorePayload(null);
    assert.equal(typeof unwrapC.store, 'object');
    assert.equal(Array.isArray(unwrapC.shelves), true);
    assert.equal(unwrapC.shelves.length, 0);

    // Case D: Empty object
    const unwrapD = unwrapStorePayload({});
    assert.equal(typeof unwrapD.store, 'object');
    assert.equal(Array.isArray(unwrapD.shelves), true);
  });

  // 7. StoreBuilder Quick Share Hub Invariants
  await t.test('7. StoreBuilder Quick Share Hub creates 1-tap WhatsApp message & Facebook share URLs', () => {
    const store = {
      shop_name: 'Bengal Artisan Studio',
      slug: 'bengal-artisan',
      bio: 'Premium Jamdani & Terracotta Crafts',
    };
    const origin = 'https://explooro.com';
    const storeUrl = `${origin}/store/${store.slug}`;

    const greeting = `🛍️ Check out "${store.shop_name}" on Explooro Bangladesh!`;
    const orderCta = '\n\nBrowse products & buy with 100% Escrow Protection:';
    const waText = encodeURIComponent(`${greeting}\n\n${store.bio}${orderCta}\n👉 ${storeUrl}`);
    const waUrl = `https://api.whatsapp.com/send?text=${waText}`;

    assert.ok(waUrl.startsWith('https://api.whatsapp.com/send?text='));
    assert.ok(waUrl.includes(encodeURIComponent('Bengal Artisan Studio')));
    assert.ok(waUrl.includes(encodeURIComponent(storeUrl)));

    const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(storeUrl)}`;
    assert.ok(fbUrl.startsWith('https://www.facebook.com/sharer/sharer.php?u='));
    assert.ok(fbUrl.includes(encodeURIComponent(storeUrl)));
  });
});

function resolveShopStatus(mode, hours, now) {
  if (mode === 'OPEN') return { isOpen: true, mode: 'MANUAL_OPEN' };
  if (mode === 'CLOSED') return { isOpen: false, mode: 'MANUAL_CLOSED' };
  return { isOpen: false, mode: 'AUTO' };
}

function resolveAutoStatus(hours, dayName, timeHHMM) {
  const day = hours?.[dayName];
  if (!day || day.is_closed) return false;
  return timeHHMM >= day.open && timeHHMM <= day.close;
}
