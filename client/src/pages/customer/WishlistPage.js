/**
 * WishlistPage.js — Customer Saved Items (Wishlist) Listing Page
 *
 * Route: /account/wishlist
 *
 * Lists every product the customer has saved, with price-drop highlighting,
 * stock status, and quick actions (move to cart / remove). Data comes from the
 * same `/wishlist` endpoint used by the WishlistButton and header badge, so the
 * page and the heart icons stay in sync via cartStore.
 *
 * All UI strings resolve via t('wishlist.*') for proper English ↔ Bangla i18n.
 */

import { api } from '../../core/api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { Switch } from '../../components/ui/Switch.js';
import { addToCart, toggleWishlist, openCartDrawer, setWishlistNotify } from '../../services/cart.js';
import { resolveProductImage } from '../../components/product/ProductCard.js';

export default function WishlistPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'wishlist-page';

  // Header
  const header = document.createElement('div');
  header.className = 'wishlist-page__header';
  header.innerHTML = `
    <a href="/account" class="wishlist-page__back" data-nav-back>${t('wishlist.back_to_account')}</a>
    <h1 class="wishlist-page__title">${t('wishlist.page_title')}</h1>
    <p class="wishlist-page__subtitle">${t('wishlist.page_subtitle')}</p>
  `;
  container.append(header);

  header.querySelector('[data-nav-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    nav('/account');
  });

  // List slot
  const listSlot = document.createElement('div');
  listSlot.className = 'wishlist-page__list';
  container.append(listSlot);
  root.append(container);

  // Helpers
  function itemTitle(item) {
    return getLanguage() === 'bn'
      ? item.title_bn || item.title_en
      : item.title_en || item.title_bn;
  }

  async function loadWishlist() {
    listSlot.innerHTML = '';
    listSlot.append(
      Skeleton({ width: '100%', height: '110px' }),
      Skeleton({ width: '100%', height: '110px' }),
      Skeleton({ width: '100%', height: '110px' })
    );

    try {
      const res = await api.get('/wishlist', { skipAuthRedirect: true });
      const items = res.data?.wishlist?.items || res.data?.items || [];
      renderWishlist(Array.isArray(items) ? items : []);
    } catch (err) {
      listSlot.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.className = 'wishlist-page__error';
      errBox.textContent = t('wishlist.load_failed');
      listSlot.append(errBox);
    }
  }

  function renderWishlist(items) {
    listSlot.innerHTML = '';

    if (items.length === 0) {
      const browseBtn = document.createElement('button');
      browseBtn.type = 'button';
      browseBtn.className = 'btn btn--primary';
      browseBtn.textContent = t('wishlist.browse_products');
      browseBtn.addEventListener('click', () => nav('/'));

      const empty = EmptyState({
        icon: '💚',
        title: t('wishlist.empty_title'),
        description: t('wishlist.empty_description'),
        action: browseBtn,
      });
      listSlot.append(empty.element || empty);
      return;
    }

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'wishlist-card';
      card.dataset.productId = item.product_id;

      const savedPrice = Number(item.saved_price || 0);
      const currentPrice = Number(item.current_price ?? item.saved_price ?? 0);
      const dropped = item.price_dropped && currentPrice < savedPrice;
      const inStock = item.is_in_stock !== false && Number(item.stock_qty ?? 0) > 0;
      const title = itemTitle(item);
      const productUrl = `/product/${item.slug || item.product_id}`;
      const imgSrc = resolveProductImage(item);
      const fallbackImg = resolveProductImage({ ...item, image_url: null });

      // Thumbnail (clickable → product detail). object-fit + a fixed box keeps a broken or
      // oversized image from blowing out the card; onerror falls back to the category/keyword image.
      const thumb = document.createElement('a');
      thumb.href = productUrl;
      thumb.className = 'wishlist-card__thumb';
      thumb.innerHTML = `<img class="wishlist-card__img" src="${imgSrc}" alt="${title}" loading="lazy" onerror="this.onerror=null;this.src='${fallbackImg}'" />`;
      thumb.addEventListener('click', (e) => {
        e.preventDefault();
        nav(productUrl);
      });

      // Body
      const body = document.createElement('div');
      body.className = 'wishlist-card__body';

      const priceBlock = dropped
        ? `<div class="wishlist-card__price-row">
             <span class="wishlist-card__price">${formatCurrency(currentPrice)}</span>
             <span class="wishlist-card__price--old">${formatCurrency(savedPrice)}</span>
             <span class="wishlist-badge wishlist-badge--drop">${t('wishlist.price_drop_badge', { amount: formatCurrency(Number(item.drop_amount || savedPrice - currentPrice)) })}</span>
           </div>`
        : `<div class="wishlist-card__price-row"><span class="wishlist-card__price">${formatCurrency(currentPrice)}</span></div>`;

      const stockBadge = inStock
        ? `<span class="wishlist-badge wishlist-badge--in">${t('wishlist.in_stock')}</span>`
        : `<span class="wishlist-badge wishlist-badge--out">${t('wishlist.out_of_stock')}</span>`;

      body.innerHTML = `
        <a href="${productUrl}" class="wishlist-card__title" data-nav-product>${title}</a>
        <div class="wishlist-card__badges">${stockBadge}</div>
        ${priceBlock}
      `;

      body.querySelector('[data-nav-product]')?.addEventListener('click', (e) => {
        e.preventDefault();
        nav(productUrl);
      });

      // Price-drop alert toggle — flips optimistically, then reconciles with the server.
      const notifySwitch = Switch({
        label: t('wishlist.notify_label'),
        hint: t('wishlist.notify_hint'),
        checked: item.notify_on_drop !== false,
        onChange: async (next) => {
          notifySwitch.setPending(true);
          try {
            const confirmed = await setWishlistNotify(item.product_id, next);
            notifySwitch.checked = confirmed !== undefined ? confirmed : next;
            notifySwitch.commit();
          } catch (err) {
            notifySwitch.revert();
            toast.error(t('wishlist.notify_failed'));
          }
        },
      });
      notifySwitch.classList.add('wishlist-card__notify');
      body.append(notifySwitch);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'wishlist-card__actions';

      const moveBtn = document.createElement('button');
      moveBtn.type = 'button';
      moveBtn.className = 'btn btn--primary btn--sm';
      moveBtn.textContent = t('wishlist.move_to_cart');
      moveBtn.disabled = !inStock;
      moveBtn.addEventListener('click', async () => {
        moveBtn.disabled = true;
        try {
          await addToCart({
            product_id: item.product_id,
            qty: 1,
            title_en: item.title_en,
            title_bn: item.title_bn,
            slug: item.slug,
            price: currentPrice,
            image_url: imgSrc,
            stock_qty: item.stock_qty,
          });
          // Remove from wishlist once it lands in the cart.
          await toggleWishlist(item.product_id);
          card.remove();
          openCartDrawer();
          if (!listSlot.querySelector('[data-product-id]')) renderWishlist([]);
        } catch (err) {
          moveBtn.disabled = false;
          toast.error(t('wishlist.move_failed'));
        }
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn--ghost btn--sm';
      removeBtn.textContent = t('wishlist.remove');
      removeBtn.addEventListener('click', async () => {
        removeBtn.disabled = true;
        try {
          await toggleWishlist(item.product_id);
          card.remove();
          if (!listSlot.querySelector('[data-product-id]')) renderWishlist([]);
        } catch (err) {
          removeBtn.disabled = false;
          toast.error(t('wishlist.remove_failed'));
        }
      });

      actions.append(moveBtn, removeBtn);
      card.append(thumb, body, actions);
      listSlot.append(card);
    });
  }

  loadWishlist();

  return () => {
    container.remove();
  };
}
