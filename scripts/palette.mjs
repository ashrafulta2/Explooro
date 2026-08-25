/**
 * Palette generator + contrast verifier for docs/design-system.md.
 *
 * Run:  node scripts/palette.mjs
 *
 * WHY this exists: every colour value and every contrast figure in the design system is GENERATED
 * and MEASURED here, never eyeballed. Eyeballing is how `brand-600` almost shipped as the primary
 * button colour at 4.07:1 — a real AA failure this script caught before any CSS was written.
 *
 * If you change a ramp, re-run this and update docs/design-system.md from its output. The two must
 * never drift. Zero dependencies, by the Dependency Policy in docs/prompt.md.
 *
 * EXPECTED FAILURES (3): the switch off-state track at ~2.2:1 (light + dark), and LIGHT: focus
 * ring (brand-500) on surface-0 at ~1.86:1. All three are documented and accepted in
 * design-system.md §2 — the switch conveys its boundary with a --border-interactive outline rather
 * than track fill, and the light brand-500 fill/ring was a deliberate "favour lighter over 1.4.11"
 * tradeoff (every TEXT pairing on top of a brand fill still clears AA). Any OTHER failure is a real
 * regression.
 */

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const gamma = (u) => (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055);
  return {
    r: clamp01(gamma(lr)), g: clamp01(gamma(lg)), b: clamp01(gamma(lb)),
    inGamut: [lr, lg, lb].every((v) => v >= -0.0001 && v <= 1.0001),
  };
}

const hex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

function relLum({ r, g, b }) {
  const lin = (u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function wcag(c1, c2) {
  const [a, b] = [relLum(c1), relLum(c2)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

// APCA 0.1.9 (W3 draft) — simplified bg/txt path
function apca(txt, bg) {
  const Y = (c) => 0.2126729 * c.r ** 2.4 + 0.7151522 * c.g ** 2.4 + 0.072175 * c.b ** 2.4;
  let Ytxt = Y(txt), Ybg = Y(bg);
  const soft = (y) => (y > 0.022 ? y : y + (0.022 - y) ** 1.414);
  Ytxt = soft(Ytxt); Ybg = soft(Ybg);
  let Lc;
  if (Ybg > Ytxt) Lc = (Ybg ** 0.56 - Ytxt ** 0.57) * 1.14, Lc = Lc < 0.001 ? 0 : (Lc - 0.027) * 100;
  else Lc = (Ybg ** 0.65 - Ytxt ** 0.62) * 1.14, Lc = Lc > -0.001 ? 0 : (Lc + 0.027) * 100;
  return Lc;
}

const O = (L, C, H) => { const c = oklchToRgb(L / 100, C, H); return { ...c, hex: hex(c), css: `oklch(${L}% ${C} ${H})` }; };

// ---------- ramps ----------
// Brand is PINK (344) and the neutral is a COOL CHARCOAL (242.5) — deliberately NOT the same hue.
// See docs/design-system.md §1.2.1 for the hue screen that rejected teal, green, and blue.
// Hue + the first 6 (L, C) pairs below are derived from 5 client-supplied reference swatches
// (fde4f2 / f9cee7 / f4b8da / eea1cd / e68bbe, all landing within ~2° of hue 344); steps 700-1000
// are extrapolated to stay lighter than the coral ramp ever was (old brand-1000 was L27%, this
// one bottoms out at L36%).
const BRAND_H = 344, NEUT_H = 242.5;

const ramps = {
  brand: [[98, 0.006], [96, 0.014], [94, 0.033], [89.5, 0.058], [84.7, 0.082], [79.7, 0.106], [74.7, 0.127], [68, 0.14], [61, 0.145], [52, 0.13], [44, 0.105], [36, 0.08]].map(([l, c]) => O(l, c, BRAND_H)),
  neutral: [[99.2, 0.002], [98, 0.003], [96, 0.005], [92, 0.006], [86, 0.008], [74, 0.010], [62, 0.012], [52, 0.014], [42, 0.016], [32, 0.016], [24, 0.015], [18, 0.014], [13, 0.012]].map(([l, c]) => O(l, c, NEUT_H)),
  accent: [[96, 0.028], [90, 0.065], [82, 0.110], [74, 0.140], [66, 0.135], [58, 0.115], [50, 0.095], [42, 0.078]].map(([l, c]) => O(l, c, 75)),
  success: [[96, 0.025], [88, 0.060], [74, 0.115], [62, 0.135], [52, 0.115], [42, 0.092]].map(([l, c]) => O(l, c, 150)),
  warning: [[96, 0.030], [88, 0.078], [76, 0.135], [66, 0.135], [54, 0.108], [44, 0.086]].map(([l, c]) => O(l, c, 75)),
  danger: [[96, 0.016], [90, 0.045], [76, 0.110], [63, 0.250], [53, 0.210], [42, 0.145]].map(([l, c]) => O(l, c, 29)),
  info: [[96, 0.016], [90, 0.045], [76, 0.095], [64, 0.140], [54, 0.140], [44, 0.110]].map(([l, c]) => O(l, c, 250)),
};

const STEPS = { brand: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000], neutral: [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000], accent: [50, 100, 200, 300, 400, 500, 600, 700], success: [50, 100, 300, 500, 700, 800], warning: [50, 100, 300, 500, 700, 800], danger: [50, 100, 300, 500, 700, 800], info: [50, 100, 300, 500, 700, 800] };

for (const [name, arr] of Object.entries(ramps)) {
  console.log(`\n## ${name}`);
  arr.forEach((c, i) => console.log(`  ${String(STEPS[name][i]).padEnd(5)} ${c.css.padEnd(26)} ${c.hex}  ${c.inGamut ? '' : ' <-- OUT OF GAMUT'}`));
}

// ---------- contrast pairings ----------
const n = (s) => ramps.neutral[STEPS.neutral.indexOf(s)];
const br = (s) => ramps.brand[STEPS.brand.indexOf(s)];
const dg = (s) => ramps.danger[STEPS.danger.indexOf(s)];
const white = O(100, 0, 0);

// LIGHT surfaces: 0=brand-50, 1=brand-100, 2=neutral-100, 3=neutral-200 (0/1 pink-tinted on
//   request; 2/3 stay neutral so raised/sunken surfaces don't blend into the pink borders)
// DARK  surfaces: 0=neutral-950, 1=neutral-900, 2=neutral-800, 3=neutral-700  (lighter with elevation)
const pairs = [
  ['LIGHT: text-primary on surface-0', n(900), br(50)],
  ['LIGHT: text-primary on surface-2', n(900), n(100)],
  ['LIGHT: text-secondary on surface-0', n(700), br(50)],
  ['LIGHT: text-muted on surface-0', n(600), br(50)],
  ['LIGHT: brand-900 text-brand on surface-0', br(900), br(50)],
  ['LIGHT: n-900 on brand-500 (primary btn)', n(900), br(500)],
  ['LIGHT: n-900 on brand-600 (brand-alt fill)', n(900), br(600)],
  ['LIGHT: n-900 on brand-700 (btn:active)', n(900), br(700)],
  ['LIGHT: danger-700 on surface-0', ramps.danger[4], br(50)],
  ['LIGHT: success-700 on surface-0', ramps.success[4], br(50)],
  // Flash-sale strip: the three pairings components/product.css actually renders. The strip reads
  // --flash-* now, but those default to the danger ramp, so this is where the SHIPPED values are
  // measured — the generated-per-seed versions are covered by client/test/colorRamp.test.js.
  ['LIGHT: flash-text n-900 on bg (d-300)', n(900), dg(300)],
  ['LIGHT: flash-text n-900 on chip (n-0)', n(900), n(0)],
  ['LIGHT: flash-tag n-0 on tag (d-800)', n(0), dg(800)],
  ['DARK:  flash-text n-100 on bg (d-800)', n(100), dg(800)],
  ['DARK:  flash-text n-100 on chip n-900', n(100), n(900)],
  ['LIGHT: border-subtle (brand-300) vs surface-0', br(300), br(50)],
  ['LIGHT: border-strong (brand-400) vs surface-0', br(400), br(50)],
  ['DARK:  text-primary on surface-0', n(100), n(950)],
  ['DARK:  text-primary on surface-2', n(100), n(800)],
  ['DARK:  text-secondary on surface-0', n(300), n(950)],
  ['DARK:  text-muted on surface-0', n(400), n(950)],
  ['DARK:  brand-300 link on surface-0', br(300), n(950)],
  ['DARK:  neutral-950 on brand-300 (btn)', n(950), br(300)],
  ['DARK:  danger-300 on surface-0', ramps.danger[2], n(950)],
  ['DARK:  border-subtle vs surface-0', n(800), n(950)],
  ['DARK:  border-strong vs surface-0', n(700), n(950)],
];

console.log('\n## contrast');
console.log('  ' + 'pairing'.padEnd(38) + 'WCAG'.padEnd(9) + 'AA?'.padEnd(6) + 'APCA Lc');
for (const [label, fg, bg] of pairs) {
  const r = wcag(fg, bg);
  const lc = apca(fg, bg);
  const isBorder = label.includes('border');
  const pass = isBorder ? (r >= 1.5 ? 'ok' : 'LOW') : r >= 4.5 ? 'PASS' : r >= 3 ? 'lg-only' : 'FAIL';
  console.log('  ' + label.padEnd(38) + (r.toFixed(2) + ':1').padEnd(9) + pass.padEnd(6) + lc.toFixed(1));
}

console.log('\n## non-text UI components (WCAG 1.4.11 needs >= 3:1)');
const extra = [
  ['LIGHT: input border (brand-800) on surface-0', br(800), br(50)],
  ['LIGHT: focus ring (brand-500) on surface-0', br(500), br(50)],
  ['LIGHT: switch track off (n-400) [expected fail]', n(400), br(50)],
  ['DARK:  input border (neutral-600) on surface-0', n(600), n(950)],
  ['DARK:  focus ring (brand-400) on surface-0', br(400), n(950)],
  ['DARK:  switch track off (n-700) [expected fail]', n(700), n(950)],
];
for (const [label, fg, bg] of extra) {
  const r = wcag(fg, bg);
  console.log('  ' + label.padEnd(48) + (r.toFixed(2) + ':1').padEnd(9) + (r >= 3 ? 'PASS' : 'FAIL'));
}
