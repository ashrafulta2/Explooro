/**
 * sourcing.controller.js — Handlers for Saler sourcing & virtual storefront curation (Prompt 4.3).
 */

import * as productService from '../services/product.service.js';

export async function addToStore(req, reply) {
  const db = req.db || req.server?.db;
  const salerId = req.user?.id;
  const { product_id, custom_retail_price, collection_name } = req.body || {};

  const result = await productService.addProductToSalerStore(db, {
    salerId,
    productId: parseInt(product_id, 10),
    customRetailPrice: custom_retail_price !== undefined ? parseFloat(custom_retail_price) : undefined,
    collectionName: collection_name,
  });

  return reply.status(201).send({ item: result });
}

export async function getSourcingCatalog(req, reply) {
  const db = req.db || req.server?.db;
  const { min_margin_pct, category_id, brand, limit, offset } = req.query || {};

  const items = await productService.listSourcingCatalog(db, {
    minMarginPct: min_margin_pct ? parseFloat(min_margin_pct) : undefined,
    categoryId: category_id ? parseInt(category_id, 10) : undefined,
    brand,
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({ catalog: items });
}

export async function getMyStore(req, reply) {
  const db = req.db || req.server?.db;
  const salerId = req.user?.id;

  const items = await productService.getSalerStoreItems(db, salerId);
  return reply.send({ store_items: items });
}
