/**
 * becomeSaler.test.js — Invariants for the 1-Click Saler Upgrade & Reseller Hub.
 *
 * Tests:
 * 1. Locale integrity — en/bn parity for customer.become_saler keys, nav keys, no double emoji.
 * 2. Calculator arithmetic invariants — precision across volume and margin boundaries.
 * 3. Vanity slug generation & normalization rules.
 * 4. API mock handler contracts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import { customerHandlers } from '../src/mocks/handlers/customer.js';

test('1. Locale integrity for customer.become_saler', async (t) => {
  await t.test('en/bn key parity for become_saler', () => {
    const en = Object.keys(enDict.customer?.become_saler || {}).sort();
    const bn = Object.keys(bnDict.customer?.become_saler || {}).sort();
    assert.deepEqual(en, bn, 'every customer.become_saler key must exist in both locales');
    assert.ok(en.length >= 25, 'become_saler must have comprehensive translations');
  });

  await t.test('nav.customer.become_saler is defined in both locales', () => {
    assert.ok(enDict.nav?.customer?.become_saler, 'en nav key');
    assert.ok(bnDict.nav?.customer?.become_saler, 'bn nav key');
  });

  await t.test('no emoji baked into dictionary values (components prefix their own decorative icons)', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [lang, dict] of [['en', enDict], ['bn', bnDict]]) {
      for (const [k, v] of Object.entries(dict.customer?.become_saler || {})) {
        assert.ok(!emoji.test(v), `${lang}.customer.become_saler.${k} must not contain an emoji: ${v}`);
      }
    }
  });
});

test('2. Profit calculator arithmetic invariants', async (t) => {
  function calculateEarnings(ordersPerDay, avgOrderPrice, marginPct) {
    const profitPerOrder = Math.round(avgOrderPrice * (marginPct / 100));
    const dailyProfit = ordersPerDay * profitPerOrder;
    const monthlyProfit = dailyProfit * 30;
    return { profitPerOrder, dailyProfit, monthlyProfit };
  }

  await t.test('Standard scenario: 5 orders/day @ ৳1,500 with 25% margin', () => {
    const res = calculateEarnings(5, 1500, 25);
    assert.equal(res.profitPerOrder, 375);
    assert.equal(res.dailyProfit, 1875);
    assert.equal(res.monthlyProfit, 56250);
  });

  await t.test('Minimum scenario: 1 order/day @ ৳500 with 10% margin', () => {
    const res = calculateEarnings(1, 500, 10);
    assert.equal(res.profitPerOrder, 50);
    assert.equal(res.dailyProfit, 50);
    assert.equal(res.monthlyProfit, 1500);
  });

  await t.test('Power-reseller scenario: 30 orders/day @ ৳2,000 with 30% margin', () => {
    const res = calculateEarnings(30, 2000, 30);
    assert.equal(res.profitPerOrder, 600);
    assert.equal(res.dailyProfit, 18000);
    assert.equal(res.monthlyProfit, 540000);
  });
});

test('3. Store slug normalization rules', async (t) => {
  function sanitizeStoreSlug(name, fallbackSuffix = '1001') {
    const base = (name || 'store')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${base || 'shop'}-${fallbackSuffix}`;
  }

  await t.test('Sanitizes English shop names with punctuation and spaces', () => {
    assert.equal(sanitizeStoreSlug("Dhaka Handloom & Crafts!", "8812"), "dhaka-handloom-crafts-8812");
  });

  await t.test('Handles empty or symbols-only gracefully', () => {
    assert.equal(sanitizeStoreSlug("!!!", "9999"), "shop-9999");
  });
});

test('4. 1-Click upgrade API mock handler contract', async (t) => {
  await t.test('POST /customer/become-saler returns 200 and redirect_url', () => {
    const handlerObj = customerHandlers.find(
      (h) => h.method === 'POST' && h.path === '/customer/become-saler'
    );
    assert.ok(handlerObj, 'POST /customer/become-saler handler must exist in customer mock handlers');

    const res = handlerObj.handler();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.success, true);
    assert.equal(res.body.data.redirect_url, '/saler/store-builder');
    assert.ok(res.body.data.store?.slug);
  });
});
