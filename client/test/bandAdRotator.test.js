/**
 * bandAdRotator.test.js — a home band panel takes turns with its ads (migration 111).
 *
 * The panel holds the viewer's own work, so it must come first and come back between every two ads:
 * an ad may borrow the space, never keep it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { playOrder, PANEL_MS, AD_MS, START_OFFSET_MS } from '../src/components/home/BandAdRotator.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const locale = (lang) => JSON.parse(readFileSync(join(root, `locales/${lang}.json`), 'utf8'));

test('with no ads the panel shows alone', () => {
  assert.deepEqual(playOrder(0), [-1]);
});

test('the panel comes first and returns between every two ads', () => {
  assert.deepEqual(playOrder(1), [-1, 0]);
  assert.deepEqual(playOrder(3), [-1, 0, -1, 1, -1, 2]);
  for (let n = 1; n <= 5; n += 1) {
    const order = playOrder(n);
    assert.equal(order[0], -1);
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i] === -1 || order[i - 1] === -1, `two ads in a row in ${order}`);
    }
    for (let ad = 0; ad < n; ad += 1) assert.equal(order.filter((x) => x === ad).length, 1, `ad ${ad} shown once per cycle`);
  }
});

test('the panel holds the space longer than an ad, and the panels never flip together', () => {
  assert.ok(PANEL_MS > AD_MS);
  assert.equal(new Set(Object.values(START_OFFSET_MS)).size, 3);
});

test('every rotator string exists in both locales', () => {
  for (const lang of ['en', 'bn']) {
    const band = locale(lang).marketplace.top.band_ads;
    for (const key of ['dots_label', 'show_panel', 'show_ad']) assert.ok(band?.[key], `${lang}: marketplace.top.band_ads.${key}`);
  }
});
