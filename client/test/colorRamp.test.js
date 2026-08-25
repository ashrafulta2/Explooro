/**
 * colorRamp.test.js — invariants of the Master Colour engine.
 *
 * The engine's whole promise is that ANY seed an admin can pick in the Theme Studio produces a
 * palette that is (a) internally ordered, (b) WCAG AA clean on every pairing the studio validates,
 * and (c) still a working dark theme. Those are properties of the generator, not of one palette,
 * so they are asserted across a spread of seeds — vivid, muted, warm, cool, near-black,
 * near-white — rather than by pinning expected hexes.
 *
 * Runs on node:test; no test-runner dependency is added to the client.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generatePalette,
  contrastRatio,
  hexToOklch,
  oklchToHex,
  hexToRgb255,
  adjustForContrast,
  BRAND_STEPS,
  DEFAULT_MASTER,
} from '../src/services/colorRamp.js';

/** Spread chosen to cover each branch the generator can take, not to look pretty. */
const SEEDS = [
  '#eea1ce', // the shipped default — pastel, anchors mid-ladder
  '#1d4ed8', // vivid deep blue — anchors low, forces white button ink
  '#0f766e', // muted teal — chroma scale below 1
  '#f59e0b', // warm amber — anchors high, forces dark button ink
  '#7c3aed', // high-chroma violet — exercises gamut clipping
  '#be123c', // crimson — hue adjacent to the danger ramp
  '#334155', // near-monochrome slate
  '#808080', // exactly mid-grey — the achromatic + mid-lightness edge
  '#111111', // near-black, below the pin band
  '#f2f2f2', // near-white, above the pin band
  '#00ff88', // out-of-ladder neon, chroma scale clamps
];

const VARIANTS = [
  { neutralMode: 'cool', statusPull: 0 },
  { neutralMode: 'match', neutralTint: 1.5, statusPull: 0.5 },
  { neutralMode: 'complement', neutralTint: 2.5, statusPull: 1 },
  { neutralMode: 'match', surfaceWash: false, borderTint: false, vividness: 1.8 },
];

const configs = SEEDS.flatMap((seed) => VARIANTS.map((v) => ({ seed, ...v })));

test('sRGB <-> OKLCH round-trips within one 8-bit step', () => {
  for (const seed of SEEDS) {
    const { l, c, h } = hexToOklch(seed);
    const back = oklchToHex(l, c, h);
    const a = hexToRgb255(seed);
    const b = hexToRgb255(back);
    for (const ch of ['r', 'g', 'b']) {
      assert.ok(
        Math.abs(a[ch] - b[ch]) <= 1,
        `${seed} -> OKLCH -> ${back}: channel ${ch} drifted by ${Math.abs(a[ch] - b[ch])}`,
      );
    }
  }
});

test('the default seed reproduces the authored themes.css brand ramp', () => {
  // Guards the claim in colorRamp.js's header: swapping themes.css for the generator must not
  // change what ships today. Tolerance is 2/255 per channel — the ladder is authored in OKLCH and
  // themes.css also carries a hand-rounded hex fallback for each step.
  const expected = [
    '#fcf7f9', '#f9eef4', '#fce3f1', '#f9cee6', '#f4b8da', '#eea1ce',
    '#e58bc1', '#d372ad', '#bd5b98', '#9b467b', '#793861', '#592a47',
  ];
  const { brand } = generatePalette(DEFAULT_MASTER);
  BRAND_STEPS.forEach((step, i) => {
    const got = hexToRgb255(brand[step]);
    const want = hexToRgb255(expected[i]);
    for (const ch of ['r', 'g', 'b']) {
      assert.ok(
        Math.abs(got[ch] - want[ch]) <= 2,
        `brand-${step}: generated ${brand[step]}, themes.css authors ${expected[i]}`,
      );
    }
  });
});

test('brand ramp lightness is strictly descending for every seed', () => {
  for (const cfg of configs) {
    const { brand } = generatePalette(cfg);
    const ls = BRAND_STEPS.map((s) => hexToOklch(brand[s]).l);
    for (let i = 1; i < ls.length; i += 1) {
      assert.ok(
        ls[i] < ls[i - 1],
        `${JSON.stringify(cfg)}: brand-${BRAND_STEPS[i]} (${brand[BRAND_STEPS[i]]}) is not darker `
        + `than brand-${BRAND_STEPS[i - 1]} (${brand[BRAND_STEPS[i - 1]]})`,
      );
    }
  }
});

test('every pairing the Theme Studio validates clears WCAG AA', () => {
  for (const cfg of configs) {
    const p = generatePalette(cfg);
    const light = p.roles.light.__resolved;
    const label = JSON.stringify(cfg);

    const check = (name, fg, bg, min) => {
      const ratio = contrastRatio(fg, bg);
      assert.ok(ratio >= min, `${label}: ${name} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    };

    check('button label on brand fill', light.brandContrast, light.brand, 4.5);
    check('body text on page canvas', p.neutral[900], light.surface0, 4.5);
    check('body text on card', p.neutral[900], light.card, 4.5);
    check('secondary text on card', p.neutral[700], light.card, 3.5);
    check('navbar text on navbar', p.neutral[900], light.navbarBg, 4.5);
    check('footer text on footer', p.neutral[0], light.footerBg, 4.5);
    check('footer muted on footer', light.footerMuted, light.footerBg, 3);

    for (const status of ['success', 'warning', 'danger', 'info']) {
      check(`${status} badge (light)`, p[status][700], p[status][50], 4.5);
      check(`${status} badge (dark)`, p[status][300], p[status][800], 4.5);
    }
  }
});

test('input boundaries stay perceivable against the page canvas', () => {
  // themes.css §2 documents >=3:1 as the a11y floor for --border-interactive; the generator picks
  // the shallowest passing step rather than assuming brand-800 as the authored palette did.
  for (const cfg of configs) {
    const p = generatePalette(cfg);
    const roles = p.roles.light;
    const ref = roles['--border-interactive'];
    const match = /^var\(--(brand|neutral)-(\d+)\)$/.exec(ref);
    assert.ok(match, `${JSON.stringify(cfg)}: unexpected --border-interactive value ${ref}`);
    const hex = match[1] === 'brand' ? p.brand[match[2]] : p.neutral[match[2]];
    const ratio = contrastRatio(hex, roles.__resolved.surface0);
    assert.ok(
      ratio >= 3,
      `${JSON.stringify(cfg)}: --border-interactive ${hex} is ${ratio.toFixed(2)}:1 on the canvas`,
    );
  }
});

test('the dark theme stays a working theme, not a light one on a dark page', () => {
  for (const cfg of configs) {
    const p = generatePalette(cfg);
    const dark = p.roles.dark.__resolved;
    const light = p.roles.light.__resolved;
    const label = JSON.stringify(cfg);

    assert.notEqual(dark.surface0, light.surface0, `${label}: dark canvas equals the light canvas`);
    assert.ok(
      contrastRatio(dark.brand, dark.surface0) >= 4.5,
      `${label}: dark brand fill ${dark.brand} is only `
      + `${contrastRatio(dark.brand, dark.surface0).toFixed(2)}:1 on ${dark.surface0}`,
    );
    assert.ok(
      contrastRatio(p.neutral[100], dark.surface0) >= 4.5,
      `${label}: dark body text fails on the dark canvas`,
    );
  }
});

test('hover is a visible change, never a rounding difference', () => {
  for (const cfg of configs) {
    const { roles } = generatePalette(cfg);
    const { brand, brandHover } = roles.light.__resolved;
    assert.notEqual(brand, brandHover, `${JSON.stringify(cfg)}: hover fill equals the rest fill`);
    const delta = Math.abs(hexToOklch(brand).l - hexToOklch(brandHover).l);
    assert.ok(
      delta >= 0.01,
      `${JSON.stringify(cfg)}: hover differs by only ${delta.toFixed(4)} lightness`,
    );
  }
});

test('a malformed seed falls back rather than producing NaN colours', () => {
  for (const bad of ['', 'not-a-colour', '#12', null, undefined, 42]) {
    const p = generatePalette({ seed: bad });
    for (const step of BRAND_STEPS) {
      assert.match(p.brand[step], /^#[0-9a-f]{6}$/, `seed ${String(bad)} produced ${p.brand[step]}`);
    }
  }
});

test('adjustForContrast reaches the target or reports the best it could do', () => {
  const bg = '#ffffff';
  const repaired = adjustForContrast('#ffee00', bg, 4.5, 'darken');
  assert.ok(contrastRatio(repaired, bg) >= 4.5, `repaired to ${repaired}`);
  // Already-passing colours are returned untouched — no gratuitous drift.
  assert.equal(adjustForContrast('#000000', bg, 4.5), '#000000');
});
