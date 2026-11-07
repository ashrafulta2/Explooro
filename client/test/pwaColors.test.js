/**
 * pwaColors.test.js — the colours the browser paints before any CSS loads come from the shipped
 * default theme, not from an older one.
 *
 * WHY: manifest.json (splash background, install title bar), the <meta name="theme-color"> in
 * index.html, the pre-CSS body fallbacks and offline.html all hold literal hex values, because none
 * of them can read a CSS custom property. They stayed Midnight Slate (#485b75) after the default
 * preset became Explooro Gold, so the Android splash and browser toolbar were slate while the app
 * was gold. This derives the expected values from the same Master Colour engine as themes.css.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generatePalette } from '../src/services/colorRamp.ts';
import { MASTER_PRESETS, DEFAULT_MASTER_PRESET } from '../src/config/master-themes.ts';
import { syncPwaColors } from '../../scripts/pwaColors.mjs';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(CLIENT, ...p), 'utf8');

const palette = generatePalette(MASTER_PRESETS[DEFAULT_MASTER_PRESET].master);
const brand = palette.brand[palette.meta.anchorStep]; // what `--brand` paints
const { neutral } = palette;
const manifest = JSON.parse(read('public', 'manifest.json'));
const indexHtml = read('index.html');
const offline = read('public', 'offline.html');

describe('PWA colours follow the default theme', () => {
  test('manifest theme_color is the brand colour and background_color the page canvas (--surface-0)', () => {
    assert.equal(manifest.theme_color, brand);
    assert.equal(manifest.background_color, neutral[50]);
  });

  test('index.html theme-color meta equals the manifest theme_color', () => {
    assert.equal(/<meta name="theme-color" content="([^"]+)"/.exec(indexHtml)?.[1], manifest.theme_color);
  });

  test('index.html pre-CSS body colours are the light and dark page canvas and text', () => {
    assert.ok(indexHtml.includes(`background: ${neutral[50]};`), 'light canvas');
    assert.ok(indexHtml.includes(`color: ${neutral[900]};`), 'light text');
    assert.ok(indexHtml.includes(`body { background: ${neutral[950]}; color: ${neutral[100]}; }`), 'dark body');
  });

  test('offline.html and the index.html theme-color have no Midnight Slate or old cool-neutral colours left', () => {
    for (const stale of ['#485b75', '#fbfdfe', '#192026', '#0c1217', '#e1e5e8', '#eef1f5', '#64748b']) {
      assert.ok(!offline.toLowerCase().includes(stale), `offline.html still has ${stale}`);
    }
    // index.html keeps #fbfdfe in its dev-only error bar, so only the theme-color is checked there.
    assert.ok(!/theme-color" content="#485b75/.test(indexHtml), 'index.html theme-color is not Midnight Slate');
    assert.ok(offline.includes(`background: ${brand};`), 'primary button is the brand colour');
    assert.ok(offline.includes(`background: ${neutral[50]};`), 'page canvas');
  });
});

describe('scripts/pwaColors.mjs (run by scripts/logo.mjs)', () => {
  test('the committed files are already what the generator writes for the default theme', () => {
    assert.deepEqual(syncPwaColors(palette, CLIENT, { write: false }), [], 'run: node scripts/logo.mjs --write');
  });

  test('a re-seed rewrites all three files, and going back restores them byte for byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwa-colors-'));
    try {
      mkdirSync(join(dir, 'public'));
      const files = ['index.html', 'public/manifest.json', 'public/offline.html'];
      for (const file of files) copyFileSync(join(CLIENT, file), join(dir, file));

      const other = generatePalette(MASTER_PRESETS.cobalt_trust.master);
      assert.deepEqual(syncPwaColors(other, dir).sort(), [...files].sort());
      assert.equal(JSON.parse(readFileSync(join(dir, 'public', 'manifest.json'), 'utf8')).theme_color, other.brand[other.meta.anchorStep]);
      assert.deepEqual(syncPwaColors(other, dir), [], 'a second run changes nothing');

      syncPwaColors(palette, dir);
      for (const file of files) assert.equal(readFileSync(join(dir, file), 'utf8'), readFileSync(join(CLIENT, file), 'utf8'), file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
