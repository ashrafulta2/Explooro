/**
 * CartPage.js — the full-page shopping cart (route: /cart).
 *
 * Replaces the old right-side drawer, which squeezed a multi-parcel cart into ~420px. Items sit
 * in a wide column grouped by supplier parcel; the order summary is sticky beside them on desktop
 * and moves above the items on small screens so "Proceed to Checkout" is never buried.
 *
 * Data comes from cartStore (optimistic updates live in services/cart.js); this page only renders.
 */

import { Button } from '../components/ui/Button.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { cartStore, fetchCart, updateItemQuantity, removeFromCart, toggleWishlist, isProductWishlisted } from '../services/cart.js';
import { formatCurrency } from '../services/format.js';
import { t, getLanguage } from '../services/i18n.js';
import { loadCartPageStyles } from '../styles/loadCartPageStyles.js';
import { PLACEHOLDER_COLOURS, placeholderInitials, resolveProductImage } from '../components/product/ProductCard.js';

const PARCEL_ICON_SVG = `
<svg class="cart-page__notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m7.5 4.27 9 5.15"/>
  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
  <path d="m3.3 7 8.7 5 8.7-5"/>
  <path d="M12 22V12"/>
</svg>`;

// Stock ceiling at or below which the row says "Only N left".
const LOW_STOCK_THRESHOLD = 5;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export default function CartPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else window.location.assign(url);
  };

  loadCartPageStyles();

  const container = el('div', 'cart-page container');
  root.append(container);

  function derivedParcels(cart) {
    if (cart.parcels?.length) return cart.parcels;
    const bySupplier = new Map();
    (cart.items || []).forEach((item) => {
      const id = item.supplier_id || 1;
      if (!bySupplier.has(id)) {
        bySupplier.set(id, { supplier_id: id, supplier_name: item.supplier_name || '', items: [], items_count: 0, subtotal: 0 });
      }
      const parcel = bySupplier.get(id);
      parcel.items.push(item);
      parcel.items_count += item.qty || 1;
      parcel.subtotal += Number(item.line_total || 0);
    });
    return Array.from(bySupplier.values());
  }

  function productTitle(item) {
    return getLanguage() === 'bn' && item.product_title_bn
      ? item.product_title_bn
      : item.product_title_en || item.title_en || item.title || '';
  }

  function renderItemImage(item) {
    const wrap = el('div', 'cart-item__image-wrap');
    const palette = PLACEHOLDER_COLOURS[(item.product_id ?? 0) % PLACEHOLDER_COLOURS.length] || PLACEHOLDER_COLOURS[0];
    const placeholder = el('div', 'cart-item__image-placeholder', placeholderInitials(item.product_title_en || item.title_en || item.title));
    placeholder.style.cssText = `background:${palette.bg};color:${palette.fg}`;

    const src = resolveProductImage({
      id: item.product_id || item.id,
      product_id: item.product_id || item.id,
      image_url: item.image_url,
      primary_image_url: item.primary_image_url,
      title_en: item.product_title_en || item.title_en || item.title,
      title_bn: item.product_title_bn || item.title_bn || item.title,
      title: item.product_title_en || item.title_en || item.title,
      category: item.category,
      category_name_en: item.category_name_en,
      slug: item.product_slug,
    });
    if (!src) {
      wrap.append(placeholder);
      return wrap;
    }
    const img = el('img', 'cart-item__image');
    img.src = src;
    img.alt = productTitle(item);
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(placeholder), { once: true });
    wrap.append(img);
    return wrap;
  }

  function renderItem(item) {
    const row = el('div', 'cart-item');
    row.append(renderItemImage(item));

    const details = el('div', 'cart-item__details');
    const ref = item.product_ref || item.product_id;
    const title = el('a', 'cart-item__title', productTitle(item));
    title.href = `/product/${ref}`;
    title.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      nav(`/product/${ref}`);
    });
    details.append(title);
    if (item.variant_title) details.append(el('div', 'cart-item__variant', item.variant_title));

    const ceiling = Number(item.stock_ceiling) || 0;
    if (ceiling > 0 && ceiling <= LOW_STOCK_THRESHOLD) {
      details.append(el('div', 'cart-item__stock cart-item__stock--low', t('cart.only_n_left', { count: ceiling })));
    } else {
      details.append(el('div', 'cart-item__stock', t('cart.in_stock')));
    }
    row.append(details);

    const price = el('div', 'cart-item__price');
    price.append(el('span', 'cart-item__price-main', formatCurrency(item.line_total ?? item.unit_price)));
    if (item.qty > 1) price.append(el('span', 'cart-item__price-each', `${formatCurrency(item.unit_price)} ${t('cart.each')}`));
    row.append(price);

    const actions = el('div', 'cart-item__actions');
    const stepper = el('div', 'cart-stepper');
    stepper.setAttribute('role', 'group');
    stepper.setAttribute('aria-label', t('cart.quantity'));

    const minus = el('button', 'cart-stepper__btn', item.qty === 1 ? '🗑️' : '−');
    minus.type = 'button';
    minus.dataset.focusKey = `minus-${item.id}`;
    minus.setAttribute('aria-label', item.qty === 1 ? t('cart.remove') : t('cart.decrease'));
    minus.addEventListener('click', () => updateItemQuantity(item.id, item.qty - 1));

    const qty = el('span', 'cart-stepper__qty', String(item.qty));
    qty.setAttribute('aria-live', 'polite');

    const plus = el('button', 'cart-stepper__btn', '+');
    plus.type = 'button';
    plus.dataset.focusKey = `plus-${item.id}`;
    plus.setAttribute('aria-label', t('cart.increase'));
    plus.disabled = Boolean(ceiling) && item.qty >= ceiling;
    plus.addEventListener('click', () => updateItemQuantity(item.id, item.qty + 1));
    stepper.append(minus, qty, plus);
    actions.append(stepper);

    const remove = el('button', 'cart-item__link-btn cart-item__link-btn--danger', t('cart.remove'));
    remove.type = 'button';
    remove.addEventListener('click', () => removeFromCart(item.id));
    actions.append(remove);

    const save = el('button', 'cart-item__link-btn', t('cart.save_for_later'));
    save.type = 'button';
    save.addEventListener('click', async () => {
      // WHY the guard: toggleWishlist flips, so calling it for an already-saved product would
      // un-save it while the row is also being removed from the cart.
      if (!isProductWishlisted(item.product_id)) await toggleWishlist(item.product_id);
      removeFromCart(item.id);
    });
    actions.append(save);
    row.append(actions);

    (item.warnings || []).forEach((w) => {
      const kind = w.code === 'PRICE_CHANGED' ? 'price' : 'stock';
      const msg = getLanguage() === 'bn' && w.message_bn ? w.message_bn : w.message_en;
      row.append(el('div', `cart-item__warning cart-item__warning--${kind}`, `⚠️ ${msg}`));
    });
    return row;
  }

  function renderParcel(parcel, index) {
    const card = el('section', 'cart-parcel');
    const header = el('div', 'cart-parcel__header');
    const info = el('div', 'cart-parcel__supplier-info');
    info.append(
      el('span', 'cart-parcel__tag', t('cart.parcel_number', { number: index + 1 })),
      el('span', 'cart-parcel__supplier-name', parcel.supplier_name || t('cart.verified_supplier')),
    );
    header.append(info, el('span', 'cart-parcel__total', `${t('cart.items_count', { count: parcel.items_count })} · ${formatCurrency(parcel.subtotal)}`));
    card.append(header);
    parcel.items.forEach((item) => card.append(renderItem(item)));
    return card;
  }

  function renderSummary(cart, parcelCount, itemCount) {
    const box = el('aside', 'cart-summary');
    box.setAttribute('aria-label', t('cart.order_summary'));
    box.append(el('h2', 'cart-summary__title', t('cart.order_summary')));

    const row = (label, value, mod = '') => {
      const r = el('div', `cart-summary__row ${mod}`.trim());
      r.append(el('span', '', label), el('span', 'cart-summary__val', value));
      return r;
    };
    const subtotal = Number(cart.subtotal) || 0;
    const shipping = Number(cart.estimated_shipping) || 0;
    box.append(
      row(`${t('cart.subtotal')} (${t('cart.items_count', { count: itemCount })})`, formatCurrency(subtotal.toFixed(2))),
      row(t('cart.shipping_estimate', { count: parcelCount }), formatCurrency(shipping.toFixed(2))),
      row(t('cart.total'), formatCurrency((subtotal + shipping).toFixed(2)), 'cart-summary__row--total'),
    );

    const checkout = Button({
      label: t('cart.proceed_to_checkout'),
      variant: 'primary',
      size: 'lg',
      className: 'cart-summary__checkout',
      onClick: () => nav('/checkout'),
    });
    box.append(checkout, el('p', 'cart-summary__note', t('cart.shipping_calculated_note')));
    return box;
  }

  function render() {
    // WHY: every cart mutation re-renders the page. Without restoring focus, a keyboard user
    // pressing "+" loses their place and has to tab back through the list from the top.
    const focusKey = document.activeElement?.dataset?.focusKey;

    const cart = cartStore.get().cart || { items: [] };
    const items = cart.items || [];
    container.replaceChildren();

    const itemCount = cart.items_count || items.reduce((n, i) => n + (i.qty || 1), 0);
    const header = el('div', 'cart-page__header');
    const title = el('h1', 'cart-page__title', t('cart.title'));
    if (itemCount > 0) title.append(el('span', 'cart-page__count', `(${t('cart.items_count', { count: itemCount })})`));
    header.append(title);
    const keepShopping = el('a', 'cart-page__continue', t('cart.continue_shopping_link'));
    keepShopping.href = '/';
    keepShopping.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      nav('/');
    });
    header.append(keepShopping);
    container.append(header);

    if (items.length === 0) {
      container.append(
        EmptyState({
          icon: '🛒',
          title: t('cart.empty_title'),
          description: t('cart.empty_description'),
          action: Button({ label: t('cart.continue_shopping'), variant: 'primary', onClick: () => nav('/') }),
        }),
      );
      return;
    }

    const parcels = derivedParcels(cart);
    const layout = el('div', 'cart-page__layout');
    const main = el('div', 'cart-page__main');

    if (parcels.length > 1) {
      const notice = el('div', 'cart-page__notice');
      notice.insertAdjacentHTML('beforeend', PARCEL_ICON_SVG);
      const text = el('div');
      text.append(el('strong', '', t('cart.parcel_split_title', { count: parcels.length })), el('span', '', t('cart.parcel_split_desc')));
      notice.append(text);
      main.append(notice);
    }
    parcels.forEach((parcel, i) => main.append(renderParcel(parcel, i)));

    const aside = el('div', 'cart-page__aside');
    aside.append(renderSummary(cart, parcels.length, itemCount));

    layout.append(main, aside);
    container.append(layout);

    if (focusKey) container.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  render();
  const unsubscribe = cartStore.subscribe(render);
  // Refresh from the server so prices/stock are current when the shopper lands here.
  fetchCart();

  return () => unsubscribe();
}
