/**
 * storefront.test.js — Automated test suite for virtual storefronts, builder, status & OG images (Prompt 4.8).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as storeService from '../src/services/store.service.js';
import * as ogService from '../src/services/og-image.service.js';
import { isReservedStoreSlug } from '../src/config/reservedSlugs.js';

test('Prompt 4.8: Reserved store slug enforcement', () => {
  assert.equal(isReservedStoreSlug('admin'), true);
  assert.equal(isReservedStoreSlug('api'), true);
  assert.equal(isReservedStoreSlug('store'), true);
  assert.equal(isReservedStoreSlug('checkout'), true);
  assert.equal(isReservedStoreSlug('saler'), true);
  assert.equal(isReservedStoreSlug('supplier'), true);
  assert.equal(isReservedStoreSlug('auth'), true);
  assert.equal(isReservedStoreSlug('login'), true);
  assert.equal(isReservedStoreSlug('settings'), true);

  // Normal valid brand slugs
  assert.equal(isReservedStoreSlug('priyo-collection'), false);
  assert.equal(isReservedStoreSlug('dhaka-textiles'), false);
  assert.equal(isReservedStoreSlug('sylhet-crafts-bd'), false);
});

test('Prompt 4.8: Slug availability validation service', async () => {
  const mockDb = {
    query: async (sql, params) => {
      if (params && params[0] === 'taken-brand') {
        return { rows: [{ id: 99 }] };
      }
      return { rows: [] };
    },
  };

  // 1. Reserved slug rejection
  const reservedRes = await storeService.validateSlugAvailability(mockDb, 'admin');
  assert.equal(reservedRes.available, false);
  assert.equal(reservedRes.reason, 'RESERVED_SLUG');

  // 2. Slug collision rejection
  const takenRes = await storeService.validateSlugAvailability(mockDb, 'taken-brand');
  assert.equal(takenRes.available, false);
  assert.equal(takenRes.reason, 'SLUG_COLLISION');

  // 3. Short / Invalid format rejection
  const shortRes = await storeService.validateSlugAvailability(mockDb, 'ab');
  assert.equal(shortRes.available, false);
  assert.equal(shortRes.reason, 'INVALID_LENGTH');

  const invalidCharRes = await storeService.validateSlugAvailability(mockDb, 'brand_name$');
  assert.equal(invalidCharRes.available, false);
  assert.equal(invalidCharRes.reason, 'INVALID_CHARACTERS');

  // 4. Valid available slug
  const validRes = await storeService.validateSlugAvailability(mockDb, 'awesome-boutique');
  assert.equal(validRes.available, true);
  assert.equal(validRes.slug, 'awesome-boutique');
});

test('Prompt 4.8: Physical shop status resolution', () => {
  // 1. Store without physical presence -> Virtual only
  const virtualOnly = storeService.resolvePhysicalShopStatus({ has_physical_shop: false });
  assert.equal(virtualOnly.isOpen, true);
  assert.equal(virtualOnly.mode, 'VIRTUAL_ONLY');

  // 2. Manual OPEN override
  const manualOpen = storeService.resolvePhysicalShopStatus({
    has_physical_shop: true,
    physical_open_status: 'OPEN',
  });
  assert.equal(manualOpen.isOpen, true);
  assert.equal(manualOpen.mode, 'MANUAL_OPEN');

  // 3. Manual CLOSED override
  const manualClosed = storeService.resolvePhysicalShopStatus({
    has_physical_shop: true,
    physical_open_status: 'CLOSED',
  });
  assert.equal(manualClosed.isOpen, false);
  assert.equal(manualClosed.mode, 'MANUAL_CLOSED');

  // 4. AUTO mode with explicit business hours schedule
  // Set schedule: Saturday 09:00 - 21:00
  const storeWithSchedule = {
    has_physical_shop: true,
    physical_open_status: 'AUTO',
    business_hours_json: {
      saturday: { open: '09:00', close: '21:00', is_closed: false },
      sunday: { open: '09:00', close: '21:00', is_closed: false },
      monday: { open: '09:00', close: '21:00', is_closed: false },
      tuesday: { open: '09:00', close: '21:00', is_closed: false },
      wednesday: { open: '09:00', close: '21:00', is_closed: false },
      thursday: { open: '09:00', close: '21:00', is_closed: false },
      friday: { open: '15:00', close: '21:00', is_closed: false },
    },
  };

  // Test during business hours (e.g. 14:00 Bangladesh time = 08:00 UTC on a Monday)
  const mondayMiddayUtc = new Date('2026-08-24T08:00:00Z'); // 14:00 BD time (Monday)
  const autoMidday = storeService.resolvePhysicalShopStatus(storeWithSchedule, mondayMiddayUtc);
  assert.equal(autoMidday.isOpen, true);
  assert.equal(autoMidday.mode, 'AUTO_OPEN');

  // Test outside business hours (e.g. 23:30 Bangladesh time = 17:30 UTC on a Monday)
  const mondayNightUtc = new Date('2026-08-24T17:30:00Z'); // 23:30 BD time (Monday)
  const autoNight = storeService.resolvePhysicalShopStatus(storeWithSchedule, mondayNightUtc);
  assert.equal(autoNight.isOpen, false);
  assert.equal(autoNight.mode, 'AUTO_CLOSED');
});

test('Prompt 4.8: Dynamic OpenGraph image generation & caching', async () => {
  const store = {
    shop_name: 'Priyo Collection',
    slug: 'priyo-collection',
    bio: 'Authentic Bangladeshi Handloom Sarees',
    rating: 4.9,
    products_count: 25,
    is_open: true,
  };

  const svg = ogService.generateStoreOgSvg(store);
  assert.ok(svg.includes('Priyo Collection'));
  assert.ok(svg.includes('priyo-collection'));
  assert.ok(svg.includes('EXPLOORO STORE'));
  assert.ok(svg.includes('Store Open 🟢'));

  const { buffer, contentType } = await ogService.getStoreOgImageBuffer(store);
  assert.equal(contentType, 'image/svg+xml');
  assert.ok(buffer.length > 500);

  // Verify Product OG Image
  const product = {
    title_en: 'Jamdani Silk Saree',
    default_retail_price: 3500,
    brand: 'Narayanganj Weavers',
    store_name: 'Priyo Collection',
  };
  const prodSvg = ogService.generateProductOgSvg(product);
  assert.ok(prodSvg.includes('Jamdani Silk Saree'));
  assert.ok(prodSvg.includes('3,500.00'));
});
