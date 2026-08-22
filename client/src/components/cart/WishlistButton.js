/**
 * WishlistButton.js — Reusable heart button for saving items to Wishlist (Prompt 5.1).
 *
 * Fully accessible with aria-pressed, keyboard support, optimistic animation,
 * and multi-language tooltips.
 */

import { toggleWishlist, isProductWishlisted, cartStore } from '../../services/cart.js';
import { t } from '../../services/i18n.js';

const HEART_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
</svg>`;

export function WishlistButton({
  productId,
  size = 'md',
  className = '',
  onChange = null,
} = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `wishlist-btn wishlist-btn--${size} ${className}`.trim();
  btn.innerHTML = HEART_SVG;

  function renderState() {
    const active = isProductWishlisted(productId);
    btn.classList.toggle('wishlist-btn--active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    const label = active
      ? t('wishlist.remove_from_wishlist') || 'Remove from Wishlist'
      : t('wishlist.add_to_wishlist') || 'Add to Wishlist';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  renderState();

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleWishlist(productId);
    renderState();
    if (onChange) onChange(isProductWishlisted(productId));
  });

  const unsubscribe = cartStore.subscribe(() => {
    renderState();
  });

  btn._cleanup = unsubscribe;
  return btn;
}
