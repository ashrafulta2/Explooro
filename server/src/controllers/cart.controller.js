/**
 * cart.controller.js — HTTP controller for Cart endpoints (Prompt 5.1).
 */

import * as cartService from '../services/cart.service.js';

const CART_COOKIE = 'cart_token';

function getIdentity(req) {
  const userId = req.user ? req.user.id : null;
  const guestToken = req.cookies?.[CART_COOKIE] || req.headers['x-cart-token'] || null;
  return { userId, guestToken };
}

function ensureCartCookie(reply, config, guestToken) {
  if (!guestToken) return;
  reply.setCookie(CART_COOKIE, guestToken, {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });
}

export async function getCart(req, reply) {
  const { db, config } = req.server;
  const { userId, guestToken } = getIdentity(req);

  const cart = await cartService.getCart(db, { userId, guestToken });
  if (!userId && cart.guest_token) {
    ensureCartCookie(reply, config, cart.guest_token);
  }

  reply.send({ data: { cart } });
}

export async function addItem(req, reply) {
  const { db, config } = req.server;
  const { userId, guestToken } = getIdentity(req);
  const { product_id, variant_id, saler_id, bundle_id, qty } = req.body;

  const cart = await cartService.addItemToCart(db, {
    userId,
    guestToken,
    productId: Number(product_id),
    variantId: variant_id ? Number(variant_id) : null,
    salerId: saler_id ? Number(saler_id) : null,
    bundleId: bundle_id ? Number(bundle_id) : null,
    qty: Number(qty || 1),
  });

  if (!userId && cart.guest_token) {
    ensureCartCookie(reply, config, cart.guest_token);
  }

  reply.send({ data: { cart } });
}

export async function updateItem(req, reply) {
  const { db } = req.server;
  const { userId, guestToken } = getIdentity(req);
  const itemId = Number(req.params.id);
  const { qty } = req.body;

  const cart = await cartService.updateItemQuantity(db, {
    userId,
    guestToken,
    itemId,
    qty: Number(qty),
  });

  reply.send({ data: { cart } });
}

export async function removeItem(req, reply) {
  const { db } = req.server;
  const { userId, guestToken } = getIdentity(req);
  const itemId = Number(req.params.id);

  const cart = await cartService.removeItemFromCart(db, {
    userId,
    guestToken,
    itemId,
  });

  reply.send({ data: { cart } });
}

export async function mergeCart(req, reply) {
  const { db } = req.server;
  const userId = req.user ? req.user.id : null;
  const guestToken = req.body?.guest_token || req.cookies?.[CART_COOKIE] || null;

  if (!userId) {
    reply.code(400).send({
      error: {
        code: 'AUTH_REQUIRED',
        message_en: 'User must be authenticated to merge cart.',
        message_bn: 'কার্ট মার্জ করতে ব্যবহারকারীকে লগইন করতে হবে।',
      },
    });
    return;
  }

  const cart = await cartService.mergeGuestCartOnLogin(db, { guestToken, userId });
  reply.clearCookie(CART_COOKIE, { path: '/' });
  reply.send({ data: { cart: cart || await cartService.getCart(db, { userId }) } });
}
