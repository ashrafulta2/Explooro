/**
 * wishlist.service.js — Wishlist business logic (Prompt 5.1).
 */

import * as cartRepo from '../repositories/cart.repository.js';
import { AppError } from '../plugins/errorHandler.js';

export async function getWishlist(db, userId) {
  if (!userId) {
    throw new AppError('AUTH_REQUIRED', 'Sign in required for wishlist.', 'উইশলিস্টের জন্য সাইন ইন করা প্রয়োজন।');
  }

  const items = await cartRepo.getWishlistByUser(db, userId);

  const formatted = items.map((item) => {
    const savedPrice = Number(item.price_at_save);
    const currentPrice = Number(item.current_retail_price);
    const isDropped = currentPrice < savedPrice;
    const dropAmount = isDropped ? (savedPrice - currentPrice).toFixed(2) : '0.00';

    return {
      id: Number(item.id),
      product_id: Number(item.product_id),
      product_ref: item.product_ref,
      title_en: item.product_title_en,
      title_bn: item.product_title_bn,
      slug: item.product_slug,
      saved_price: savedPrice.toFixed(2),
      current_price: currentPrice.toFixed(2),
      price_dropped: isDropped,
      drop_amount: dropAmount,
      stock_qty: Number(item.stock_qty ?? 0),
      is_in_stock: Number(item.stock_qty ?? 0) > 0,
      image_url: item.primary_image_url || '/placeholder-product.svg',
      notify_on_drop: item.notify_on_drop,
      created_at: item.created_at,
    };
  });

  return {
    items: formatted,
    count: formatted.length,
  };
}

export async function toggleWishlist(db, { userId, productId }) {
  if (!userId) {
    throw new AppError('AUTH_REQUIRED', 'Sign in required for wishlist.', 'উইশলিস্টের জন্য সাইন ইন করা প্রয়োজন।');
  }

  const exists = await cartRepo.isProductInWishlist(db, { userId, productId });
  if (exists) {
    await cartRepo.removeWishlistItem(db, { userId, productId });
    return { in_wishlist: false, product_id: productId };
  }

  // Get current price
  const { rows } = await db.query(
    `SELECT retail_price FROM products WHERE id = $1 AND status = 'ACTIVE'`,
    [productId]
  );
  if (!rows.length) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'পণ্যটি পাওয়া যায়নি।');
  }

  const currentPrice = Number(rows[0].retail_price);
  await cartRepo.addWishlistItem(db, {
    userId,
    productId,
    priceAtSave: currentPrice,
    notifyOnDrop: true,
  });

  return { in_wishlist: true, product_id: productId };
}

export async function removeFromWishlist(db, { userId, productId }) {
  if (!userId) {
    throw new AppError('AUTH_REQUIRED', 'Sign in required for wishlist.', 'উইশলিস্টের জন্য সাইন ইন করা প্রয়োজন।');
  }
  await cartRepo.removeWishlistItem(db, { userId, productId });
  return { removed: true, product_id: productId };
}
