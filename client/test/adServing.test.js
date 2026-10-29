/**
 * adServing.test.js — what the storefront asks the ads API for, and what it does with the answer.
 *
 *   1. GET /ads/reserved answers `{ placements: [...] }`; callers must always get an ARRAY in `data`
 *      (the old code read `res.data`, the whole body object, so no reserved ad ever rendered).
 *   2. 'HOMEPAGE_HERO' is sent as the server's 'HOME_HERO', and the category goes out as `category_id`.
 *   3. A failing auction request resolves to [] — an ad must never break a page.
 *   4. A supplier can reach the ad manager from the menu (same route, permission and module as the shop partner).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/core/api.ts';
import { adsApi } from '../src/services/ads.api.ts';
import { navItems } from '../src/config/navigation.ts';

async function withGet(impl, fn) {
  const original = api.get;
  api.get = impl;
  try {
    return await fn();
  } finally {
    api.get = original;
  }
}

test('reserved placements resolve to an array in the slot shape, with legacy fields kept', async () => {
  const body = {
    placements: [{
      campaign_id: 5, creative_id: 6, title: 'T', headline: 'Spot', description: 'D',
      banner_image_url: '/b.png', call_to_action: 'SHOP_NOW', destination_url: null, product_id: 'PRD-1',
      placement: 'HOME_HERO',
    }],
  };
  const res = await withGet(async () => ({ ...body, data: body }), () => adsApi.listReservedPlacements('HOME_HERO'));
  assert.ok(Array.isArray(res.data));
  assert.equal(res.data.length, 1);
  const ad = res.data[0];
  assert.equal(ad.campaignId, 5);
  assert.equal(ad.headline, 'Spot');
  assert.equal(ad.destinationUrl, '/product/PRD-1');
  assert.equal(ad.campaign_id, 5);
  assert.equal(ad.creative.image_url, '/b.png');
});

test('HOMEPAGE_HERO is requested as HOME_HERO and the category as category_id', async () => {
  const seen = [];
  await withGet(async (path) => { seen.push(path); return { placements: [], data: { placements: [] } }; }, async () => {
    await adsApi.listReservedPlacements('HOMEPAGE_HERO');
    await adsApi.listReservedPlacements('CATEGORY_BANNER', 42);
  });
  assert.match(seen[0], /placement=HOME_HERO/);
  assert.doesNotMatch(seen[0], /HOMEPAGE_HERO/);
  assert.match(seen[1], /category_id=42/);
});

test('an empty or malformed reserved answer still gives an array', async () => {
  const res = await withGet(async () => ({}), () => adsApi.listReservedPlacements('LIVE_LOBBY'));
  assert.deepEqual(res.data, []);
});

test('runAuction returns the winners and sends keyword + limit', async () => {
  let path = '';
  const ads = await withGet(async (p) => { path = p; return { ads: [{ campaignId: 1 }] }; }, () => adsApi.runAuction('SEARCH_RESULTS', { keyword: 'honey', limit: 2 }));
  assert.deepEqual(ads, [{ campaignId: 1 }]);
  assert.match(path, /placement=SEARCH_RESULTS/);
  assert.match(path, /keyword=honey/);
  assert.match(path, /limit=2/);
});

test('a failing auction request resolves to an empty list instead of throwing', async () => {
  const ads = await withGet(() => Promise.reject(new Error('boom')), () => adsApi.runAuction('FEED'));
  assert.deepEqual(ads, []);
});

test('a supplier has an Ad Campaigns menu entry that matches the route guard', () => {
  const salerItem = navItems.find((i) => i.key === 'saler.ads');
  const supplierItem = navItems.find((i) => i.key === 'supplier.ads');
  assert.ok(supplierItem, 'supplier.ads nav item is missing');
  assert.deepEqual(supplierItem.roles, ['supplier']);
  assert.equal(supplierItem.path, salerItem.path);
  assert.equal(supplierItem.permission, salerItem.permission);
  assert.equal(supplierItem.module, salerItem.module);
});
