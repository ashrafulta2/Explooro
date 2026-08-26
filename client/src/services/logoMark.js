/**
 * logoMark.js — the Explooro brand mark: a four-point sparkle punched with a circle, on a badge.
 *
 * Single source of truth for the mark's geometry so the live, theme-reactive logo (icons.js,
 * painted with CSS custom properties so it repaints with the Master Colour engine — any preset
 * *and* any custom seed from Theme Studio, not just the shipped presets) and the static files
 * scripts/logo.mjs bakes per theme (favicon, PWA icons, docs/marketing use) never drift apart.
 *
 * The sparkle path has exact 4-fold rotational symmetry around (50,50) in a 0..100 viewBox — each
 * of the 4 cubic-bezier segments is the same curve rotated 90°, so every point is identical.
 */

export const LOGO_SPARKLE_PATH =
  'M50,4 C58,34 66,42 96,50 C66,58 58,66 50,96 C42,66 34,58 4,50 C34,42 42,34 50,4 Z';

export const LOGO_BADGE_RADIUS = 48;
export const LOGO_HOLE_RADIUS = 9;

/** The circular badge: background disc + sparkle + centre hole. Used at any size. */
export function buildLogoMarkSvg({ size = 28, className = '', bg, star, hole } = {}) {
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}"${className ? ` class="${className}"` : ''} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="50" cy="50" r="${LOGO_BADGE_RADIUS}" fill="${bg}" />
    <path d="${LOGO_SPARKLE_PATH}" fill="${star}" />
    <circle cx="50" cy="50" r="${LOGO_HOLE_RADIUS}" fill="${hole}" />
  </svg>`;
}

/**
 * Full-bleed variant for maskable PWA icons: background fills the entire square (so an OS mask
 * crops background, never transparency) and the mark is scaled to 80% so it survives circle/squircle
 * cropping (the maskable spec's "safe zone").
 */
export function buildLogoMaskableSvg({ size = 512, bg, star, hole } = {}) {
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="100" height="100" fill="${bg}" />
    <g transform="translate(50 50) scale(0.8) translate(-50 -50)">
      <path d="${LOGO_SPARKLE_PATH}" fill="${star}" />
      <circle cx="50" cy="50" r="${LOGO_HOLE_RADIUS}" fill="${hole}" />
    </g>
  </svg>`;
}
