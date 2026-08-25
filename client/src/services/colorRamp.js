/**
 * colorRamp.js — OKLCH colour engine. One master seed colour -> the entire system palette.
 *
 * WHY this exists: components reference the RAW ramp steps (--brand-50 … --brand-1000,
 * --neutral-0 … --neutral-1000) in ~199 places — card borders, hover fills, scrollbar thumbs,
 * sidebar active pills, focus rings. The Prompt 3.5 preset system only overrode 33 *semantic*
 * tokens and no ramp step at all, so switching preset left every one of those surfaces pink.
 * Re-theming the product therefore means regenerating the RAMPS, not repainting a few roles.
 *
 * The ladder shape below (per-step lightness + chroma) is the one originally authored by hand in
 * styles/themes.css. Only the hue and the chroma envelope move with the seed; the lightness ladder
 * is a contrast contract (border-interactive >= 3:1 on surface-0, text-brand >= 4.5:1) and is
 * preserved by construction.
 *
 * The direction of that relationship has since reversed: styles/themes.css is now GENERATED from
 * `DEFAULT_MASTER` below (`node scripts/palette.mjs --write`) rather than transcribed into it. WHY:
 * themes.css is what paints before main.js can run `initTheme()`, so while it was hand-authored
 * against one seed and the product booted with another, every cold load flashed the wrong colour
 * and then swapped. client/test/colorRamp.test.js parses the CSS and fails if the two diverge.
 *
 * Zero dependencies — client/package.json dependencies stays {}.
 */

/* =========================================================================
 * 1. sRGB <-> OKLCH conversion (Ottosson matrices)
 * ======================================================================= */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function hexToRgb255(hex) {
  if (typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
  let clean = hex.trim().replace('#', '');
  if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return { r: 0, g: 0, b: 0 };
  const n = parseInt(clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgb255ToHex({ r, g, b }) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function linearRgbToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToLinearRgb(L, a, bb) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** hex -> { l: 0..1, c: 0..~0.4, h: 0..360 }. Hue is 0 for achromatic input. */
export function hexToOklch(hex) {
  const { r, g, b } = hexToRgb255(hex);
  const lab = linearRgbToOklab(srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255));
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = c < 1e-6 ? 0 : (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: lab.L, c, h };
}

/** True when the OKLCH triplet lands inside the sRGB cube (small tolerance for rounding). */
function inSrgbGamut(l, c, h) {
  const rad = (h * Math.PI) / 180;
  const { r, g, b } = oklabToLinearRgb(l, c * Math.cos(rad), c * Math.sin(rad));
  const lo = -0.0002;
  const hi = 1.0002;
  return r >= lo && r <= hi && g >= lo && g <= hi && b >= lo && b <= hi;
}

/**
 * OKLCH -> hex, gamut-mapped by reducing chroma (never lightness) until the colour fits sRGB.
 * WHY chroma-only: dropping lightness would break the ladder's contrast contract; dropping
 * chroma just desaturates a colour the display could not have shown anyway.
 */
export function oklchToHex(l, c, h) {
  const L = clamp(l, 0, 1);
  let C = Math.max(c, 0);
  if (!inSrgbGamut(L, C, h)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (inSrgbGamut(L, mid, h)) lo = mid;
      else hi = mid;
    }
    C = lo;
  }
  const rad = (h * Math.PI) / 180;
  const lin = oklabToLinearRgb(L, C * Math.cos(rad), C * Math.sin(rad));
  return rgb255ToHex({
    r: linearToSrgb(clamp(lin.r, 0, 1)) * 255,
    g: linearToSrgb(clamp(lin.g, 0, 1)) * 255,
    b: linearToSrgb(clamp(lin.b, 0, 1)) * 255,
  });
}

/* =========================================================================
 * 2. WCAG contrast (sRGB relative luminance — NOT OKLCH lightness)
 * ======================================================================= */

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb255(hex);
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Whichever of the candidates reads best on `bg` — used to decide button label colour. */
export function bestContrastOn(bg, candidates) {
  let best = candidates[0];
  let bestRatio = -1;
  for (const cand of candidates) {
    const ratio = contrastRatio(bg, cand);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = cand;
    }
  }
  return best;
}

/* =========================================================================
 * 3. Ladder shapes — the hand-authored contrast contract every seed is fitted to
 * ======================================================================= */

export const BRAND_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000];
const BRAND_L = [0.98, 0.96, 0.94, 0.895, 0.847, 0.797, 0.747, 0.68, 0.61, 0.52, 0.44, 0.36];
const BRAND_C = [0.006, 0.014, 0.033, 0.058, 0.082, 0.106, 0.127, 0.14, 0.145, 0.13, 0.105, 0.08];

export const NEUTRAL_STEPS = [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000];
const NEUTRAL_L = [0.992, 0.98, 0.96, 0.92, 0.86, 0.74, 0.62, 0.52, 0.42, 0.32, 0.24, 0.18, 0.13];
const NEUTRAL_C = [0.002, 0.003, 0.005, 0.006, 0.008, 0.01, 0.012, 0.014, 0.016, 0.016, 0.015, 0.014, 0.012];

/* Status + accent ramps keep their own semantic hue (green means success, red means danger) but
   inherit the master's chroma energy and — via `statusPull` — a slight hue lean toward it, which
   is what makes a re-themed palette read as one family instead of six unrelated ramps. */
const STATUS_SOURCE = {
  success: { 50: '#e7f7e9', 100: '#bce3c3', 300: '#73bf84', 500: '#3e9c58', 700: '#2d7b44', 800: '#205b31' },
  warning: { 50: '#feefdc', 100: '#f6d19e', 300: '#e3a340', 500: '#c28412', 700: '#936412', 800: '#6e4b0e' },
  danger: { 50: '#fceeec', 100: '#fbd4cd', 300: '#ef9688', 500: '#fd1913', 700: '#c9120d', 800: '#8b1f17' },
  info: { 50: '#eaf3fc', 100: '#c8e1fb', 300: '#82b6ec', 500: '#3f90dd', 700: '#1b71bc', 800: '#16558c' },
};

const ACCENT_SOURCE = {
  50: '#fdf0de',
  100: '#f8d9af',
  200: '#eeba70',
  300: '#de9c31',
  400: '#c28412',
  500: '#a26f17',
  600: '#835a18',
  700: '#664613',
};

/**
 * Walks a colour's OKLCH lightness (hue and chroma held) until it clears `minRatio` against `bg`.
 * WHY needed: scaling a status ramp's chroma to match the master's energy also moves its
 * luminance, so a badge pairing that passed AA at the authored chroma can quietly drop below it.
 * Repairing here means a generated palette is AA-clean by construction rather than by inspection.
 */
export function adjustForContrast(hex, bg, minRatio, direction = 'auto') {
  if (contrastRatio(hex, bg) >= minRatio) return hex;
  const src = hexToOklch(hex);
  const step = direction === 'lighten' || (direction === 'auto' && relativeLuminance(bg) < 0.18)
    ? 0.012
    : -0.012;
  let l = src.l;
  let out = hex;
  for (let i = 0; i < 70; i += 1) {
    l = clamp(l + step, 0.02, 0.99);
    out = oklchToHex(l, src.c, src.h);
    if (contrastRatio(out, bg) >= minRatio) return out;
    if (l <= 0.02 || l >= 0.99) break;
  }
  return out;
}

/** Shortest-path interpolation on the hue circle, so 350deg -> 10deg goes forward, not backward. */
function mixHue(from, to, amount) {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * amount + 360) % 360;
}

/* =========================================================================
 * 4. Ramp generation
 * ======================================================================= */

/**
 * Which ladder step the seed itself should occupy. Clamped to 400..950: a seed lighter than 400
 * cannot carry a button fill at all, and brand-1000 must stay reserved as the ramp's floor.
 */
function pickBrandStep(seedL) {
  let best = 5;
  let bestDist = Infinity;
  for (let i = 4; i <= 10; i += 1) {
    const d = Math.abs(BRAND_L[i] - seedL);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Shifts the lightness ladder so the anchor step lands on the seed's own lightness, with the
 * shift tapering to zero at both ends. WHY taper: brand-50 backs the page canvas and brand-1000
 * backs the deepest fills — pulling either toward a mid-tone seed would destroy the light/dark
 * headroom the whole ladder depends on. The anchor is then forced to the seed exactly and the
 * whole array re-monotonised OUTWARD FROM THE ANCHOR, so a seed that sits well off the ladder
 * (a deep slate against a mid-tone step) pushes its neighbours aside instead of folding the ramp
 * back on itself.
 */
function shiftedLadder(anchorIndex, seedL) {
  const delta = clamp(seedL - BRAND_L[anchorIndex], -0.06, 0.06);
  const last = BRAND_L.length - 1;
  const out = BRAND_L.map((baseL, i) => {
    let weight;
    if (i <= anchorIndex) weight = anchorIndex === 0 ? 0 : i / anchorIndex;
    else weight = anchorIndex === last ? 0 : (last - i) / (last - anchorIndex);
    return clamp(baseL + delta * weight, 0.12, 0.995);
  });

  // The pin is clamped to the ladder's usable band: a near-black or near-white seed would
  // otherwise crush the steps above/below it into visually identical duplicates, costing the
  // ramp the very distinctions borders and hovers are built from.
  out[anchorIndex] = clamp(seedL, 0.2, 0.9);
  const MIN_GAP = 0.012;
  for (let i = anchorIndex - 1; i >= 0; i -= 1) {
    if (out[i] < out[i + 1] + MIN_GAP) out[i] = Math.min(0.995, out[i + 1] + MIN_GAP);
  }
  for (let i = anchorIndex + 1; i <= last; i += 1) {
    if (out[i] > out[i - 1] - MIN_GAP) out[i] = Math.max(0.06, out[i - 1] - MIN_GAP);
  }
  return out;
}

/**
 * Hover/active step direction. A mid-tone brand deepens when pressed (the conventional
 * "recessed" read), but a brand already sitting near the ramp floor has nowhere darker to go, so
 * it lightens instead — otherwise hover is a 1% change nobody can see.
 */
function interactionSteps(anchorIndex) {
  const last = BRAND_STEPS.length - 1;
  if (anchorIndex + 2 <= last) return { hover: anchorIndex + 1, active: anchorIndex + 2 };
  return { hover: Math.max(0, anchorIndex - 1), active: Math.max(0, anchorIndex - 2) };
}

/**
 * The colour the product ships with, in engine terms.
 *
 * Three things are pinned to this one object and a test asserts each: styles/themes.css is
 * generated from it, `MASTER_PRESETS.midnight_slate` in config/master-themes.js carries the same
 * settings (it is the preset `DEFAULT_MASTER_PRESET` names), and `normaliseMasterConfig` falls
 * back to it field by field when a stored master block is partial.
 *
 * WHY those must agree rather than merely resemble each other: themes.css paints first, the
 * preset is what `initTheme()` mounts a beat later, and the fallback is what a half-written blob
 * resolves to. Any two of them disagreeing shows up as a colour flash on load, which is precisely
 * what this used to do while the CSS was pink and the boot default was slate.
 */
export const DEFAULT_MASTER = {
  seed: '#334155',
  vividness: 1,
  neutralMode: 'match',
  neutralTint: 1,
  accentHarmony: 'complement',
  statusPull: 0,
  surfaceWash: false,
  borderTint: false,
};

const NEUTRAL_COOL_HUE = 242.5;

export function resolveNeutralHue(mode, seedHue) {
  if (mode === 'match') return seedHue;
  if (mode === 'complement') return (seedHue + 180) % 360;
  return NEUTRAL_COOL_HUE;
}

export function resolveAccentHue(harmony, seedHue) {
  if (harmony === 'mono') return seedHue;
  if (harmony === 'analogous') return (seedHue + 42) % 360;
  if (harmony === 'triad') return (seedHue + 120) % 360;
  return (seedHue + 180) % 360;
}

/**
 * The whole palette from one seed. Returns the raw ramps plus semantic role maps for light and
 * dark, so no caller ever has to re-derive a contrast decision.
 */
export function generatePalette(userConfig = {}) {
  const cfg = { ...DEFAULT_MASTER, ...userConfig };
  const seed = hexToOklch(cfg.seed);
  const seedHue = seed.c < 0.008 ? NEUTRAL_COOL_HUE : seed.h;

  const anchor = pickBrandStep(seed.l);
  const ladderL = shiftedLadder(anchor, seed.l);
  const chromaScale = clamp((seed.c / BRAND_C[anchor]) * cfg.vividness, 0.2, 4);

  const brand = {};
  BRAND_STEPS.forEach((step, i) => {
    brand[step] = oklchToHex(ladderL[i], BRAND_C[i] * chromaScale, seedHue);
  });
  // Pin the anchor to the seed itself: what the admin picked is what a button paints with.
  // ladderL[anchor] rather than seed.l, so the pinned colour and the ladder cannot disagree when
  // an out-of-band seed got clamped.
  brand[BRAND_STEPS[anchor]] = oklchToHex(ladderL[anchor], seed.c, seedHue);

  const neutralHue = resolveNeutralHue(cfg.neutralMode, seedHue);
  const neutralChroma = clamp(cfg.neutralTint, 0, 6);
  const neutral = {};
  NEUTRAL_STEPS.forEach((step, i) => {
    neutral[step] = oklchToHex(NEUTRAL_L[i], NEUTRAL_C[i] * neutralChroma, neutralHue);
  });

  const statusChroma = clamp(0.65 + 0.35 * chromaScale, 0.6, 1.7);
  const pull = clamp(cfg.statusPull, 0, 1) * 0.35;
  const status = {};
  for (const [name, ramp] of Object.entries(STATUS_SOURCE)) {
    status[name] = {};
    for (const [step, hex] of Object.entries(ramp)) {
      const src = hexToOklch(hex);
      status[name][step] = oklchToHex(src.l, src.c * statusChroma, mixHue(src.h, seedHue, pull));
    }
    // The two pairings every badge in the product actually renders: 700-on-50 (light) and
    // 300-on-800 (dark). Repaired with a small margin over 4.5 so 1-decimal rounding in the
    // studio's own validator can never report a 4.4 for a palette this engine called clean.
    status[name][700] = adjustForContrast(status[name][700], status[name][50], 4.6, 'darken');
    status[name][300] = adjustForContrast(status[name][300], status[name][800], 4.6, 'lighten');
  }

  const accentHue = resolveAccentHue(cfg.accentHarmony, seedHue);
  const accent = {};
  for (const [step, hex] of Object.entries(ACCENT_SOURCE)) {
    const src = hexToOklch(hex);
    accent[step] = oklchToHex(src.l, src.c * clamp(chromaScale, 0.5, 1.6), accentHue);
  }

  const roles = {
    light: buildLightRoles({ cfg, brand, neutral, anchor, danger: status.danger }),
    dark: buildDarkRoles({ brand, neutral, danger: status.danger }),
  };

  return {
    config: cfg,
    brand,
    neutral,
    accent,
    success: status.success,
    warning: status.warning,
    danger: status.danger,
    info: status.info,
    roles,
    meta: {
      seedHue: Math.round(seedHue * 10) / 10,
      neutralHue: Math.round(neutralHue * 10) / 10,
      accentHue: Math.round(accentHue * 10) / 10,
      anchorStep: BRAND_STEPS[anchor],
      chromaScale: Math.round(chromaScale * 100) / 100,
    },
  };
}

/** Shallowest ramp step clearing `minRatio` against `bg` — deepest step if none does. */
function shallowestPassing(ramp, bg, minRatio) {
  for (const step of BRAND_STEPS) {
    if (contrastRatio(ramp[step], bg) >= minRatio) return step;
  }
  return BRAND_STEPS[BRAND_STEPS.length - 1];
}

/**
 * Solves one "coloured strip with text on it" surface — the flash-sale header, its countdown chip
 * and the FLASH tag on a product card.
 *
 * WHY it is not just `var(--danger-300)` hardcoded in the CSS any more: that step is regenerated
 * from the master seed like everything else, and `statusPull` can lean its hue toward the brand.
 * A strip whose ink was fixed at neutral-900 would therefore drift below AA for some seeds without
 * anything reporting it. The ink is measured, and only if NEITHER candidate clears the bar is the
 * fill itself repaired — in which case a literal hex is returned instead of the ramp reference,
 * because at that point the ramp step genuinely is not the colour being painted.
 */
function flashRole(fillHex, fillVar, inkCandidates) {
  let fill = fillHex;
  let ink = bestContrastOn(fill, inkCandidates);
  if (contrastRatio(fill, ink) < 4.6) {
    fill = adjustForContrast(fill, ink, 4.6);
    ink = bestContrastOn(fill, inkCandidates);
  }
  return { fill, fillRef: fill === fillHex ? fillVar : fill, ink };
}

function buildLightRoles({ cfg, brand, neutral, anchor, danger }) {
  const stepAt = (i) => BRAND_STEPS[clamp(i, 0, BRAND_STEPS.length - 1)];
  const inkCandidates = [neutral[900], neutral[0]];
  const bestInkRatio = (i) => {
    const fill = brand[stepAt(i)];
    return contrastRatio(fill, bestContrastOn(fill, inkCandidates));
  };

  // A seed landing in the mid-lightness dead zone reaches 4.5:1 with NEITHER white nor near-black
  // ink. Step away from it — outward in both directions, nearest first — rather than shipping a
  // button whose own label fails AA.
  let usable = anchor;
  if (bestInkRatio(anchor) < 4.5) {
    for (let d = 1; d <= BRAND_STEPS.length; d += 1) {
      if (bestInkRatio(anchor + d) >= 4.5) { usable = anchor + d; break; }
      if (bestInkRatio(anchor - d) >= 4.5) { usable = anchor - d; break; }
    }
  }

  const interaction = interactionSteps(clamp(usable, 0, BRAND_STEPS.length - 1));
  const brandStep = stepAt(usable);
  const hoverStep = stepAt(interaction.hover);
  const activeStep = stepAt(interaction.active);

  const surface0 = cfg.surfaceWash ? brand[50] : neutral[50];
  const surface1 = cfg.surfaceWash ? brand[100] : neutral[0];
  const inkVar = (bg) => (bestContrastOn(bg, inkCandidates) === neutral[0] ? 'var(--neutral-0)' : 'var(--neutral-900)');

  const flash = flashRole(danger[300], 'var(--danger-300)', inkCandidates);
  const flashTag = flashRole(danger[800], 'var(--danger-800)', inkCandidates);
  const flashInkVar = flash.ink === neutral[0] ? 'var(--neutral-0)' : 'var(--neutral-900)';
  const tagInkVar = flashTag.ink === neutral[0] ? 'var(--neutral-0)' : 'var(--neutral-900)';
  // The countdown digits inherit the header's ink, so the chip behind them has to run the OTHER
  // way — a dark chip under dark digits is the bug this replaced.
  const flashChip = flash.ink === neutral[0] ? neutral[900] : neutral[0];
  const flashChipVar = flash.ink === neutral[0] ? 'var(--neutral-900)' : 'var(--neutral-0)';

  return {
    '--surface-0': cfg.surfaceWash ? 'var(--brand-50)' : 'var(--neutral-50)',
    '--surface-1': cfg.surfaceWash ? 'var(--brand-100)' : 'var(--neutral-0)',
    '--surface-2': 'var(--neutral-100)',
    '--surface-3': 'var(--neutral-200)',

    '--border-subtle': cfg.borderTint ? 'var(--brand-300)' : 'var(--neutral-200)',
    '--border-strong': cfg.borderTint ? 'var(--brand-400)' : 'var(--neutral-300)',
    // >=3:1 against the page canvas is the a11y floor for an input boundary (themes.css §2).
    '--border-interactive': cfg.borderTint
      ? `var(--brand-${shallowestPassing(brand, surface0, 3)})`
      : 'var(--neutral-600)',
    '--border-default': 'var(--border-strong)',

    '--text-primary': 'var(--neutral-900)',
    '--text-secondary': 'var(--neutral-700)',
    '--text-muted': 'var(--neutral-600)',
    '--text-inverse': 'var(--neutral-0)',

    '--brand': `var(--brand-${brandStep})`,
    '--brand-hover': `var(--brand-${hoverStep})`,
    '--brand-active': `var(--brand-${activeStep})`,
    // Light seed -> dark label; dark seed -> white label. Decided per seed, never assumed.
    '--brand-contrast': inkVar(brand[brandStep]),
    '--text-brand': `var(--brand-${shallowestPassing(brand, surface0, 4.5)})`,
    '--brand-alt': `var(--brand-${hoverStep})`,
    '--brand-alt-contrast': inkVar(brand[hoverStep]),

    '--success': 'var(--success-700)',
    '--success-bg': 'var(--success-50)',
    '--success-border': 'var(--success-300)',
    '--warning': 'var(--warning-700)',
    '--warning-bg': 'var(--warning-50)',
    '--warning-border': 'var(--warning-300)',
    '--danger': 'var(--danger-700)',
    '--danger-bg': 'var(--danger-50)',
    '--danger-border': 'var(--danger-300)',
    '--info': 'var(--info-700)',
    '--info-bg': 'var(--info-50)',
    '--info-border': 'var(--info-300)',

    // Flash sale / promo strip. Kept on the DANGER ramp (urgency reads red across every locale
    // we ship) but resolved, not assumed — see flashRole().
    '--flash-bg': flash.fillRef,
    '--flash-text': flashInkVar,
    '--flash-chip-bg': flashChipVar,
    '--flash-tag-bg': flashTag.fillRef,
    '--flash-tag-text': tagInkVar,

    '--focus-ring': `var(--brand-${brandStep})`,
    '--shadow-color': hslTriplet(neutral[900], 14, 14),
    '--scrim': `hsl(${hslTriplet(neutral[950], 28, 9)} / 48%)`,

    '--navbar-bg': 'var(--neutral-0)',
    '--navbar-text': 'var(--neutral-900)',
    '--navbar-border': cfg.borderTint ? 'var(--brand-300)' : 'var(--neutral-200)',
    '--navbar-search-bg': 'var(--neutral-100)',
    '--footer-bg': 'var(--neutral-900)',
    '--footer-text': 'var(--neutral-0)',
    '--footer-muted': 'var(--neutral-400)',
    '--footer-border': 'var(--neutral-800)',

    __resolved: {
      surface0,
      surface1,
      card: surface1,
      subtle: neutral[100],
      border: cfg.borderTint ? brand[300] : neutral[200],
      brand: brand[brandStep],
      brandHover: brand[hoverStep],
      brandContrast: bestContrastOn(brand[brandStep], inkCandidates),
      flash: {
        bg: flash.fill,
        text: flash.ink,
        chipBg: flashChip,
        tagBg: flashTag.fill,
        tagText: flashTag.ink,
      },
      navbarBg: neutral[0],
      navbarSearch: neutral[100],
      footerBg: neutral[900],
      footerMuted: neutral[400],
      footerBorder: neutral[800],
    },
  };
}

function buildDarkRoles({ brand, neutral, danger }) {
  // Dark inverts the brand: a LIGHT tint carries the action and dark ink sits on it, because no
  // mid-lightness fill clears 4.5:1 against a near-black canvas.
  const page = neutral[950];
  // DEEPEST step that still clears a comfortable 6:1 on the dark canvas — searching from the
  // light end would always stop at brand-200 and leave every dark-mode button washed out.
  let dStep = 300;
  for (const step of [700, 600, 500, 400, 300, 200]) {
    if (contrastRatio(brand[step], page) >= 6) {
      dStep = step;
      break;
    }
  }
  const idx = BRAND_STEPS.indexOf(dStep);
  // Dark mode DEEPENS on press (themes.css §1.6 rule 1): surfaces rise toward the light, but a
  // control being pressed should read as recessed.
  const hoverStep = BRAND_STEPS[clamp(idx + 1, 0, BRAND_STEPS.length - 1)];
  const activeStep = BRAND_STEPS[clamp(idx + 2, 0, BRAND_STEPS.length - 1)];

  // Dark inverts the strip too: the deep -800 fill that carries the tag on light becomes the
  // header, since a coral-300 band across a near-black page glares.
  const darkInk = [neutral[100], neutral[950]];
  const flash = flashRole(danger[800], 'var(--danger-800)', darkInk);
  const flashLightInk = flash.ink === neutral[100];

  return {
    '--surface-0': 'var(--neutral-950)',
    '--surface-1': 'var(--neutral-900)',
    '--surface-2': 'var(--neutral-800)',
    '--surface-3': 'var(--neutral-700)',

    '--border-subtle': 'var(--neutral-800)',
    '--border-strong': 'var(--neutral-700)',
    '--border-interactive': 'var(--neutral-600)',
    '--border-default': 'var(--border-strong)',

    '--text-primary': 'var(--neutral-100)',
    '--text-secondary': 'var(--neutral-300)',
    '--text-muted': 'var(--neutral-400)',
    '--text-inverse': 'var(--neutral-950)',

    '--brand': `var(--brand-${dStep})`,
    '--brand-hover': `var(--brand-${hoverStep})`,
    '--brand-active': `var(--brand-${activeStep})`,
    '--brand-contrast': 'var(--neutral-950)',
    '--text-brand': `var(--brand-${dStep})`,
    '--brand-alt': `var(--brand-${dStep})`,
    '--brand-alt-contrast': 'var(--neutral-950)',

    '--success': 'var(--success-300)',
    '--success-bg': 'var(--success-800)',
    '--success-border': 'var(--success-500)',
    '--warning': 'var(--warning-300)',
    '--warning-bg': 'var(--warning-800)',
    '--warning-border': 'var(--warning-500)',
    '--danger': 'var(--danger-300)',
    '--danger-bg': 'var(--danger-800)',
    '--danger-border': 'var(--danger-500)',
    '--info': 'var(--info-300)',
    '--info-bg': 'var(--info-800)',
    '--info-border': 'var(--info-500)',

    '--flash-bg': flash.fillRef,
    '--flash-text': flashLightInk ? 'var(--neutral-100)' : 'var(--neutral-950)',
    '--flash-chip-bg': flashLightInk ? 'var(--neutral-900)' : 'var(--neutral-100)',
    '--flash-tag-bg': flash.fillRef,
    '--flash-tag-text': flashLightInk ? 'var(--neutral-100)' : 'var(--neutral-950)',

    '--focus-ring': `var(--brand-${hoverStep})`,
    '--shadow-color': hslTriplet(neutral[1000], 12, 2),
    '--scrim': `hsl(${hslTriplet(neutral[1000], 42, 3)} / 60%)`,

    '--navbar-bg': 'var(--neutral-900)',
    '--navbar-text': 'var(--neutral-100)',
    '--navbar-border': 'var(--neutral-800)',
    '--navbar-search-bg': 'var(--neutral-800)',
    '--footer-bg': 'var(--neutral-1000)',
    '--footer-text': 'var(--neutral-100)',
    '--footer-muted': 'var(--neutral-400)',
    '--footer-border': 'var(--neutral-800)',

    __resolved: {
      surface0: page,
      brand: brand[dStep],
      brandContrast: neutral[950],
      flash: {
        bg: flash.fill,
        text: flash.ink,
        chipBg: flashLightInk ? neutral[900] : neutral[100],
      },
    },
  };
}

/**
 * `--shadow-color` is consumed as `hsl(var(--shadow-color) / alpha)`, so it must be an HSL
 * triplet, not a hex. Only the HUE is taken from the neutral ramp; saturation and lightness stay
 * at the values themes.css already tuned, so a shadow never turns into a coloured smear.
 */
function hslTriplet(hex, sat, light) {
  const { r, g, b } = hexToRgb255(hex);
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  let h = 0;
  const d = max - min;
  if (d > 1e-6) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return `${Math.round(h)}deg ${sat}% ${light}%`;
}


/**
 * Projects a generated palette down onto the 6-section token shape the Prompt 3.5 studio, its
 * WCAG validator and the server all already speak. Publishing therefore stores BOTH — the master
 * config (so the theme can be regenerated or re-tuned later) and the flattened sections (so
 * server-side validation and any consumer that predates the master engine still work).
 */
export function paletteToSectionTokens(palette) {
  const r = palette.roles.light.__resolved;
  const n = palette.neutral;
  const s = palette;

  return {
    navbar: {
      bg: r.navbarBg,
      text: n[900],
      border: r.border,
      search_bg: r.navbarSearch,
    },
    surfaces: {
      page: r.surface0,
      card: r.card,
      subtle: r.subtle,
      border: r.border,
    },
    brand: {
      primary: r.brand,
      hover: r.brandHover,
      contrast: r.brandContrast,
      secondary_bg: palette.brand[100],
      secondary_text: n[900],
    },
    typography: {
      primary: n[900],
      secondary: n[700],
      muted: n[600],
      inverse: n[0],
    },
    badges: {
      success_bg: s.success[50],
      success_text: s.success[700],
      warning_bg: s.warning[50],
      warning_text: s.warning[700],
      danger_bg: s.danger[50],
      danger_text: s.danger[700],
      info_bg: s.info[50],
      info_text: s.info[700],
    },
    footer: {
      bg: r.footerBg,
      text: n[0],
      muted: r.footerMuted,
      border: r.footerBorder,
    },
    flash_sale: {
      bg: r.flash.bg,
      text: r.flash.text,
      chip_bg: r.flash.chipBg,
      tag_bg: r.flash.tagBg,
      tag_text: r.flash.tagText,
    },
  };
}

/** The closed vocabularies of the master config. Exported so validators cannot drift from them. */
export const MASTER_NEUTRAL_MODES = ['cool', 'match', 'complement'];
export const MASTER_ACCENT_HARMONIES = ['complement', 'analogous', 'triad', 'mono'];

/**
 * Slider bounds for the continuous master controls. The Theme Studio builds its sliders from this
 * and the server validates writes against it — WHY one constant: if the two drifted, an admin
 * could drag a slider to a value the API then refused to store.
 */
export const MASTER_RANGES = {
  vividness: { min: 0.4, max: 2, step: 0.05 },
  neutralTint: { min: 0, max: 3, step: 0.1 },
  statusPull: { min: 0, max: 1, step: 0.05 },
};

/** A master config with every field present, so a partial stored blob cannot produce NaN. */
export function normaliseMasterConfig(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MASTER };
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    seed: typeof raw.seed === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.seed.trim())
      ? raw.seed.trim().toLowerCase()
      : DEFAULT_MASTER.seed,
    vividness: num(raw.vividness, DEFAULT_MASTER.vividness),
    neutralMode: MASTER_NEUTRAL_MODES.includes(raw.neutralMode)
      ? raw.neutralMode
      : DEFAULT_MASTER.neutralMode,
    neutralTint: num(raw.neutralTint, DEFAULT_MASTER.neutralTint),
    accentHarmony: MASTER_ACCENT_HARMONIES.includes(raw.accentHarmony)
      ? raw.accentHarmony
      : DEFAULT_MASTER.accentHarmony,
    statusPull: num(raw.statusPull, DEFAULT_MASTER.statusPull),
    // An absent flag falls back to DEFAULT_MASTER like every other field. It used to read
    // `raw.surfaceWash !== false`, which hardcoded `true` — harmless while the default WAS true,
    // but a silent disagreement with DEFAULT_MASTER the moment the shipped default changed.
    surfaceWash: typeof raw.surfaceWash === 'boolean' ? raw.surfaceWash : DEFAULT_MASTER.surfaceWash,
    borderTint: typeof raw.borderTint === 'boolean' ? raw.borderTint : DEFAULT_MASTER.borderTint,
  };
}
