/**
 * BandAdRotator — lets a panel of the home page's top band take turns with the ads booked for it
 * (Home Top Band — Left / Centre / Right, migration 111).
 *
 * The panel is wrapped as it is built and shows alone until ads arrive. Once they do, the wrapper
 * plays: panel → ad 1 → panel → ad 2 → panel → … Each ad shows for AD_MS, the panel for PANEL_MS.
 *
 * WHY the panel comes back after every ad instead of the ads playing in a row: the panels hold the
 * viewer's own work (orders to pack, figures, shortcuts). An ad may borrow the space for a moment,
 * never keep it, so the panel is always the first thing shown and is never more than one ad away.
 * WHY the ad card is drawn to the panel's size (`contain: size` in the sheet): a booked ad must never
 * change the band's height, or the feed below would jump every time it rotated.
 *
 * Rotation pauses under the pointer and keyboard focus, and never moves on its own for a visitor who
 * asked for reduced motion (the dots still let them step through). Hidden slides are inert.
 */

import { t } from '../../services/i18n.ts';
import { api } from '../../core/api.ts';
import { HOME_BAND_PLACEMENTS } from '../../services/ads.api.ts';
import type { HomeBandPosition, ReservedPlacement } from '../../services/ads.api.ts';

export const PANEL_MS = 9000;
export const AD_MS = 6000;
// WHY staggered: three panels flipping on the same tick make the whole band jump at once.
export const START_OFFSET_MS: Record<HomeBandPosition, number> = { left: 0, center: 2000, right: 4000 };

const CTA_KEYS: Record<string, string> = {
  SHOP_NOW: 'cta_shop_now', LEARN_MORE: 'cta_learn_more', GET_OFFER: 'cta_get_offer', VIEW_PRODUCT: 'cta_view_product',
};

/**
 * Pure. The play order for a panel and its ads: the panel (-1) before every ad (its index).
 * `[]` ads → `[-1]`, two ads → `[-1, 0, -1, 1]`.
 */
export function playOrder(adCount: number): number[] {
  const order = [-1];
  for (let i = 0; i < adCount; i += 1) order.push(i, -1);
  order.pop();
  return adCount > 0 ? order : [-1];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string | null): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Opens an ad's destination: an outside link in a new tab, our own path through the router. */
function openDestination(ad: ReservedPlacement, onNavigate: (path: string) => void) {
  if (/^https?:\/\//.test(ad.destinationUrl)) window.open(ad.destinationUrl, '_blank', 'noopener,noreferrer');
  else if (ad.destinationUrl) onNavigate(ad.destinationUrl);
}

/**
 * One ad, drawn for its panel: a tall card (image on top) for the side panels, a wide card (text left,
 * image right) for the centre. Without an image it is a solid brand card with the headline set large.
 */
export function BandAdCard(ad: ReservedPlacement, position: HomeBandPosition, { onNavigate }: { onNavigate: (path: string) => void }): HTMLElement {
  const shape = position === 'center' ? 'wide' : 'tall';
  const card = el('article', `band-ad band-ad--${shape}${ad.bannerImageUrl ? '' : ' band-ad--text'}`);
  card.setAttribute('aria-label', `${t('marketplace.top.sponsored')}: ${ad.headline}`);

  if (ad.bannerImageUrl) {
    const media = el('div', 'band-ad__media');
    const img = el('img', 'band-ad__img');
    img.src = ad.bannerImageUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // A broken image falls back to the text design instead of an empty box.
    img.addEventListener('error', () => { media.remove(); card.classList.add('band-ad--text'); });
    media.append(img);
    card.append(media);
  }

  const body = el('div', 'band-ad__body');
  body.append(
    el('span', 'band-ad__tag', t('marketplace.top.sponsored')),
    el('h2', 'band-ad__title', ad.headline),
  );
  if (ad.description) body.append(el('p', 'band-ad__sub', ad.description));
  const go = el('button', 'band-ad__cta', `${t(`ads.slot.${CTA_KEYS[ad.callToAction] || 'cta_shop_now'}`)} ›`);
  go.type = 'button';
  go.addEventListener('click', () => {
    api.post('/ads/clicks', { campaign_id: ad.campaignId, creative_id: ad.creativeId }).catch(() => {});
    openDestination(ad, onNavigate);
  });
  body.append(go);
  card.append(body);
  return card;
}

export interface BandAdRotatorParts {
  el: HTMLElement;
  /** Adds the panel's booked ads and starts the rotation. Call once; an empty list changes nothing. */
  addAds(ads: ReservedPlacement[]): void;
  cleanup(): void;
}

export interface BandAdRotatorOptions {
  onNavigate: (path: string) => void;
  /** Extra class for the wrapper, e.g. to hide it with its panel on narrow screens. */
  className?: string;
}

export function BandAdRotator(panel: HTMLElement, position: HomeBandPosition, { onNavigate, className = '' }: BandAdRotatorOptions): BandAdRotatorParts {
  const root = el('div', `band-ad-rotator band-ad-rotator--${position}${className ? ` ${className}` : ''}`);
  root.append(panel);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;
  let started = false;
  let paused = false;
  let step = 0;
  let order: number[] = [-1];
  let frames: HTMLElement[] = [];
  const dotNodes: HTMLButtonElement[] = [];
  const impressed = new Set<number | string>();
  let ads: ReservedPlacement[] = [];
  const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stop() { if (timer) clearTimeout(timer); timer = null; }

  function schedule(delay?: number) {
    stop();
    if (!alive || reduced || paused || order.length < 2) return;
    timer = setTimeout(() => show(step + 1), delay ?? (order[step] === -1 ? PANEL_MS : AD_MS));
  }

  function show(next: number, userPicked = false) {
    step = (next + order.length) % order.length;
    const current = order[step];
    frames.forEach((frame, i) => {
      // frames[0] is the panel, frames[i + 1] is ad i.
      const active = i === current + 1;
      frame.classList.toggle('is-shown', active);
      frame.setAttribute('aria-hidden', active ? 'false' : 'true');
      frame.inert = !active;
    });
    // One dot for the panel, one per ad; the panel's dot is current whenever the panel is.
    dotNodes.forEach((dot, i) => dot.setAttribute('aria-current', i === current + 1 ? 'true' : 'false'));
    if (current >= 0) {
      const ad = ads[current];
      if (!impressed.has(ad.campaignId)) {
        impressed.add(ad.campaignId);
        api.post('/ads/impressions', {
          campaign_id: ad.campaignId, creative_id: ad.creativeId, placement: HOME_BAND_PLACEMENTS[position], viewable: true,
        }).catch(() => {});
      }
    }
    if (userPicked || started) schedule();
  }

  function addAds(list: ReservedPlacement[]) {
    if (!alive || started || !list.length) return;
    started = true;
    ads = list;
    order = playOrder(ads.length);
    panel.classList.add('band-ad-rotator__panel');
    const cards = ads.map((ad) => BandAdCard(ad, position, { onNavigate }));
    frames = [panel, ...cards];
    root.append(...cards);
    root.classList.add('is-rotating');

    const dots = el('div', 'band-ad-rotator__dots');
    dots.setAttribute('aria-label', t('marketplace.top.band_ads.dots_label'));
    frames.forEach((_, i) => {
      const dot = el('button', 'band-ad-rotator__dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', i === 0
        ? t('marketplace.top.band_ads.show_panel')
        : t('marketplace.top.band_ads.show_ad', { n: i }));
      // Jump to the panel, or to that ad's place in the play order.
      dot.addEventListener('click', () => show(i === 0 ? 0 : order.indexOf(i - 1), true));
      dotNodes.push(dot);
      dots.append(dot);
    });
    root.append(dots);

    show(0);
    schedule(PANEL_MS + START_OFFSET_MS[position]);
  }

  root.addEventListener('pointerenter', () => { paused = true; stop(); });
  root.addEventListener('pointerleave', () => { paused = false; schedule(); });
  root.addEventListener('focusin', () => { paused = true; stop(); });
  root.addEventListener('focusout', () => { paused = false; schedule(); });

  return { el: root, addAds, cleanup: () => { alive = false; stop(); } };
}
