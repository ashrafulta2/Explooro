/**
 * PersonalizedRails — the themed product rows between the home page's tabs and its catalog grid
 * (Phase C of the personalized home feed).
 *
 * The server decides WHICH rails exist for this shopper and what is in them (GET /discovery/rails —
 * order, sizes and the ranking behind each are admin settings). This component only turns that into
 * rows: it names each rail, says honestly whether it is personal, and stays out of the way when there
 * is nothing worth showing.
 *
 * @param {object}   opts
 * @param {string}   [opts.role]
 * @param {object}   [opts.modules]
 * @param {string}   [opts.lang]
 * @param {function} [opts.onNavigate]
 * @param {function} [opts.onAction]
 * @param {boolean}  [opts.signedIn]  — whether the personalization settings page is reachable
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, setVisible: (v: boolean) => void, cleanup: () => void }}
 *
 * Invariants:
 *  - A failed or empty response renders nothing: the home page must look complete without rails.
 *  - A response that arrives after a newer request (or after cleanup) is discarded.
 *  - Changing the personalization preference refetches, so an opt-out is visible immediately.
 */

import { ProductRail, ProductRailSkeleton } from './ProductRail.js';
import { getRails } from '../../services/discovery.api.js';
import { onPersonalizationChange } from '../../services/signals.js';
import { t } from '../../services/i18n.js';

/** i18n keys for a rail's heading. for_you changes its wording when it is just the popular list. */
export function railCopy(rail) {
  const key = rail.key === 'for_you' && !rail.personalized ? 'for_you_popular' : rail.key;
  return {
    title: t(`discover.rails.${key}_title`),
    subtitle: t(`discover.rails.${key}_sub`),
  };
}

export function PersonalizedRails({
  role = 'customer',
  modules = {},
  lang = 'en',
  onNavigate = null,
  onAction = null,
  signedIn = false,
} = {}) {
  const el = document.createElement('div');
  el.className = 'home-rails';
  el.hidden = true;

  let generation = 0;
  let disposed = false;
  let railCleanups = [];
  let wanted = true;
  let loaded = false;

  const audience = role === 'saler' ? 'saler' : 'customer';

  function clear() {
    railCleanups.forEach((fn) => fn());
    railCleanups = [];
    el.replaceChildren();
  }

  function render(rails) {
    clear();
    if (!rails.length) {
      el.hidden = true;
      return;
    }
    for (const rail of rails) {
      const copy = railCopy(rail);
      const { el: railEl, cleanup } = ProductRail({
        railKey: rail.key,
        title: copy.title,
        subtitle: copy.subtitle,
        products: rail.products,
        role,
        modules,
        lang,
        onNavigate,
        onAction,
        // Only offered where the page exists for the viewer: it needs an account.
        note:
          rail.personalized && signedIn && onNavigate
            ? { label: t('discover.rails.manage'), onClick: () => onNavigate('/settings/notifications') }
            : null,
      });
      railCleanups.push(cleanup);
      el.append(railEl);
    }
    el.hidden = !wanted;
  }

  async function refresh() {
    const mine = ++generation;
    if (!loaded) {
      // First load only: reserve the space. A refetch keeps the rows on screen until the new ones land.
      clear();
      el.append(ProductRailSkeleton());
      el.hidden = !wanted;
    }
    let rails = [];
    try {
      rails = await getRails({ audience });
    } catch {
      // No rails is a complete home page; an error banner above the catalog would not be.
    }
    if (disposed || mine !== generation) return;
    loaded = true;
    render(rails);
  }

  /** The rails belong to the unfiltered landing view; hide (without refetching) while a filter is active. */
  function setVisible(visible) {
    wanted = Boolean(visible);
    el.hidden = !wanted || !el.firstElementChild;
  }

  const stopConsent = onPersonalizationChange(() => {
    if (loaded) refresh();
  });

  function cleanup() {
    disposed = true;
    stopConsent();
    clear();
  }

  return { el, refresh, setVisible, cleanup };
}
