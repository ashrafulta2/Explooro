import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { liveFlashDeals, flashStripEndsAt, flashEndsAtMs } from '../src/services/flashDeal.ts';

const root = path.resolve(import.meta.dirname, '..');
const flashWidgetSrc = fs.readFileSync(path.resolve(root, 'src/components/product/FlashSaleWidget.ts'), 'utf8');
const homeSrc = fs.readFileSync(path.resolve(root, 'src/pages/HomePage.ts'), 'utf8');
const productsMockSrc = fs.readFileSync(path.resolve(root, 'src/mocks/handlers/products.ts'), 'utf8');
const cssSrc = fs.readFileSync(path.resolve(root, 'src/styles/components/product.css'), 'utf8');
const en = JSON.parse(fs.readFileSync(path.resolve(root, 'src/locales/en.json'), 'utf8'));
const bn = JSON.parse(fs.readFileSync(path.resolve(root, 'src/locales/bn.json'), 'utf8'));

test('FlashSaleWidget — onViewAll prop and click event wiring', () => {
  assert.ok(flashWidgetSrc.includes('onViewAll = null'), 'FlashSaleWidget must declare onViewAll parameter');
  assert.ok(flashWidgetSrc.includes('typeof onViewAll === \'function\''), 'FlashSaleWidget must check if onViewAll is a function');
  assert.ok(flashWidgetSrc.includes('onViewAll();'), 'FlashSaleWidget must invoke onViewAll() on click');
  assert.ok(flashWidgetSrc.includes('onNavigate(\'/?feed=flash\')'), 'FlashSaleWidget must maintain onNavigate fallback');
});

test('FlashSaleWidget — internationalization for View All Deals', () => {
  assert.ok(en.marketplace?.flash_sale?.view_all_deals, 'en.json must define marketplace.flash_sale.view_all_deals');
  assert.ok(bn.marketplace?.flash_sale?.view_all_deals, 'bn.json must define marketplace.flash_sale.view_all_deals');
  assert.equal(en.marketplace.flash_sale.view_all_deals, 'View All Deals');
  assert.equal(bn.marketplace.flash_sale.view_all_deals, 'সব অফার দেখুন');
});

test('HomePage.ts — FlashSaleWidget onViewAll wiring and smooth scroll', () => {
  assert.ok(homeSrc.includes('onViewAll: () => {'), 'HomePage must pass onViewAll callback to FlashSaleWidget');
  assert.ok(homeSrc.includes('syncFeed(\'flash\')'), 'onViewAll callback must synchronize feed to flash');
  assert.ok(homeSrc.includes('catalogSection?.scrollIntoView'), 'onViewAll callback must scroll catalogSection into view');
  assert.ok(homeSrc.includes("behavior: 'smooth'"), 'scrollIntoView must use smooth scrolling');
});

test('HomePage.ts — does not unmount FlashSaleWidget during grid rebuilds', () => {
  // rebuildGrid should not call unmountFlashWidget() as that causes layout flash and disrupts scroll
  const rebuildGridIdx = homeSrc.indexOf('function rebuildGrid() {');
  const nextFunctionIdx = homeSrc.indexOf('function handleAction(', rebuildGridIdx);
  const rebuildGridBody = homeSrc.slice(rebuildGridIdx, nextFunctionIdx);
  assert.ok(!rebuildGridBody.includes('unmountFlashWidget()'), 'rebuildGrid must not call unmountFlashWidget');
});

test('product.css — .home-catalog scroll margin top configuration', () => {
  assert.ok(cssSrc.includes('.home-catalog'), 'product.css must style .home-catalog');
  assert.ok(cssSrc.includes('scroll-margin-top: calc(var(--topbar-h, 56px) + var(--space-4));'), '.home-catalog must have scroll-margin-top to prevent topbar overlap');
});

test('Mock products handler — filters by flash_sale and supplier_tier', () => {
  assert.ok(productsMockSrc.includes('query.flash_sale'), 'Mock handler must inspect query.flash_sale');
  assert.ok(productsMockSrc.includes('is_flash_sale'), 'Mock handler must filter products by is_flash_sale');
  assert.ok(productsMockSrc.includes('query.supplier_tier'), 'Mock handler must support query.supplier_tier');
});

// ── Invariant: the home strip only ever shows real, live deals, counted down to a real end ───────
// It used to fall back to the first ten ordinary products with a forced SALE tag, count down a
// fixed four hours, and show booked ad units at an invented ৳999 → ৳799.

const NOW = Date.parse('2026-10-31T12:00:00Z');
const at = (h) => new Date(NOW + h * 3_600_000).toISOString();

test('liveFlashDeals — no flagged row means no deal, never a fallback', () => {
  const ordinary = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, price: '100.00', is_flash_sale: false }));
  assert.deepEqual(liveFlashDeals(ordinary, NOW), []);
  assert.deepEqual(liveFlashDeals([], NOW), []);
  assert.deepEqual(liveFlashDeals(null, NOW), []);
  // A truthy-but-not-true flag (string, 1) is not the server's boolean and is not promoted.
  assert.deepEqual(liveFlashDeals([{ id: 1, is_flash_sale: 'true' }, { id: 2, is_flash_sale: 1 }], NOW), []);
});

test('liveFlashDeals — keeps flagged live deals, drops ended ones and sponsored units', () => {
  const rows = [
    { id: 1, is_flash_sale: true, flash_ends_at: at(2) },
    { id: 2, is_flash_sale: false },
    { id: 3, is_flash_sale: true, flash_ends_at: at(-1) }, // already ended
    { id: 4, is_flash_sale: true, flash_ends_at: null },    // live per the server, no end time
    { id: 'ad_9', isSponsored: true, is_flash_sale: true, flash_ends_at: at(1) },
  ];
  assert.deepEqual(liveFlashDeals(rows, NOW).map((r) => r.id), [1, 4]);
  // Rows come back as given: nothing is rewritten onto them.
  assert.equal(liveFlashDeals(rows, NOW)[0], rows[0]);
});

test('flashStripEndsAt — the earliest real flash_ends_at among the deals, else null', () => {
  const deals = [
    { is_flash_sale: true, flash_ends_at: at(5) },
    { is_flash_sale: true, flash_ends_at: at(2) },
    { is_flash_sale: true, flash_ends_at: null },
    { is_flash_sale: true, flash_ends_at: 'not a date' },
  ];
  assert.equal(flashStripEndsAt(deals, NOW), NOW + 2 * 3_600_000);
  assert.equal(flashStripEndsAt([{ is_flash_sale: true, flash_ends_at: null }], NOW), null);
  assert.equal(flashStripEndsAt([], NOW), null);
  // An end already passed never becomes the target.
  assert.equal(flashStripEndsAt([{ flash_ends_at: at(-1) }, { flash_ends_at: at(3) }], NOW), NOW + 3 * 3_600_000);
  assert.equal(flashEndsAtMs({ flash_ends_at: NOW }), NOW);
});

test('FlashSaleWidget — no fallback, no forced flag, no invented countdown', () => {
  assert.ok(!/products\.slice\(0,\s*10\)/.test(flashWidgetSrc), 'must not fall back to the first ten products');
  assert.ok(!/is_flash_sale:\s*true/.test(flashWidgetSrc), 'must not force is_flash_sale on any card');
  assert.ok(!/4\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(flashWidgetSrc), 'must not default to a fixed 4-hour countdown');
  assert.ok(flashWidgetSrc.includes('liveFlashDeals(products)'), 'deals must come from liveFlashDeals');
  assert.ok(flashWidgetSrc.includes('flashStripEndsAt(deals)'), 'countdown must default to the earliest real flash_ends_at');
  assert.ok(flashWidgetSrc.includes('root.hidden = deals.length === 0'), 'no live deal renders the widget hidden');
});

test('HomePage.ts — no strip without a live deal, real end time, honest sponsored units', () => {
  const start = homeSrc.indexOf('// ── Flash sale widget (module-gated)');
  const end = homeSrc.indexOf('function unmountFlashWidget()', start);
  const block = homeSrc.slice(start, end);
  assert.ok(start > -1 && end > start, 'flash widget block not found');
  assert.ok(!/=\s*allProducts\s*\|\|\s*\[\]/.test(block), 'must not fall back to allProducts');
  assert.ok(!/4\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(block), 'must not pass a fixed 4-hour endsAt');
  assert.ok(!/endsAt:/.test(block), 'the widget derives the end from flash_ends_at; HomePage passes none');
  assert.ok(/if \(deals\.length === 0\) \{[\s\S]*?return;/.test(block), 'with no live deal the strip is not mounted');
  // Booked FLASH_STRIP units: labelled sponsored, no made-up prices, never flagged as a deal on their own.
  assert.ok(block.includes('isSponsored: true'), 'ad units must be marked sponsored');
  assert.ok(!/\bprice:\s*\d/.test(block) && !/special_price/.test(block), 'ad units must not carry invented prices');
  assert.ok(!/is_flash_sale:\s*true/.test(block), 'ad units must not be flagged as a flash sale by the page');
});

test('ProductCard — sponsored label is translated and a priceless card prints no price', () => {
  const cardSrc = fs.readFileSync(path.resolve(root, 'src/components/product/ProductCard.ts'), 'utf8');
  assert.ok(cardSrc.includes("t('ads.sponsored')"), 'the Sponsored badge must be translated');
  assert.ok(!cardSrc.includes("textContent = 'Sponsored'"), 'no hardcoded Sponsored label');
  assert.ok(en.ads?.sponsored && bn.ads?.sponsored, 'ads.sponsored must exist in both locales');
  assert.ok(cardSrc.includes("const hasPrice = product.price != null && product.price !== ''"), 'no ৳0 for a card without a price');
});
