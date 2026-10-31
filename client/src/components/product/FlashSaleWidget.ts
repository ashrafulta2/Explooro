/**
 * FlashSaleWidget — countdown banner + horizontal product scroll (Prompt 4.5).
 *
 * @param {object}    opts
 * @param {object[]}  opts.products   — flash sale products (product data objects)
 * @param {number}    opts.endsAt     — Unix timestamp (ms) when the earliest shown deal ends; null = no countdown
 * @param {string}    opts.role       — current user role
 * @param {object}    opts.modules    — live module flags
 * @param {string}    opts.lang       — 'en' | 'bn'
 * @param {function}  opts.onNavigate — router navigate(path)
 * @param {function}  opts.onAction   — (product, actionType) CTA callback
 * @returns {{ el: HTMLElement, cleanup: () => void }}
 *
 * Invariants:
 *  - The countdown `setInterval` is cleared in cleanup() to avoid leaking timers.
 *  - The component is only mounted when modules.flash_sale is truthy — callers gate it.
 *  - Compact ProductCards are used in the scroll row (no action button, smaller footprint).
 *  - Only real live deals (services/flashDeal.ts liveFlashDeals) and labelled sponsored units are
 *    shown; a product is never tagged SALE here unless it has a flash sale.
 *  - The countdown is the real end of the earliest deal shown, never an invented window. At zero
 *    the timer stops and `onExpired` lets the page reload the strip.
 */

import { ProductCard } from './ProductCard.ts';
import type {
  ProductActionHandler,
  ProductCardData,
  ProductModules,
  ProductNavigate,
  ProductWidgetHandle,
} from './ProductCard.ts';
import { t } from '../../services/i18n.ts';
import { flashStripEndsAt, liveFlashDeals } from '../../services/flashDeal.ts';

export interface FlashSaleWidgetOptions {
  /** Live flash-sale products and sponsored units; anything else is dropped. */
  products?: ProductCardData[];
  /** Unix time in ms when the earliest shown deal ends; defaults to the deals' own `flash_ends_at`. null hides the countdown. */
  endsAt?: number | null;
  /** Called once when the countdown reaches zero, so the page can reload the strip. */
  onExpired?: (() => void) | null;
  role?: 'customer' | 'saler' | string;
  modules?: ProductModules;
  lang?: 'en' | 'bn' | string;
  onNavigate?: ProductNavigate | null;
  onAction?: ProductActionHandler | null;
  /** Called by "View all deals"; without it the widget navigates to `/?feed=flash` itself. */
  onViewAll?: (() => void) | null;
}

/** Inline SVG: bolt (flash sale icon). */
function boltSvg(): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'flash-sale-widget__icon';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 4 14h7v8l9-12h-7z"/></svg>';
  return wrap;
}

/** Inline SVG: chevron left. */
function chevronLeftSvg(): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'flash-sale-widget__nav-icon';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  return wrap;
}

/** Inline SVG: chevron right. */
function chevronRightSvg(): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'flash-sale-widget__nav-icon';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  return wrap;
}

/** Format seconds into { hh, mm, ss } zero-padded strings. */
function secondsToHMS(totalSeconds: number): { hh: string; mm: string; ss: string } {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return { hh, mm, ss };
}

function makeTimeUnit(value: string, label: string): { wrap: HTMLSpanElement; num: HTMLSpanElement } {
  const wrap = document.createElement('span');
  wrap.className = 'flash-sale-widget__time-unit';
  const num = document.createElement('span');
  num.className = 'flash-sale-widget__time-num';
  num.textContent = value;
  const lbl = document.createElement('span');
  lbl.className = 'flash-sale-widget__time-label';
  lbl.textContent = label;
  wrap.append(num, lbl);
  return { wrap, num };
}

function makeSep(): HTMLSpanElement {
  const sep = document.createElement('span');
  sep.className = 'flash-sale-widget__sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = ':';
  return sep;
}

export function FlashSaleWidget({
  products = [],
  endsAt,
  role = 'customer',
  modules = {},
  lang = 'en',
  onNavigate = null,
  onAction = null,
  onViewAll = null,
  onExpired = null,
}: FlashSaleWidgetOptions = {}): ProductWidgetHandle {
  const deals = liveFlashDeals(products);
  const sponsored = products.filter((p) => p?.isSponsored);
  const endTime = endsAt === undefined ? flashStripEndsAt(deals) : endsAt;

  const root = document.createElement('section');
  root.className = 'flash-sale-widget';
  root.setAttribute('aria-label', t('marketplace.flash_sale.title'));

  // ── Header strip ─────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'flash-sale-widget__header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'flash-sale-widget__header-left';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'flash-sale-widget__title';
  titleWrap.append(boltSvg());
  const titleText = document.createElement('span');
  titleText.textContent = t('marketplace.flash_sale.title');
  titleWrap.append(titleText);
  headerLeft.append(titleWrap);

  // Countdown
  const countdownWrap = document.createElement('div');
  countdownWrap.className = 'flash-sale-widget__countdown';
  const endsLabel = document.createElement('span');
  endsLabel.className = 'flash-sale-widget__ends-label';
  endsLabel.textContent = t('marketplace.flash_sale.ends_in');
  countdownWrap.append(endsLabel);

  const timerWrap = document.createElement('div');
  timerWrap.className = 'flash-sale-widget__timer';

  const initial = secondsToHMS(((endTime ?? Date.now()) - Date.now()) / 1000);
  const { wrap: hhWrap, num: hhNum } = makeTimeUnit(initial.hh, t('marketplace.flash_sale.h'));
  const { wrap: mmWrap, num: mmNum } = makeTimeUnit(initial.mm, t('marketplace.flash_sale.m'));
  const { wrap: ssWrap, num: ssNum } = makeTimeUnit(initial.ss, t('marketplace.flash_sale.s'));

  timerWrap.append(hhWrap, makeSep(), mmWrap, makeSep(), ssWrap);
  countdownWrap.append(timerWrap);
  if (endTime !== null) headerLeft.append(countdownWrap);
  header.append(headerLeft);

  // View all action in header
  const viewAllBtn = document.createElement('button');
  viewAllBtn.type = 'button';
  viewAllBtn.className = 'flash-sale-widget__view-all';
  viewAllBtn.innerHTML = `<span>${t('marketplace.flash_sale.view_all_deals') || 'View All Deals'}</span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
  viewAllBtn.addEventListener('click', () => {
    if (typeof onViewAll === 'function') {
      onViewAll();
    } else if (typeof onNavigate === 'function') {
      onNavigate('/?feed=flash');
    } else {
      window.location.search = '?feed=flash';
    }
  });
  header.append(viewAllBtn);

  root.append(header);

  // ── Product scroll wrapper with navigation arrows ────────────────────────
  const scrollWrapper = document.createElement('div');
  scrollWrapper.className = 'flash-sale-widget__scroll-wrapper';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'flash-sale-widget__nav-btn flash-sale-widget__nav-btn--prev is-hidden';
  prevBtn.setAttribute('aria-label', t('marketplace.flash_sale.scroll_prev'));
  prevBtn.append(chevronLeftSvg());

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'flash-sale-widget__nav-btn flash-sale-widget__nav-btn--next';
  nextBtn.setAttribute('aria-label', t('marketplace.flash_sale.scroll_next'));
  nextBtn.append(chevronRightSvg());

  const scroll = document.createElement('div');
  scroll.className = 'flash-sale-widget__scroll';

  // Sponsored units first (a bought FLASH_STRIP slot), then the deals. Neither is re-flagged.
  for (const product of [...sponsored, ...deals]) {
    scroll.append(
      ProductCard({
        product,
        role,
        modules: { ...modules, flash_sale: true },
        lang,
        size: 'compact',
        onNavigate,
        onAction,
      })
    );
  }

  const updateArrows = () => {
    // WHY: scroll-snap (mandatory) parks the rest position at the first card's
    // offsetLeft (the scroll container's left padding), never a true 0 — so the
    // "at start" test has to tolerate that inset or the prev arrow never hides.
    const startInset = ((scroll.firstElementChild as HTMLElement | null)?.offsetLeft ?? 0) + 5;
    const atStart = scroll.scrollLeft <= startInset;
    const atEnd = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 5;
    prevBtn.classList.toggle('is-hidden', atStart);
    nextBtn.classList.toggle('is-hidden', atEnd);
  };

  prevBtn.addEventListener('click', () => {
    scroll.scrollBy({ left: -380, behavior: 'smooth' });
  });
  nextBtn.addEventListener('click', () => {
    scroll.scrollBy({ left: 380, behavior: 'smooth' });
  });

  scroll.addEventListener('scroll', updateArrows, { passive: true });
  setTimeout(updateArrows, 100);

  scrollWrapper.append(prevBtn, scroll, nextBtn);
  root.append(scrollWrapper);

  // ── Countdown interval ───────────────────────────────────────────────────
  const interval = endTime === null ? null : setInterval(() => {
    const { hh, mm, ss } = secondsToHMS((endTime - Date.now()) / 1000);
    hhNum.textContent = hh;
    mmNum.textContent = mm;
    ssNum.textContent = ss;
    if (Date.now() >= endTime) {
      clearInterval(interval);
      if (typeof onExpired === 'function') onExpired();
    }
  }, 1000);

  function cleanup(): void {
    if (interval) clearInterval(interval);
    scroll.removeEventListener('scroll', updateArrows);
  }

  return { el: root, cleanup };
}
