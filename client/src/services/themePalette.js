/**
 * themePalette.js — Client runtime theme applier, WCAG AA contrast calculator & token validator (Prompt 3.5).
 */

import { THEME_PRESETS } from '../config/theme-presets.js';
import { MASTER_PRESETS, DEFAULT_MASTER_PRESET } from '../config/master-themes.js';
import { generatePalette, DEFAULT_MASTER } from './colorRamp.js';
import {
  applyMasterPalette,
  clearMasterPalette,
  paletteToSectionTokens,
  normaliseMasterConfig,
} from './masterTheme.js';

let currentTokens = { ...THEME_PRESETS.default.tokens };
let currentMaster = null;

/**
 * Converts a hex color string (#fff or #ffffff) to an {r, g, b} object.
 */
export function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Calculates standard sRGB relative luminance per WCAG 2.1 specs.
 */
export function getRelativeLuminance({ r, g, b }) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * Returns the WCAG contrast ratio between two hex colors (1:1 to 21:1).
 */
export function getContrastRatio(hex1, hex2) {
  const lum1 = getRelativeLuminance(hexToRgb(hex1));
  const lum2 = getRelativeLuminance(hexToRgb(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  const ratio = (brightest + 0.05) / (darkest + 0.05);
  return Math.round(ratio * 10) / 10;
}

/**
 * Validates that all tokens are solid colors (ZERO gradients allowed).
 */
export function validateNoGradients(tokens) {
  const checkValue = (val) => {
    if (typeof val === 'string' && /gradient/i.test(val)) return false;
    if (typeof val === 'object' && val !== null) {
      return Object.values(val).every(checkValue);
    }
    return true;
  };
  return checkValue(tokens);
}

/**
 * Validates that the token palette satisfies WCAG AA contrast on every pairing.
 */
export function validatePaletteContrast(tokens = {}) {
  const failures = [];

  const check = (name, fg, bg, minRatio = 4.5) => {
    if (!fg || !bg) return;
    const ratio = getContrastRatio(fg, bg);
    if (ratio < minRatio) {
      failures.push({
        pairing: name,
        fg,
        bg,
        ratio,
        required: minRatio,
        message: `${name} has contrast ratio of ${ratio}:1, which fails WCAG AA minimum (${minRatio}:1)`,
      });
    }
  };

  const nav = tokens.navbar || {};
  const surf = tokens.surfaces || {};
  const brand = tokens.brand || {};
  const typo = tokens.typography || {};
  const badges = tokens.badges || {};
  const footer = tokens.footer || {};
  const flash = tokens.flash_sale || {};

  // 1. Navbar
  check('Navbar Text on Navbar BG', nav.text, nav.bg, 4.5);

  // 2. Surfaces & Typography
  check('Body Text on Page Canvas', typo.primary, surf.page, 4.5);
  check('Body Text on Card Surface', typo.primary, surf.card, 4.5);
  check('Secondary Text on Card Surface', typo.secondary, surf.card, 3.5);

  // 3. Brand Button
  check('Brand Button Contrast Text on Brand Primary', brand.contrast, brand.primary, 4.5);

  // 4. Badges
  check('Success Badge Text on BG', badges.success_text, badges.success_bg, 4.5);
  check('Warning Badge Text on BG', badges.warning_text, badges.warning_bg, 4.5);
  check('Danger Badge Text on BG', badges.danger_text, badges.danger_bg, 4.5);
  check('Info Badge Text on BG', badges.info_text, badges.info_bg, 4.5);

  // 5. Footer
  check('Footer Text on Footer BG', footer.text, footer.bg, 4.5);
  check('Footer Muted Text on Footer BG', footer.muted, footer.bg, 3.0);

  // 6. Flash sale strip. The countdown digits inherit the header's ink, so the chip is checked
  // against flash.text and not against a colour of its own.
  check('Flash Sale Header Text on Header BG', flash.text, flash.bg, 4.5);
  check('Flash Sale Countdown Digits on Chip', flash.text, flash.chip_bg, 4.5);
  check('Flash Sale Tag Text on Tag BG', flash.tag_text, flash.tag_bg, 4.5);

  return {
    isValid: failures.length === 0,
    failures,
  };
}

/** Every inline custom property a section override can pin, so a reset is exhaustive. */
const SECTION_OVERRIDE_PROPS = [
  '--navbar-bg', '--navbar-text', '--navbar-border', '--navbar-search-bg',
  '--surface-page', '--surface-0', '--surface-1', '--surface-card', '--surface-subtle',
  '--surface-2', '--border-subtle',
  '--brand', '--brand-primary', '--brand-hover', '--brand-contrast',
  '--btn-secondary-bg', '--btn-secondary-text',
  '--text-primary', '--text-secondary', '--text-muted', '--text-inverse',
  '--success-bg', '--success', '--warning-bg', '--warning',
  '--danger-bg', '--danger', '--info-bg', '--info',
  '--footer-bg', '--footer-text', '--footer-muted', '--footer-border',
  '--flash-bg', '--flash-text', '--flash-chip-bg', '--flash-tag-bg', '--flash-tag-text',
];

/** Drops the per-section inline pins but leaves any mounted master stylesheet in place. */
export function clearSectionOverrides() {
  const root = document.documentElement;
  SECTION_OVERRIDE_PROPS.forEach((prop) => root.style.removeProperty(prop));
}

export function clearThemeOverrides() {
  clearMasterPalette();
  currentMaster = null;
  clearSectionOverrides();
}

/**
 * Maps a 6-section token to the custom properties it drives. Several tokens feed more than one
 * property because the section vocabulary (page/card/subtle) is coarser than the surface ladder
 * the components read (surface-0..3).
 */
const SECTION_PROPERTY_MAP = {
  navbar: {
    bg: ['--navbar-bg'],
    text: ['--navbar-text'],
    border: ['--navbar-border'],
    search_bg: ['--navbar-search-bg'],
  },
  surfaces: {
    page: ['--surface-page', '--surface-0', '--surface-1'],
    card: ['--surface-card'],
    subtle: ['--surface-subtle', '--surface-2'],
    border: ['--border-subtle'],
  },
  brand: {
    primary: ['--brand', '--brand-primary'],
    hover: ['--brand-hover'],
    contrast: ['--brand-contrast'],
    secondary_bg: ['--btn-secondary-bg'],
    secondary_text: ['--btn-secondary-text'],
  },
  typography: {
    primary: ['--text-primary'],
    secondary: ['--text-secondary'],
    muted: ['--text-muted'],
    inverse: ['--text-inverse'],
  },
  badges: {
    success_bg: ['--success-bg'],
    success_text: ['--success'],
    warning_bg: ['--warning-bg'],
    warning_text: ['--warning'],
    danger_bg: ['--danger-bg'],
    danger_text: ['--danger'],
    info_bg: ['--info-bg'],
    info_text: ['--info'],
  },
  footer: {
    bg: ['--footer-bg'],
    text: ['--footer-text'],
    muted: ['--footer-muted'],
    border: ['--footer-border'],
  },
  flash_sale: {
    bg: ['--flash-bg'],
    text: ['--flash-text'],
    chip_bg: ['--flash-chip-bg'],
    tag_bg: ['--flash-tag-bg'],
    tag_text: ['--flash-tag-text'],
  },
};

/**
 * Applies a theme in real time.
 *
 * A theme may carry a `master` block (a seed colour plus harmony settings). When present, the
 * whole palette — every brand/neutral/status/accent ramp step and every semantic role, in BOTH
 * light and dark — is generated from it and mounted as a stylesheet, which is what makes borders,
 * hover fills, scrollbars and focus rings follow the seed. The 6 per-section token groups then
 * layer on top, but ONLY where the admin actually moved a swatch away from the generated value:
 * pinning an unchanged value inline would beat the [data-theme='dark'] rules and re-break the
 * light/dark switch for no benefit.
 */
export function applyTheme(tokens = {}) {
  if (!tokens || tokens === THEME_PRESETS.default.tokens) {
    currentTokens = { ...THEME_PRESETS.default.tokens };
    clearThemeOverrides();
    return;
  }

  currentTokens = tokens;
  const root = document.documentElement;

  let generated = null;
  if (tokens.master) {
    currentMaster = normaliseMasterConfig(tokens.master);
    generated = paletteToSectionTokens(applyMasterPalette(currentMaster));
  } else {
    currentMaster = null;
    clearMasterPalette();
  }

  clearSectionOverrides();

  for (const [section, keyMap] of Object.entries(SECTION_PROPERTY_MAP)) {
    const values = tokens[section];
    if (!values) continue;
    for (const [key, props] of Object.entries(keyMap)) {
      const value = values[key];
      if (!value) continue;
      // A value the master already generates needs no inline pin — and pinning it would cost the
      // dark theme. Only a hand-edited swatch gets forced.
      if (generated && generated[section]?.[key] === value) continue;
      props.forEach((prop) => root.style.setProperty(prop, value));
    }
  }
}

export function getCurrentTokens() {
  return currentTokens;
}

/** The master config backing the live theme, or null when none is active. */
export function getCurrentMaster() {
  return currentMaster;
}

/** A ready-to-apply theme for a master preset key: the seed config plus its generated sections. */
export function themeFromMasterPreset(presetKey) {
  const preset = MASTER_PRESETS[presetKey] || MASTER_PRESETS[DEFAULT_MASTER_PRESET];
  return themeFromMaster(preset.master);
}

/** Same, for an arbitrary (hand-tuned) master config. */
export function themeFromMaster(masterConfig) {
  const master = normaliseMasterConfig(masterConfig);
  return { master, ...paletteToSectionTokens(generatePalette(master)) };
}

/**
 * Migrates a palette published before the master engine existed. Its brand fill becomes the seed,
 * so the ramps, borders, hovers and dark theme it never carried are generated; its navbar and
 * footer are kept verbatim, because a deliberately dark header is identity rather than something
 * the generator should overrule. Shared with the Theme Studio's preset grid so the live site and
 * the studio preview cannot disagree about what a legacy palette looks like.
 */
export function themeFromLegacyTokens(tokens = {}) {
  const generated = themeFromMaster({
    ...DEFAULT_MASTER,
    seed: tokens.brand?.primary || DEFAULT_MASTER.seed,
    neutralMode: 'match',
    neutralTint: 1.3,
    statusPull: 0.25,
  });
  return {
    ...generated,
    navbar: { ...(tokens.navbar || generated.navbar) },
    footer: { ...(tokens.footer || generated.footer) },
    // No `flash_sale` carry-over: a pre-master palette never had one, so the generated strip is
    // the only value that exists and must not be replaced with an undefined.
    flash_sale: { ...(tokens.flash_sale || generated.flash_sale) },
  };
}

/**
 * Boots the runtime theme.
 *
 * The shipped default is mounted SYNCHRONOUSLY, before the API is asked anything: the master
 * engine — not themes.css — is what defines the product's colours now, and a published palette
 * only ever replaces that default. Waiting for the round trip first would leave the shell painting
 * the engine's pink calibration baseline for the whole request.
 */
export async function initTheme() {
  applyTheme(themeFromMasterPreset(DEFAULT_MASTER_PRESET));
  try {
    const { api } = await import('../core/api.js');
    const res = await api.get('/theme/active');
    // The previous condition tested `res.is_custom`, a field the theme controller never sends —
    // so a published palette was fetched and then silently discarded on every boot. Read the
    // shape the API actually returns instead.
    const tokens = res?.theme?.tokens_json || res?.tokens || null;
    if (tokens?.master) {
      applyTheme(tokens);
      return;
    }
    if (tokens?.brand?.primary) {
      applyTheme(themeFromLegacyTokens(tokens));
      return;
    }
  } catch {
    // Fall back to the default mounted above.
  }
  // Nothing published, or the call failed — the default mounted at the top of this function
  // stands. Deliberately NOT clearThemeOverrides(), which would strip it back to the authored
  // themes.css baseline and leave the product wearing a colour no longer chosen as its default.
}

