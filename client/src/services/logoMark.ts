/**
 * logoMark.ts — the Explooro brand mark: two linked rings, the "OO" in the name.
 *
 * WHY two rings (owner, 2026-11-20): the platform is a link between two sides, the supplier who
 * holds stock and the Explooro partner who sells it, and the name carries that pair as its "OO".
 * The rings interlock like a chain: the right ring passes over the left at the top crossing and
 * under it at the bottom one.
 *
 * Single source of truth for the mark's geometry so the live, theme-reactive logo (icons.ts,
 * painted with CSS custom properties so it repaints with the Master Colour engine — any preset
 * *and* any custom seed from Theme Studio) and the static files scripts/logo.mjs bakes per theme
 * (favicon, PWA icons, link-preview banner) never drift apart. scripts/logoPng.mjs paints the same
 * numbers to PNG.
 */

import { BRAND_STEPS, contrastRatio } from './colorRamp.ts';
import type { Palette } from './colorRamp.ts';

/** Ring centres in a 0..100 viewBox. They cross at (50, 30) and (50, 70). */
export const LOGO_RING_LEFT = { cx: 35, cy: 50 } as const;
export const LOGO_RING_RIGHT = { cx: 65, cy: 50 } as const;
export const LOGO_RING_RADIUS = 25;
export const LOGO_RING_WIDTH = 11;
/**
 * Below this y the left ring is drawn over the right one. The rings only overlap at their two
 * crossings, so this one line is what makes them interlock instead of lying on top of each other.
 */
export const LOGO_LINK_Y = 50;
/** How much the maskable variant shrinks the mark so an OS circle/squircle crop never cuts it. */
export const LOGO_MASKABLE_SCALE = 0.8;

/** The mark's colours: the two rings, and the tile behind them on full-bleed app icons. */
export interface LogoColors {
  /** Left ring: the theme's brand colour, dark enough to read on a light page. */
  ring1: string;
  /** Right ring: a lighter step of the same ramp, so the pair reads as two linked things. */
  ring2: string;
  /** The square behind the rings on maskable and iOS icons, which may not be transparent. */
  bg: string;
}

/** The left ring must read on the lightest surface at least as much as any graphic (WCAG 1.4.11). */
export const LOGO_RING_MIN_CONTRAST = 3;
/** How many ramp steps lighter the right ring is than the left. */
export const LOGO_RING_STEP_GAP = 2;

/** The rings' colours before any theme loads. */
// The shipped default's colours (macos_native); client/test/logoTheme.test.js fails if they drift.
export const LOGO_FALLBACK_COLORS: LogoColors = { ring1: '#007aff', ring2: '#73adff', bg: '#fcfcfc' };

/**
 * The mark's colours for a palette, all from the theme's own brand ramp.
 *
 * The left ring starts at the seed's step and walks toward the dark end until it has 3:1 on the
 * lightest neutral (a light seed such as gold would otherwise vanish on a white top bar); the
 * right ring sits LOGO_RING_STEP_GAP steps lighter. The full-bleed icon tile is that lightest
 * neutral, so the installed icon is the same picture as the top bar's.
 */
export function logoColorsFromPalette(palette: Pick<Palette, 'brand' | 'neutral' | 'meta'>): LogoColors {
  const bg = palette.neutral[0];
  const step = (i: number) => palette.brand[BRAND_STEPS[i]];
  let i = Math.max(0, BRAND_STEPS.indexOf(palette.meta.anchorStep));
  while (i < BRAND_STEPS.length - 1 && contrastRatio(step(i), bg) < LOGO_RING_MIN_CONTRAST) i++;
  return { ring1: step(i), ring2: step(Math.max(0, i - LOGO_RING_STEP_GAP)), bg };
}

/** A paint as an SVG attribute: a literal colour as the attribute, a `var(…)` as a style (attributes take no var()). */
function paintAttr(prop: 'stroke' | 'fill', color: string): string {
  return color.includes('var(') ? `style="${prop}: ${color}"` : `${prop}="${color}"`;
}

/** The two rings and the over-strand of the left one, with the clip that cuts that strand. */
function ringsSvg(ring1: string, ring2: string, clipId: string): string {
  const { cx: lx, cy: ly } = LOGO_RING_LEFT;
  const { cx: rx, cy: ry } = LOGO_RING_RIGHT;
  const ring = (cx: number, cy: number, color: string, clip = '') =>
    `<circle cx="${cx}" cy="${cy}" r="${LOGO_RING_RADIUS}" fill="none" ${paintAttr('stroke', color)} stroke-width="${LOGO_RING_WIDTH}"${clip} />`;
  return `<defs><clipPath id="${clipId}"><rect x="0" y="${LOGO_LINK_Y}" width="100" height="${100 - LOGO_LINK_Y}" /></clipPath></defs>
    ${ring(lx, ly, ring1)}
    ${ring(rx, ry, ring2)}
    ${ring(lx, ly, ring1, ` clip-path="url(#${clipId})"`)}`;
}

/** SVG paints (a colour or `var(--…)`) for the rings and the icon tile. */
export type LogoPaints = Partial<LogoColors>;

/** The mark on transparency. Used at any size. */
export function buildLogoMarkSvg({
  size = 28,
  className = '',
  ring1 = LOGO_FALLBACK_COLORS.ring1,
  ring2 = LOGO_FALLBACK_COLORS.ring2,
}: LogoPaints & { size?: number; className?: string } = {}): string {
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}"${className ? ` class="${className}"` : ''} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    ${ringsSvg(ring1, ring2, `explooro-link-${size}`)}
  </svg>`;
}

/**
 * Full-bleed variant for maskable PWA icons: the tile fills the entire square (so an OS mask crops
 * the tile, never transparency) and the mark is scaled to 80% so it survives circle/squircle
 * cropping (the maskable spec's "safe zone").
 */
export function buildLogoMaskableSvg({
  size = 512,
  ring1 = LOGO_FALLBACK_COLORS.ring1,
  ring2 = LOGO_FALLBACK_COLORS.ring2,
  bg = LOGO_FALLBACK_COLORS.bg,
}: LogoPaints & { size?: number } = {}): string {
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="100" height="100" ${paintAttr('fill', bg)} />
    <g transform="translate(50 50) scale(${LOGO_MASKABLE_SCALE}) translate(-50 -50)">
      ${ringsSvg(ring1, ring2, 'explooro-link-mask')}
    </g>
  </svg>`;
}
