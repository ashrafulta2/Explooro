/**
 * pricingConflicts.test.js — the admin is warned when price and discount settings work against each
 * other (client/src/services/pricingConflicts.ts, owner request 2026-10-31).
 *
 * Invariants: every conflict the rules predict is what the server's own pricing really does (the
 * partner profit cap in pricing.service, the team price floor in teamPurchase.service), and no
 * conflict is reported where the server pays as set; each suggested fix really removes its conflict;
 * the case the owner hit (15% markup, 25% team discount) is reported; every message exists in both
 * languages; both admin pages get the settings the rules need.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { findPricingConflicts, newConflicts } from '../../client/src/services/pricingConflicts.ts';
import { assertPartnerProfitFits } from '../src/services/pricing.service.ts';
import { retailFromSupplierPrice } from '../src/services/retailMarkup.service.ts';
import { computeGroupPrice } from '../src/services/teamPurchase.service.ts';

const read = (rel) => fs.readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');

// WHY ৳1,00,000: the team price is rounded to whole taka, which on a small price can turn a margin of a
// few paisa into none. At this size every margin the grid produces is worth whole taka.
const SUPPLIER = 100000;

const fakeDb = (floor, share) => ({
  async query() {
    return { rows: [{ value_json: { saler_split_pct: share, platform_split_pct: 100 - share, platform_default_profit_pct: floor } }] };
  },
});

const codesOf = (conflicts) => conflicts.filter((c) => c.is_default).map((c) => c.code).sort();
const policy = (m, f, s, team = null) => ({ markup: { default_markup_pct: m }, split: { saler_split_pct: s, platform_default_profit_pct: f }, team });

describe('every prediction matches what the server pays', () => {
  test('markup below the minimum, and a share the minimum cuts, are reported exactly when they happen', async () => {
    for (const f of [0, 5, 10, 20]) {
      for (const s of [10, 40, 70, 90]) {
        for (const m of [0, 3, 5, 9, 10, 12, 15, 20, 33, 34, 50, 100]) {
          const retail = retailFromSupplierPrice(SUPPLIER, m, 0);
          const marginPaisa = Math.round((retail - SUPPLIER) * 100);
          const maxPaisa = Math.round((await assertPartnerProfitFits(fakeDb(f, s), { baseCost: SUPPLIER, retailPrice: retail, partnerProfit: 0 })) * 100);
          const fromSplitPaisa = Math.floor((marginPaisa * s) / 100);
          const floorPaisa = Math.round(SUPPLIER * f);
          const expected = [];
          if (marginPaisa < floorPaisa) expected.push('MARKUP_BELOW_FLOOR');
          else if (fromSplitPaisa > maxPaisa) expected.push('SPLIT_CAPPED');
          assert.deepEqual(codesOf(findPricingConflicts(policy(m, f, s))), expected, `markup ${m}% floor ${f}% share ${s}%`);
        }
      }
    }
  });

  test('a team sold at cost, or under the minimum, is reported exactly when computeGroupPrice does it', () => {
    for (const f of [0, 5, 10]) {
      for (const m of [10, 15, 20, 30, 50]) {
        for (const d of [1, 3, 5, 9, 10, 13, 14, 15, 20, 25, 40]) {
          const retail = retailFromSupplierPrice(SUPPLIER, m, 0);
          const { groupPaisa } = computeGroupPrice({ retailPrice: retail, baseCost: SUPPLIER, wholesaleMargin: 0, discountPct: d });
          const marginPaisa = groupPaisa - SUPPLIER * 100;
          const expected = [];
          if (m >= f) {
            if (marginPaisa <= 0) expected.push('TEAM_AT_COST');
            else if (marginPaisa < SUPPLIER * f) expected.push('TEAM_BELOW_FLOOR');
          }
          const found = findPricingConflicts(policy(m, f, 0, { discount_pct_2: d, discount_pct_3: 0 })).filter((c) => c.code.startsWith('TEAM'));
          assert.deepEqual(found.map((c) => c.code), expected, `markup ${m}% floor ${f}% discount ${d}%`);
        }
      }
    }
  });
});

describe('the suggested fix removes the conflict', () => {
  test('raising the markup or lowering the minimum to the suggested value clears a capped share', () => {
    const [c] = findPricingConflicts(policy(15, 10, 70));
    assert.equal(c.code, 'SPLIT_CAPPED');
    assert.deepEqual(c.params, { markup: 15, floor: 10, share: 70, effective_share: 33.3, need_markup: 33.4, max_floor: 4.5 });
    assert.deepEqual(findPricingConflicts(policy(c.params.need_markup, 10, 70)), []);
    assert.deepEqual(findPricingConflicts(policy(15, c.params.max_floor, 70)), []);
  });

  test('a team discount at the suggested maximum no longer conflicts', () => {
    for (const [m, f, d] of [[15, 10, 25], [15, 10, 8], [30, 5, 28], [20, 0, 19]]) {
      const team = { discount_pct_2: d, discount_pct_3: 0 };
      const c = findPricingConflicts(policy(m, f, 0, team)).find((x) => x.code.startsWith('TEAM'));
      assert.ok(c, `${m}/${f}/${d} conflicts`);
      const fixed = findPricingConflicts(policy(m, f, 0, { ...team, discount_pct_2: c.params.max_discount }));
      assert.equal(fixed.filter((x) => x.code.startsWith('TEAM')).length, 0, `${m}/${f} at ${c.params.max_discount}%`);
    }
  });
});

describe('what the admin sees', () => {
  test('the owner case: 15% markup with 15% and 25% team discounts sells every team at cost', () => {
    const found = findPricingConflicts(policy(15, 10, 70, { discount_pct_2: 15, discount_pct_3: 25 }));
    assert.deepEqual(found.map((c) => c.key), ['TEAM_AT_COST:2:default', 'TEAM_AT_COST:3:default', 'SPLIT_CAPPED:default']);
    assert.equal(found[0].params.cost_discount, 13);
    assert.equal(found[0].params.max_discount, 4.3);
  });

  test('a category override is reported on its own, with its name', () => {
    const found = findPricingConflicts({
      ...policy(40, 10, 70),
      markup: { default_markup_pct: 40, categories: { 3: 8 } },
      categoryNames: [{ id: 1, name_en: 'Fashion' }, { id: 3, name_en: 'Grocery', name_bn: 'মুদি' }],
    });
    assert.deepEqual(found.map((c) => c.key), ['MARKUP_BELOW_FLOOR:cat:3']);
    assert.deepEqual(found[0].categories, [{ id: '3', name_en: 'Grocery', name_bn: 'মুদি' }]);
  });

  test('team buying switched off cannot conflict', () => {
    assert.deepEqual(findPricingConflicts(policy(15, 0, 50, null)), []);
  });

  test('newConflicts keeps only what a save would add', () => {
    const before = findPricingConflicts(policy(15, 10, 70));
    const after = findPricingConflicts(policy(15, 10, 70, { discount_pct_2: 15, discount_pct_3: 5 }));
    assert.deepEqual(newConflicts(before, after).map((c) => c.key), ['TEAM_AT_COST:2:default', 'TEAM_BELOW_FLOOR:3:default']);
    assert.deepEqual(newConflicts(after, before), []);
  });

  test('every conflict has a message and a fix in both languages', () => {
    const src = read('../client/src/services/pricingConflicts.ts');
    const codes = [...src.matchAll(/\| '([A-Z_]+)'/g)].map((m) => m[1]);
    assert.equal(codes.length, 4);
    for (const lang of ['en', 'bn']) {
      const dict = JSON.parse(read(`../client/src/locales/${lang}.json`)).pricing_conflicts;
      for (const code of codes) {
        assert.ok(dict[code.toLowerCase()], `${lang} ${code}`);
        assert.ok(dict[`${code.toLowerCase()}_fix`], `${lang} ${code} fix`);
      }
      for (const key of ['splits', 'group-buy']) assert.ok(dict.link[key], `${lang} link ${key}`);
    }
  });

  test('both pages get the settings on the other page that their rules need', () => {
    assert.ok(read('src/controllers/finance.controller.ts').includes('team_buying: teamSettings ?'));
    const overview = read('src/services/teamPurchase.service.ts');
    assert.ok(overview.includes('pricing: {') && overview.includes('loadMarkupPolicy(db)'));
  });
});
