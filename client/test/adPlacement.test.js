/**
 * adPlacement.test.js — paid cards inside a product grid stay sparse and never touch.
 *
 *   1. Search places its first ad first; the feed waits two cards.
 *   2. Two ads are never adjacent, even if the density is misconfigured to `every: 1`.
 *   3. No placement shows more than one ad per eight organic cards.
 *   4. Every string the ad card draws exists in both locales.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AD_DENSITY, adBefore } from '../src/components/ads/adPlacement.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const en = JSON.parse(readFileSync(join(root, 'locales/en.json'), 'utf8'));
const bn = JSON.parse(readFileSync(join(root, 'locales/bn.json'), 'utf8'));

/** The grid as drawn: 'A' for an ad slot, 'o' for an organic card. */
function layout(density, organic = 40) {
  const out = [];
  for (let i = 0; i < organic; i += 1) {
    if (adBefore(i, density) >= 0) out.push('A');
    out.push('o');
  }
  return out.join('');
}

test('search leads with an ad; the feed opens on two organic cards', () => {
  assert.equal(adBefore(0, AD_DENSITY.SEARCH_RESULTS), 0);
  assert.equal(layout(AD_DENSITY.FEED).slice(0, 3), 'ooA');
});

test('ads are numbered in order so each winner is shown once', () => {
  const d = AD_DENSITY.SEARCH_RESULTS;
  const picks = Array.from({ length: 40 }, (_, i) => adBefore(i, d)).filter((n) => n >= 0);
  assert.deepEqual(picks, picks.map((_, i) => i));
});

test('two ads are never adjacent, even with every: 1', () => {
  for (const d of [...Object.values(AD_DENSITY), { firstAt: 0, every: 1 }, { firstAt: 3, every: 0 }]) {
    assert.ok(!layout(d).includes('AA'), JSON.stringify(d));
  }
});

test('at most one ad per eight organic cards on every placement', () => {
  for (const [placement, d] of Object.entries(AD_DENSITY)) {
    assert.ok(d.every >= 8, `${placement} shows ads too often`);
  }
});

test('the ad card strings exist in both locales', () => {
  assert.equal(typeof en.ads.sponsored, 'string');
  assert.equal(typeof bn.ads.sponsored, 'string');
  assert.deepEqual(Object.keys(bn.ads.slot).sort(), Object.keys(en.ads.slot).sort());
  for (const v of Object.values(bn.ads.slot)) assert.ok(String(v).trim());
});

test('a sponsored card reads like the organic cards around it: same price format, same no-image tile', () => {
  const src = readFileSync(new URL('../src/components/ads/SponsoredSlot.ts', import.meta.url), 'utf8');
  assert.match(src, /formatCurrency\(/, 'price goes through formatCurrency');
  assert.doesNotMatch(src, /`৳\$\{/, 'no hand-built ৳ price');
  assert.match(src, /PLACEHOLDER_COLOURS/, 'no-image tile uses the organic card colours');
});
