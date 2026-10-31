// Invariant: a product card's struck price, "% OFF" and "Claimed" bar come only from data.
// The card used to invent the struck price as price × 1.25 (a constant "20% OFF") and a Claimed
// share clamped to 35–95%. See client/src/services/flashDeal.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { flashDealView, liveFlashDeals, flashStripEndsAt } from '../src/services/flashDeal.ts';

const root = path.resolve(import.meta.dirname, '..');

test('a flash flag alone draws no struck price, no % OFF and no Claimed bar', () => {
  const v = flashDealView({ price: '3200.00', is_flash_sale: true });
  assert.deepEqual(v, { price: 3200, wasPrice: null, pctOff: null, claimedPct: null });
});

test('a live deal shows the deal price against the regular price', () => {
  const v = flashDealView({
    price: '3200.00', is_flash_sale: true, flash_discount_price: '2720.00',
    flash_allocated_qty: 40, flash_sold_qty: 10,
  });
  assert.equal(v.price, 2720);
  assert.equal(v.wasPrice, 3200);
  assert.equal(v.pctOff, 15);
  assert.equal(v.claimedPct, 25);
});

test('a deal price at or above the regular price is not shown as a saving', () => {
  const v = flashDealView({ price: 1000, is_flash_sale: true, flash_discount_price: 1000 });
  assert.equal(v.price, 1000);
  assert.equal(v.wasPrice, null);
  assert.equal(v.pctOff, null);
});

test('a deal price is ignored when the product is not in a flash sale', () => {
  const v = flashDealView({ price: 1000, is_flash_sale: false, flash_discount_price: 800 });
  assert.equal(v.price, 1000);
  assert.equal(v.wasPrice, null);
});

test('Claimed is the real sold / allocated share, 0 and 100 included', () => {
  assert.equal(flashDealView({ price: 10, is_flash_sale: true, flash_allocated_qty: 50, flash_sold_qty: 0 }).claimedPct, 0);
  assert.equal(flashDealView({ price: 10, is_flash_sale: true, flash_allocated_qty: 50, flash_sold_qty: 50 }).claimedPct, 100);
});

test('a caller-supplied real compare-at price still shows', () => {
  const v = flashDealView({ price: 900, original_price: 1200 });
  assert.equal(v.wasPrice, 1200);
  assert.equal(v.pctOff, 25);
});

test('no invented multiplier is left in the card or the flyer', () => {
  const card = fs.readFileSync(path.resolve(root, 'src/components/product/ProductCard.ts'), 'utf8');
  assert.ok(!/\*\s*1\.25/.test(card), 'ProductCard must not compute a struck price from price × 1.25');
  assert.ok(card.includes('flashDealView('), 'ProductCard must price its row through flashDealView');
  const flyer = fs.readFileSync(path.resolve(root, '../server/src/services/flyer.service.ts'), 'utf8');
  assert.ok(!/\*\s*1\.25/.test(flyer), 'the flyer must not invent a compare price');
  assert.ok(!flyer.includes('SAVE 20%'), 'the flyer must not print a fixed saving');
});

// ── Home flash strip ─────────────────────────────────────────────────────────

const NOW = Date.parse('2026-10-31T12:00:00Z');
const at = (h) => new Date(NOW + h * 3600_000).toISOString();

test('the strip shows only live deals: no ordinary, ended or sponsored rows', () => {
  const rows = [
    { ref: 'a', price: 100 },
    { ref: 'b', price: 100, is_flash_sale: true, flash_ends_at: at(2) },
    { ref: 'c', price: 100, is_flash_sale: true, flash_ends_at: at(-1) },
    { ref: 'd', price: 100, is_flash_sale: true },
    { ref: 'e', isSponsored: true, is_flash_sale: true },
  ];
  assert.deepEqual(liveFlashDeals(rows, NOW).map((p) => p.ref), ['b', 'd']);
  assert.deepEqual(liveFlashDeals([{ ref: 'x', price: 1 }], NOW), [], 'no deal means an empty strip, not the catalog');
});

test('the countdown runs to the earliest real deal end, or is absent', () => {
  const rows = [
    { is_flash_sale: true, flash_ends_at: at(5) },
    { is_flash_sale: true, flash_ends_at: at(2) },
    { is_flash_sale: true, flash_ends_at: at(-1) },
  ];
  assert.equal(flashStripEndsAt(rows, NOW), NOW + 2 * 3600_000);
  assert.equal(flashStripEndsAt([{ is_flash_sale: true }], NOW), null);
  assert.equal(flashStripEndsAt([], NOW), null);
});

test('no invented flash strip is left in the widget or the home page', () => {
  const widget = fs.readFileSync(path.resolve(root, 'src/components/product/FlashSaleWidget.ts'), 'utf8');
  const home = fs.readFileSync(path.resolve(root, 'src/pages/HomePage.ts'), 'utf8');
  for (const [name, src] of [['FlashSaleWidget', widget], ['HomePage', home]]) {
    assert.ok(!/4 \* 60 \* 60 \* 1000/.test(src), `${name} must not invent a 4-hour countdown`);
    assert.ok(!/is_flash_sale: true/.test(src), `${name} must not tag a product as a flash sale`);
  }
  assert.ok(!home.includes('flashList = allProducts'), 'HomePage must not fill the strip with the catalog');
  assert.ok(!/price: 999|special_price: 799/.test(home), 'a sponsored unit must not carry a made-up price');
});
