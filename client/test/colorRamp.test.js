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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  generatePalette,
  contrastRatio,
  hexToOklch,
  oklchToHex,
  hexToRgb255,
  adjustForContrast,
  BRAND_STEPS,
  NEUTRAL_STEPS,
  DEFAULT_MASTER,
} from '../src/services/colorRamp.js';
import { MASTER_PRESETS, DEFAULT_MASTER_PRESET } from '../src/config/master-themes.js';

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

/* -------------------------------------------------------------------------
 * styles/themes.css is generated from DEFAULT_MASTER by scripts/palette.mjs. These two tests are
 * what make that claim enforceable: without them the CSS could be hand-edited, or the seed changed
 * without re-running the generator, and the only symptom would be a colour flash on cold load that
 * nobody thinks to look for.
 * ---------------------------------------------------------------------- */

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'themes.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ''); // comments carry example values; only declarations count

/** The body of the first `<selector> {` block at or after `from`, brace-matched. */
function block(selector, from = 0) {
  const at = CSS.indexOf(`${selector} {`, from);
  assert.ok(at >= 0, `themes.css has no "${selector}" block after index ${from}`);
  const open = CSS.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: CSS.slice(open + 1, i), end: i };
    }
  }
  throw new Error(`themes.css: unterminated "${selector}" block`);
}

function declarations(body) {
  const out = {};
  for (const [, prop, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[prop] = value.trim();
  }
  return out;
}

test('styles/themes.css is exactly what the engine generates for DEFAULT_MASTER', () => {
  const palette = generatePalette(DEFAULT_MASTER);
  const ramps = [
    ['brand', BRAND_STEPS],
    ['neutral', NEUTRAL_STEPS],
    ...['success', 'warning', 'danger', 'info'].map((n) => [n, [50, 100, 300, 500, 700, 800]]),
    ['accent', [50, 100, 200, 300, 400, 500, 600, 700]],
  ];

  // Layer 1a — the hex fallback ramps.
  const hexes = declarations(block(':root').body);
  for (const [name, steps] of ramps) {
    for (const step of steps) {
      assert.equal(
        hexes[`--${name}-${step}`],
        palette[name][step],
        `themes.css --${name}-${step} is stale; re-run \`node scripts/palette.mjs --write\``,
      );
    }
  }

  // Layer 1b — the OKLCH override must be the SAME pixel as the fallback above it, not merely a
  // near-miss. A hand-rounded triplet that renders one 8-bit step off is the classic drift here.
  const oklch = declarations(block(':root', CSS.indexOf('@supports')).body);
  for (const [name, steps] of ramps) {
    for (const step of steps) {
      const m = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(oklch[`--${name}-${step}`] || '');
      assert.ok(m, `themes.css --${name}-${step} has no OKLCH override`);
      assert.equal(
        oklchToHex(Number(m[1]) / 100, Number(m[2]), Number(m[3])),
        palette[name][step],
        `themes.css --${name}-${step}: the OKLCH value and its hex fallback are different colours`,
      );
    }
  }

  // Layer 2 — the four semantic blocks, in the order that makes an explicit toggle outrank the OS.
  const sectionTwo = CSS.indexOf('@supports');
  const afterSupports = block(':root', sectionTwo).end;
  const blocks = [
    [':root', palette.roles.light],
    [":root:not([data-theme='light'])", palette.roles.dark],
    [":root[data-theme='dark']", palette.roles.dark],
    [":root[data-theme='light']", palette.roles.light],
  ];
  let cursor = afterSupports;
  for (const [selector, roleMap] of blocks) {
    const found = block(selector, cursor);
    cursor = found.end;
    const got = declarations(found.body);
    const want = Object.fromEntries(
      Object.entries(roleMap).filter(([prop]) => prop.startsWith('--')),
    );
    assert.deepEqual(
      got,
      want,
      `themes.css "${selector}" does not match the generated ${roleMap === palette.roles.dark ? 'dark' : 'light'} roles`,
    );
  }
});

test('the shipped CSS, the engine default and the default preset are one colour', () => {
  // Three places name the shipped default: DEFAULT_MASTER (which themes.css is generated from),
  // and the preset DEFAULT_MASTER_PRESET points at (which initTheme() mounts a beat later). If
  // they disagree the product visibly changes colour partway through boot.
  const preset = MASTER_PRESETS[DEFAULT_MASTER_PRESET];
  assert.ok(preset, `master-themes.js has no preset "${DEFAULT_MASTER_PRESET}"`);
  assert.deepEqual(
    preset.master,
    DEFAULT_MASTER,
    `preset "${DEFAULT_MASTER_PRESET}" and colorRamp.js's DEFAULT_MASTER describe different palettes`,
  );
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

    // The flash strip is the one surface whose ink CANNOT be fixed at neutral-900: statusPull
    // leans the danger ramp toward the seed, so its luminance moves with the theme. The chip is
    // checked against the strip's own ink because the countdown digits inherit it.
    check('flash strip ink on strip', light.flash.text, light.flash.bg, 4.5);
    check('countdown digits on chip', light.flash.text, light.flash.chipBg, 4.5);
    check('flash tag ink on tag', light.flash.tagText, light.flash.tagBg, 4.5);
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
    assert.ok(
      contrastRatio(dark.flash.text, dark.flash.bg) >= 4.5,
      `${label}: dark flash strip ink ${dark.flash.text} fails on ${dark.flash.bg}`,
    );
    assert.ok(
      contrastRatio(dark.flash.text, dark.flash.chipBg) >= 4.5,
      `${label}: dark countdown digits fail on the chip`,
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
