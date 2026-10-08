/**
 * sampleKit.test.js — the small pure rules behind the sample and marketing-kit pages.
 *
 * The money, the state machine and the validation live (and are tested) on the server. What the
 * client decides is only presentation: which caption to show, how typed text becomes a list, and what
 * a search matches. Those must never lose or mangle what a supplier wrote.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCaption } from '../src/components/sampleKit/MarketingKitCard.js';
import { filterKits } from '../src/pages/saler/SalerMarketingKitsPage.js';
import { splitEntries } from '../src/pages/supplier/SupplierMarketingKitsPage.js';
import en from '../src/locales/en.json' with { type: 'json' };
import bn from '../src/locales/bn.json' with { type: 'json' };

test('pickCaption prefers the viewer\'s language and falls back rather than showing nothing', () => {
  const both = { caption_en: 'English', caption_bn: 'বাংলা' };
  assert.equal(pickCaption(both, 'en'), 'English');
  assert.equal(pickCaption(both, 'bn'), 'বাংলা');
  assert.equal(pickCaption({ caption_en: 'English', caption_bn: null }, 'bn'), 'English');
  assert.equal(pickCaption({ caption_en: null, caption_bn: 'বাংলা' }, 'en'), 'বাংলা');
  assert.equal(pickCaption({ caption_en: null, caption_bn: null }, 'en'), '');
});

test('splitEntries turns typed text into clean lists', () => {
  assert.deepEqual(splitEntries('#eid, #panjabi  #cotton,,', /[,\s]+/), ['#eid', '#panjabi', '#cotton']);
  assert.deepEqual(splitEntries('100% cotton\n\n  Free size  \n', /\n/), ['100% cotton', 'Free size']);
  assert.deepEqual(splitEntries('', /\n/), []);
  assert.deepEqual(splitEntries(null, /\n/), []);
});

test('filterKits matches product or supplier, in either language, ignoring case', () => {
  const kits = [
    { title_en: 'Cotton Panjabi', title_bn: 'কটন পাঞ্জাবি', supplier_name: 'Rahman Traders' },
    { title_en: 'Jute Bag', title_bn: 'পাটের ব্যাগ', supplier_name: 'Dhaka Home Goods' },
  ];
  assert.equal(filterKits(kits, '').length, 2);
  assert.equal(filterKits(kits, '   ').length, 2);
  assert.deepEqual(filterKits(kits, 'PANJABI').map((k) => k.title_en), ['Cotton Panjabi']);
  assert.deepEqual(filterKits(kits, 'পাটের').map((k) => k.title_en), ['Jute Bag']);
  assert.deepEqual(filterKits(kits, 'dhaka home').map((k) => k.title_en), ['Jute Bag']);
  assert.equal(filterKits(kits, 'nothing like this').length, 0);
});

test('every sample and kit string exists in both languages with the same placeholders', () => {
  const placeholders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
  const walk = (a, b, path) => {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `same keys at ${path}`);
    for (const key of Object.keys(a)) {
      if (typeof a[key] === 'object') walk(a[key], b[key], `${path}.${key}`);
      else assert.equal(placeholders(a[key]), placeholders(b[key]), `same placeholders at ${path}.${key}`);
    }
  };
  walk(en.sample, bn.sample, 'sample');
  walk(en.kit, bn.kit, 'kit');
  for (const status of ['REQUESTED', 'ACCEPTED', 'SHIPPED', 'DELIVERED', 'DECLINED', 'CANCELLED', 'EXPIRED']) {
    assert.ok(en.sample.status[status] && bn.sample.status[status], `status ${status} has a label in both languages`);
  }
});

test('no sample or kit string puts a literal currency symbol next to a placeholder', () => {
  // Money goes through formatCurrency so English reads "Tk 260.00" and Bangla "৳২৬০.০০"; a hard-coded
  // symbol before a placeholder would print the symbol twice.
  for (const locale of [en, bn]) {
    for (const [name, block] of Object.entries({ sample: locale.sample, kit: locale.kit })) {
      const text = JSON.stringify(block);
      assert.ok(!/৳\s*\{\{/.test(text), `${name}: a literal ৳ sits before a placeholder`);
    }
  }
});
