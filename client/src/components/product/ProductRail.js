/**
 * ProductRail — a titled, horizontally scrolling row of compact product cards (Phase C of the
 * personalized home feed).
 *
 * @param {object}    opts
 * @param {string}    opts.railKey     — stable rail id (continue_browsing, for_you, trending, ...)
 * @param {string}    opts.title       — already-translated heading
 * @param {string}    [opts.subtitle]  — already-translated one-line explanation of why these products
 * @param {object[]}  opts.products    — normalized product list items
 * @param {string}    [opts.role]      — current user role (decides margin badges on the cards)
 * @param {object}    [opts.modules]   — live module flags
 * @param {string}    [opts.lang]      — 'en' | 'bn'
 * @param {function}  [opts.onNavigate] — router navigate(path)
 * @param {function}  [opts.onAction]  — (product, actionType) CTA callback
 * @param {{label: string, onClick: function}} [opts.note] — small text button in the header, used for
 *                                       the "why am I seeing this" link on personal rails
 * @returns {{ el: HTMLElement, cleanup: () => void }}
 *
 * Invariants:
 *  - The card is the shared ProductCard, so click / impression behavioural signals are recorded the
 *    same way as on the catalog grid — a rail is not a second tracking path.
 *  - Arrow visibility follows the scroll position; the listener is removed in cleanup().
 *  - An empty product list renders nothing (the caller decides whether to mount at all).
 */

import '../../styles/components/product-rail.css';
import { ProductCard } from './ProductCard.js';
import { t } from '../../services/i18n.js';

const SCROLL_STEP = 380;

function chevron(direction) {
  const wrap = document.createElement('span');
  wrap.className = 'product-rail__nav-icon';
  wrap.setAttribute('aria-hidden', 'true');
  const d = direction === 'prev' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6';
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  return wrap;
}

export function ProductRail({
  railKey = '',
  title = '',
  subtitle = '',
  products = [],
  role = 'customer',
  modules = {},
  lang = 'en',
  onNavigate = null,
  onAction = null,
  note = null,
} = {}) {
  const root = document.createElement('section');
  root.className = 'product-rail';
  if (railKey) root.dataset.rail = railKey;
  root.setAttribute('aria-label', title);

  // ── Header ───────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'product-rail__header';

  const heading = document.createElement('div');
  heading.className = 'product-rail__heading';
  const h2 = document.createElement('h2');
  h2.className = 'product-rail__title';
  h2.textContent = title;
  heading.append(h2);
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'product-rail__subtitle';
    sub.textContent = subtitle;
    heading.append(sub);
  }
  header.append(heading);

  if (note && typeof note.onClick === 'function') {
    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.className = 'product-rail__note';
    noteBtn.textContent = note.label;
    noteBtn.addEventListener('click', note.onClick);
    header.append(noteBtn);
  }
  root.append(header);

  // ── Scroller ─────────────────────────────────────────────────────────────
  const wrapper = document.createElement('div');
  wrapper.className = 'product-rail__scroll-wrapper';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'product-rail__nav-btn product-rail__nav-btn--prev is-hidden';
  prevBtn.setAttribute('aria-label', t('marketplace.flash_sale.scroll_prev'));
  prevBtn.append(chevron('prev'));

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'product-rail__nav-btn product-rail__nav-btn--next';
  nextBtn.setAttribute('aria-label', t('marketplace.flash_sale.scroll_next'));
  nextBtn.append(chevron('next'));

  const scroll = document.createElement('div');
  scroll.className = 'product-rail__scroll';
  for (const product of products) {
    scroll.append(ProductCard({ product, role, modules, lang, size: 'compact', onNavigate, onAction }));
  }

  const updateArrows = () => {
    // WHY the inset: scroll-snap parks the resting position at the first card's offsetLeft (the
    // container's left padding), never a true 0, so "at start" has to tolerate it.
    const startInset = (scroll.firstElementChild?.offsetLeft ?? 0) + 5;
    prevBtn.classList.toggle('is-hidden', scroll.scrollLeft <= startInset);
    nextBtn.classList.toggle('is-hidden', scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 5);
  };
  prevBtn.addEventListener('click', () => scroll.scrollBy({ left: -SCROLL_STEP, behavior: 'smooth' }));
  nextBtn.addEventListener('click', () => scroll.scrollBy({ left: SCROLL_STEP, behavior: 'smooth' }));
  scroll.addEventListener('scroll', updateArrows, { passive: true });
  const settle = setTimeout(updateArrows, 100);

  wrapper.append(prevBtn, scroll, nextBtn);
  root.append(wrapper);

  function cleanup() {
    clearTimeout(settle);
    scroll.removeEventListener('scroll', updateArrows);
  }

  return { el: root, cleanup };
}

/** Placeholder with the rail's exact footprint, so the page does not jump when the rails arrive. */
export function ProductRailSkeleton({ count = 6 } = {}) {
  const root = document.createElement('section');
  root.className = 'product-rail product-rail--skeleton';
  root.setAttribute('aria-hidden', 'true');
  const bar = document.createElement('div');
  bar.className = 'product-rail__skeleton-title';
  const row = document.createElement('div');
  row.className = 'product-rail__scroll';
  for (let i = 0; i < count; i += 1) {
    const card = document.createElement('div');
    card.className = 'product-rail__skeleton-card';
    row.append(card);
  }
  root.append(bar, row);
  return root;
}
