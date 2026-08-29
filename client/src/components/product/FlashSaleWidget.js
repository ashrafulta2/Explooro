/**
 * FlashSaleWidget — countdown banner + horizontal product scroll (Prompt 4.5).
 *
 * @param {object}    opts
 * @param {object[]}  opts.products   — flash sale products (product data objects)
 * @param {number}    opts.endsAt     — Unix timestamp (ms) when the flash sale ends
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
 */

import { ProductCard } from './ProductCard.js';
import { t } from '../../services/i18n.js';

/** Inline SVG: bolt (flash sale icon). */
function boltSvg() {
  const wrap = document.createElement('span');
  wrap.className = 'flash-sale-widget__icon';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 4 14h7v8l9-12h-7z"/></svg>';
  return wrap;
}

/** Inline SVG: chevron left. */
function chevronLeftSvg() {
  const wrap = document.createElement('span');
  wrap.className = 'flash-sale-widget__nav-icon';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  return wrap;
}

/** Inline SVG: chevron right. */
function chevronRightSvg() {
  const wrap = document.createElement('span');
  wrap.className = 'flash-sale-widget__nav-icon';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  return wrap;
}

/** Format seconds into { hh, mm, ss } zero-padded strings. */
function secondsToHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return { hh, mm, ss };
}

function makeTimeUnit(value, label) {
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

function makeSep() {
  const sep = document.createElement('span');
  sep.className = 'flash-sale-widget__sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = ':';
  return sep;
}

export function FlashSaleWidget({
  products = [],
  endsAt = Date.now() + 4 * 60 * 60 * 1000, // default 4 hours from now
  role = 'customer',
  modules = {},
  lang = 'en',
  onNavigate = null,
  onAction = null,
} = {}) {
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

  const initial = secondsToHMS((endsAt - Date.now()) / 1000);
  const { wrap: hhWrap, num: hhNum } = makeTimeUnit(initial.hh, t('marketplace.flash_sale.h'));
  const { wrap: mmWrap, num: mmNum } = makeTimeUnit(initial.mm, t('marketplace.flash_sale.m'));
  const { wrap: ssWrap, num: ssNum } = makeTimeUnit(initial.ss, t('marketplace.flash_sale.s'));

  timerWrap.append(hhWrap, makeSep(), mmWrap, makeSep(), ssWrap);
  countdownWrap.append(timerWrap);
  headerLeft.append(countdownWrap);
  header.append(headerLeft);

  // View all action in header
  const viewAllBtn = document.createElement('button');
  viewAllBtn.type = 'button';
  viewAllBtn.className = 'flash-sale-widget__view-all';
  viewAllBtn.innerHTML = `<span>${t('marketplace.flash_sale.view_all_deals') || 'View All Deals'}</span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
  viewAllBtn.addEventListener('click', () => {
    if (typeof onNavigate === 'function') {
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

  let flashProducts = products.filter((p) => p.is_flash_sale);
  if (flashProducts.length === 0 && products.length > 0) {
    flashProducts = products.slice(0, 10).map((p) => ({ ...p, is_flash_sale: true }));
  }

  for (const product of flashProducts) {
    scroll.append(
      ProductCard({
        product: { ...product, is_flash_sale: true },
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
    const startInset = (scroll.firstElementChild?.offsetLeft ?? 0) + 5;
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
  const interval = setInterval(() => {
    const { hh, mm, ss } = secondsToHMS((endsAt - Date.now()) / 1000);
    hhNum.textContent = hh;
    mmNum.textContent = mm;
    ssNum.textContent = ss;
    if (Date.now() >= endsAt) clearInterval(interval);
  }, 1000);

  function cleanup() {
    clearInterval(interval);
    scroll.removeEventListener('scroll', updateArrows);
  }

  return { el: root, cleanup };
}
