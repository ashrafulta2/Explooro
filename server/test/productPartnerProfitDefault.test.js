/**
 * productPartnerProfitDefault.test.js — the product form no longer asks for a partner profit
 * (owner decision 2026-10-31), so the server derives it from the admin's split.
 *
 * Invariants: a create without one starts at saler_split_pct of the margin; a price edit without one
 * re-derives it from the new price; a title-only edit leaves it alone; one sent explicitly (public
 * API, older clients) is still checked and kept. Verified end to end on dev Postgres as well.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');
const svc = read('src/services/product.service.ts');

describe('partner profit follows the price', () => {
  test('one default, used by create and by a price edit', () => {
    assert.equal((svc.match(/async function defaultPartnerProfit\(/g) || []).length, 1);
    assert.ok(svc.includes('return defaultPartnerProfit(db, { baseCost, wholesaleMargin, defaultRetailPrice });'));
    assert.ok(svc.includes('fields.partner_profit = await defaultPartnerProfit(db, { baseCost, wholesaleMargin, defaultRetailPrice });'));
  });

  test('only a price field triggers it, and never over an explicit value', () => {
    assert.ok(svc.includes("const movesPrice = ['base_cost', 'wholesale_margin', 'default_retail_price'].some((k) => fields[k] !== undefined);"));
    assert.ok(svc.includes('if (movesPrice && fields.partner_profit === undefined) {'));
  });

  test('the default is the admin split, capped by the platform floor', () => {
    const fn = svc.slice(svc.indexOf('async function defaultPartnerProfit('));
    assert.ok(fn.slice(0, 900).includes('salerSplitPct'));
    assert.ok(fn.slice(0, 900).includes('Math.min(fromSplitPaisa, toPaisa(maxAllowed))'));
  });
});

describe('the product form', () => {
  test('sends no partner profit and shows the supplier payout instead', () => {
    const page = read('../client/src/pages/admin/CatalogProductsPage.ts');
    assert.ok(!page.includes('name="partner_profit"'));
    assert.ok(!/payload\.partner_profit|partner_profit:/.test(page));
    assert.equal((page.match(/<p class="catalog-form-payout" data-slot="payout"/g) || []).length, 2, 'both the add and the edit form');
  });
});
