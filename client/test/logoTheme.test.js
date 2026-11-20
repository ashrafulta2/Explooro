/**
 * logoTheme.test.js — the brand mark and the favicon follow the theme, and stay legible doing it.
 *
 * WHY (owner, 2026-11-20): the mark was locked to gold on 2026-08-26, so after a re-theme it was the
 * one thing on screen still in the old colour, and so was the browser tab's favicon. It now takes
 * its sparkle from the live brand ramp (services/logoMark.ts logoColorsFromPalette), set as
 * --logo-* properties and a re-drawn favicon by services/logoTheme.ts.
 *
 *   1. On every preset the white sparkle keeps 3:1 against its brand badge (WCAG 1.4.11, a graphic).
 *   2. The badge is the theme's colour (owner, 2026-11-20: the dark badge clashed with a blue sparkle).
 *   3. The live mark reads the --logo-* properties (white on --brand as the pre-theme fallback),
 *      and a var() stop is written as a style, since an SVG presentation attribute takes no var().
 *   4. The static favicon scripts/logo.mjs bakes is the picture the runtime draws for the shipped
 *      default, so the tab does not change colour when the theme loads.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generatePalette, contrastRatio, DEFAULT_MASTER } from '../src/services/colorRamp.ts';
import { MASTER_PRESETS, DEFAULT_MASTER_PRESET } from '../src/config/master-themes.ts';
import { logoColorsFromPalette, buildLogoMarkSvg, LOGO_STAR_MIN_CONTRAST } from '../src/services/logoMark.ts';
import { faviconHrefFor } from '../src/services/logoTheme.ts';
import { getExplooroLogoSvg } from '../src/components/ui/icons.ts';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('on every preset the white sparkle keeps 3:1 against the brand badge', () => {
  for (const [key, preset] of Object.entries(MASTER_PRESETS)) {
    const { bg, hole, stops } = logoColorsFromPalette(generatePalette(preset.master));
    assert.equal(hole, bg, `${key}: the hole is punched through to the badge`);
    for (const stop of stops) {
      const ratio = contrastRatio(stop.color, bg);
      assert.ok(ratio >= LOGO_STAR_MIN_CONTRAST, `${key}: ${stop.color} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('the badge is the theme colour: the seed step when white reads on it, else a deeper step', () => {
  const blue = generatePalette(MASTER_PRESETS.macos_native.master);
  const gold = generatePalette(MASTER_PRESETS.pure_gold.master);
  const bgOf = (p) => logoColorsFromPalette(p).bg;
  assert.notEqual(bgOf(blue), bgOf(gold));
  assert.equal(bgOf(blue), blue.brand[blue.meta.anchorStep]);
  assert.ok(Object.values(gold.brand).includes(bgOf(gold)), 'a light seed still gets a shade of its own ramp');
  assert.notEqual(bgOf(gold), gold.brand[gold.meta.anchorStep]);
});

test('the live mark reads the --logo-* properties, as styles', () => {
  const svg = getExplooroLogoSvg({ size: 28 });
  for (const i of [1, 2, 3]) assert.match(svg, new RegExp(`style="stop-color: var\\(--logo-star, var\\(--logo-star-${i}, #`));
  assert.match(svg, /fill="var\(--logo-bg, var\(--brand\)\)"/);
  assert.doesNotMatch(svg, /stop-color="var\(/, 'an SVG attribute ignores var(): the sparkle would render black');
});

test('the static favicon is the runtime favicon of the shipped default', () => {
  assert.equal(DEFAULT_MASTER.seed, MASTER_PRESETS[DEFAULT_MASTER_PRESET].master.seed);
  const shipped = readFileSync(join(CLIENT, 'public', 'favicon.svg'), 'utf8').trim();
  const palette = generatePalette(MASTER_PRESETS[DEFAULT_MASTER_PRESET].master);
  assert.equal(shipped, buildLogoMarkSvg({ size: 32, ...logoColorsFromPalette(palette) }).trim(), 'run: node scripts/logo.mjs --write');
  assert.equal(decodeURIComponent(faviconHrefFor(palette).replace('data:image/svg+xml,', '')).trim(), shipped);
});

test('no home slide paints its CTA with the brand fill', () => {
  // A brand-filled button on a coloured slide clashes whenever the theme's hue is far from the
  // slide's (blue on burnt orange under macOS Native). Every slide CTA is white on its own slide.
  const css = readFileSync(join(CLIENT, 'src', 'styles', 'components', 'home-top.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\.home-top__slide--\w+[^,]*\.home-top__slide-cta/.test(m[1])) {
      assert.doesNotMatch(m[2], /background[^;]*var\(--brand/, m[1].trim());
    }
  }
});
