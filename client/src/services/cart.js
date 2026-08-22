/**
 * services/cart.js — Client-side cart and wishlist state management (Prompt 5.1).
 *
 * Provides reactive subscriptions, optimistic UI updates, badge count synchronization,
 * and drawer trigger events.
 */

import { api, pickMessage } from '../core/api.js';
import { createStore } from '../core/store.js';
import { appStore } from '../state/appStore.js';
import { toast } from './toast.js';
import { t } from './i18n.js';

export const cartStore = createStore({
  cart: {
    cart_id: null,
    items: [],
    parcels: [],
    parcel_count: 0,
    items_count: 0,
    subtotal: '0.00',
    estimated_shipping: '0.00',
    grand_total: '0.00',
    has_warnings: false,
  },
  wishlistProductIds: new Set(),
  drawerOpen: false,
  loading: false,
});

let isInitialized = false;

export async function initCart() {
  if (isInitialized) return;
  isInitialized = true;
  await Promise.all([fetchCart(), fetchWishlist()]);
}

export function openCartDrawer() {
  cartStore.update({ drawerOpen: true });
}

export function closeCartDrawer() {
  cartStore.update({ drawerOpen: false });
}

export function toggleCartDrawer() {
  const current = cartStore.get().drawerOpen;
  cartStore.update({ drawerOpen: !current });
}

export async function fetchCart() {
  try {
    cartStore.update({ loading: true });
    const res = await api.get('/cart', { skipAuthRedirect: true });
    if (res?.data?.cart) {
      updateCartState(res.data.cart);
    }
  } catch (err) {
    console.error('Failed to fetch cart:', err);
  } finally {
    cartStore.update({ loading: false });
  }
}

function updateCartState(cart) {
  cartStore.update({ cart });
  // Sync badge in appStore
  const badges = appStore.get().badges || {};
  appStore.update({
    badges: {
      ...badges,
      cart: cart.items_count || 0,
    },
  });
}

export async function addToCart({
  product_id,
  variant_id = null,
  saler_id = null,
  bundle_id = null,
  qty = 1,
  title_en = '',
  title_bn = '',
  slug = '',
  variant_title = '',
  variant_sku = '',
  price = 0,
  image_url = '',
  supplier_id = 1,
  supplier_name = '',
  stock_qty = 10,
}) {
  const previousCart = cartStore.get().cart;

  // Optimistic update
  const currentItems = [...(previousCart.items || [])];
  const existingIdx = currentItems.findIndex(
    (i) => i.product_id === product_id && (i.variant_id || null) === (variant_id || null)
  );

  if (existingIdx >= 0) {
    currentItems[existingIdx] = {
      ...currentItems[existingIdx],
      qty: currentItems[existingIdx].qty + qty,
      line_total: ((currentItems[existingIdx].qty + qty) * Number(currentItems[existingIdx].unit_price)).toFixed(2),
    };
  } else {
    currentItems.push({
      id: Date.now(),
      product_id,
      product_title_en: title_en,
      product_title_bn: title_bn,
      product_slug: slug,
      variant_id,
      variant_title,
      variant_sku,
      saler_id,
      bundle_id,
      qty,
      stock_ceiling: stock_qty,
      price_at_add: Number(price).toFixed(2),
      unit_price: Number(price).toFixed(2),
      line_total: (Number(price) * qty).toFixed(2),
      image_url,
      supplier_id,
      supplier_name: supplier_name || t('product_detail.supplier.tier.standard'),
      warnings: [],
    });
  }

  // Temporary optimistic recalculation
  const optimisticSubtotal = currentItems.reduce((acc, i) => acc + Number(i.line_total), 0);
  const optimisticCount = currentItems.reduce((acc, i) => acc + i.qty, 0);

  cartStore.update({
    cart: {
      ...previousCart,
      items: currentItems,
      items_count: optimisticCount,
      subtotal: optimisticSubtotal.toFixed(2),
      grand_total: optimisticSubtotal.toFixed(2),
    },
    drawerOpen: true, // open drawer immediately on adding to cart
  });

  const badges = appStore.get().badges || {};
  appStore.update({ badges: { ...badges, cart: optimisticCount } });

  toast.success(t('cart.added_to_cart_toast') || 'Added to cart');

  try {
    const res = await api.post('/cart/items', {
      product_id,
      variant_id,
      saler_id,
      bundle_id,
      qty,
      title_en,
      title_bn,
      slug,
      variant_title,
      variant_sku,
      price,
      image_url,
      supplier_id,
      supplier_name,
      stock_qty,
    });

    if (res?.data?.cart) {
      updateCartState(res.data.cart);
    }
  } catch (err) {
    // Rollback on failure
    updateCartState(previousCart);
    toast.error(pickMessage(err) || err.message || t('cart.add_failed'));
  }
}

export async function updateItemQuantity(itemId, newQty) {
  const previousCart = cartStore.get().cart;

  // Optimistic update
  let nextItems;
  if (newQty <= 0) {
    nextItems = (previousCart.items || []).filter((i) => i.id !== itemId);
  } else {
    nextItems = (previousCart.items || []).map((i) => {
      if (i.id !== itemId) return i;
      return {
        ...i,
        qty: newQty,
        line_total: (newQty * Number(i.unit_price)).toFixed(2),
      };
    });
  }

  const optimisticSubtotal = nextItems.reduce((acc, i) => acc + Number(i.line_total), 0);
  const optimisticCount = nextItems.reduce((acc, i) => acc + i.qty, 0);

  cartStore.update({
    cart: {
      ...previousCart,
      items: nextItems,
      items_count: optimisticCount,
      subtotal: optimisticSubtotal.toFixed(2),
      grand_total: optimisticSubtotal.toFixed(2),
    },
  });

  const badges = appStore.get().badges || {};
  appStore.update({ badges: { ...badges, cart: optimisticCount } });

  try {
    let res;
    if (newQty <= 0) {
      res = await api.delete(`/cart/items/${itemId}`);
    } else {
      res = await api.patch(`/cart/items/${itemId}`, { qty: newQty });
    }
    if (res?.data?.cart) {
      updateCartState(res.data.cart);
    }
  } catch (err) {
    updateCartState(previousCart);
    toast.error(pickMessage(err) || err.message || t('cart.update_failed'));
  }
}

export async function removeFromCart(itemId) {
  return updateItemQuantity(itemId, 0);
}

/* ---------------- Wishlist Helpers ---------------- */

export async function fetchWishlist() {
  try {
    const res = await api.get('/wishlist', { skipAuthRedirect: true });
    if (res?.data?.wishlist?.items) {
      const set = new Set(res.data.wishlist.items.map((w) => Number(w.product_id)));
      cartStore.update({ wishlistProductIds: set });
    }
  } catch {
    // Guest or unauthenticated users might not have server-side wishlist
  }
}

export async function toggleWishlist(productId) {
  const currentSet = new Set(cartStore.get().wishlistProductIds);
  const isPresent = currentSet.has(Number(productId));

  // Optimistic flip
  if (isPresent) {
    currentSet.delete(Number(productId));
    toast.info(t('wishlist.removed_toast') || 'Removed from wishlist');
  } else {
    currentSet.add(Number(productId));
    toast.success(t('wishlist.added_toast') || 'Saved to wishlist');
  }
  cartStore.update({ wishlistProductIds: currentSet });

  try {
    const res = await api.post(`/wishlist/${productId}`);
    if (res?.data) {
      const confirmedSet = new Set(cartStore.get().wishlistProductIds);
      if (res.data.in_wishlist) {
        confirmedSet.add(Number(productId));
      } else {
        confirmedSet.delete(Number(productId));
      }
      cartStore.update({ wishlistProductIds: confirmedSet });
    }
  } catch (err) {
    // Rollback
    const rollbackSet = new Set(cartStore.get().wishlistProductIds);
    if (isPresent) {
      rollbackSet.add(Number(productId));
    } else {
      rollbackSet.delete(Number(productId));
    }
    cartStore.update({ wishlistProductIds: rollbackSet });
    toast.error(pickMessage(err) || err.message || t('wishlist.update_failed'));
  }
}

export function isProductWishlisted(productId) {
  return cartStore.get().wishlistProductIds.has(Number(productId));
}

export function getCart() {
  return cartStore.get().cart;
}
