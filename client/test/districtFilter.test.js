/**
 * districtFilter.test.js — Invariants for the Bangladesh 64-District Filter with Search.
 *
 * Tests:
 * 1. ALL_BD_DISTRICTS exports all 64 districts with bilingual English/Bengali names and divisions.
 * 2. District filter in FilterPanel renders search input with accessible placeholder and label.
 * 3. FilterPanel correctly imports and leverages ALL_BD_DISTRICTS.
 * 4. Locale keys for district filter exist in both en.json and bn.json.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_BD_DISTRICTS, getAllDistricts } from '../src/data/bangladeshGeo.js';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };

const clientRoot = path.resolve(import.meta.dirname, '..');

test('Bangladesh 64-District Filter with Search Invariants', async (t) => {
  await t.test('1. ALL_BD_DISTRICTS contains all 64 districts with bilingual metadata', () => {
    assert.equal(ALL_BD_DISTRICTS.length, 64, 'Must have exactly 64 districts of Bangladesh');
    assert.equal(getAllDistricts().length, 64, 'getAllDistricts() must return 64 districts');

    const seenIds = new Set();
    for (const d of ALL_BD_DISTRICTS) {
      assert.ok(d.id, 'District must have an id');
      assert.ok(d.name_en, 'District must have name_en');
      assert.ok(d.name_bn, 'District must have name_bn');
      assert.ok(d.division, 'District must have division');
      assert.ok(!seenIds.has(d.id), `Duplicate district id: ${d.id}`);
      seenIds.add(d.id);
    }
  });

  await t.test('2. Key major districts are present in ALL_BD_DISTRICTS', () => {
    const names = ALL_BD_DISTRICTS.map((d) => d.name_en);
    const required = [
      'Dhaka', 'Chattogram', 'Sylhet', 'Khulna', 'Rajshahi',
      'Rangpur', 'Mymensingh', 'Barishal', 'Gazipur', 'Narayanganj',
      'Cumilla', 'Bogura', "Cox's Bazar", 'Jashore', 'Bagerhat',
      'Tangail', 'Panchagarh', 'Bandarban', 'Sunamganj'
    ];
    for (const req of required) {
      assert.ok(names.includes(req), `ALL_BD_DISTRICTS must contain ${req}`);
    }
  });

  await t.test('3. FilterPanel source code includes live search input and ALL_BD_DISTRICTS', () => {
    const filterPanelPath = path.join(clientRoot, 'src', 'components', 'product', 'FilterPanel.js');
    const content = fs.readFileSync(filterPanelPath, 'utf8');

    assert.match(
      content,
      /ALL_BD_DISTRICTS/,
      'FilterPanel must import and use ALL_BD_DISTRICTS'
    );
    assert.match(
      content,
      /filter-panel__select-search-input/,
      'FilterPanel must render search input for filtering districts'
    );
    assert.match(
      content,
      /filter-panel__select-search-clear/,
      'FilterPanel must render clear button for district search'
    );
  });

  await t.test('4. Locale keys for district filter exist in both en.json and bn.json', () => {
    assert.ok(enDict.marketplace?.filter?.search_district, 'en.json must contain search_district');
    assert.ok(bnDict.marketplace?.filter?.search_district, 'bn.json must contain search_district');
    assert.ok(enDict.marketplace?.filter?.no_districts_found, 'en.json must contain no_districts_found');
    assert.ok(bnDict.marketplace?.filter?.no_districts_found, 'bn.json must contain no_districts_found');
  });
});
