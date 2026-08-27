/**
 * wishlist.controller.js — HTTP controller for Wishlist endpoints (Prompt 5.1).
 */

import * as wishlistService from '../services/wishlist.service.js';

export async function getWishlist(req, reply) {
  const { db } = req.server;
  const userId = req.user?.id;
  const wishlist = await wishlistService.getWishlist(db, userId);
  reply.send({ data: { wishlist } });
}

export async function toggleWishlistItem(req, reply) {
  const { db } = req.server;
  const userId = req.user?.id;
  const productId = Number(req.params.productId);
  const result = await wishlistService.toggleWishlist(db, { userId, productId });
  reply.send({ data: result });
}

export async function removeWishlistItem(req, reply) {
  const { db } = req.server;
  const userId = req.user?.id;
  const productId = Number(req.params.productId);
  const result = await wishlistService.removeFromWishlist(db, { userId, productId });
  reply.send({ data: result });
}

export async function setWishlistNotify(req, reply) {
  const { db } = req.server;
  const userId = req.user?.id;
  const productId = Number(req.params.productId);
  const notifyOnDrop = req.body.notify_on_drop;
  const result = await wishlistService.setNotifyOnDrop(db, { userId, productId, notifyOnDrop });
  reply.send({ data: result });
}
