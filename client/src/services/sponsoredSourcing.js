/**
 * sponsoredSourcing.js — Client side of the Sponsored Sourcing Slot.
 *
 * Fetches the auction winners for the Sourcing Catalog and reports the two billable events:
 *   impression  the card was >= 50% visible for >= 1 second (same bar as SponsoredSlot)
 *   click       the saler acted on the card (calculate / add to store), reported once per ad
 *
 * WHY tracking never throws: a failed beacon must not stop a saler adding a product to their store.
 * The server decides what is billable (self-clicks, duplicates and the budget cap are all enforced
 * there), so nothing here is a billing authority.
 */
import { api } from '../core/api.js';
import { isFeatureEnabled } from './featureFlags.js';

export const VIEWABLE_MS = 1000;
export const PLACEMENT = 'SOURCING_CATALOG';

/** @returns {Promise<Array<{campaign_id:number, creative_id:number, charged_cpc:number, product:object}>>} */
export async function fetchSponsored({ categoryId } = {}) {
  // Module gate: no request at all when ads are switched off.
  if (!isFeatureEnabled('sponsored_ads')) return [];
  try {
    const query = categoryId ? { category_id: categoryId } : undefined;
    const { data } = await api.get('/sourcing/sponsored', { query });
    return data?.sponsored || [];
  } catch {
    return [];
  }
}

/** Fires the impression beacon once, when `el` has been mostly visible for VIEWABLE_MS. */
export function trackImpression(el, ad) {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  let timer = null;
  let done = false;

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        if (!timer && !done) {
          timer = setTimeout(() => {
            done = true;
            observer.disconnect();
            api.post('/ads/impressions', {
              campaign_id: ad.campaign_id,
              creative_id: ad.creative_id,
              placement: PLACEMENT,
              viewable: true,
            }).catch(() => {});
          }, VIEWABLE_MS);
        }
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  }, { threshold: [0.5] });
  observer.observe(el);

  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}

/** Returns a function that reports a click for `ad` the first time it is called. */
export function clickReporter(ad) {
  let sent = false;
  return () => {
    if (sent) return;
    sent = true;
    api.post('/ads/clicks', {
      campaign_id: ad.campaign_id,
      creative_id: ad.creative_id,
      charged_cpc: ad.charged_cpc,
    }).catch(() => {});
  };
}
