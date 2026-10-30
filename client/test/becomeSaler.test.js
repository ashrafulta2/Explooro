/**
 * becomeSaler.test.js — Invariants for the 1-Click Shop Partner Upgrade & Shop Partner Hub.
 *
 * Tests:
 * 1. Locale integrity — en/bn parity for customer.become_saler keys, nav keys, no double emoji.
 * 2. No per-sale profit promise: the calculator is gone and the reward factors are ranked.
 * 3. Vanity slug generation & normalization rules.
 * 4. API mock handler contracts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import { customerHandlers } from '../src/mocks/handlers/customer.ts';

const clientRoot = path.resolve(import.meta.dirname, '..');

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

test('2. No per-sale profit promise (partner reward pool, migrations 085/086)', async (t) => {
  const page = fs.readFileSync(path.join(clientRoot, 'src', 'pages', 'customer', 'BecomeSalerPage.ts'), 'utf8');

  await t.test('the profit calculator is gone', () => {
    assert.doesNotMatch(page, /type="range"|calc-margin-slider|calculator_/, 'a partner earns no margin per order to calculate');
  });

  await t.test('the reward section names the four factors in the rule order', () => {
    // WHY: partner_reward.rules requires sales >= social >= community >= activity, and the page
    // lists the factors "from what counts most", so this order is a claim about the rules.
    assert.match(page, /REWARD_FACTORS = \['sales', 'social', 'community', 'activity'\]/);
    for (const key of ['sales', 'social', 'community', 'activity']) {
      for (const [lang, dict] of [['en', enDict], ['bn', bnDict]]) {
        assert.ok(dict.customer.become_saler[`reward_factor_${key}`], `${lang} reward_factor_${key}`);
        assert.ok(dict.customer.become_saler[`reward_factor_${key}_desc`], `${lang} reward_factor_${key}_desc`);
      }
    }
  });

  await t.test('no become_saler copy promises a percentage or a per-order profit', () => {
    for (const [lang, dict] of [['en', enDict], ['bn', bnDict]]) {
      for (const [k, v] of Object.entries(dict.customer.become_saler)) {
        assert.doesNotMatch(v, /[0-9০-৯]\s*%|profit per order|প্রতি অর্ডারে .*লাভ/i, `${lang}.customer.become_saler.${k}: ${v}`);
      }
    }
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
