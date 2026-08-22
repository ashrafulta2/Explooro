/**
 * Charcoal & Coral palette exploration.
 * Derives OKLCH hue/chroma from the reference image's colours, builds full ramps, and MEASURES
 * every contrast pairing from design-system.md §2 before anything is written to CSS.
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

function hexToOklch(hexStr) {
  const s = hexStr.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  const lin = (u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s2 = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s2;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s2;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s2;
  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L: L * 100, C, H };
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
const O = (L, C, H) => { const c = oklchToRgb(L / 100, C, H); return { ...c, hex: hex(c), css: `oklch(${L}% ${C} ${H})` }; };

// ---- Reference colours read off the supplied image ----
console.log('## reference image colours -> OKLCH');
const refs = {
  'charcoal (bg)': '#232d35',
  'coral (bg)': '#e3694a',
  'coral light': '#f18e72',
};
for (const [name, h] of Object.entries(refs)) {
  const o = hexToOklch(h);
  console.log(`  ${name.padEnd(16)} ${h}  ->  L=${o.L.toFixed(1)}%  C=${o.C.toFixed(3)}  H=${o.H.toFixed(1)}`);
}

const CORAL_H = Math.round(hexToOklch(refs['coral (bg)']).H * 10) / 10;
const CHAR_H = Math.round(hexToOklch(refs['charcoal (bg)']).H * 10) / 10;
console.log(`\n  => brand hue  = ${CORAL_H} (coral)`);
console.log(`  => neutral hue = ${CHAR_H} (cool charcoal — complementary to coral, as in the image)`);

// ---- Ramps ----
// Coral: chroma peaks mid-ramp and falls off at both ends to stay in gamut.
const ramps = {
  brand: [[97,0.014],[94,0.028],[88,0.062],[80,0.098],[72,0.128],[65,0.148],[58,0.150],[50,0.132],[42,0.110],[35,0.088],[27,0.064],[20,0.046]].map(([l,c])=>O(l,c,CORAL_H)),
  // Charcoal neutral: cool, low chroma, tinted toward the charcoal hue.
  neutral: [[99.2,0.002],[98,0.003],[96,0.005],[92,0.006],[86,0.008],[74,0.010],[62,0.012],[52,0.014],[42,0.016],[32,0.016],[24,0.015],[18,0.014],[13,0.012]].map(([l,c])=>O(l,c,CHAR_H)),
  accent:  [[96,0.028],[90,0.065],[82,0.110],[74,0.140],[66,0.135],[58,0.115],[50,0.095],[42,0.078]].map(([l,c])=>O(l,c,75)),
  success: [[96,0.025],[88,0.060],[74,0.115],[62,0.135],[52,0.115],[42,0.092]].map(([l,c])=>O(l,c,150)),
  warning: [[96,0.030],[88,0.078],[76,0.135],[66,0.135],[54,0.108],[44,0.086]].map(([l,c])=>O(l,c,75)),
  danger:  [[96,0.016],[90,0.045],[76,0.110],[62,0.180],[52,0.180],[42,0.145]].map(([l,c])=>O(l,c,27)),
  info:    [[96,0.016],[90,0.045],[76,0.095],[64,0.140],[54,0.140],[44,0.110]].map(([l,c])=>O(l,c,250)),
};

const STEPS = { brand:[50,100,200,300,400,500,600,700,800,900,950,1000], neutral:[0,50,100,200,300,400,500,600,700,800,900,950,1000], accent:[50,100,200,300,400,500,600,700], success:[50,100,300,500,700,800], warning:[50,100,300,500,700,800], danger:[50,100,300,500,700,800], info:[50,100,300,500,700,800] };

for (const name of ['brand', 'neutral']) {
  console.log(`\n## ${name}`);
  ramps[name].forEach((c, i) =>
    console.log(`  ${String(STEPS[name][i]).padEnd(5)} ${c.css.padEnd(26)} ${c.hex}${c.inGamut ? '' : '  <-- OUT OF GAMUT'}`));
}

const n = (s) => ramps.neutral[STEPS.neutral.indexOf(s)];
const br = (s) => ramps.brand[STEPS.brand.indexOf(s)];
const white = O(100, 0, 0);

const pairs = [
  ['LIGHT: text-primary on surface-0',    n(900),  n(0)],
  ['LIGHT: text-secondary on surface-0',  n(700),  n(0)],
  ['LIGHT: text-muted on surface-0',      n(600),  n(0)],
  ['LIGHT: brand-700 link on surface-0',  br(700), n(0)],
  ['LIGHT: white on brand-500 (image coral!)', white, br(500)],
  ['LIGHT: white on brand-600 (btn)',     white,   br(600)],
  ['LIGHT: white on brand-700 (btn)',     white,   br(700)],
  ['LIGHT: white on brand-800 (btn:hov)', white,   br(800)],
  ['LIGHT: n-900 on brand-500 (alt btn)', n(900),  br(500)],
  ['DARK:  text-primary on surface-0',    n(100),  n(950)],
  ['DARK:  text-secondary on surface-0',  n(300),  n(950)],
  ['DARK:  text-muted on surface-0',      n(400),  n(950)],
  ['DARK:  brand-300 link on surface-0',  br(300), n(950)],
  ['DARK:  neutral-950 on brand-300',     n(950),  br(300)],
  ['DARK:  neutral-950 on brand-400',     n(950),  br(400)],
];

console.log('\n## contrast (AA needs 4.5:1 body / 3:1 large + non-text)');
console.log('  ' + 'pairing'.padEnd(40) + 'WCAG'.padEnd(10) + 'verdict');
for (const [label, fg, bg] of pairs) {
  const r = wcag(fg, bg);
  const pass = r >= 4.5 ? 'PASS' : r >= 3 ? 'large-only' : 'FAIL';
  console.log('  ' + label.padEnd(40) + (r.toFixed(2) + ':1').padEnd(10) + pass);
}

console.log('\n## non-text UI (needs >= 3:1)');
for (const [label, fg, bg] of [
  ['LIGHT: input border (n-500) on surface-0', n(500), n(0)],
  ['LIGHT: focus ring (brand-600) on surface-0', br(600), n(0)],
  ['DARK:  input border (n-600) on surface-0', n(600), n(950)],
  ['DARK:  focus ring (brand-400) on surface-0', br(400), n(950)],
]) {
  const r = wcag(fg, bg);
  console.log('  ' + label.padEnd(46) + (r.toFixed(2)+':1').padEnd(10) + (r >= 3 ? 'PASS' : 'FAIL'));
}
