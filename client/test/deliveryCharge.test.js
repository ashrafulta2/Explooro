/**
 * deliveryCharge.test.js — the normal-checkout delivery charge is a setting, not a number in code.
 *
 * The super admin sets it at /admin/platform/delivery. The cart, Quick Buy and checkout used to
 * repeat ৳60 themselves; a copy left behind would show one price and charge another.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('Delivery charge', () => {
  it('no client price path keeps its own ৳60', () => {
    assert.ok(!/parcels\.length \* 60/.test(read('services/cart.js')));
    assert.ok(!/const shipping = 60/.test(read('components/cart/QuickBuyModal.js')));
    assert.ok(!/estimated_shipping \|\| 60/.test(read('pages/CheckoutPage.js')));
    assert.ok(!/PerParcel = 60/.test(read('mocks/handlers/cart.js')));
  });

  it('the cart and Quick Buy read the policy the server serves', () => {
    assert.match(read('services/cart.js'), /knownDeliveryCharge\(\)/);
    assert.match(read('components/cart/QuickBuyModal.js'), /loadDeliveryCharge\(\)/);
    assert.match(read('services/deliveryCharge.js'), /api\.get\('\/delivery\/policy'/);
  });

  it('the admin page is routed, in the nav and in the platform tabs with the same key', () => {
    assert.match(read('main.js'), /path: '\/admin\/platform\/delivery',[\s\S]{0,200}permission: 'platform\.delivery\.view'/);
    assert.match(read('config/navigation.js'), /path: '\/admin\/platform\/delivery'.*permission: 'platform\.delivery\.view', module: 'core'/);
    assert.match(read('components/admin/PlatformSubnav.js'), /href: '\/admin\/platform\/delivery'/);
  });

  it('every string the page uses exists in English and Bangla', () => {
    const page = read('pages/admin/DeliveryChargePage.js');
    const keys = [...new Set([...page.matchAll(/t\('(admin\.delivery\.[a-z_]+)'/g)].map((m) => m[1]))];
    assert.ok(keys.length > 10);
    for (const lang of ['en', 'bn']) {
      const dict = JSON.parse(read(`locales/${lang}.json`));
      for (const key of keys) {
        const value = key.split('.').reduce((o, k) => o?.[k], dict);
        assert.equal(typeof value, 'string', `${lang}: ${key}`);
      }
    }
  });
});
