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

const GUEST_CART_STORAGE_KEY = 'explooro_guest_cart';

function loadStoredCart() {
  try {
    const raw = localStorage.getItem(GUEST_CART_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStoredCart(cart) {
  try {
    if (!cart || !cart.items || cart.items.length === 0) {
      localStorage.removeItem(GUEST_CART_STORAGE_KEY);
    } else {
      localStorage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify(cart));
    }
  } catch {}
}

export function buildCartFromItems(items = []) {
  const suppliersMap = new Map();
  let subtotal = 0;
  let itemsCount = 0;

  items.forEach((item) => {
    const qty = Number(item.qty || 1);
    itemsCount += qty;
    const unitPrice = Number(item.unit_price ?? item.price ?? 0);
    const lineTotal = Number(item.line_total ?? (unitPrice * qty));
    item.line_total = lineTotal.toFixed(2);
    item.unit_price = unitPrice.toFixed(2);
    subtotal += lineTotal;

    const suppId = item.supplier_id || 1;
    if (!suppliersMap.has(suppId)) {
      suppliersMap.set(suppId, {
        supplier_id: suppId,
        supplier_name: item.supplier_name || 'Verified Supplier',
        parcel_ref: `PARCEL-${suppId}`,
        items: [],
        subtotal: '0.00',
        items_count: 0,
      });
    }

    const parcel = suppliersMap.get(suppId);
    parcel.items.push(item);
    parcel.subtotal = (Number(parcel.subtotal) + lineTotal).toFixed(2);
    parcel.items_count += qty;
  });

  const parcels = Array.from(suppliersMap.values());
  const estimatedShipping = (parcels.length * 60.0).toFixed(2);
  const grandTotal = (subtotal + Number(estimatedShipping)).toFixed(2);

  return {
    cart_id: Date.now(),
    items,
    parcels,
    parcel_count: parcels.length,
    items_count: itemsCount,
    subtotal: subtotal.toFixed(2),
    estimated_shipping: estimatedShipping,
    grand_total: grandTotal,
    has_warnings: false,
  };
}

const initialStored = loadStoredCart();

export const cartStore = createStore({
  cart: initialStored || {
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
    if (res?.data?.cart?.items?.length > 0) {
      updateCartState(res.data.cart);
    } else {
      const local = loadStoredCart();
      if (local && local.items && local.items.length > 0) {
        updateCartState(local);
      } else if (res?.data?.cart) {
        updateCartState(res.data.cart);
      }
    }
  } catch (err) {
    const local = loadStoredCart();
    if (local) {
      updateCartState(local);
    }
  } finally {
    cartStore.update({ loading: false });
  }
}

function updateCartState(cart) {
  const normalizedCart = (!cart.parcels || cart.parcels.length === 0) && cart.items?.length > 0
    ? buildCartFromItems(cart.items)
    : cart;

  cartStore.update({ cart: normalizedCart });
  saveStoredCart(normalizedCart);

  // Sync badge in appStore
  const badges = appStore.get().badges || {};
  appStore.update({
    badges: {
      ...badges,
      cart: normalizedCart.items_count || 0,
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
    const existing = currentItems[existingIdx];
    const newQty = existing.qty + qty;
    const unitPrice = Number(existing.unit_price || price);
    currentItems[existingIdx] = {
      ...existing,
      qty: newQty,
      line_total: (newQty * unitPrice).toFixed(2),
    };
  } else {
    currentItems.push({
      id: Date.now(),
      product_id,
      product_title_en: title_en || 'Product Item',
      product_title_bn: title_bn || 'পণ্য আইটেম',
      product_slug: slug || `product-${product_id}`,
      variant_id,
      variant_title,
      variant_sku,
      saler_id,
      bundle_id,
      qty,
      stock_ceiling: stock_qty || 10,
      price_at_add: Number(price).toFixed(2),
      unit_price: Number(price).toFixed(2),
      line_total: (Number(price) * qty).toFixed(2),
      image_url,
      supplier_id: supplier_id || 1,
      supplier_name: supplier_name || t('product_detail.supplier.tier.standard') || 'Verified Supplier',
      warnings: [],
    });
  }

  const optimisticCart = buildCartFromItems(currentItems);

  cartStore.update({
    cart: optimisticCart,
    drawerOpen: true, // open drawer immediately on adding to cart
  });
  saveStoredCart(optimisticCart);

  const badges = appStore.get().badges || {};
  appStore.update({ badges: { ...badges, cart: optimisticCart.items_count } });

  toast.success(t('cart.added_to_cart_toast') || 'Added to cart');

  try {
    const res = await api.post(
      '/cart/items',
      {
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
      },
      { skipAuthRedirect: true }
    );

    if (res?.data?.cart) {
      updateCartState(res.data.cart);
    }
  } catch (err) {
    // Keep local guest cart active even if server sync fails
    console.warn('Server cart sync notice:', err);
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

  const optimisticCart = buildCartFromItems(nextItems);
  updateCartState(optimisticCart);

  try {
    let res;
    if (newQty <= 0) {
      res = await api.delete(`/cart/items/${itemId}`, { skipAuthRedirect: true });
    } else {
      res = await api.patch(`/cart/items/${itemId}`, { qty: newQty }, { skipAuthRedirect: true });
    }
    if (res?.data?.cart) {
      updateCartState(res.data.cart);
    }
  } catch (err) {
    console.warn('Server cart update notice:', err);
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

/**
 * Toggle the price-drop alert flag for a wishlisted product.
 * Returns the confirmed server value so the caller can reconcile its own UI.
 */
export async function setWishlistNotify(productId, notifyOnDrop) {
  const res = await api.patch(`/wishlist/${productId}/notify`, { notify_on_drop: !!notifyOnDrop });
  return res?.data?.notify_on_drop;
}

export function getCart() {
  return cartStore.get().cart;
}

export function clearCart() {
  const emptyCart = {
    cart_id: null,
    items: [],
    parcels: [],
    parcel_count: 0,
    items_count: 0,
    subtotal: '0.00',
    estimated_shipping: '0.00',
    grand_total: '0.00',
    has_warnings: false,
  };
  updateCartState(emptyCart);
}

export async function syncCartToServer() {
  const items = cartStore.get().cart?.items || [];
  if (items.length === 0) return;

  for (const item of items) {
    try {
      await api.post(
        '/cart/items',
        {
          product_id: item.product_id,
          variant_id: item.variant_id || null,
          saler_id: item.saler_id || null,
          bundle_id: item.bundle_id || null,
          qty: item.qty || 1,
          title_en: item.product_title_en,
          title_bn: item.product_title_bn,
          slug: item.product_slug,
          variant_title: item.variant_title,
          variant_sku: item.variant_sku,
          price: item.unit_price,
          image_url: item.image_url,
          supplier_id: item.supplier_id,
          supplier_name: item.supplier_name,
          stock_qty: item.stock_ceiling,
        },
        { skipAuthRedirect: true }
      );
    } catch {}
  }
}
