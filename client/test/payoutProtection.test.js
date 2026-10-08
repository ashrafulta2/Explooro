/**
 * payoutProtection.test.js — the small pure rules behind the Fast Payout and Return Protection pages.
 *
 * The fee, the eligibility and the money all live (and are tested) on the server. What the client decides
 * is only presentation: which words explain a refusal, and that both languages carry every string. A
 * refusal with no words would leave a person staring at a greyed-out button.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reasonKey } from '../src/components/payoutProtection/FastPayoutTable.js';
import { deniedKey } from '../src/components/payoutProtection/ProtectionCoverTable.js';
import en from '../src/locales/en.json' with { type: 'json' };
import bn from '../src/locales/bn.json' with { type: 'json' };

// The reason codes fastPayout.service.js can return, and the denial reasons returnProtection.service.js records.
const FAST_PAYOUT_REASONS = ['NOT_LOCKED', 'NOT_DELIVERED', 'COD_UNRECONCILED', 'OPEN_CLAIM', 'GRADE_BLOCKED', 'TOO_SMALL', 'TOO_LARGE', 'TOO_SOON', 'EXPOSURE_LIMIT'];
const DENIED_REASONS = ['CLAIM_LIMIT', 'NOT_CLAWED_BACK', 'NOTHING_TO_PAY'];

function lookup(locale, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), locale);
}

test('every reason the server can give maps to words in both languages', () => {
  for (const code of FAST_PAYOUT_REASONS) {
    const key = reasonKey(code);
    assert.equal(key, `fastpay.reason.${code}`);
    assert.ok(lookup(en, key) && lookup(bn, key), `${key} exists in both languages`);
  }
  for (const code of DENIED_REASONS) {
    const key = deniedKey(code);
    assert.equal(key, `rprot.denied.${code}`);
    assert.ok(lookup(en, key) && lookup(bn, key), `${key} exists in both languages`);
  }
});

test('an unknown reason falls back to a generic line rather than a missing key', () => {
  assert.equal(reasonKey('SOMETHING_NEW'), 'fastpay.reason.OTHER');
  assert.equal(reasonKey(undefined), 'fastpay.reason.OTHER');
  assert.equal(deniedKey('SOMETHING_NEW'), 'rprot.denied.OTHER');
  assert.ok(lookup(en, 'fastpay.reason.OTHER') && lookup(bn, 'fastpay.reason.OTHER'));
  assert.ok(lookup(en, 'rprot.denied.OTHER') && lookup(bn, 'rprot.denied.OTHER'));
});

test('every cover status has a label in both languages', () => {
  for (const status of ['ACTIVE', 'CLAIMED', 'DENIED']) {
    assert.ok(en.rprot.status[status] && bn.rprot.status[status], `status ${status}`);
  }
});

test('every fast payout and return protection string exists in both languages with the same placeholders', () => {
  const placeholders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
  const walk = (a, b, path) => {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `same keys at ${path}`);
    for (const key of Object.keys(a)) {
      if (typeof a[key] === 'object') walk(a[key], b[key], `${path}.${key}`);
      else assert.equal(placeholders(a[key]), placeholders(b[key]), `same placeholders at ${path}.${key}`);
    }
  };
  walk(en.fastpay, bn.fastpay, 'fastpay');
  walk(en.rprot, bn.rprot, 'rprot');
  for (const key of ['fast_payout', 'return_protection']) {
    for (const role of ['supplier', 'saler']) {
      assert.ok(en.nav[role][key] && bn.nav[role][key], `nav.${role}.${key}`);
    }
  }
});

test('no fast payout or return protection string puts a literal currency symbol next to a placeholder', () => {
  // Money goes through formatCurrency so English reads "Tk 980.00" and Bangla "৳৯৮০.০০"; a hard-coded
  // symbol before a placeholder would print the symbol twice.
  for (const locale of [en, bn]) {
    for (const [name, block] of Object.entries({ fastpay: locale.fastpay, rprot: locale.rprot })) {
      const text = JSON.stringify(block);
      assert.ok(!/৳\s*\{\{/.test(text), `${name}: a literal ৳ sits before a placeholder`);
      assert.ok(!/Tk\s*\{\{/.test(text), `${name}: a literal Tk sits before a placeholder`);
    }
  }
});
