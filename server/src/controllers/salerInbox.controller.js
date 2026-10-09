/**
 * salerInbox.controller.js — Saler Unified Inbox Controller (Prompt 8.3 / DFD Subsystem 20.0).
 */

import * as service from '../services/whatsappCommerce.service.js';
import { primaryImageKeySql, toPublicImageUrl } from '../lib/productImage.js';

export async function getUnifiedThreads(req, reply) {
  const { limit = 30, offset = 0 } = req.query || {};

  const result = await service.getUnifiedSalerThreads(req.server.db, req.user.id, {
    limit: parseInt(limit, 10) || 30,
    offset: parseInt(offset, 10) || 0,
  });

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function sendOutboundReply(req, reply) {
  const threadId = parseInt(req.params.id, 10);
  const { content } = req.body || {};

  const result = await service.sendOutboundReply(req.server.db, {
    threadId,
    salerId: req.user.id,
    content,
  });

  return reply.status(201).send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function sendProductCard(req, reply) {
  const threadId = parseInt(req.params.id, 10);
  const { product_id, variant_id, note } = req.body || {};

  const result = await service.sendProductCard(req.server.db, {
    threadId,
    salerId: req.user.id,
    productId: product_id,
    variantId: variant_id || null,
    note,
  });

  return reply.status(201).send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function resolveCheckoutToken(req, reply) {
  const { token } = req.params;
  const result = service.consumeCheckoutToken(token);

  if (!result.valid) {
    return reply.status(400).send({
      error: { code: result.error, message_en: result.message },
    });
  }

  // Fetch product details for prefilling checkout
  const { rows: prodRows } = await req.server.db.query(
    // WHY: this prefills a customer checkout, so it carries the retail price, not base_price
    // (supplier cost). Images live in product_images, not on products.
    `SELECT p.id, p.title_en, p.title_bn, p.default_retail_price AS retail_price, p.supplier_id,
            ${primaryImageKeySql('p')} AS image_key
     FROM products p WHERE p.id = $1`,
    [result.data.productId]
  );

  const product = prodRows[0]
    ? (({ image_key: imageKey, ...rest }) => ({ ...rest, image_url: toPublicImageUrl(imageKey) }))(prodRows[0])
    : null;

  return reply.send({
    data: {
      checkoutData: result.data,
      product,
    },
    meta: { trace_id: req.traceId },
  });
}
