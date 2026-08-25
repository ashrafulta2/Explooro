/**
 * scripts/palette.mjs — generates client/src/styles/themes.css, and measures it.
 *
 * Run:  node scripts/palette.mjs            print the ramps + every contrast pairing
 *       node scripts/palette.mjs --write    regenerate client/src/styles/themes.css
 *       node scripts/palette.mjs --markdown emit the §1/§2 tables for docs/design-system.md
 *
 * WHY this exists: every colour value and every contrast figure in the design system is GENERATED
 * and MEASURED here, never eyeballed. Eyeballing is how `brand-600` almost shipped as the primary
 * button colour at 4.07:1 — a real AA failure this script caught before any CSS was written.
 *
 * WHY it no longer authors its own ladder: it used to carry a second, hand-typed copy of every
 * OKLCH triplet, which meant "the palette" existed twice — here and in themes.css — with nothing
 * but discipline keeping them equal. Both are now derived from `DEFAULT_MASTER` in
 * client/src/services/colorRamp.js, the same engine the Theme Studio and the server run, so the
 * shipped CSS baseline and a freshly booted runtime theme cannot disagree. What stays local is the
 * MEASUREMENT: the WCAG and APCA implementations below are deliberately independent of the
 * engine's, so a bug in the engine's contrast maths cannot hide itself from this script.
 *
 * Zero dependencies, by the Dependency Policy in docs/prompt.md.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  generatePalette,
  hexToOklch,
  oklchToHex,
  DEFAULT_MASTER,
  BRAND_STEPS,
  NEUTRAL_STEPS,
} from '../client/src/services/colorRamp.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_CSS = join(ROOT, 'client', 'src', 'styles', 'themes.css');

const STATUS_NAMES = ['success', 'warning', 'danger', 'info'];
const STATUS_STEPS = [50, 100, 300, 500, 700, 800];
const ACCENT_STEPS = [50, 100, 200, 300, 400, 500, 600, 700];
const RAMPS = [
  ['brand', BRAND_STEPS],
  ['neutral', NEUTRAL_STEPS],
  ...STATUS_NAMES.map((n) => [n, STATUS_STEPS]),
  ['accent', ACCENT_STEPS],
];

const palette = generatePalette(DEFAULT_MASTER);

/* =========================================================================
 * 1. Contrast maths — independent of the engine's, on purpose (see header).
 * ======================================================================= */

function rgb01(hexStr) {
  const n = parseInt(hexStr.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function relLum({ r, g, b }) {
  const lin = (u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function wcag(hexA, hexB) {
  const [a, b] = [relLum(rgb01(hexA)), relLum(rgb01(hexB))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

// APCA 0.1.9 (W3 draft) — simplified bg/txt path. Reported alongside WCAG because WCAG 2 is known
// to misjudge mid-tone pairs; where the two disagree, investigate rather than trusting either.
function apca(txtHex, bgHex) {
  const txt = rgb01(txtHex);
  const bg = rgb01(bgHex);
  const Y = (c) => 0.2126729 * c.r ** 2.4 + 0.7151522 * c.g ** 2.4 + 0.072175 * c.b ** 2.4;
  const soft = (y) => (y > 0.022 ? y : y + (0.022 - y) ** 1.414);
  const Ytxt = soft(Y(txt));
  const Ybg = soft(Y(bg));
  let Lc;
  if (Ybg > Ytxt) {
    Lc = (Ybg ** 0.56 - Ytxt ** 0.57) * 1.14;
    Lc = Lc < 0.001 ? 0 : (Lc - 0.027) * 100;
  } else {
    Lc = (Ybg ** 0.65 - Ytxt ** 0.62) * 1.14;
    Lc = Lc > -0.001 ? 0 : (Lc + 0.027) * 100;
  }
  return Lc;
}

/* =========================================================================
 * 2. Resolving a semantic token back to a pixel
 * ======================================================================= */

/**
 * Follows a role's value down to a hex. WHY resolve rather than name steps directly: WHICH step
 * backs a role is a decision the engine makes per seed — the slate default anchors its brand at
 * 950, the pink one anchored at 500 — so a pairing list naming steps would quietly start measuring
 * the wrong pixels the moment the seed moved. That is exactly how this file drifted before.
 */
function resolve(roleMap, prop, depth = 0) {
  const value = roleMap[prop];
  if (!value || depth > 4) return null;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const ramp = /^var\(--([a-z]+)-(\d+)\)$/.exec(value);
  if (ramp && palette[ramp[1]]) return palette[ramp[1]][ramp[2]] || null;
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (alias) return resolve(roleMap, alias[1], depth + 1);
  return null; // hsl() triplets (shadow, scrim) are not contrast-checked
}

/* =========================================================================
 * 3. Pairings — named semantically, resolved per theme
 * ======================================================================= */

/** [label, foreground prop, background prop, minimum ratio]. */
const TEXT_PAIRS = [
  ['text-primary on surface-0', '--text-primary', '--surface-0', 4.5],
  ['text-primary on surface-2', '--text-primary', '--surface-2', 4.5],
  ['text-secondary on surface-0', '--text-secondary', '--surface-0', 4.5],
  ['text-muted on surface-0', '--text-muted', '--surface-0', 4.5],
  ['text-brand on surface-0', '--text-brand', '--surface-0', 4.5],
  ['brand-contrast on brand (button)', '--brand-contrast', '--brand', 4.5],
  ['brand-contrast on brand-hover', '--brand-contrast', '--brand-hover', 4.5],
  ['brand-alt-contrast on brand-alt', '--brand-alt-contrast', '--brand-alt', 4.5],
  ['navbar-text on navbar-bg', '--navbar-text', '--navbar-bg', 4.5],
  ['footer-text on footer-bg', '--footer-text', '--footer-bg', 4.5],
  ['footer-muted on footer-bg', '--footer-muted', '--footer-bg', 3],
  ['success text on success-bg', '--success', '--success-bg', 4.5],
  ['warning text on warning-bg', '--warning', '--warning-bg', 4.5],
  ['danger text on danger-bg', '--danger', '--danger-bg', 4.5],
  ['info text on info-bg', '--info', '--info-bg', 4.5],
  ['danger text on surface-0', '--danger', '--surface-0', 4.5],
  ['success text on surface-0', '--success', '--surface-0', 4.5],
  ['flash-text on flash-bg', '--flash-text', '--flash-bg', 4.5],
  ['flash-text on flash-chip-bg', '--flash-text', '--flash-chip-bg', 4.5],
  ['flash-tag-text on flash-tag-bg', '--flash-tag-text', '--flash-tag-bg', 4.5],
];

/** WCAG 1.4.11: a non-text boundary needs >= 3:1 to be perceivable. */
const UI_PAIRS = [
  ['border-interactive on surface-0', '--border-interactive', '--surface-0', 3],
  ['focus-ring on surface-0', '--focus-ring', '--surface-0', 3],
  ['brand fill on surface-0', '--brand', '--surface-0', 3],
];

/**
 * Decorative separators — reported, never gated. They may not be a sole interactive boundary.
 * The switch track is here rather than in UI_PAIRS because it is a KNOWN, accepted 1.4.11 miss
 * (design-system.md §2): a switch conveys its boundary with a --border-interactive outline, not
 * with track fill, and darkening the track to pass would make "off" look like "on".
 */
const DECORATIVE = [
  ['border-subtle on surface-0', '--border-subtle', '--surface-0'],
  ['border-strong on surface-0', '--border-strong', '--surface-0'],
  ['switch track off on surface-0', '--surface-3', '--surface-0'],
];

function measure(roleMap, pairs) {
  return pairs.flatMap(([label, fgProp, bgProp, min]) => {
    const fg = resolve(roleMap, fgProp);
    const bg = resolve(roleMap, bgProp);
    if (!fg || !bg) return [];
    return [{ label, fg, bg, min, ratio: wcag(fg, bg), lc: apca(fg, bg) }];
  });
}

/* =========================================================================
 * 4. themes.css emission
 * ======================================================================= */

/**
 * The OKLCH override layer. Precision is not a style choice: it is raised until the triplet
 * re-renders to the exact hex written in the fallback layer above it, so the two representations
 * are provably the same pixel rather than the same pixel by convention. Hex fallback and OKLCH
 * value quietly disagreeing after someone hand-edits one is the drift this file used to warn
 * about in prose; it is now ruled out by construction.
 */
function oklchFor(hexValue) {
  const o = hexToOklch(hexValue);
  for (const [pl, pc, ph] of [[2, 4, 2], [3, 5, 3], [4, 6, 4]]) {
    const L = Number((o.l * 100).toFixed(pl));
    const C = Number(o.c.toFixed(pc));
    const H = Number(o.h.toFixed(ph));
    if (oklchToHex(L / 100, C, H) === hexValue) return `oklch(${L}% ${C} ${H})`;
  }
  throw new Error(`${hexValue}: no OKLCH precision reproduces it exactly`);
}

function rampBlock(fmt, indent) {
  return RAMPS.map(([name, steps]) => steps
    .map((s) => `${indent}--${name}-${s}: ${fmt(palette[name][s])};`)
    .join('\n')).join('\n\n');
}

function roleBlock(roleMap, indent) {
  const out = [];
  const group = (heading, props) => {
    const lines = props
      .filter((p) => roleMap[p] !== undefined)
      .map((p) => `${indent}${p}: ${roleMap[p]};`);
    if (lines.length) out.push(`${indent}/* ${heading} */\n${lines.join('\n')}`);
  };
  group('Surfaces (elevation ladder) — dark mode LIGHTENS as elevation rises, never darkens', ['--surface-0', '--surface-1', '--surface-2', '--surface-3']);
  group('Borders — subtle/strong are decorative; interactive is the a11y-gated one', ['--border-subtle', '--border-strong', '--border-interactive', '--border-default']);
  group('Text', ['--text-primary', '--text-secondary', '--text-muted', '--text-inverse']);
  group('Brand', ['--brand', '--brand-hover', '--brand-active', '--brand-contrast', '--text-brand', '--brand-alt', '--brand-alt-contrast']);
  group('Status triads', STATUS_NAMES.flatMap((n) => [`--${n}`, `--${n}-bg`, `--${n}-border`]));
  group('Flash sale / campaign strip — countdown digits inherit --flash-text', ['--flash-bg', '--flash-text', '--flash-chip-bg', '--flash-tag-bg', '--flash-tag-text']);
  group('Chrome', ['--navbar-bg', '--navbar-text', '--navbar-border', '--navbar-search-bg', '--footer-bg', '--footer-text', '--footer-muted', '--footer-border']);
  group('Focus, shadow, scrim — shadow-color is an HSL triplet, consumed as hsl(var(--shadow-color) / a)', ['--focus-ring', '--shadow-color', '--scrim']);
  return out.join('\n\n');
}

function ratioNote(roleMap, prop, againstProp) {
  const fg = resolve(roleMap, prop);
  const bg = resolve(roleMap, againstProp);
  return fg && bg ? `${wcag(fg, bg).toFixed(2)}:1` : 'n/a';
}

function themesCss() {
  const { meta, config } = palette;
  const light = palette.roles.light;
  const dark = palette.roles.dark;

  return `/**
 * Explooro — Design Tokens: colour.
 *
 * GENERATED FILE. Do not hand-edit — run \`node scripts/palette.mjs --write\`.
 *
 * Every value below is the output of the Master Colour engine
 * (client/src/services/colorRamp.js) fed the shipped default seed. That is the same engine the
 * Theme Studio previews with and the same one the server re-derives and validates against, so this
 * baseline and a freshly booted runtime theme are the same palette rather than two palettes that
 * happen to look alike. WHY that matters: this file paints during the frames BEFORE main.js runs
 * \`initTheme()\`. While it was authored by hand against a different seed, every cold load flashed
 * the old colour and then swapped.
 *
 * To change the colour the product ships with, change \`DEFAULT_MASTER\` in colorRamp.js (and the
 * matching preset in config/master-themes.js — client/test/colorRamp.test.js asserts the two
 * agree), then re-run the command above. Hand-editing a step here is the one thing that CAN put
 * this file out of step with the engine, and that same test fails if you do.
 *
 *   seed          ${config.seed} (hue ${meta.seedHue})
 *   brand anchor  step ${meta.anchorStep}, chroma scale ${meta.chromaScale}
 *   neutral hue   ${meta.neutralHue} (${config.neutralMode})
 *   accent hue    ${meta.accentHue} (${config.accentHarmony})
 *   surface wash  ${config.surfaceWash ? 'on' : 'off'}, border tint ${config.borderTint ? 'on' : 'off'}
 *
 * Two layers:
 *   1. Raw ramps — brand / neutral / success / warning / danger / info / accent. Theme-independent:
 *      a ramp step is the same colour in light and dark mode. Emitted as hex, then overridden in
 *      OKLCH for engines that support it — the same pixel at sub-8-bit precision, at a precision
 *      the generator verifies round-trips exactly rather than assumes.
 *   2. Semantic tokens — surface/text/border/brand/status roles. THEME-dependent: which ramp step
 *      backs "surface-0" flips between light and dark. Emitted four times (base / OS-dark /
 *      explicit-dark / explicit-light) so an explicit \`data-theme\` toggle always outranks the OS
 *      preference — the same block order services/masterTheme.js mounts at runtime.
 */

/* =========================================================================
 * 1. Raw ramps — hex fallback first, OKLCH override for engines that support it.
 * ======================================================================= */

:root {
${rampBlock((h) => h, '  ')}
}

@supports (color: oklch(0 0 0)) {
  :root {
${rampBlock(oklchFor, '    ')}
  }
}

/* =========================================================================
 * 2. Semantic tokens — theme-dependent. Components reference ONLY these.
 * ======================================================================= */

/* ---- Light (default) ---------------------------------------------------
   What the engine resolved for this seed, and the measurement behind each choice:
     --brand              ${light['--brand']} with ${light['--brand-contrast']} ink — ${ratioNote(light, '--brand-contrast', '--brand')}. The ink is
                          picked per seed, never assumed: a light seed takes dark ink and vice versa.
     --text-brand         ${light['--text-brand']} on the canvas — ${ratioNote(light, '--text-brand', '--surface-0')}. The SHALLOWEST step clearing
                          4.5:1, so link text is as light as AA permits and no lighter.
     --border-interactive ${light['--border-interactive']} — ${ratioNote(light, '--border-interactive', '--surface-0')}. WCAG 1.4.11 wants 3:1 for an input
                          boundary; border-subtle/strong stay decorative and are not gated.
   None of those steps are fixed by hand. A different seed lands on different ones. */
:root {
${roleBlock(light, '  ')}
}

/* ---- Dark, following the OS preference ---------------------------------
   :not([data-theme='light']) so an explicit light toggle (block 4) always outranks the OS.
   Dark is designed, not inverted: surfaces LIGHTEN with elevation, and --brand takes the DEEPEST
   step still clearing 6:1 on the canvas (${dark['--brand']}, measured ${ratioNote(dark, '--brand', '--surface-0')}) rather than
   the shallowest, which would leave every dark-mode button washed out. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${roleBlock(dark, '    ')}
  }
}

/* ---- Dark, explicit toggle (wins over OS preference) ------------------- */
:root[data-theme='dark'] {
${roleBlock(dark, '  ')}
}

/* ---- Light, explicit toggle (wins over a dark OS preference) -----------
   Last, so it takes the specificity tie against the OS-dark block above. */
:root[data-theme='light'] {
${roleBlock(light, '  ')}
}
`;
}

/* =========================================================================
 * 5. Output
 * ======================================================================= */

const args = new Set(process.argv.slice(2));

if (args.has('--write')) {
  writeFileSync(THEMES_CSS, themesCss(), 'utf8');
  console.log(`wrote ${THEMES_CSS}`);
}

function contrastTable(title, roleMap) {
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n## ${title}`);
  console.log('  ' + pad('pairing', 36) + pad('colours', 22) + pad('WCAG', 9) + pad('AA?', 9) + 'APCA Lc');
  let failed = 0;
  for (const row of measure(roleMap, TEXT_PAIRS)) {
    if (row.ratio < row.min) failed += 1;
    const verdict = row.ratio >= row.min ? 'PASS' : row.ratio >= 3 ? 'lg-only' : 'FAIL';
    console.log('  ' + pad(row.label, 36) + pad(`${row.fg} on ${row.bg}`, 22)
      + pad(`${row.ratio.toFixed(2)}:1`, 9) + pad(verdict, 9) + row.lc.toFixed(1));
  }
  console.log('  -- non-text UI (WCAG 1.4.11 needs >= 3:1)');
  for (const row of measure(roleMap, UI_PAIRS)) {
    if (row.ratio < row.min) failed += 1;
    console.log('  ' + pad(row.label, 36) + pad(`${row.fg} on ${row.bg}`, 22)
      + pad(`${row.ratio.toFixed(2)}:1`, 9) + (row.ratio >= row.min ? 'PASS' : 'FAIL'));
  }
  console.log('  -- decorative separators (reported, not gated)');
  for (const [label, fgProp, bgProp] of DECORATIVE) {
    const fg = resolve(roleMap, fgProp);
    const bg = resolve(roleMap, bgProp);
    if (!fg || !bg) continue;
    console.log('  ' + pad(label, 36) + pad(`${fg} on ${bg}`, 22) + pad(`${wcag(fg, bg).toFixed(2)}:1`, 9) + 'decorative');
  }
  return failed;
}

if (args.has('--markdown')) {
  for (const [name, steps] of RAMPS) {
    console.log(`\n#### ${name}\n`);
    console.log('| Step | OKLCH | Hex |');
    console.log('| :--- | :--- | :--- |');
    steps.forEach((s) => console.log(`| ${s} | \`${oklchFor(palette[name][s])}\` | \`${palette[name][s]}\` |`));
  }
  for (const [title, roleMap] of [['Light theme', palette.roles.light], ['Dark theme', palette.roles.dark]]) {
    console.log(`\n#### ${title}\n`);
    console.log('| Pairing | Colours | Ratio | AA | APCA Lc |');
    console.log('| :--- | :--- | :--- | :--- | :--- |');
    for (const row of [...measure(roleMap, TEXT_PAIRS), ...measure(roleMap, UI_PAIRS)]) {
      const ok = row.ratio >= row.min ? '✅' : '❌';
      console.log(`| ${row.label} | \`${row.fg}\` on \`${row.bg}\` | **${row.ratio.toFixed(2)}:1** | ${ok} | ${row.lc.toFixed(1)} |`);
    }
    for (const [label, fgProp, bgProp] of DECORATIVE) {
      const fg = resolve(roleMap, fgProp);
      const bg = resolve(roleMap, bgProp);
      if (fg && bg) console.log(`| ${label} | \`${fg}\` on \`${bg}\` | ${wcag(fg, bg).toFixed(2)}:1 | decorative only | ${apca(fg, bg).toFixed(1)} |`);
    }
  }
} else if (!args.has('--write')) {
  console.log(`## seed ${palette.config.seed} -> ${JSON.stringify(palette.meta)}`);
  for (const [name, steps] of RAMPS) {
    console.log(`\n## ${name}`);
    steps.forEach((s) => console.log(`  ${String(s).padEnd(5)} ${oklchFor(palette[name][s]).padEnd(28)} ${palette[name][s]}`));
  }
  const failures = contrastTable('LIGHT', palette.roles.light) + contrastTable('DARK', palette.roles.dark);
  console.log(`\n${failures === 0 ? 'All gated pairings PASS.' : `${failures} gated pairing(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}
