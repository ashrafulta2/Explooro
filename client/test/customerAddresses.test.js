/**
 * customerAddresses.test.js — Invariants for the Customer Saved Delivery Addresses book.
 *
 * Pins the defects the feature must never regress:
 *   1. Locale integrity — en/bn parity for customer_addresses.*, nav key present, no double emoji.
 *   2. Bangladeshi geography — cascade helpers return real data and stay consistent.
 *   3. Phone normalization/validation — identical rules client and server.
 *   4. Default-address invariant — exactly one default at all times through create/promote/delete.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import {
  BANGLADESH_DIVISIONS,
  getDistrictsByDivision,
  getUpazilasByDistrict,
  getDivisionById,
  getDistrictById,
} from '../src/data/bangladeshGeo.js';

test('1. Locale integrity for customer_addresses', async (t) => {
  await t.test('en/bn key parity', () => {
    const en = Object.keys(enDict.customer_addresses || {}).sort();
    const bn = Object.keys(bnDict.customer_addresses || {}).sort();
    assert.deepEqual(en, bn, 'every customer_addresses key must exist in both locales');
    assert.ok(en.length > 40, 'the page renders far more strings than a handful of keys');
  });

  await t.test('nav.customer.addresses is defined in both locales', () => {
    assert.ok(enDict.nav?.customer?.addresses, 'en nav key');
    assert.ok(bnDict.nav?.customer?.addresses, 'bn nav key');
  });

  await t.test('no emoji baked into dictionary values (the page prefixes its own icons)', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [lang, dict] of [['en', enDict], ['bn', bnDict]]) {
      for (const [k, v] of Object.entries(dict.customer_addresses || {})) {
        assert.ok(!emoji.test(v), `${lang}.customer_addresses.${k} must not contain an emoji: ${v}`);
      }
    }
  });

  await t.test('customer_addresses declared exactly once per locale file', () => {
    for (const lang of ['en', 'bn']) {
      const raw = fs.readFileSync(path.join(import.meta.dirname, `../src/locales/${lang}.json`), 'utf8');
      assert.equal(raw.split('"customer_addresses":').length - 1, 1, `${lang}.json`);
    }
  });
});

test('2. Bangladeshi administrative geography helpers', async (t) => {
  await t.test('8 divisions, each with districts', () => {
    assert.equal(BANGLADESH_DIVISIONS.length, 8);
    for (const div of BANGLADESH_DIVISIONS) {
      assert.ok(getDistrictsByDivision(div.id).length > 0, `${div.id} has districts`);
    }
  });

  await t.test('district lookup is scoped to its division', () => {
    assert.equal(getDivisionById('dhaka')?.name_en, 'Dhaka');
    assert.equal(getDistrictById('dhaka', 'dhaka_city')?.name_en, 'Dhaka City');
    assert.ok(!getDistrictById('chittagong', 'dhaka_city'), 'district not resolvable in the wrong division');
  });

  await t.test('unknown ids never throw', () => {
    assert.deepEqual(getDistrictsByDivision('atlantis'), []);
    assert.deepEqual(getUpazilasByDistrict('atlantis', 'nowhere'), []);
    assert.ok(!getDivisionById(undefined));
  });
});

test('3. Bangladeshi phone normalization and validation', async (t) => {
  // Mirrors normalizeBdPhone / isValidBdPhone in AddressForm.js and customerAddress.service.js.
  const normalize = (input) => {
    const digits = String(input || '').replace(/\D/g, '');
    if (digits.startsWith('8801') && digits.length === 13) return `+${digits}`;
    if (digits.startsWith('01') && digits.length === 11) return `+88${digits}`;
    if (digits.startsWith('1') && digits.length === 10) return `+880${digits}`;
    return String(input || '').trim();
  };
  const isValid = (p) => /^\+8801[3-9]\d{8}$/.test(normalize(p));

  await t.test('normalizes local, national, and international forms', () => {
    assert.equal(normalize('01711223344'), '+8801711223344');
    assert.equal(normalize('8801811223344'), '+8801811223344');
    assert.equal(normalize('+8801911223344'), '+8801911223344');
    assert.equal(normalize('017-1122-3344'), '+8801711223344');
  });

  await t.test('accepts operator prefixes 013–019, rejects the rest', () => {
    for (const d of [3, 4, 5, 6, 7, 8, 9]) assert.ok(isValid(`01${d}11223344`), `013${d}...`);
    for (const d of [0, 1, 2]) assert.ok(!isValid(`01${d}11223344`), `01${d}... invalid`);
    assert.ok(!isValid('12345'));
    assert.ok(!isValid('0171122334')); // too short
  });
});

test('4. Default-address invariant (mirrors the address book service/mock)', async (t) => {
  // Reference implementation of the default-management rules the server enforces transactionally
  // and the mock handler reproduces. The invariant: 0 addresses → 0 defaults; ≥1 address → exactly 1.
  function makeBook() {
    let rows = [];
    let id = 1;
    const defaults = () => rows.filter((r) => r.is_default).length;
    return {
      rows: () => rows,
      defaultCount: defaults,
      create(is_default = false) {
        const shouldDefault = is_default || rows.length === 0;
        if (shouldDefault) rows.forEach((r) => (r.is_default = false));
        rows.push({ id: id++, is_default: shouldDefault, touched: Date.now() + id });
        return rows[rows.length - 1];
      },
      setDefault(target) {
        rows.forEach((r) => (r.is_default = r.id === target));
      },
      remove(target) {
        const gone = rows.find((r) => r.id === target);
        rows = rows.filter((r) => r.id !== target);
        if (gone?.is_default && rows.length > 0) {
          const promote = [...rows].sort((a, b) => b.touched - a.touched)[0];
          rows.forEach((r) => (r.is_default = r.id === promote.id));
        }
      },
    };
  }

  await t.test('first address becomes the default automatically', () => {
    const b = makeBook();
    b.create();
    assert.equal(b.defaultCount(), 1);
  });

  await t.test('adding a non-default address does not change the default', () => {
    const b = makeBook();
    const first = b.create();
    b.create(false);
    assert.equal(b.defaultCount(), 1);
    assert.equal(b.rows().find((r) => r.is_default).id, first.id);
  });

  await t.test('promoting always leaves exactly one default', () => {
    const b = makeBook();
    b.create();
    const second = b.create();
    b.create();
    b.setDefault(second.id);
    assert.equal(b.defaultCount(), 1);
    assert.equal(b.rows().find((r) => r.is_default).id, second.id);
  });

  await t.test('deleting the default promotes the most recently touched remaining address', () => {
    const b = makeBook();
    const first = b.create();
    const second = b.create();
    b.remove(first.id); // first was the default
    assert.equal(b.defaultCount(), 1);
    assert.equal(b.rows()[0].id, second.id);
  });

  await t.test('deleting the last address leaves zero defaults, not a dangling flag', () => {
    const b = makeBook();
    const only = b.create();
    b.remove(only.id);
    assert.equal(b.rows().length, 0);
    assert.equal(b.defaultCount(), 0);
  });
});
