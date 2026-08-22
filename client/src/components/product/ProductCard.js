/**
 * ProductCard — the atomic product tile used across the marketplace (Prompt 4.5).
 *
 * @param {object} product       — product data shape from GET /products
 * @param {string} role          — current user role ('customer' | 'saler' | etc.)
 * @param {object} modules       — { flash_sale, sourcing, physical_shop_status, … }
 * @param {string} lang          — current language ('en' | 'bn')
 * @param {'full'|'compact'}  size
 * @param {function} onNavigate  — navigate(path) from router context
 * @param {function} onAction    — called with (product, actionType) on CTA click
 *
 * Invariants:
 *  - Aspect-ratio-locked placeholder (1:1) → zero CLS even before image arrives.
 *  - title uses `lang`-aware field: `title_bn` when lang==='bn', else `title_en`.
 *  - Margin badge is only rendered when role==='saler' AND modules.sourcing is truthy.
 *  - Flash tag is only rendered when product.is_flash_sale AND modules.flash_sale is truthy.
 *  - Physical open/closed dot is only rendered when modules.physical_shop_status is truthy.
 *  - Verified supplier badge is only rendered when product.is_verified_supplier is truthy.
 *  - CTA: 'saler' → "Add to My Store", all others → "Quick Buy" (hidden when out of stock).
 *  - Press feedback via scale(0.98) matches craft.css §press — defined in product.css.
 */

import '../../styles/components/product.css';
import { formatCurrency } from '../../services/format.js';
import { t } from '../../services/i18n.js';

// Ten HSL-defined, accessible background colours for the SVG image placeholder.
// Each maps to a distinct category visual identity — consistent per image_index.
const PLACEHOLDER_COLOURS = [
  { bg: '#da694c', fg: '#fff' }, // coral — Clothing
  { bg: '#2d7b44', fg: '#fff' }, // green — Kids
  { bg: '#1e5fa8', fg: '#fff' }, // blue — Electronics
  { bg: '#a04129', fg: '#fff' }, // rust — Bags
  { bg: '#7b3da0', fg: '#fff' }, // purple — Jewellery
  { bg: '#936412', fg: '#fff' }, // amber — Food & Grocery
  { bg: '#205b31', fg: '#fff' }, // dark green — Crafts
  { bg: '#2c343a', fg: '#fff' }, // charcoal — Footwear
  { bg: '#8b1f17', fg: '#fff' }, // deep red — Beauty & Health
  { bg: '#464e55', fg: '#fff' }, // dark grey — Wholesale
];

/** Returns the first letter(s) of a title for use as placeholder text. */
function placeholderInitials(title) {
  if (!title) return '?';
  const words = title.trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0] || '').join('').toUpperCase() || '?';
}

/** Inline SVG: filled star (rating display). */
function starSvg(filled) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9Z');
  svg.append(path);
  return svg;
}

/** Renders 5 stars, filled up to `rating`. Half-stars rounded to nearest integer for simplicity. */
function renderStars(rating) {
  const wrap = document.createElement('span');
  wrap.className = 'product-card__stars';
  wrap.setAttribute('aria-hidden', 'true');
  const filled = Math.round(Number(rating) || 0);
  for (let i = 1; i <= 5; i += 1) {
    wrap.append(starSvg(i <= filled));
  }
  return wrap;
}

/** Inline SVG: verification checkmark. */
function verifiedSvg() {
  const wrap = document.createElement('span');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = 'display:inline-flex;width:14px;height:14px;color:var(--brand-600);flex-shrink:0';
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 2.5 14.6 5l3.5-.4 1 3.4 3 1.9-1.6 3.1 1.6 3.1-3 1.9-1 3.4-3.5-.4L12 21.5 9.4 19l-3.5.4-1-3.4-3-1.9L4.5 11 2.9 7.9l3-1.9 1-3.4L10.4 3Z"/>' +
    '<path d="m8.8 12.2 2.2 2.2 4.2-4.4"/></svg>';
  return wrap;
}

/** Inline SVG: bolt (flash sale). */
function boltSvg() {
  const wrap = document.createElement('span');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = 'display:inline-flex;width:10px;height:10px;color:#fff;flex-shrink:0';
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 4 14h7v8l9-12h-7z"/></svg>';
  return wrap;
}

/**
 * @param {object} opts
 * @returns {HTMLElement}  — the card root (an <article>)
 */
export function ProductCard({
  product = {},
  role = 'customer',
  modules = {},
  lang = 'en',
  size = 'full',
  onNavigate = null,
  onAction = null,
} = {}) {
  const card = document.createElement('article');
  card.className = size === 'compact' ? 'product-card product-card--compact' : 'product-card';
  // Keyboard accessibility — the whole card is clickable
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.setAttribute(
    'aria-label',
    lang === 'bn' ? (product.title_bn || product.title_en || '') : (product.title_en || product.title_bn || '')
  );

  const navigate = () => onNavigate && onNavigate(`/product/${product.ref}`);
  card.addEventListener('click', navigate);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(); }
  });

  // ── Image / placeholder ─────────────────────────────────────────────────
  const imgWrap = document.createElement('div');
  imgWrap.className = 'product-card__image-wrap';

  const palette = PLACEHOLDER_COLOURS[product.image_index % PLACEHOLDER_COLOURS.length] || PLACEHOLDER_COLOURS[0];
  const placeholder = document.createElement('div');
  placeholder.className = 'product-card__image-placeholder';
  placeholder.style.cssText = `background:${palette.bg};color:${palette.fg}`;
  placeholder.textContent = placeholderInitials(lang === 'bn' ? product.title_bn : product.title_en);
  imgWrap.append(placeholder);

  // Flash sale tag overlaid on the image
  if (product.is_flash_sale && modules.flash_sale) {
    const flashTag = document.createElement('div');
    flashTag.className = 'product-card__flash-tag';
    flashTag.append(boltSvg());
    flashTag.append(document.createTextNode(t('marketplace.flash_sale.tag')));
    imgWrap.append(flashTag);
  }

  card.append(imgWrap);

  // ── Body ────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'product-card__body';

  // Badges row: verified supplier + store open/closed
  const badgesRow = document.createElement('div');
  badgesRow.className = 'product-card__badges';

  if (product.is_verified_supplier) {
    const vBadge = document.createElement('span');
    vBadge.className = 'badge badge--verified badge--sm';
    vBadge.title = t('marketplace.product.verified_supplier');
    vBadge.append(verifiedSvg());
    const vText = document.createElement('span');
    vText.textContent = t('marketplace.product.verified_supplier');
    vBadge.append(vText);
    badgesRow.append(vBadge);
  }

  if (modules.physical_shop_status) {
    const isOpen = product.store_open;
    const statusBadge = document.createElement('span');
    statusBadge.className = 'badge badge--status badge--sm';
    statusBadge.dataset.status = isOpen ? 'open' : 'closed';
    const dot = document.createElement('span');
    dot.className = 'badge__dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = isOpen ? t('marketplace.product.open') : t('marketplace.product.closed');
    statusBadge.append(dot, label);
    badgesRow.append(statusBadge);
  }

  body.append(badgesRow);

  // Title
  const title = document.createElement('h3');
  title.className = 'product-card__title';
  title.textContent = lang === 'bn'
    ? (product.title_bn || product.title_en || '')
    : (product.title_en || product.title_bn || '');
  body.append(title);

  // Price row + margin badge
  const priceRow = document.createElement('div');
  priceRow.className = 'product-card__price-row';

  const priceEl = document.createElement('span');
  priceEl.className = 'product-card__price';
  priceEl.textContent = formatCurrency(product.price, { lang });
  priceRow.append(priceEl);

  // WHY: margin badge only visible to Salers AND only when 'sourcing' module is on —
  // a divergence here (client vs server) is a financial bug; the badge is informational only.
  if (role === 'saler' && modules.sourcing && product.margin_pct != null) {
    const marginBadge = document.createElement('span');
    marginBadge.className = 'product-card__margin';
    marginBadge.textContent = t('marketplace.product.margin_badge', { pct: product.margin_pct });
    priceRow.append(marginBadge);
  }

  body.append(priceRow);

  // Rating
  const ratingWrap = document.createElement('div');
  ratingWrap.className = 'product-card__rating';
  const rating = Number(product.rating) || 0;
  ratingWrap.append(renderStars(rating));
  const ratingCount = document.createElement('span');
  ratingCount.className = 'product-card__rating-count';
  ratingCount.textContent = `(${product.rating_count ?? 0})`;
  ratingWrap.append(ratingCount);
  body.append(ratingWrap);

  card.append(body);

  // ── CTA action button (hidden in compact mode to save space) ────────────
  if (size === 'full') {
    const actionWrap = document.createElement('div');
    actionWrap.className = 'product-card__action';

    const inStock = (product.stock ?? 0) > 0;
    const isSaler = role === 'saler';

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = isSaler
      ? 'product-card__action-btn product-card__action-btn--add-to-store'
      : 'product-card__action-btn';
    actionBtn.disabled = !inStock && !isSaler;

    if (!inStock && !isSaler) {
      actionBtn.textContent = t('marketplace.product.out_of_stock');
      actionBtn.style.background = 'var(--surface-2)';
      actionBtn.style.color = 'var(--text-muted)';
    } else if (isSaler) {
      actionBtn.textContent = t('marketplace.product.add_to_store');
    } else {
      actionBtn.textContent = t('marketplace.product.quick_buy');
    }

    // Stop propagation so clicking the button doesn't also navigate to product detail
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onAction && onAction(product, isSaler ? 'add_to_store' : 'quick_buy');
    });

    actionWrap.append(actionBtn);
    card.append(actionWrap);
  }

  return card;
}

/**
 * ProductCardSkeleton — layout-matching loading placeholder.
 * Same DOM structure as ProductCard; widths match 2-line title + price + rating bar.
 * @returns {HTMLElement}
 */
export function ProductCardSkeleton({ size = 'full' } = {}) {
  const root = document.createElement('div');
  root.className = `skeleton skeleton--product-card${size === 'compact' ? ' product-card--compact' : ''}`;
  root.setAttribute('aria-hidden', 'true');

  const img = document.createElement('div');
  img.className = 'skeleton__image';
  root.append(img);

  const body = document.createElement('div');
  body.className = 'skeleton__body';

  const lines = [
    { width: '90%', height: '13px' },
    { width: '65%', height: '13px' },
    { width: '50%', height: '16px' },
    { width: '70%', height: '12px' },
  ];
  for (const { width, height } of lines) {
    const line = document.createElement('span');
    line.className = 'skeleton__line';
    line.style.cssText = `width:${width};height:${height};display:block;border-radius:4px;
      background:var(--surface-2);animation:skeleton-pulse 1.4s ease-in-out infinite;`;
    body.append(line);
  }
  root.append(body);
  return root;
}
