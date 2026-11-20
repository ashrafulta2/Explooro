/**
 * logoTheme.ts — keeps the brand mark and the browser-tab favicon in the live theme's colours.
 *
 * The in-app mark (icons.ts getExplooroLogoSvg) reads --logo-ring-1 and --logo-ring-2, set here
 * from the palette. The favicon is a separate document that cannot read the page's CSS, so it is
 * re-drawn with the same colours and swapped in as a data: URL. Both come from one function,
 * logoColorsFromPalette, which scripts/logo.mjs also bakes the static icons with, so the tab, the
 * top bar and the installed icon of the shipped default are the same picture.
 *
 * WHY the static favicon.svg stays the first thing loaded: a browser asks for the icon before any
 * script runs. It is the shipped default's mark; this replaces it once a theme is applied.
 */

import { buildLogoMarkSvg, logoColorsFromPalette } from './logoMark.ts';
import type { Palette } from './colorRamp.ts';

const RING_VARS = ['--logo-ring-1', '--logo-ring-2'] as const;

/** The href index.html shipped with, so a reset can put the static file back. */
let shippedFavicon: string | null = null;

function faviconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]');
}

/** The favicon for a palette, as the data: URL a <link rel="icon"> can take. */
export function faviconHrefFor(palette: Pick<Palette, 'brand' | 'neutral' | 'meta'>): string {
  const { ring1, ring2 } = logoColorsFromPalette(palette);
  return `data:image/svg+xml,${encodeURIComponent(buildLogoMarkSvg({ size: 32, ring1, ring2 }))}`;
}

/**
 * Paints the mark and the favicon from `palette`, or puts back the shipped look when it is null
 * (the default theme, or a legacy theme with no master palette).
 */
export function applyLogoTheme(palette: Pick<Palette, 'brand' | 'neutral' | 'meta'> | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const link = faviconLink();
  if (link && shippedFavicon === null) shippedFavicon = link.getAttribute('href');

  if (!palette) {
    RING_VARS.forEach((v) => root.style.removeProperty(v));
    if (link && shippedFavicon) {
      link.setAttribute('href', shippedFavicon);
      link.setAttribute('type', 'image/svg+xml');
    }
    return;
  }

  const { ring1, ring2 } = logoColorsFromPalette(palette);
  root.style.setProperty(RING_VARS[0], ring1);
  root.style.setProperty(RING_VARS[1], ring2);
  if (link) {
    link.setAttribute('type', 'image/svg+xml');
    link.setAttribute('href', faviconHrefFor(palette));
  }
}
