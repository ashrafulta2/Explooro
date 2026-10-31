/**
 * retailMarkup.test.js — the platform sets the retail price from the supplier's price (owner decision
 * 2026-10-31).
 *
 * Invariants: retail = supplier price + markup, rounded UP to the step (never down, so the margin is
 * never smaller than the markup); a category override replaces the default; the client preview and
 * the server agree on every input; writes are strict and need a reason; product create/edit derive
 * retail from supplier_price; the shipped defaults are 15% markup and a 70/30 split.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as server from '../src/services/retailMarkup.service.ts';
import * as client from '../../client/src/services/retailMarkup.ts';

const read = (rel) => fs.readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');

describe('retail from supplier price', () => {
  test('15% on ৳1,000 is ৳1,150; a ৳999 price rounds up to the next ৳10', () => {
    assert.equal(server.retailFromSupplierPrice(1000, 15, 10), 1150);
    assert.equal(server.retailFromSupplierPrice(999, 15, 10), 1150);
    assert.equal(server.retailFromSupplierPrice(999, 15, 0), 1148.85);
    assert.equal(server.retailFromSupplierPrice('250.50', 0, 0), 250.5);
  });

  test('rounding never lands below the marked-up price', () => {
    for (let price = 1; price < 3000; price += 7.31) {
      const raw = Math.round(Math.round(price * 100) * 1.15) / 100;
      assert.ok(server.retailFromSupplierPrice(price, 15, 10) >= raw);
    }
  });

  test('the client preview matches the server on every input', () => {
    for (const price of [1, 9.99, 99.95, 333.33, 1000, 1234.56, 99999.99]) {
      for (const pct of [0, 5, 12.5, 15, 33.3, 100, 300]) {
        for (const round of [0, 1, 5, 10, 100]) {
          assert.equal(client.retailFromSupplierPrice(price, pct, round), server.retailFromSupplierPrice(price, pct, round), `${price} ${pct}% ${round}`);
        }
      }
    }
  });

  test('a category override replaces the default, on both sides', () => {
    const policy = { default_markup_pct: 15, round_to_bdt: 10, categories: { 7: 30 } };
    for (const impl of [server, client]) {
      assert.equal(impl.markupForCategory(policy, 7), 30);
      assert.equal(impl.markupForCategory(policy, '7'), 30);
      assert.equal(impl.markupForCategory(policy, 8), 15);
      assert.equal(impl.markupForCategory(policy, null), 15);
    }
  });
});

describe('policy storage', () => {
  const fakeDb = (setting, cats = []) => {
    const writes = [];
    return {
      writes,
      async query(sql, params) {
        writes.push({ sql, params });
        if (/FROM platform_settings/.test(sql)) return { rows: setting ? [{ value_json: setting }] : [] };
        if (/FROM category_markups/.test(sql)) return { rows: cats };
        if (/FROM categories/.test(sql)) return { rows: [{ id: params[0] }] };
        return { rows: [] };
      },
    };
  };

  test('a missing or out-of-range stored value reads as the shipped default', async () => {
    assert.deepEqual(await server.loadMarkupPolicy(fakeDb(null)), { default_markup_pct: 15, round_to_bdt: 10, categories: {} });
    const odd = await server.loadMarkupPolicy(fakeDb({ default_markup_pct: -4, round_to_bdt: 'x' }, [{ category_id: '3', markup_pct: '22.50' }]));
    assert.deepEqual(odd, { default_markup_pct: 15, round_to_bdt: 10, categories: { 3: 22.5 } });
  });

  test('writes are strict and need a reason', async () => {
    const db = fakeDb({ default_markup_pct: 15, round_to_bdt: 10 });
    await assert.rejects(server.saveDefaultMarkup(db, { defaultMarkupPct: 301, roundToBdt: 10, reason: 'x' }), /VALIDATION_FAILED|between/);
    await assert.rejects(server.saveDefaultMarkup(db, { defaultMarkupPct: 15, roundToBdt: 2.5, reason: 'x' }), /whole number/);
    await assert.rejects(server.saveDefaultMarkup(db, { defaultMarkupPct: 15, roundToBdt: 10, reason: ' ' }), /reason/);
    await assert.rejects(server.setCategoryMarkup(db, { categoryId: 3, markupPct: '', reason: 'x' }), /between/);
    const saved = await server.saveDefaultMarkup(db, { defaultMarkupPct: 20, roundToBdt: 5, reason: 'Eid pricing' });
    assert.deepEqual(saved, { default_markup_pct: 20, round_to_bdt: 5 });
  });

  test('the migration seeds 15% / ৳10, a bounded category table, and moves only a 40/60 split', () => {
    const sql = read('src/db/migrations/094_retail_markup.sql');
    assert.ok(sql.includes(`'{"default_markup_pct": 15, "round_to_bdt": 10}'`));
    assert.ok(sql.includes('CHECK (markup_pct >= 0 AND markup_pct <= 300)'), 'equal to MARKUP_LIMITS.markup_pct');
    assert.deepEqual(server.MARKUP_LIMITS.markup_pct, { min: 0, max: 300 });
    assert.ok(sql.includes(`'{"saler_split_pct": 70, "platform_split_pct": 30}'`));
    assert.ok(sql.includes(`(value_json->>'saler_split_pct')::numeric = 40`));
  });
});

describe('products take the supplier price', () => {
  const svc = read('src/services/product.service.ts');

  test('create and edit derive retail from supplier_price through quoteRetail', () => {
    assert.equal((svc.match(/await quoteRetail\(db, \{ supplierPrice, categoryId \}\)/g) || []).length, 2);
    assert.ok(svc.includes("const { media_ids: mediaIds, supplier_price: supplierPrice, ...fields } = rawFields;"));
  });

  test('re-pricing is an explicit, audited admin action', () => {
    const fn = svc.slice(svc.indexOf('export async function repriceProducts('));
    assert.ok(fn.slice(0, 2500).includes("action: 'catalog.product.reprice'"));
    assert.ok(fn.slice(0, 2500).includes('defaultPartnerProfit(tx'));
  });

  test('the supplier form sends only supplier_price', () => {
    const page = read('../client/src/pages/admin/CatalogProductsPage.ts');
    assert.ok(page.includes('supplier_price: supplierPrice,'));
    assert.ok(!page.includes('name="margin_pct"') && !page.includes('name="price"'));
    assert.ok(!/default_retail_price:|base_cost:/.test(page.slice(page.indexOf('const payload'))), 'no cost or retail sent by the form');
  });
});
