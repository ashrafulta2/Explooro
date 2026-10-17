/**
 * SponsoredStrip.js — a row of paid ads for one surface (search results, home feed, product page).
 *
 * Fetches the auction winners for `placement`, draws each as a SponsoredSlot, and stays completely
 * out of the way otherwise: no winner, the `sponsored_ads` module off, or a failed request all leave
 * an empty hidden container, so a page never has a hole where an ad "should" be.
 *
 * The strip is for METERED formats (CPC/CPM). Prepaid formats (hero, category banner, store
 * directory, live lobby, flash strip) are booked slots served by adsApi.listReservedPlacements.
 */

import { adsApi } from '../../services/ads.api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { loadSponsoredStyles } from '../../styles/loadSponsoredStyles.js';
import { SponsoredSlot } from './SponsoredSlot.js';

/**
 * @param {Object} options
 * @param {'SEARCH_RESULTS'|'FEED'|'PRODUCT_PAGE'} options.placement
 * @param {'card'|'banner'|'feed'} [options.variant='card']
 * @param {string} [options.keyword]
 * @param {number|string} [options.categoryId]
 * @param {number} [options.limit=3]
 * @param {Array<Object>} [options.ads] - Pre-fetched winners (skips the request; used by the gallery).
 * @returns {{ el: HTMLElement, cleanup: () => void }}
 */
export function SponsoredStrip({ placement, variant = 'card', keyword = '', categoryId = null, limit = 3, ads = null } = {}) {
  const el = document.createElement('div');
  el.className = `sponsored-strip sponsored-strip--${variant}`;
  el.dataset.placement = placement;
  el.hidden = true;

  const slots = [];
  let destroyed = false;

  async function load() {
    if (!isFeatureEnabled('sponsored_ads')) return;
    const winners = ads ?? (await adsApi.runAuction(placement, { keyword, categoryId, limit }));
    if (destroyed || !winners.length) return;

    await loadSponsoredStyles();
    if (destroyed) return;

    for (const ad of winners) {
      const slot = new SponsoredSlot({ ad, variant, placement });
      slots.push(slot);
      el.append(slot.render());
    }
    el.hidden = false;
  }

  load();

  return {
    el,
    cleanup() {
      destroyed = true;
      slots.forEach((s) => s.destroy());
      slots.length = 0;
    },
  };
}
