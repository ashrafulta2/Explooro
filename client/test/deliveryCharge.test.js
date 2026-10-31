/**
 * deliveryCharge.test.js — the normal-checkout delivery charge is a setting, not a number in code,
 * and since migration 098 it is set per delivery zone (Inside Dhaka, Outside Dhaka, ...).
 *
 * The super admin sets it at /admin/platform/delivery. The cart, Quick Buy and checkout used to
 * repeat ৳60 themselves; a copy left behind would show one price and charge another. The zone
 * resolver's parity with the server lives in server/test/deliveryZones.test.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('Delivery charge', () => {
  it('no client price path keeps its own ৳60', () => {
    assert.ok(!/parcels\.length \* 60/.test(read('services/cart.ts')));
    assert.ok(!/const shipping = 60/.test(read('components/cart/QuickBuyModal.ts')));
    assert.ok(!/estimated_shipping \|\| 60/.test(read('pages/CheckoutPage.ts')));
    assert.ok(!/PerParcel = 60/.test(read('mocks/handlers/cart.ts')));
  });

  it('the cart and Quick Buy read the policy the server serves', () => {
    assert.match(read('services/cart.ts'), /knownDeliveryCharge\(\)/);
    assert.match(read('components/cart/QuickBuyModal.ts'), /loadDeliveryCharge\(\)/);
    assert.match(read('services/deliveryCharge.ts'), /api\.get\('\/delivery\/policy'/);
  });

  it('checkout, Quick Buy and the live drawer price by the zone of the picked district', () => {
    const checkout = read('pages/CheckoutPage.ts');
    assert.match(checkout, /knownZoneFor\(addressData\.district\)/);
    assert.match(checkout, /loadDeliveryPolicy\(\)/);
    assert.match(read('components/cart/QuickBuyModal.ts'), /knownZoneFor\(addressData\.district\)/);
    const live = read('pages/LiveStreamPage.ts');
    assert.match(live, /knownZoneFor\(distSelect\.value\)/);
    assert.match(live, /district: distSelect\.value/);
    // The drawer once promised "৳60" / "৳120" in its division labels, whatever the admin had set.
    assert.ok(!/৳(60|120) delivery/.test(live));
    for (const lang of ['en', 'bn']) {
      assert.ok(!/division_dhaka|৳120 delivery/.test(read(`locales/${lang}.json`)), lang);
    }
  });

  it('the cart estimate is the default zone, and a stored policy is checked before it is used', async () => {
    const zones = await import('../src/services/deliveryZones.ts');
    const policy = {
      default_zone: 'outside_dhaka',
      zones: [
        { key: 'inside_dhaka', name_en: 'Inside Dhaka', name_bn: 'ঢাকার ভিতরে', charge: 60, team_charge: 50, days_min: 1, days_max: 2, districts: ['dhaka_city'] },
        { key: 'outside_dhaka', name_en: 'Outside Dhaka', name_bn: 'ঢাকার বাইরে', charge: 120, team_charge: 100, days_min: 3, days_max: 5, districts: [] },
      ],
    };
    assert.equal(zones.defaultZone(policy).charge, 120);
    assert.equal(zones.resolveZone(policy, 'dhaka_city').charge, 60);
    assert.equal(zones.zoneName(policy.zones[0], 'bn'), 'ঢাকার ভিতরে');
    assert.ok(zones.isDeliveryPolicy(policy));
    // A policy stored before migration 099 (no team charge, no days) is refused and re-fetched.
    const preTeam = { default_zone: 'x', zones: [{ key: 'x', name_en: 'X', name_bn: 'X', charge: 60, districts: [] }] };
    const backwards = { default_zone: 'x', zones: [{ key: 'x', charge: 60, team_charge: 60, days_min: 5, days_max: 2, districts: [] }] };
    for (const bad of [null, 60, { per_parcel_charge: 60 }, { default_zone: 'x', zones: [] }, { default_zone: 'x', zones: [{ key: 'x', charge: -1, districts: [] }] }, preTeam, backwards]) {
      assert.equal(zones.isDeliveryPolicy(bad), false, JSON.stringify(bad));
    }
  });

  it('the delivery time window counts calendar days from the day the order was placed', async () => {
    const { expectedDeliveryWindow } = await import('../src/services/deliveryZones.ts');
    const [from, to] = expectedDeliveryWindow('2026-10-31T20:00:00', 3, 5);
    assert.deepEqual([from.getMonth(), from.getDate(), to.getMonth(), to.getDate()], [10, 3, 10, 5]);
    for (const [a, b] of [[null, null], [3, null], [5, 2], [-1, 2], [1.5, 2]]) {
      assert.equal(expectedDeliveryWindow('2026-10-31', a, b), null, `${a}-${b}`);
    }
    assert.equal(expectedDeliveryWindow('not a date', 1, 2), null);
  });

  it('checkout no longer prints one delivery time for every address', () => {
    // (A shop partner's canned chat reply may still say "2-3 business days"; that is their own words.)
    for (const lang of ['en', 'bn']) {
      assert.ok(!/2-3 business days|২-৩ কার্যদিবস/.test(JSON.stringify(JSON.parse(read(`locales/${lang}.json`)).checkout)), lang);
    }
    assert.match(read('pages/CheckoutPage.ts'), /deliveryEtaText\(knownZoneFor\(addressData\.district\)\)/);
  });

  it('the mock checkout charges the zone of the district, as the server does', async () => {
    const { mockDeliveryChargeFor, mockDeliveryCharge } = await import('../src/mocks/handlers/delivery.ts');
    assert.equal(mockDeliveryChargeFor('dhaka_city').key, 'inside_dhaka');
    assert.equal(mockDeliveryChargeFor('sylhet_city').key, 'outside_dhaka');
    assert.equal(mockDeliveryChargeFor(null).charge, mockDeliveryCharge());
  });

  it('the admin page is routed, in the nav and in the platform tabs with the same key', () => {
    assert.match(read('main.ts'), /path: '\/admin\/platform\/delivery',[\s\S]{0,200}permission: 'platform\.delivery\.view'/);
    assert.match(read('config/navigation.ts'), /path: '\/admin\/platform\/delivery'.*permission: 'platform\.delivery\.view', module: 'core'/);
    assert.match(read('components/admin/PlatformSubnav.ts'), /href: '\/admin\/platform\/delivery'/);
  });

  it('every string the page and the shopper surfaces use exists in English and Bangla', () => {
    const page = read('pages/admin/DeliveryChargePage.ts');
    const keys = [...new Set([...page.matchAll(/t\('(admin\.delivery\.[a-z_]+)'/g)].map((m) => m[1]))];
    assert.ok(keys.length > 10);
    keys.push('checkout.delivery_charge', 'checkout.delivery_zone', 'checkout.delivery_zone_rate', 'live.chk_district',
      'delivery.eta_days', 'delivery.eta_days_one', 'delivery.eta_same_day', 'checkout.parcel_eta', 'checkout.delivery_eta_label',
      'order_tracking.expected_delivery', 'order_tracking.expected_range', 'team_purchases.checkout.shipping_zone',
      'admin.group_buy.delivery_note', 'admin.group_buy.delivery_link');
    for (const lang of ['en', 'bn']) {
      const dict = JSON.parse(read(`locales/${lang}.json`));
      for (const key of keys) {
        const value = key.split('.').reduce((o, k) => o?.[k], dict);
        assert.equal(typeof value, 'string', `${lang}: ${key}`);
      }
    }
  });
});
