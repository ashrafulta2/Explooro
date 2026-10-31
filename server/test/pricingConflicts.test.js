/**
 * pricingConflicts.test.js — the admin is warned when price and discount settings work against each
 * other (client/src/services/pricingConflicts.ts, owner request 2026-10-31).
 *
 * Invariants: every conflict the rules predict is what the server's own pricing really does (the
 * partner profit cap in pricing.service, the team price floor in teamPurchase.service), and no
 * conflict is reported where the server pays as set; each suggested fix really removes its conflict;
 * the case the owner hit (15% markup, 25% team discount) is reported; every message exists in both
 * languages; both admin pages get the settings the rules need. For one deal price, the split the rules
 * describe is the one checkout computes, and a flash sale under the supplier price is refused; a
 * platform-funded coupon is flagged exactly when it gives more than the platform keeps.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { findPricingConflicts, newConflicts, findDealPriceConflicts, findCouponConflicts, platformShareOfRetail } from '../../client/src/services/pricingConflicts.ts';
import { assertPartnerProfitFits, calculatePricingBreakdown } from '../src/services/pricing.service.ts';
import { createFlashSale } from '../src/services/flashSale.service.ts';
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
    const codes = [...src.matchAll(/^\s*\| '([A-Z_]+)'/gm)].map((m) => m[1]);
    assert.equal(codes.length, 9);
    for (const lang of ['en', 'bn']) {
      const dict = JSON.parse(read(`../client/src/locales/${lang}.json`)).pricing_conflicts;
      for (const code of codes) {
        assert.ok(dict[code.toLowerCase()], `${lang} ${code}`);
        assert.ok(dict[`${code.toLowerCase()}_fix`], `${lang} ${code} fix`);
      }
      for (const key of ['splits', 'group-buy']) assert.ok(dict.link[key], `${lang} link ${key}`);
      assert.ok(dict.deal_below_floor_fix_no_room, `${lang} no-room fix`);
    }
  });

  test('both pages get the settings on the other page that their rules need', () => {
    assert.ok(read('src/controllers/finance.controller.ts').includes('team_buying: teamSettings ?'));
    const overview = read('src/services/teamPurchase.service.ts');
    assert.ok(overview.includes('const pricing = await loadPricingContext(db);'));
  });
});

describe('one deal price', () => {
  test('the split a deal is warned about is the split checkout computes', () => {
    for (const [supplier, partnerProfit, retail] of [[1250, 65, 1440], [970, 53, 1120], [4800, 240, 5520], [500, 0, 580]]) {
      const floor = Math.round(supplier * 10) / 100;
      for (let price = supplier - 20; price < retail; price += 5) {
        const found = findDealPriceConflicts({ price, supplierPrice: supplier, retailPrice: retail, partnerProfit, floorPct: 10 });
        if (price < supplier) {
          assert.throws(() => calculatePricingBreakdown({ baseCost: supplier, retailPrice: price, partnerProfit }), /wholesale cost/);
          assert.deepEqual(found.map((c) => c.code), ['DEAL_BELOW_SUPPLIER'], `${supplier} at ${price}`);
          continue;
        }
        const pricing = calculatePricingBreakdown({ baseCost: supplier, retailPrice: price, partnerProfit });
        if (pricing.platform_earning < floor) {
          assert.deepEqual(found.map((c) => c.code), ['DEAL_BELOW_FLOOR'], `${supplier} at ${price}`);
          assert.equal(found[0].params.platform, pricing.platform_earning);
          assert.equal(found[0].params.pool, pricing.saler_earning);
          if (found[0].fix === 'deal_below_floor_fix_no_room') {
            // Even the normal price leaves no room: the pool's profit plus the minimum reach retail.
            assert.ok(supplier + partnerProfit + floor >= retail, `${supplier} has room`);
          } else {
            assert.deepEqual(findDealPriceConflicts({ price: found[0].params.min_price, supplierPrice: supplier, retailPrice: retail, partnerProfit, floorPct: 10 }), [], 'the suggested price clears it');
          }
        } else {
          assert.deepEqual(found, [], `${supplier} at ${price}`);
        }
      }
    }
  });

  test('at the current settings a re-priced product has no room for any discount above the minimum', () => {
    // ৳1,250 → ৳1,440 with a ৳65 pool profit: 1250 + 65 + 125 = 1440, so every deal price undercuts it.
    const [c] = findDealPriceConflicts({ price: 1430, supplierPrice: 1250, retailPrice: 1440, partnerProfit: 65, floorPct: 10 });
    assert.equal(c.code, 'DEAL_BELOW_FLOOR');
    assert.equal(c.fix, 'deal_below_floor_fix_no_room');
  });

  test('a deal at or above the normal price is not a discount', () => {
    const found = findDealPriceConflicts({ price: 1440, supplierPrice: 1250, retailPrice: 1440, partnerProfit: 65, floorPct: 10 });
    assert.deepEqual(found.map((c) => [c.code, c.severity]), [['DEAL_NOT_A_DISCOUNT', 'error']]);
  });

  test('the server refuses a flash sale under the supplier price', async () => {
    const db = {
      async query(sql) {
        if (sql.includes('FROM products WHERE id')) return { rows: [{ id: 1, title_en: 'P', title_bn: 'P', default_retail_price: '1440.00', stock_qty: 100, status: 'ACTIVE', supplier_price: '1250.00' }] };
        return { rows: [] };
      },
    };
    const admin = { id: 1, roles: ['super_admin'] };
    await assert.rejects(
      () => createFlashSale(db, admin, { product_id: 1, discount_price: 1200, allocated_qty: 1 }),
      (err) => err.code === 'VALIDATION_FAILED' && /supplier is paid/.test(err.message)
    );
  });
});

describe('a platform-funded coupon', () => {
  test('what the platform keeps of a sale matches the server split', async () => {
    for (const [m, f, s] of [[15, 10, 70], [40, 10, 70], [5, 10, 70], [30, 0, 50]]) {
      const retail = retailFromSupplierPrice(SUPPLIER, m, 0);
      const margin = retail - SUPPLIER;
      const max = await assertPartnerProfitFits(fakeDb(f, s), { baseCost: SUPPLIER, retailPrice: retail, partnerProfit: 0 });
      const partner = Math.min(Math.floor(margin * s) / 100, max);
      const expected = ((margin - partner) * 100) / retail;
      assert.ok(Math.abs(platformShareOfRetail(m, s, f) - expected) < 1e-6, `${m}/${f}/${s}`);
    }
  });

  test('flagged exactly when it gives more than the platform keeps, and the fix clears it', () => {
    const pol = policy(15, 10, 70);
    const pct = (v) => findCouponConflicts({ discount_type: 'PERCENT', discount_value: v, min_spend: 1000 }, pol);
    assert.equal(pct(10)[0].code, 'COUPON_PERCENT_ABOVE_SHARE');
    assert.equal(pct(10)[0].params.platform_pct, 8.6);
    assert.deepEqual(pct(8.6), []);
    // A cap on the amount brings a big percentage under the platform's share at the minimum spend.
    assert.deepEqual(findCouponConflicts({ discount_type: 'PERCENT', discount_value: 20, min_spend: 1000, max_discount: 80 }, pol), []);

    const fixed = findCouponConflicts({ discount_type: 'FIXED', discount_value: 100, min_spend: 1000 }, pol);
    assert.equal(fixed[0].code, 'COUPON_FIXED_ABOVE_SHARE');
    assert.deepEqual(findCouponConflicts({ discount_type: 'FIXED', discount_value: 100, min_spend: fixed[0].params.min_spend_needed }, pol), []);

    assert.deepEqual(findCouponConflicts({ discount_type: 'PERCENT', discount_value: 50, funded_by: 'SUPPLIER' }, pol), []);
    assert.deepEqual(findCouponConflicts({ discount_type: 'FREE_SHIPPING', discount_value: 1 }, pol), []);
  });

  test('the lowest markup in use decides', () => {
    // A 5% category keeps 5/105 = 4.8% of retail, below the default 40% markup's 12/140 = 8.6%.
    const pol = { ...policy(40, 10, 70), markup: { default_markup_pct: 40, categories: { 3: 5 } } };
    const [c] = findCouponConflicts({ discount_type: 'PERCENT', discount_value: 6, min_spend: 0 }, pol);
    assert.equal(c.params.markup, 5);
    assert.equal(c.params.platform_pct, 4.7);
    assert.deepEqual(findCouponConflicts({ discount_type: 'PERCENT', discount_value: 6, min_spend: 0 }, policy(40, 10, 70)), []);
  });
});

describe('the deal and coupon forms', () => {
  test('get the context their rules need', () => {
    const routes = read('src/routes/promotion.routes.ts');
    assert.ok(routes.includes("'/admin/growth/campaigns/flash-sales/price-context'"));
    assert.ok(routes.includes('promotionController.adminListCoupons'));
    assert.ok(read('src/controllers/promotion.controller.ts').includes('loadPricingContext(db)'));
    const page = read('../client/src/pages/admin/CampaignManagerPage.ts');
    assert.ok(page.includes('findDealPriceConflicts({') && page.includes('findCouponConflicts({'));
  });
});
