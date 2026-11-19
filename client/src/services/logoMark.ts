/**
 * logoMark.ts — the Explooro brand mark: a four-point sparkle punched with a circle, on a badge.
 *
 * Single source of truth for the mark's geometry so the live, theme-reactive logo (icons.ts,
 * painted with CSS custom properties so it repaints with the Master Colour engine — any preset
 * *and* any custom seed from Theme Studio, not just the shipped presets) and the static files
 * scripts/logo.mjs bakes per theme (favicon, PWA icons, docs/marketing use) never drift apart.
 *
 * The sparkle path has exact 4-fold rotational symmetry around (50,50) in a 0..100 viewBox — each
 * of the 4 cubic-bezier segments is the same curve rotated 90°, so every point is identical.
 */

import { BRAND_STEPS, contrastRatio } from './colorRamp.ts';
import type { Palette } from './colorRamp.ts';

export const LOGO_SPARKLE_PATH =
  'M50,4 C58,34 66,42 96,50 C66,58 58,66 50,96 C42,66 34,58 4,50 C34,42 42,34 50,4 Z';

export const LOGO_BADGE_RADIUS = 48;
export const LOGO_HOLE_RADIUS = 9;
/** How much the maskable variant shrinks the mark so an OS circle/squircle crop never cuts it. */
export const LOGO_MASKABLE_SCALE = 0.8;

export interface LogoStop {
  offset: number;
  color: string;
}

/**
 * The sparkle's gold, top-left to bottom-right across the sparkle's own bounding box. It is only
 * the fallback now: a live theme paints the sparkle from its own brand ramp (logoColorsFromPalette).
 */
export const LOGO_GOLD_STOPS: ReadonlyArray<LogoStop> = [
  { offset: 0, color: '#ffe58f' },
  { offset: 0.45, color: '#ffbc00' },
  { offset: 1, color: '#d98200' },
];

/** The badge's own colours: a dark disc and hole, and the sparkle's three gradient stops. */
export interface LogoColors {
  bg: string;
  hole: string;
  stops: LogoStop[];
}

/** The sparkle must stand out from the dark badge at least as much as any graphic (WCAG 1.4.11). */
export const LOGO_STAR_MIN_CONTRAST = 3;

/**
 * The mark's colours for a palette: the sparkle runs through the theme's own brand ramp, centred
 * on the seed's step, on the palette's darkest working neutral.
 *
 * WHY derive and not keep the gold (owner, 2026-11-20): the mark was locked to gold on 2026-08-26
 * so it stayed legible on every preset, but then it was the one thing on screen that did not
 * follow a re-theme. Legibility is kept by rule instead of by a fixed colour: the middle stop
 * walks toward the light end of the ramp until it has 3:1 on the badge (a dark seed such as
 * midnight slate would otherwise vanish into it), and the dark stop never drops below that line.
 */
export function logoColorsFromPalette(palette: Pick<Palette, 'brand' | 'neutral' | 'meta'>): LogoColors {
  const bg = palette.neutral[900];
  const passes = (i: number) => contrastRatio(palette.brand[BRAND_STEPS[i]], bg) >= LOGO_STAR_MIN_CONTRAST;
  let mid = Math.max(0, BRAND_STEPS.indexOf(palette.meta.anchorStep));
  while (mid > 0 && !passes(mid)) mid--;
  let dark = Math.min(mid + 2, BRAND_STEPS.length - 1);
  while (dark > mid && !passes(dark)) dark--;
  const light = Math.max(mid - 2, 0);
  const step = (i: number) => palette.brand[BRAND_STEPS[i]];
  return {
    bg,
    hole: bg,
    stops: [
      { offset: 0, color: step(light) },
      { offset: 0.45, color: step(mid) },
      { offset: 1, color: step(dark) },
    ],
  };
}

/** A stop as SVG: a literal colour as the attribute, a `var(…)` as a style (attributes take no var()). */
function stopSvg({ offset, color }: LogoStop): string {
  const paint = color.includes('var(') ? `style="stop-color: ${color}"` : `stop-color="${color}"`;
  return `<stop offset="${Math.round(offset * 100)}%" ${paint} />`;
}

function stopsSvg(stops: ReadonlyArray<LogoStop>): string {
  return stops.map(stopSvg).join('\n        ');
}

/** SVG paints (a colour or `var(--…)`) and the sparkle's gradient stops (gold when omitted). */
export interface LogoPaints {
  bg?: string;
  hole?: string;
  stops?: ReadonlyArray<LogoStop>;
}

/** The circular badge: background disc + sparkle + centre hole. Used at any size. */
export function buildLogoMarkSvg({
  size = 28,
  className = '',
  bg,
  hole,
  stops = LOGO_GOLD_STOPS,
}: LogoPaints & { size?: number; className?: string } = {}): string {
  const gradId = `explooro-sparkle-gold-${size}`;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}"${className ? ` class="${className}"` : ''} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
        ${stopsSvg(stops)}
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="${LOGO_BADGE_RADIUS}" fill="${bg}" />
    <path d="${LOGO_SPARKLE_PATH}" fill="url(#${gradId})" />
    <circle cx="50" cy="50" r="${LOGO_HOLE_RADIUS}" fill="${hole}" />
  </svg>`;
}

/**
 * Full-bleed variant for maskable PWA icons: background fills the entire square (so an OS mask
 * crops background, never transparency) and the mark is scaled to 80% so it survives circle/squircle
 * cropping (the maskable spec's "safe zone").
 */
export function buildLogoMaskableSvg({ size = 512, bg, hole, stops = LOGO_GOLD_STOPS }: LogoPaints & { size?: number } = {}): string {
  const gradId = `explooro-sparkle-gold-mask`;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
        ${stopsSvg(stops)}
      </linearGradient>
    </defs>
    <rect width="100" height="100" fill="${bg}" />
    <g transform="translate(50 50) scale(${LOGO_MASKABLE_SCALE}) translate(-50 -50)">
      <path d="${LOGO_SPARKLE_PATH}" fill="url(#${gradId})" />
      <circle cx="50" cy="50" r="${LOGO_HOLE_RADIUS}" fill="${hole}" />
    </g>
  </svg>`;
}
