/**
 * logoTheme.test.js — the brand mark and the favicon follow the theme, and stay legible doing it.
 *
 * The mark is two linked rings (owner, 2026-11-20), both from the live brand ramp
 * (services/logoMark.ts logoColorsFromPalette), set as --logo-ring-* properties and a re-drawn
 * favicon by services/logoTheme.ts.
 *
 *   1. On every preset the first ring keeps 3:1 against the lightest surface (WCAG 1.4.11), and the
 *      second ring is a lighter step of the same ramp, so the pair reads as two rings.
 *   2. The rings are the theme's colour: the first ring is the seed's own step when that passes.
 *   3. The live mark reads the --logo-ring-* properties (with the shipped default as the pre-theme
 *      fallback), and a var() paint is written as a style, since an SVG attribute takes no var().
 *   4. The static favicon scripts/logo.mjs bakes is the picture the runtime draws for the shipped
 *      default, so the tab does not change colour when the theme loads.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generatePalette, contrastRatio, DEFAULT_MASTER, BRAND_STEPS } from '../src/services/colorRamp.ts';
import { MASTER_PRESETS, DEFAULT_MASTER_PRESET } from '../src/config/master-themes.ts';
import {
  logoColorsFromPalette,
  buildLogoMarkSvg,
  LOGO_RING_MIN_CONTRAST,
  LOGO_FALLBACK_COLORS,
} from '../src/services/logoMark.ts';
import { faviconHrefFor } from '../src/services/logoTheme.ts';
import { getExplooroLogoSvg } from '../src/components/ui/icons.ts';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('on every preset the first ring reads on the page and the second is a lighter step', () => {
  for (const [key, preset] of Object.entries(MASTER_PRESETS)) {
    const palette = generatePalette(preset.master);
    const { ring1, ring2, bg } = logoColorsFromPalette(palette);
    assert.equal(bg, palette.neutral[0], `${key}: the icon tile is the lightest surface`);
    const ratio = contrastRatio(ring1, bg);
    assert.ok(ratio >= LOGO_RING_MIN_CONTRAST, `${key}: ${ring1} on ${bg} is ${ratio.toFixed(2)}:1`);
    const stepOf = (c) => BRAND_STEPS.find((s) => palette.brand[s] === c);
    assert.ok(stepOf(ring2) < stepOf(ring1), `${key}: the second ring is a lighter step of the ramp`);
  }
});

test('the rings are the theme colour, not a fixed one', () => {
  const blue = generatePalette(MASTER_PRESETS.macos_native.master);
  const gold = generatePalette(MASTER_PRESETS.pure_gold.master);
  assert.notEqual(logoColorsFromPalette(blue).ring1, logoColorsFromPalette(gold).ring1);
  assert.equal(logoColorsFromPalette(blue).ring1, blue.brand[blue.meta.anchorStep]);
});

test('the live mark reads the --logo-ring-* properties, as styles', () => {
  const svg = getExplooroLogoSvg({ size: 28 });
  assert.match(svg, /style="stroke: var\(--logo-star, var\(--logo-ring-1, #/);
  assert.match(svg, /style="stroke: var\(--logo-ring-2, #/);
  assert.doesNotMatch(svg, /stroke="var\(/, 'an SVG attribute ignores var(): the ring would not paint');
});

test('the pre-theme fallback is the shipped default, so the mark does not change colour on load', () => {
  const { ring1, ring2, bg } = logoColorsFromPalette(generatePalette(MASTER_PRESETS[DEFAULT_MASTER_PRESET].master));
  assert.deepEqual(LOGO_FALLBACK_COLORS, { ring1, ring2, bg });
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
