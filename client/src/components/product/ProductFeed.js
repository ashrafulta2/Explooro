/**
 * ProductFeed.js — Full-viewport, one-product-at-a-time vertical discovery feed (the /discover
 * surface). Each slide shows a product large, like a condensed product-detail page, and the shopper
 * moves through them one by one (scroll-snap, wheel, ArrowUp/Down/PageUp/PageDown, touch-swipe).
 *
 * Ranking is server-side and interest-based (services/discovery.api.js → GET /discovery/feed); this
 * component only records the signals that drive it: a VIEW the first time a slide is seen, and a
 * DWELL (with elapsed time) when the shopper moves on. Slides lazily enrich to full detail
 * (supplier, description, variants) once they become active, so the initial page stays light on
 * Bangladeshi mobile networks.
 *
 * The whole purchase happens on the slide — no jump to a product page. On enrichment a customer
 * slide mounts the product page's own VariantSelector (choose size/colour, out-of-stock combos
 * disabled) which drives the slide's price, stock badge, image and the Add-to-Cart button; a
 * quantity stepper sits beside it. Audience-configurable: `audience: 'customer'` renders that inline
 * buy box (options + quantity + Add to Cart + Wishlist); `audience: 'saler'` renders sourcing CTAs
 * (margin + Add to store) with read-only variant chips instead.
 *
 * @param {object} opts
 * @param {'customer'|'saler'} [opts.audience]
 * @param {function} opts.navigate       router navigate(path)
 * @param {object}   [opts.filters]      snake_case catalog query filters passed through to the feed
 * @param {function} [opts.onFilterHint] called with feed meta after each fetch (e.g. personalized flag)
 * @param {function} [opts.onFirstPage]  called with the first page's products after a (re)load
 * @returns {{ el: HTMLElement, cleanup: () => void, reload: (filters?) => void }}
 */
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { addToCart } from '../../services/cart.js';
import { getFeed, recordEvent } from '../../services/discovery.api.js';
import { getProduct, addToSalerStore } from '../../services/catalog.api.js';
import { resolveProductImage } from './ProductCard.js';
import { VariantSelector } from './VariantSelector.js';
import { WishlistButton } from '../cart/WishlistButton.js';
import { openQuickBuyModal } from '../cart/QuickBuyModal.js';
import { openTeamPurchaseModal } from './TeamPurchaseModal.js';
import { api } from '../../core/api.js';
import { appStore } from '../../state/appStore.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Skeleton } from '../ui/Skeleton.js';

// Fetch the next page once the active slide is within this many of the end.
const PREFETCH_LOOKAHEAD = 3;
// Ignore accidental micro-dwells as an engagement signal.
const MIN_DWELL_MS = 800;

function titleOf(p, lang) {
  return (lang === 'bn' ? p.title_bn || p.title_en : p.title_en || p.title_bn) || '';
}
function categoryOf(p, lang) {
  return (lang === 'bn' ? p.category_bn || p.category : p.category) || '';
}
function priceOf(p) {
  return Number(p.price ?? p.default_retail_price ?? p.pricing?.retail_price ?? 0);
}

export function ProductFeed({ audience = 'customer', navigate, filters = {}, onFilterHint = null, onFirstPage = null } = {}) {
  const lang = getLanguage();
  const el = document.createElement('div');
  el.className = 'discover-feed';
  el.setAttribute('role', 'feed');
  el.setAttribute('aria-label', t('discover.aria.feed'));
  el.tabIndex = 0;

  // The actual scroll-snap container. Kept separate from `el` so the nav controls can be pinned
  // over it (absolute to `el`) without scrolling away with the slides.
  const scroller = document.createElement('div');
  scroller.className = 'discover-feed__scroller';
  el.append(scroller);

  let items = [];
  let currentFilters = { ...filters };
  let offset = 0;
  let hasMore = true;
  let loading = false;
  let destroyed = false;
  const seen = new Set(); // slide keys that already fired a VIEW
  const enriched = new Set(); // slide keys already enriched to full detail
  // Per-slide live handles (price/stock/image/add-button/qty + current variant selection) so the
  // inline variant selector, mounted lazily on enrichment, can drive the whole buy box on the slide.
  const slideState = new Map();
  let activeKey = null;
  let activeSince = 0;

  const keyOf = (p) => String(p.ref || p.id || p.slug);

  function setStockBadge(el, qty) {
    el.className = `discover-slide__stock discover-slide__stock--${qty > 0 ? 'in' : 'out'}`;
    el.textContent = qty > 0 ? t('discover.stock.in') : t('discover.stock.out');
  }

  // ── Slide stepping ─────────────────────────────────────────────────────────
  // WHY: the on-screen up/down arrow buttons were removed — they floated over the card's right side
  // and hid part of the buy box. Stepping now happens purely through wheel, touch-swipe, scroll-snap
  // and the keyboard (ArrowUp/ArrowDown/PageUp/PageDown), which is enough to move between products.
  function slideEls() {
    return [...scroller.querySelectorAll('.discover-slide')];
  }
  function activeIndex() {
    const all = slideEls();
    return all.findIndex((s) => s.dataset.key === activeKey);
  }
  function step(delta) {
    const all = slideEls();
    const idx = Math.max(0, activeIndex());
    const next = all[idx + delta];
    if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Interaction signals ────────────────────────────────────────────────────
  function eventContext(p) {
    return {
      product_id: p.id,
      category: p.category, // name — drives mock affinity; also human-readable in logs
      category_id: p.category_id,
      supplier_id: p.supplier_id || p.supplier?.id,
    };
  }
  function fireDwell() {
    if (!activeKey) return;
    const p = items.find((it) => keyOf(it) === activeKey);
    if (!p) return;
    const ms = Date.now() - activeSince;
    if (ms >= MIN_DWELL_MS) {
      recordEvent({ event_type: 'DWELL', dwell_ms: ms, ...eventContext(p) }, { audience });
    }
  }

  // ── Active-slide detection (IntersectionObserver on the scroll container) ───
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const slide = entry.target;
        const key = slide.dataset.key;
        if (key === activeKey) continue;
        fireDwell();
        activeKey = key;
        activeSince = Date.now();

        const p = items.find((it) => keyOf(it) === key);
        if (p) {
          if (!seen.has(key)) {
            seen.add(key);
            recordEvent({ event_type: 'VIEW', ...eventContext(p) }, { audience });
          }
          enrichSlide(slide, p);
          const idx = items.findIndex((it) => keyOf(it) === key);
          if (idx >= items.length - PREFETCH_LOOKAHEAD) loadMore();
        }
      }
    },
    { root: scroller, threshold: 0.6 }
  );

  // ── Slide rendering ─────────────────────────────────────────────────────────
  function buildSlide(p) {
    const key = keyOf(p);
    const slide = document.createElement('article');
    slide.className = 'discover-slide';
    slide.dataset.key = key;
    slide.setAttribute('aria-label', titleOf(p, lang));

    // Navigate to the full product page. Wired to the (clickable) media and title below, so the
    // whole visual card acts as the link — no separate "View details" button needed.
    const goToDetail = () => {
      const targetId = p.ref || p.id || p.slug;
      recordEvent({ event_type: 'CLICK', ...eventContext(p) }, { audience });
      if (navigate) navigate(`/product/${targetId}`);
      else window.location.href = `/product/${targetId}`;
    };

    // Media (clickable → product detail)
    const media = document.createElement('div');
    media.className = 'discover-slide__media is-clickable';
    media.setAttribute('role', 'link');
    media.tabIndex = 0;
    media.setAttribute('aria-label', t('discover.cta.view_details'));
    const img = document.createElement('img');
    img.className = 'discover-slide__img';
    img.loading = 'lazy';
    img.decoding = 'async'; // paint the slide without blocking on image decode — avoids a visible stall
    img.alt = titleOf(p, lang);
    img.src = p.image_url || resolveProductImage(p);
    // Fall back to a neutral placeholder if the source 404s, so the media never shows a blank box.
    img.addEventListener('error', () => {
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = '1';
      img.src = resolveProductImage(p);
    }, { once: true });
    media.append(img);

    // Hover affordance so it reads as tappable ("View details →").
    const viewHint = document.createElement('span');
    viewHint.className = 'discover-slide__view-hint';
    viewHint.innerHTML =
      `<span>${t('discover.cta.view_details')}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
    media.append(viewHint);

    media.addEventListener('click', goToDetail);
    media.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goToDetail();
      }
    });

    const category = categoryOf(p, lang);
    if (category) {
      const chip = document.createElement('span');
      chip.className = 'discover-slide__chip';
      chip.textContent = category;
      media.append(chip);
    }
    if (p.is_flash_sale) {
      const flash = document.createElement('span');
      flash.className = 'discover-slide__flash';
      flash.textContent = t('discover.badge.flash_sale');
      media.append(flash);
    }

    // Panel
    const panel = document.createElement('div');
    panel.className = 'discover-slide__panel';

    // Multi-parameter recommendation badge (why this product is shown)
    const REASON_I18N = {
      trending: 'discover.reason.trending',
      bestseller: 'discover.reason.bestseller',
      interest: 'discover.reason.interest',
      browsed: 'discover.reason.browsed',
      crowd: 'discover.reason.crowd',
    };
    const reasonType = p.recommendation_reason || 'trending';
    const reasonWrap = document.createElement('div');
    reasonWrap.className = `discover-slide__reason discover-slide__reason--${reasonType}`;

    let reasonSvg = '';
    if (reasonType === 'trending') {
      reasonSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3.5z"/></svg>';
    } else if (reasonType === 'bestseller') {
      reasonSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>';
    } else if (reasonType === 'interest') {
      reasonSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>';
    } else if (reasonType === 'browsed') {
      reasonSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    } else {
      reasonSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    }

    const reasonIconSpan = document.createElement('span');
    reasonIconSpan.className = 'discover-slide__reason-icon';
    reasonIconSpan.setAttribute('aria-hidden', 'true');
    reasonIconSpan.innerHTML = reasonSvg;

    const reasonTextSpan = document.createElement('span');
    reasonTextSpan.className = 'discover-slide__reason-text';
    reasonTextSpan.textContent = t(REASON_I18N[reasonType] || 'discover.reason.trending');

    reasonWrap.append(reasonIconSpan, reasonTextSpan);
    panel.append(reasonWrap);

    const title = document.createElement('h2');
    title.className = 'discover-slide__title is-clickable';
    title.textContent = titleOf(p, lang);
    title.setAttribute('role', 'link');
    title.tabIndex = 0;
    title.addEventListener('click', goToDetail);
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goToDetail();
      }
    });
    panel.append(title);

    const meta = document.createElement('div');
    meta.className = 'discover-slide__meta';
    const rating = Number(p.rating ?? p.rating_avg ?? 0);
    if (rating > 0) {
      const ratingEl = document.createElement('span');
      ratingEl.className = 'discover-slide__rating';
      ratingEl.textContent = `★ ${formatNumber(rating, { lang })}`;
      if (p.rating_count) ratingEl.textContent += ` · ${t('discover.reviews', { count: p.rating_count })}`;
      meta.append(ratingEl);
    }
    const stockQty = Number(p.stock ?? p.stock_qty ?? 0);
    const stock = document.createElement('span');
    setStockBadge(stock, stockQty);
    meta.append(stock);
    panel.append(meta);

    const price = document.createElement('div');
    price.className = 'discover-slide__price';
    price.textContent = formatCurrency(priceOf(p), { lang });
    panel.append(price);

    // Detail region (supplier, description; read-only variant chips for salers). Painted NOW from
    // the list item — the feed carries the supplier line + description, so this text lands in the
    // same frame as the title/price instead of popping in after the per-slide detail fetch.
    // enrichSlide() re-runs renderDetail with the full product, but the signature guard there makes
    // it a no-op when the text is unchanged, so there is no second flash.
    const detail = document.createElement('div');
    detail.className = 'discover-slide__detail';
    detail.dataset.detailFor = key;
    panel.append(detail);
    renderDetail(detail, p);

    // Live buy-box state for this slide. The variant selector (mounted on enrichment) and the CTA
    // both read/write it, so the whole purchase — choose options, set quantity, add to cart —
    // happens inline with no jump to the product page.
    const st = {
      product: p,
      img,
      priceEl: price,
      stockEl: stock,
      addBtn: null,
      qtyInput: null,
      qtyClamp: null,
      optionsEl: null,
      qtyEl: null,
      selection: null,
      basePrice: priceOf(p),
      availStock: stockQty,
      // Trust the list item's hint only provisionally; enrichment settles it from the full product.
      mode: p.has_variants ? 'variant' : 'simple',
    };
    slideState.set(key, st);

    if (audience === 'saler') {
      panel.append(buildSalerCtas(p));
    } else {
      const options = document.createElement('div');
      options.className = 'discover-slide__options';
      const qty = buildQtyStepper(st);
      options.append(qty);
      st.optionsEl = options;
      st.qtyEl = qty;
      panel.append(options);
      panel.append(buildCustomerCtas(p, st));
      // Mount the Size selector NOW when the feed carried the variant set, so it paints in the same
      // frame as the price/quantity instead of popping in after the per-slide getProduct() fetch.
      // Called after buildCustomerCtas so st.addBtn exists when the selector's initial onChange
      // fires. enrichSlide() calls mountInlineOptions again with the full product, but its
      // optionsMounted guard makes that a no-op — no duplicate selector, no second appearance.
      if (p.has_variants && Array.isArray(p.variants) && p.variants.length) {
        mountInlineOptions(key, p);
      }
    }

    slide.append(media, panel);
    observer.observe(slide);
    return slide;
  }

  // Quantity stepper (− n +), clamped to the currently-available stock (which the variant selector
  // updates as the shopper picks a combination).
  function buildQtyStepper(st) {
    const wrap = document.createElement('div');
    wrap.className = 'discover-slide__qty';
    const label = document.createElement('span');
    label.className = 'discover-slide__qty-label';
    label.textContent = t('discover.qty.label');
    const control = document.createElement('div');
    control.className = 'discover-slide__qty-control';

    const dec = document.createElement('button');
    dec.type = 'button';
    dec.className = 'discover-slide__qty-btn';
    dec.textContent = '−';
    dec.setAttribute('aria-label', t('discover.qty.decrease'));
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'discover-slide__qty-input';
    input.min = '1';
    input.value = '1';
    input.setAttribute('aria-label', t('discover.qty.label'));
    const inc = document.createElement('button');
    inc.type = 'button';
    inc.className = 'discover-slide__qty-btn';
    inc.textContent = '+';
    inc.setAttribute('aria-label', t('discover.qty.increase'));

    const clamp = () => {
      const max = st.availStock > 0 ? st.availStock : 1;
      let v = Math.floor(Number(input.value) || 1);
      if (v < 1) v = 1;
      if (v > max) v = max;
      input.value = String(v);
      dec.disabled = v <= 1;
      inc.disabled = v >= max;
    };
    dec.addEventListener('click', () => { input.value = String((Number(input.value) || 1) - 1); clamp(); });
    inc.addEventListener('click', () => { input.value = String((Number(input.value) || 1) + 1); clamp(); });
    input.addEventListener('change', clamp);

    control.append(dec, input, inc);
    wrap.append(label, control);
    st.qtyInput = input;
    st.qtyClamp = clamp;
    clamp();
    return wrap;
  }

  function buildCustomerCtas(p, st) {
    const container = document.createElement('div');
    container.className = 'discover-slide__actions-container';

    // ── Row 1: Primary Purchase Actions (Add to Cart + Quick Buy + Wishlist) ──
    const primaryRow = document.createElement('div');
    primaryRow.className = 'discover-slide__action-row discover-slide__action-row--primary';

    const cartIcon = document.createElement('span');
    cartIcon.className = 'btn-icon-svg';
    cartIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>`;

    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'btn btn--primary btn--md discover-slide__btn discover-slide__btn--cart';
    const cartText = document.createElement('span');
    cartText.textContent = t('discover.cta.add_to_cart');
    primary.append(cartIcon, cartText);
    st.addBtn = primary;
    primary.disabled = st.mode === 'variant' ? true : st.availStock <= 0;

    primary.addEventListener('click', () => {
      const sel = st.selection;
      if (st.mode === 'variant' && !sel) {
        toast.info(t('discover.cta.select_variant'));
        return;
      }
      const variant = sel?.variant;
      const qty = Math.max(1, Math.floor(Number(st.qtyInput?.value) || 1));
      addToCart({
        product_id: p.id,
        variant_id: variant?.id || null,
        qty,
        title_en: p.title_en,
        title_bn: p.title_bn,
        slug: p.slug,
        variant_title: variant ? Object.values(variant.attributes || {}).join(' / ') : null,
        variant_sku: sel?.sku || null,
        price: sel?.price ?? priceOf(p),
        image_url: p.image_url || resolveProductImage(p),
        supplier_id: p.supplier_id || 1,
        supplier_name: p.supplier_name || p.supplier?.name || 'Verified Supplier',
        stock_qty: sel?.stockQty ?? st.availStock ?? 10,
      });
      recordEvent({ event_type: 'ADD_CART', ...eventContext(p) }, { audience });
    });
    primaryRow.append(primary);

    // Quick Buy Button
    if (isFeatureEnabled('quick_buy')) {
      const quickBuyBtn = document.createElement('button');
      quickBuyBtn.type = 'button';
      quickBuyBtn.className = 'btn btn--secondary btn--md discover-slide__btn discover-slide__btn--quick';
      const lightningIcon = document.createElement('span');
      lightningIcon.className = 'btn-icon-svg';
      lightningIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
      const quickBuyText = document.createElement('span');
      quickBuyText.textContent = t('marketplace.product.quick_buy') || 'Quick Buy';
      quickBuyBtn.append(lightningIcon, quickBuyText);
      st.quickBuyBtn = quickBuyBtn;
      quickBuyBtn.disabled = st.mode === 'variant' ? true : st.availStock <= 0;

      quickBuyBtn.addEventListener('click', () => {
        openQuickBuyModal({
          product: st.fullProduct || p,
          selectedVariant: st.selection?.variant || null,
          initialQty: Math.max(1, Math.floor(Number(st.qtyInput?.value) || 1)),
          navigate,
        });
      });
      primaryRow.append(quickBuyBtn);
    }

    // Wishlist Button
    if (isFeatureEnabled('wishlist') && p.id != null) {
      const wishlistWrap = document.createElement('div');
      wishlistWrap.dataset.module = 'wishlist';
      wishlistWrap.className = 'discover-slide__wishlist-wrap';
      wishlistWrap.append(WishlistButton({ productId: p.id, size: 'md' }));
      primaryRow.append(wishlistWrap);
    }
    container.append(primaryRow);

    // ── Row 2: Secondary Social & Group Commerce (Chat + Team Purchase) ──
    const secondaryRow = document.createElement('div');
    secondaryRow.className = 'discover-slide__action-row discover-slide__action-row--secondary';

    // Chat with Seller
    if (isFeatureEnabled('chat')) {
      const chatBtn = document.createElement('button');
      chatBtn.type = 'button';
      chatBtn.className = 'btn btn--secondary btn--sm discover-slide__social-btn';
      const chatIcon = document.createElement('span');
      chatIcon.className = 'btn-icon-svg';
      chatIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
      const chatText = document.createElement('span');
      chatText.textContent = t('product_detail.cta.chat_with_seller') || 'Chat with Seller';
      chatBtn.append(chatIcon, chatText);

      chatBtn.addEventListener('click', async () => {
        const { auth } = appStore.get();
        if (!auth?.isAuthenticated) {
          toast.info(lang === 'bn' ? 'বিক্রেতার সাথে চ্যাট করতে অনুগ্রহ করে সাইন ইন করুন।' : 'Please sign in to chat with the seller.');
          const redirectUrl = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
          if (navigate) navigate(redirectUrl);
          else window.location.href = redirectUrl;
          return;
        }
        chatBtn.disabled = true;
        try {
          const supplierId = p.supplier_id || p.supplier?.id || 1;
          const supplierName = p.supplier?.name || p.supplier_name || 'Verified Supplier';
          const productTitle = titleOf(p, lang) || 'Product';
          const productRef = p.ref || `PRD-${p.id}`;

          const res = await api.post('/chat/threads', {
            target_user_id: supplierId,
            thread_type: 'CUSTOMER_SALER',
            metadata: {
              product_id: p.id,
              product_name: productTitle,
              product_ref: productRef,
              supplier_name: supplierName,
            },
          });
          const createdThread = res?.data?.thread || res?.thread || res?.data;
          const threadId = createdThread?.id || 10;
          const chatUrl = `/chat?threadId=${threadId}&productRef=${encodeURIComponent(productRef)}&productTitle=${encodeURIComponent(productTitle)}`;
          if (navigate) navigate(chatUrl);
          else window.location.href = chatUrl;
        } catch (err) {
          toast.error(err?.message || (lang === 'bn' ? 'চ্যাট শুরু করতে ব্যর্থ হয়েছে।' : 'Failed to start chat with seller.'));
        } finally {
          chatBtn.disabled = false;
        }
      });
      secondaryRow.append(chatBtn);
    }

    // Team Purchase
    if (isFeatureEnabled('group_buying')) {
      const teamBtn = document.createElement('button');
      teamBtn.type = 'button';
      teamBtn.className = 'btn btn--secondary btn--sm discover-slide__social-btn discover-slide__team-btn';
      const teamIcon = document.createElement('span');
      teamIcon.className = 'btn-icon-svg';
      teamIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
      const teamText = document.createElement('span');
      teamText.textContent = t('product_detail.cta.team_purchase') || 'Team Purchase';
      const saveBadge = document.createElement('span');
      saveBadge.className = 'discover-slide__discount-badge';
      saveBadge.textContent = lang === 'bn' ? '২০% ছাড়' : 'Save 20%';
      teamBtn.append(teamIcon, teamText, saveBadge);

      teamBtn.addEventListener('click', () => {
        openTeamPurchaseModal({
          product: st.fullProduct || p,
          selectedVariant: st.selection?.variant || null,
          navigate,
        });
      });
      secondaryRow.append(teamBtn);
    }

    if (secondaryRow.children.length > 0) {
      container.append(secondaryRow);
    }

    // No "View details" button — the media image and title are the link to the full product page.

    return container;
  }

  function buildSalerCtas(p) {
    const row = document.createElement('div');
    row.className = 'discover-slide__ctas';
    // Sourcing CTA: show the reseller margin and let them add it to their store.
    if (p.margin_pct != null || p.pricing?.saler_margin_pct != null) {
      const margin = document.createElement('span');
      margin.className = 'discover-slide__margin';
      const pct = Number(p.margin_pct ?? p.pricing?.saler_margin_pct);
      margin.textContent = t('discover.saler.margin', { pct: formatNumber(pct, { lang }) });
      row.append(margin);
    }
    const addStoreBtn = document.createElement('button');
    addStoreBtn.type = 'button';
    addStoreBtn.className = 'btn btn--primary btn--sm discover-slide__primary';
    addStoreBtn.textContent = t('discover.saler.add_to_store');
    addStoreBtn.addEventListener('click', async () => {
      recordEvent({ event_type: 'CLICK', ...eventContext(p) }, { audience });
      addStoreBtn.disabled = true;
      try {
        await addToSalerStore({ productId: p.id, collectionName: 'General' });
        toast.success(t('discover.saler.added'));
      } catch (err) {
        toast.error(err?.message || t('discover.saler.add_failed'));
      } finally {
        addStoreBtn.disabled = false;
      }
    });
    row.append(addStoreBtn);
    // The clickable media/title is the link to the full product page — no separate button here.

    return row;
  }

  // Lazy detail enrichment — one fetch per slide, first time it becomes active.
  async function enrichSlide(slide, p) {
    const key = keyOf(p);
    if (enriched.has(key)) return;
    enriched.add(key);
    const detail = slide.querySelector(`[data-detail-for="${CSS.escape(key)}"]`);
    if (!detail) return;
    try {
      const full = await getProduct(p.ref || p.slug || p.id);
      if (destroyed || !full) return;
      const st = slideState.get(key);
      if (st) st.fullProduct = full;
      // Backfill fields the list item lacked so CTAs/events have real ids.
      Object.assign(p, {
        id: p.id ?? full.id,
        category_id: p.category_id ?? full.category_id,
        supplier_id: p.supplier_id ?? full.supplier_id ?? full.supplier?.id,
        has_variants: full.has_variants ?? p.has_variants,
      });
      renderDetail(detail, full);
      mountInlineOptions(key, full);
    } catch {
      // Detail is enhancement only; the slide already works without it.
    }
  }

  // Customer slides get a live, interactive variant selector (reusing the product page's own
  // VariantSelector) so the whole purchase happens inline. Saler slides show the read-only chips
  // rendered by renderDetail — sourcing to a store doesn't pick a single combination.
  function mountInlineOptions(key, full) {
    if (audience === 'saler') return;
    const st = slideState.get(key);
    if (!st || !st.optionsEl || st.optionsMounted) return;
    // Guard against a second mount: buildSlide mounts this from the list item when the feed carried
    // variants, and enrichSlide re-calls with the full product. Whichever runs first owns the buy
    // box; the other is a no-op, so the selector never appears twice or flips.
    st.optionsMounted = true;

    if (full.has_variants && full.variants?.length) {
      st.mode = 'variant';
      const selector = VariantSelector({
        variants: full.variants,
        basePrice: st.basePrice,
        onChange: (selection) => {
          st.selection = selection;
          if (selection) {
            st.availStock = selection.stockQty;
            st.priceEl.textContent = formatCurrency(selection.price, { lang });
            setStockBadge(st.stockEl, selection.stockQty);
            if (selection.imageUrl) st.img.src = selection.imageUrl;
            if (st.addBtn) st.addBtn.disabled = selection.stockQty <= 0;
            if (st.quickBuyBtn) st.quickBuyBtn.disabled = selection.stockQty <= 0;
          } else {
            st.availStock = 0;
            if (st.addBtn) st.addBtn.disabled = true;
            if (st.quickBuyBtn) st.quickBuyBtn.disabled = true;
            setStockBadge(st.stockEl, 0);
          }
          st.qtyClamp && st.qtyClamp();
        },
      });
      // Options above the quantity stepper: choose the combination, then how many.
      st.optionsEl.insertBefore(selector, st.qtyEl);
    } else {
      // Settled as a simple product — enable straight from stock (the list hint may have been wrong).
      st.mode = 'simple';
      const qty = Number(full.stock_qty ?? full.stock ?? st.availStock ?? 0);
      st.availStock = qty;
      setStockBadge(st.stockEl, qty);
      if (st.addBtn) st.addBtn.disabled = qty <= 0;
      if (st.quickBuyBtn) st.quickBuyBtn.disabled = qty <= 0;
      st.qtyClamp && st.qtyClamp();
    }
  }

  function renderDetail(detail, full) {
    // Idempotency guard: buildSlide paints this from the list item and enrichSlide re-runs it with
    // the full product. Rebuilding identical nodes would replay the fade-in animation as a flicker,
    // so skip when the resulting content signature is unchanged.
    const sig = [
      full.supplier?.name || '',
      full.supplier?.district || '',
      (lang === 'bn' ? full.description_bn : full.description_en) || '',
      audience === 'saler' && full.has_variants && full.variants?.length
        ? full.variants.map((v) => Object.values(v.attributes || {})[0] || '').join('|')
        : '',
    ].join('');
    if (detail.dataset.sig === sig) return;
    detail.dataset.sig = sig;

    detail.replaceChildren();
    const sup = full.supplier;
    if (sup?.name) {
      const supplier = document.createElement('p');
      supplier.className = 'discover-slide__supplier';
      supplier.textContent = sup.district
        ? t('discover.supplier.ships_from', { name: sup.name, district: sup.district })
        : sup.name;
      detail.append(supplier);
    }
    const desc = lang === 'bn' ? full.description_bn : full.description_en;
    if (desc) {
      const d = document.createElement('p');
      d.className = 'discover-slide__desc';
      d.textContent = desc;
      detail.append(d);
    }
    // Read-only variant chips are for salers only; customers get the interactive selector instead.
    if (audience === 'saler' && full.has_variants && full.variants?.length) {
      const chips = document.createElement('div');
      chips.className = 'discover-slide__variants';
      const seenLabels = new Set();
      for (const v of full.variants) {
        const label = Object.values(v.attributes || {})[0];
        if (!label || seenLabels.has(label)) continue;
        seenLabels.add(label);
        const chip = document.createElement('span');
        chip.className = 'discover-slide__variant-chip';
        if (v.is_active === false || (v.stock_qty ?? 0) <= 0) chip.classList.add('is-disabled');
        chip.textContent = label;
        chips.append(chip);
      }
      if (chips.children.length) detail.append(chips);
    }
  }

  // ── Data loading ────────────────────────────────────────────────────────────
  async function loadMore() {
    if (loading || !hasMore || destroyed) return;
    loading = true;
    try {
      const { products, meta } = await getFeed({ audience, offset, filters: currentFilters });
      if (destroyed) return;
      onFilterHint?.(meta);
      if (products.length === 0 && items.length === 0) {
        scroller.replaceChildren(
          EmptyState({
            variant: 'empty',
            title: t('discover.empty.title'),
            description: t('discover.empty.desc'),
          })
        );
        hasMore = false;
        return;
      }
      const isFirstPage = items.length === 0;
      const frag = document.createDocumentFragment();
      for (const p of products) {
        items.push(p);
        frag.append(buildSlide(p));
      }
      if (isFirstPage) {
        scroller.replaceChildren(); // drop the loading skeleton
        onFirstPage?.(products);
      }
      scroller.append(frag);
      hasMore = Boolean(meta.has_more);
      offset = meta.next_offset != null ? meta.next_offset : offset + products.length;
    } catch {
      if (!destroyed && items.length === 0) {
        scroller.replaceChildren(
          EmptyState({
            variant: 'error',
            title: t('discover.error.title'),
            description: t('discover.error.desc'),
          })
        );
      }
    } finally {
      loading = false;
    }
  }

  function reload(nextFilters) {
    if (nextFilters) currentFilters = { ...nextFilters };
    for (const slide of slideEls()) observer.unobserve(slide);
    items = [];
    offset = 0;
    hasMore = true;
    seen.clear();
    enriched.clear();
    slideState.clear();
    activeKey = null;
    scroller.replaceChildren(Skeleton({ variant: 'card' }));
    loadMore();
  }

  // Keyboard navigation. Bound at the window level (not on `el`) so the arrow keys move the feed even
  // when nothing inside it is focused — the feed owns the whole viewport on this route. Ignored while
  // the shopper is typing in a field (search box, quantity input) so those keep their native caret
  // behaviour.
  function onKeydown(e) {
    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) {
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      step(-1);
    }
  }
  window.addEventListener('keydown', onKeydown);

  // Discrete wheel navigation: one scroll moves exactly one post smoothly.
  let isWheelStepping = false;
  let wheelTimeout = null;

  function onWheel(e) {
    const panel = e.target.closest('.discover-slide__panel');
    if (panel && panel.scrollHeight > panel.clientHeight) {
      const isUp = e.deltaY < 0;
      const isDown = e.deltaY > 0;
      const atTop = panel.scrollTop <= 2;
      const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2;
      if ((isUp && !atTop) || (isDown && !atBottom)) {
        return; // Allow natural scroll within the text panel
      }
    }

    e.preventDefault();
    if (isWheelStepping) return;

    if (Math.abs(e.deltaY) >= 15) {
      isWheelStepping = true;
      step(e.deltaY > 0 ? 1 : -1);
      clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(() => {
        isWheelStepping = false;
      }, 420);
    }
  }
  scroller.addEventListener('wheel', onWheel, { passive: false });

  // Record a final dwell if the shopper navigates away mid-slide.
  const onPageHide = () => fireDwell();
  window.addEventListener('pagehide', onPageHide);

  // Initial load. Slides go in `scroller`.
  scroller.append(Skeleton({ variant: 'card' }));
  loadMore();

  return {
    el,
    reload,
    step,
    cleanup() {
      destroyed = true;
      fireDwell();
      observer.disconnect();
      window.removeEventListener('keydown', onKeydown);
      scroller.removeEventListener('wheel', onWheel);
      clearTimeout(wheelTimeout);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
}
