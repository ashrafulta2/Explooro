/**
 * themePalette.js — Client runtime theme applier, WCAG AA contrast calculator & token validator (Prompt 3.5).
 */

import { THEME_PRESETS } from '../config/theme-presets.js';

let currentTokens = { ...THEME_PRESETS.default.tokens };

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

  return {
    isValid: failures.length === 0,
    failures,
  };
}

export function clearThemeOverrides() {
  const root = document.documentElement;
  const props = [
    '--navbar-bg', '--navbar-text', '--navbar-border', '--navbar-search-bg',
    '--surface-page', '--surface-0', '--surface-1', '--surface-card', '--surface-subtle', '--surface-2', '--border-subtle',
    '--brand', '--brand-primary', '--brand-hover', '--brand-contrast', '--btn-secondary-bg', '--btn-secondary-text',
    '--text-primary', '--text-secondary', '--text-muted', '--text-inverse',
    '--success-bg', '--success', '--warning-bg', '--warning', '--danger-bg', '--danger', '--info-bg', '--info',
    '--footer-bg', '--footer-text', '--footer-muted', '--footer-border',
  ];
  props.forEach((p) => root.style.removeProperty(p));
}

/**
 * Applies token custom properties to the document root element in real time.
 */
export function applyTheme(tokens = {}) {
  if (!tokens || tokens === THEME_PRESETS.default.tokens) {
    currentTokens = { ...THEME_PRESETS.default.tokens };
    clearThemeOverrides();
    return;
  }
  currentTokens = tokens;
  const root = document.documentElement;

  const nav = tokens.navbar || {};
  const surf = tokens.surfaces || {};
  const brand = tokens.brand || {};
  const typo = tokens.typography || {};
  const badges = tokens.badges || {};
  const footer = tokens.footer || {};

  // Navbar tokens
  if (nav.bg) root.style.setProperty('--navbar-bg', nav.bg);
  if (nav.text) root.style.setProperty('--navbar-text', nav.text);
  if (nav.border) root.style.setProperty('--navbar-border', nav.border);
  if (nav.search_bg) root.style.setProperty('--navbar-search-bg', nav.search_bg);

  // Surfaces & Canvas tokens
  if (surf.page) {
    root.style.setProperty('--surface-page', surf.page);
    root.style.setProperty('--surface-0', surf.page);
    root.style.setProperty('--surface-1', surf.page);
  }
  if (surf.card) root.style.setProperty('--surface-card', surf.card);
  if (surf.subtle) {
    root.style.setProperty('--surface-subtle', surf.subtle);
    root.style.setProperty('--surface-2', surf.subtle);
  }
  if (surf.border) root.style.setProperty('--border-subtle', surf.border);

  // Brand / Button tokens
  if (brand.primary) {
    root.style.setProperty('--brand', brand.primary);
    root.style.setProperty('--brand-primary', brand.primary);
  }
  if (brand.hover) root.style.setProperty('--brand-hover', brand.hover);
  if (brand.contrast) root.style.setProperty('--brand-contrast', brand.contrast);
  if (brand.secondary_bg) root.style.setProperty('--btn-secondary-bg', brand.secondary_bg);
  if (brand.secondary_text) root.style.setProperty('--btn-secondary-text', brand.secondary_text);

  // Typography tokens
  if (typo.primary) root.style.setProperty('--text-primary', typo.primary);
  if (typo.secondary) root.style.setProperty('--text-secondary', typo.secondary);
  if (typo.muted) root.style.setProperty('--text-muted', typo.muted);
  if (typo.inverse) root.style.setProperty('--text-inverse', typo.inverse);

  // Badge tokens
  if (badges.success_bg) root.style.setProperty('--success-bg', badges.success_bg);
  if (badges.success_text) root.style.setProperty('--success', badges.success_text);
  if (badges.warning_bg) root.style.setProperty('--warning-bg', badges.warning_bg);
  if (badges.warning_text) root.style.setProperty('--warning', badges.warning_text);
  if (badges.danger_bg) root.style.setProperty('--danger-bg', badges.danger_bg);
  if (badges.danger_text) root.style.setProperty('--danger', badges.danger_text);
  if (badges.info_bg) root.style.setProperty('--info-bg', badges.info_bg);
  if (badges.info_text) root.style.setProperty('--info', badges.info_text);

  // Footer tokens
  if (footer.bg) root.style.setProperty('--footer-bg', footer.bg);
  if (footer.text) root.style.setProperty('--footer-text', footer.text);
  if (footer.muted) root.style.setProperty('--footer-muted', footer.muted);
  if (footer.border) root.style.setProperty('--footer-border', footer.border);
}

export function getCurrentTokens() {
  return currentTokens;
}

/**
 * Initializes active theme from server or default fallback on boot.
 */
export async function initTheme() {
  try {
    const { api } = await import('../core/api.js');
    const res = await api.get('/theme/active');
    if (res?.tokens && res?.is_custom) {
      applyTheme(res.tokens);
      return;
    }
  } catch {
    // Fall back to default
  }
  clearThemeOverrides();
}

