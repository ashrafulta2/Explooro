import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const flashWidgetSrc = fs.readFileSync(path.resolve(root, 'src/components/product/FlashSaleWidget.js'), 'utf8');
const homeSrc = fs.readFileSync(path.resolve(root, 'src/pages/HomePage.js'), 'utf8');
const productsMockSrc = fs.readFileSync(path.resolve(root, 'src/mocks/handlers/products.js'), 'utf8');
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

test('HomePage.js — FlashSaleWidget onViewAll wiring and smooth scroll', () => {
  assert.ok(homeSrc.includes('onViewAll: () => {'), 'HomePage must pass onViewAll callback to FlashSaleWidget');
  assert.ok(homeSrc.includes('syncFeed(\'flash\')'), 'onViewAll callback must synchronize feed to flash');
  assert.ok(homeSrc.includes('catalogSection?.scrollIntoView'), 'onViewAll callback must scroll catalogSection into view');
  assert.ok(homeSrc.includes("behavior: 'smooth'"), 'scrollIntoView must use smooth scrolling');
});

test('HomePage.js — does not unmount FlashSaleWidget during grid rebuilds', () => {
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
