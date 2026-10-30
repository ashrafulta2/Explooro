/**
 * adPlacement.ts — where paid cards sit inside an organic product grid (search results, home feed).
 *
 * An ad drawn as a strip above the results reads as "the ad bit" and is skipped. Drawn inside the
 * grid, at the same size as every other card, it is seen as a product, and its amber border and
 * "Sponsored" tag still say plainly that it was paid for. The density rule below is what keeps that
 * from turning into a page full of ads.
 */

import { adsApi } from '../../services/ads.api.ts';
import { isFeatureEnabled } from '../../services/featureFlags.ts';
import { loadSponsoredStyles } from '../../styles/loadSponsoredStyles.ts';
import { SponsoredSlot } from './SponsoredSlot.ts';
import type { SponsoredAdData } from './SponsoredSlot.ts';

export type InlinePlacement = 'SEARCH_RESULTS' | 'FEED';

export interface AdDensity {
  /** Organic index the first ad goes in front of (0 = the very first card). */
  firstAt: number;
  /** Organic cards between one ad and the next. */
  every: number;
}

// WHY these numbers: search puts its first ad first because the shopper has just said what they want,
// so a matching paid product is useful there. The feed waits two cards so the page opens on its own
// picks. One ad per eight organic cards is two full rows on desktop, which keeps ads out of the same
// row and never side by side. They are presentation rules, not prices; the auction's `limit` caps
// how many ads a page gets at all.
export const AD_DENSITY: Record<InlinePlacement, AdDensity> = {
  SEARCH_RESULTS: { firstAt: 0, every: 8 },
  FEED: { firstAt: 2, every: 8 },
};

/**
 * Which ad (0-based) goes immediately in front of organic card `organicIndex`, or -1 for none.
 * `every` below 2 is raised to 2: two ads must never touch.
 */
export function adBefore(organicIndex: number, { firstAt, every }: AdDensity): number {
  const gap = Math.max(2, Math.floor(every));
  const start = Math.max(0, Math.floor(firstAt));
  if (organicIndex < start || (organicIndex - start) % gap !== 0) return -1;
  return (organicIndex - start) / gap;
}

/**
 * Fetches the winners for one grid placement and loads the ad stylesheet. Resolves to [] when the
 * module is off, nothing won, or the request failed, so a grid that waits on it is never held up by
 * an error.
 */
export async function fetchInlineAds(
  placement: InlinePlacement,
  { keyword = '', limit = 3 }: { keyword?: string; limit?: number } = {}
): Promise<SponsoredAdData[]> {
  if (!isFeatureEnabled('sponsored_ads')) return [];
  try {
    const winners = (await adsApi.runAuction(placement, { keyword, limit })) as SponsoredAdData[];
    if (!winners.length) return [];
    await loadSponsoredStyles();
    return winners;
  } catch {
    return [];
  }
}

export interface AdInterleaver {
  /** The ad card that goes in front of organic card `organicIndex`, or null. */
  at: (organicIndex: number) => HTMLElement | null;
  cleanup: () => void;
}

/** Hands a ProductGrid one ad card at each density position until the winners run out. */
export function adInterleaver(placement: InlinePlacement, ads: SponsoredAdData[]): AdInterleaver {
  const slots: SponsoredSlot[] = [];
  return {
    at(organicIndex) {
      const n = adBefore(organicIndex, AD_DENSITY[placement]);
      const ad = n >= 0 ? ads[n] : null;
      if (!ad) return null;
      const slot = new SponsoredSlot({ ad, variant: 'card', placement });
      slots.push(slot);
      return slot.render();
    },
    cleanup() {
      slots.forEach((s) => s.destroy());
      slots.length = 0;
    },
  };
}
