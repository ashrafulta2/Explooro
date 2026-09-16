import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const homeSrc = fs.readFileSync(path.resolve(root, 'src/pages/HomePage.js'), 'utf8');
const cssSrc = fs.readFileSync(path.resolve(root, 'src/styles/components/product.css'), 'utf8');
const en = JSON.parse(fs.readFileSync(path.resolve(root, 'src/locales/en.json'), 'utf8'));
const bn = JSON.parse(fs.readFileSync(path.resolve(root, 'src/locales/bn.json'), 'utf8'));

test('Floating Browse & Filter bar — elements & structure in HomePage.js', () => {
  assert.ok(homeSrc.includes('home-floating-bar'), 'HomePage must contain home-floating-bar');
  assert.ok(homeSrc.includes('home-floating-bar__toggle'), 'HomePage must contain floating toggle');
  assert.ok(homeSrc.includes('home-floating-bar__toggle-icon'), 'Floating toggle must contain filter icon');
  assert.ok(homeSrc.includes('home-floating-bar__toggle-chevron'), 'Floating toggle must contain chevron');
  assert.ok(homeSrc.includes('home-floating-bar__toggle-badge'), 'Floating toggle must contain active badge');
  assert.ok(homeSrc.includes('home-floating-bar__toggle-active'), 'Floating toggle must contain active category chip');
});

test('Floating Toolbar — features & controls in HomePage.js', () => {
  assert.ok(homeSrc.includes('home-floating-toolbar'), 'HomePage must contain home-floating-toolbar');
  assert.ok(homeSrc.includes('home-floating-toolbar__feeds'), 'Toolbar must contain feeds row');
  assert.ok(homeSrc.includes('home-floating-toolbar__search'), 'Toolbar must contain search form');
  assert.ok(homeSrc.includes('home-floating-toolbar__sort'), 'Toolbar must contain sort dropdown');
  assert.ok(homeSrc.includes('home-floating-toolbar__filter-btn'), 'Toolbar must contain filter trigger button');
  assert.ok(homeSrc.includes('home-floating-toolbar__clear-btn'), 'Toolbar must contain clear-all button');

  // Verify sort options exist
  assert.ok(homeSrc.includes('price_asc'), 'Sort dropdown must support price_asc');
  assert.ok(homeSrc.includes('price_desc'), 'Sort dropdown must support price_desc');
  assert.ok(homeSrc.includes('rating'), 'Sort dropdown must support rating');
  assert.ok(homeSrc.includes('newest'), 'Sort dropdown must support newest');
});

test('Floating Toolbar — dragging & positioning mechanics in HomePage.js', () => {
  assert.ok(homeSrc.includes('pointerdown'), 'Toggle must handle pointerdown for drag');
  assert.ok(homeSrc.includes('pointermove'), 'Window must handle pointermove for drag');
  assert.ok(homeSrc.includes('pointerup'), 'Window must handle pointerup for drag');
  assert.ok(homeSrc.includes('DRAG_THRESHOLD'), 'Must use drag threshold to distinguish clicks from drags');
  assert.ok(homeSrc.includes('positionFloatingToolbar'), 'Must reposition dropdown relative to dragged pill');
});

test('Floating Toolbar — styling exists in product.css', () => {
  assert.ok(cssSrc.includes('.home-floating-bar'), 'product.css must define .home-floating-bar');
  assert.ok(cssSrc.includes('.home-floating-bar__toggle'), 'product.css must define .home-floating-bar__toggle');
  assert.ok(cssSrc.includes('.home-floating-toolbar'), 'product.css must define .home-floating-toolbar');
});

test('Floating Toolbar — locale strings exist in en.json and bn.json', () => {
  const keys = ['sort_featured', 'sort_price_asc', 'sort_price_desc', 'sort_rating', 'sort_newest', 'clear_all'];
  for (const k of keys) {
    assert.ok(en.marketplace[k], `en.json must have marketplace.${k}`);
    assert.ok(bn.marketplace[k], `bn.json must have marketplace.${k}`);
  }
});