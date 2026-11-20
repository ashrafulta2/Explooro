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
/**
 * How far the sparkle is shrunk inside its badge. WHY (owner, 2026-11-20): with a white sparkle on
 * a brand badge, points that reach the rim cut the disc into four slices; at 80% the badge reads as
 * one round shape with the sparkle inside it.
 */
export const LOGO_SPARKLE_SCALE = 0.8;
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

/** The badge's own colours: the disc and hole, and the sparkle's three gradient stops. */
export interface LogoColors {
  bg: string;
  hole: string;
  stops: LogoStop[];
}

/** The sparkle must stand out from the badge at least as much as any graphic (WCAG 1.4.11). */
export const LOGO_STAR_MIN_CONTRAST = 3;

/**
 * The mark's colours for a palette: a badge in the theme's own brand colour with a near-white
 * sparkle (the palette's lightest neutral) punched through it.
 *
 * WHY a brand badge and not a dark one (owner, 2026-11-20): the dark neutral disc under a blue
 * sparkle read as two unrelated colours. The badge now starts at the seed's own step and walks
 * toward the dark end of the ramp until the white sparkle has 3:1 on it, so a light seed (gold,
 * pink) gets a deeper shade of itself rather than an illegible pale disc.
 */
export function logoColorsFromPalette(palette: Pick<Palette, 'brand' | 'neutral' | 'meta'>): LogoColors {
  const star = palette.neutral[0];
  const step = (i: number) => palette.brand[BRAND_STEPS[i]];
  let i = Math.max(0, BRAND_STEPS.indexOf(palette.meta.anchorStep));
  while (i < BRAND_STEPS.length - 1 && contrastRatio(star, step(i)) < LOGO_STAR_MIN_CONTRAST) i++;
  const bg = step(i);
  return {
    bg,
    hole: bg,
    stops: [
      { offset: 0, color: star },
      { offset: 0.45, color: star },
      { offset: 1, color: star },
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

const SPARKLE_TRANSFORM = ` transform="translate(50 50) scale(${LOGO_SPARKLE_SCALE}) translate(-50 -50)"`;

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
    <path d="${LOGO_SPARKLE_PATH}" fill="url(#${gradId})"${SPARKLE_TRANSFORM} />
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
      <path d="${LOGO_SPARKLE_PATH}" fill="url(#${gradId})"${SPARKLE_TRANSFORM} />
      <circle cx="50" cy="50" r="${LOGO_HOLE_RADIUS}" fill="${hole}" />
    </g>
  </svg>`;
}
