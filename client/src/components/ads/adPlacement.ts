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

// The live numbers are configuration: `ads.density` in platform_settings (migration 090), set at
// /admin/growth/ad-pricing and served by GET /ads/density. These are only the fallback for when that
// request fails, and must equal DEFAULT_DENSITY in server/src/services/adDensity.service.ts
// (server/test/adDensity.test.js). Search leads with an ad because the shopper has just said what
// they want; the feed opens on its own picks; one ad per eight is two full desktop rows.
export const AD_DENSITY: Record<InlinePlacement, AdDensity> = {
  SEARCH_RESULTS: { firstAt: 0, every: 8 },
  FEED: { firstAt: 2, every: 8 },
};

let densityRequest: Promise<Record<InlinePlacement, AdDensity>> | null = null;

/** The platform's density, fetched once per page load; the fallback above on any failure. */
export function fetchAdDensity(): Promise<Record<InlinePlacement, AdDensity>> {
  densityRequest ??= adsApi.getDensity().then((raw) => {
    const out = { ...AD_DENSITY };
    for (const p of Object.keys(AD_DENSITY) as InlinePlacement[]) {
      const row = raw?.[p];
      if (Number.isInteger(row?.first_at) && Number.isInteger(row?.every)) {
        out[p] = { firstAt: row.first_at, every: row.every };
      }
    }
    return out;
  });
  return densityRequest;
}

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

export interface InlineAds {
  ads: SponsoredAdData[];
  density: AdDensity;
}

/**
 * Fetches the winners and the density for one grid placement, and loads the ad stylesheet. Resolves
 * to no ads when the module is off, nothing won, or a request failed, so a grid that waits on it is
 * never held up by an error.
 */
export async function fetchInlineAds(
  placement: InlinePlacement,
  { keyword = '', limit = 3 }: { keyword?: string; limit?: number } = {}
): Promise<InlineAds> {
  const none = { ads: [], density: AD_DENSITY[placement] };
  if (!isFeatureEnabled('sponsored_ads')) return none;
  try {
    const [winners, density] = await Promise.all([
      adsApi.runAuction(placement, { keyword, limit }) as Promise<SponsoredAdData[]>,
      fetchAdDensity(),
    ]);
    if (!winners.length) return none;
    await loadSponsoredStyles();
    return { ads: winners, density: density[placement] };
  } catch {
    return none;
  }
}

export interface AdInterleaver {
  /** The ad card that goes in front of organic card `organicIndex`, or null. */
  at: (organicIndex: number) => HTMLElement | null;
  cleanup: () => void;
}

/** Hands a ProductGrid one ad card at each density position until the winners run out. */
export function adInterleaver(placement: InlinePlacement, { ads, density }: InlineAds): AdInterleaver {
  const slots: SponsoredSlot[] = [];
  return {
    at(organicIndex) {
      const n = adBefore(organicIndex, density);
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
