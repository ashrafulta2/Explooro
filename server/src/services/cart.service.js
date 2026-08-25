/**
 * cart.service.js — Cart business logic & live revalidation (Prompt 5.1).
 *
 * Invariants:
 *  - Carts persist server-side for both guests (cart_token) and logged-in users.
 *  - Guest carts merge cleanly on login without duplicates.
 *  - Every cart read revalidates price, stock, and product status, emitting explicit
 *    line warnings without silent mutation.
 *  - Lines are grouped into parcels by supplier so checkout splitting is never a surprise.
 */

import { randomUUID } from 'node:crypto';
import * as cartRepo from '../repositories/cart.repository.js';
import { AppError } from '../plugins/errorHandler.js';

export function generateGuestToken() {
  return `gst_${randomUUID().replace(/-/g, '')}`;
}

/**
 * Variants have no name column — they are identified by `attributes_json`
 * ({"size":"L","color":"Navy"}), so the display label is derived: "L / Navy".
 */
function formatVariantTitle(attributes) {
  if (!attributes || typeof attributes !== 'object') return null;
  const values = Object.values(attributes).filter(Boolean);
  return values.length ? values.join(' / ') : null;
}

export async function getOrCreateActiveCart(db, { userId = null, guestToken = null }) {
  let cart = null;
  if (userId) {
    cart = await cartRepo.findActiveCartByUser(db, userId);
  } else if (guestToken) {
    cart = await cartRepo.findActiveCartByGuestToken(db, guestToken);
  }

  if (!cart) {
    const newGuestToken = userId ? null : (guestToken || generateGuestToken());
    cart = await cartRepo.createCart(db, { userId, guestToken: newGuestToken });
  }

  return cart;
}

export async function getCart(db, { userId = null, guestToken = null }) {
  const cart = await getOrCreateActiveCart(db, { userId, guestToken });
  await cartRepo.touchCartActivity(db, cart.id);

  const rawItems = await cartRepo.getCartItemsWithDetails(db, cart.id);

  // Live revalidation & multi-supplier grouping
  let subtotal = 0;
  let totalItemsCount = 0;
  let hasWarnings = false;

  const suppliersMap = new Map();

  const validatedItems = rawItems.map((raw) => {
    const qty = Number(raw.qty);
    totalItemsCount += qty;

    const currentPrice = Number(raw.variant_price_override ?? raw.current_product_retail_price);
    const priceAtAdd = Number(raw.price_at_add);
    const lineTotal = (currentPrice * qty);
    subtotal += lineTotal;

    const currentStock = Number(raw.variant_stock_qty ?? raw.current_product_stock_qty ?? 0);
    const isProductActive = raw.product_status === 'ACTIVE' && (raw.variant_is_active !== false);

    // Line warnings
    const warnings = [];

    if (!isProductActive) {
      warnings.push({
        code: 'PRODUCT_UNAVAILABLE',
        message_en: 'This product is no longer available.',
        message_bn: 'এই পণ্যটি এখন আর উপলব্ধ নেই।',
      });
      hasWarnings = true;
    } else if (currentStock <= 0) {
      warnings.push({
        code: 'OUT_OF_STOCK',
        message_en: 'This item is out of stock.',
        message_bn: 'এই আইটেমটির স্টক শেষ।',
      });
      hasWarnings = true;
    } else if (qty > currentStock) {
      warnings.push({
        code: 'STOCK_INSUFFICIENT',
        available_qty: currentStock,
        message_en: `Only ${currentStock} units available in stock.`,
        message_bn: `স্টকে মাত্র ${currentStock}টি আইটেম অবশিষ্ট আছে।`,
      });
      hasWarnings = true;
    }

    if (Math.abs(currentPrice - priceAtAdd) > 0.001) {
      warnings.push({
        code: 'PRICE_CHANGED',
        old_price: priceAtAdd.toFixed(2),
        current_price: currentPrice.toFixed(2),
        diff: (currentPrice - priceAtAdd).toFixed(2),
        message_en: `Price changed from ৳${priceAtAdd.toFixed(2)} to ৳${currentPrice.toFixed(2)}.`,
        message_bn: `মূল্য ৳${priceAtAdd.toFixed(2)} থেকে ৳${currentPrice.toFixed(2)} এ পরিবর্তিত হয়েছে।`,
      });
      hasWarnings = true;
    }

    const itemObj = {
      id: Number(raw.id),
      product_id: Number(raw.product_id),
      product_ref: raw.product_ref,
      product_title_en: raw.product_title_en,
      product_title_bn: raw.product_title_bn,
      product_slug: raw.product_slug,
      variant_id: raw.variant_id ? Number(raw.variant_id) : null,
      variant_title: formatVariantTitle(raw.variant_attributes),
      variant_sku: raw.variant_sku,
      saler_id: raw.saler_id ? Number(raw.saler_id) : null,
      bundle_id: raw.bundle_id ? Number(raw.bundle_id) : null,
      qty,
      stock_ceiling: currentStock,
      price_at_add: priceAtAdd.toFixed(2),
      unit_price: currentPrice.toFixed(2),
      line_total: lineTotal.toFixed(2),
      image_url: raw.primary_image_url || '/placeholder-product.svg',
      supplier_id: Number(raw.supplier_id),
      supplier_name: raw.supplier_name,
      warnings,
    };

    // Group into supplier parcels
    const suppId = itemObj.supplier_id;
    if (!suppliersMap.has(suppId)) {
      suppliersMap.set(suppId, {
        supplier_id: suppId,
        supplier_name: raw.supplier_name,
        parcel_ref: `PARCEL-${suppId}`,
        items: [],
        subtotal: 0,
        items_count: 0,
      });
    }

    const parcel = suppliersMap.get(suppId);
    parcel.items.push(itemObj);
    parcel.subtotal += lineTotal;
    parcel.items_count += qty;

    return itemObj;
  });

  const parcels = Array.from(suppliersMap.values()).map((p) => ({
    ...p,
    subtotal: p.subtotal.toFixed(2),
  }));

  // Estimated standard shipping in Bangladesh (e.g., ৳60 per supplier parcel within Dhaka)
  const estimatedShippingPerParcel = 60.0;
  const estimatedShippingTotal = parcels.length * estimatedShippingPerParcel;
  const grandTotal = subtotal + estimatedShippingTotal;

  return {
    cart_id: Number(cart.id),
    guest_token: cart.guest_token,
    user_id: cart.user_id ? Number(cart.user_id) : null,
    status: cart.status,
    items: validatedItems,
    parcels,
    parcel_count: parcels.length,
    items_count: totalItemsCount,
    subtotal: subtotal.toFixed(2),
    estimated_shipping: estimatedShippingTotal.toFixed(2),
    grand_total: grandTotal.toFixed(2),
    has_warnings: hasWarnings,
    last_activity_at: cart.last_activity_at,
  };
}

export async function addItemToCart(db, { userId = null, guestToken = null, productId, variantId = null, salerId = null, bundleId = null, qty = 1 }) {
  if (qty <= 0) {
    throw new AppError('BAD_REQUEST', 'Quantity must be at least 1.', 'পরিমাণ কমপক্ষে ১ হতে হবে।');
  }

  const cart = await getOrCreateActiveCart(db, { userId, guestToken });

  // Verify product & active price
  const { rows: prodRows } = await db.query(
    `SELECT id, default_retail_price, stock_qty, status FROM products WHERE id = $1`,
    [productId]
  );
  if (!prodRows.length || prodRows[0].status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 'Product not available.', 'পণ্যটি উপলব্ধ নেই।');
  }

  let unitPrice = Number(prodRows[0].default_retail_price);
  let availableStock = Number(prodRows[0].stock_qty);

  if (variantId) {
    const { rows: varRows } = await db.query(
      `SELECT id, price_delta, stock_qty, is_active FROM product_variants WHERE id = $1 AND product_id = $2`,
      [variantId, productId]
    );
    if (!varRows.length || !varRows[0].is_active) {
      throw new AppError('NOT_FOUND', 'Selected variant is not available.', 'নির্বাচিত ভ্যারিয়েন্টটি উপলব্ধ নেই।');
    }
    // price_delta is signed and relative to the product price, not a replacement for it.
    unitPrice += Number(varRows[0].price_delta ?? 0);
    availableStock = Number(varRows[0].stock_qty);
  }

  if (availableStock <= 0) {
    throw new AppError('OUT_OF_STOCK', 'Item is out of stock.', 'আইটেমটির স্টক শেষ।');
  }

  await cartRepo.upsertCartItem(db, {
    cartId: cart.id,
    productId,
    variantId,
    salerId,
    bundleId,
    qty,
    priceAtAdd: unitPrice,
  });

  await cartRepo.touchCartActivity(db, cart.id);

  return getCart(db, { userId, guestToken: cart.guest_token });
}

export async function updateItemQuantity(db, { userId = null, guestToken = null, itemId, qty }) {
  if (qty <= 0) {
    return removeItemFromCart(db, { userId, guestToken, itemId });
  }

  const cart = await getOrCreateActiveCart(db, { userId, guestToken });
  const updated = await cartRepo.updateCartItemQty(db, { cartId: cart.id, itemId, qty });
  if (!updated) {
    throw new AppError('NOT_FOUND', 'Cart item not found.', 'কার্ট আইটেম পাওয়া যায়নি।');
  }

  await cartRepo.touchCartActivity(db, cart.id);
  return getCart(db, { userId, guestToken: cart.guest_token });
}

export async function removeItemFromCart(db, { userId = null, guestToken = null, itemId }) {
  const cart = await getOrCreateActiveCart(db, { userId, guestToken });
  await cartRepo.deleteCartItem(db, { cartId: cart.id, itemId });
  await cartRepo.touchCartActivity(db, cart.id);
  return getCart(db, { userId, guestToken: cart.guest_token });
}

export async function mergeGuestCartOnLogin(db, { guestToken, userId }) {
  if (!guestToken || !userId) return;

  const guestCart = await cartRepo.findActiveCartByGuestToken(db, guestToken);
  if (!guestCart) return;

  const userCart = await getOrCreateActiveCart(db, { userId });
  if (guestCart.id === userCart.id) return;

  await cartRepo.mergeGuestCart(db, {
    guestCartId: guestCart.id,
    userCartId: userCart.id,
  });

  await cartRepo.touchCartActivity(db, userCart.id);
  return getCart(db, { userId });
}
