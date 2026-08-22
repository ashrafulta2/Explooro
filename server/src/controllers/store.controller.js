/**
 * store.controller.js — Request handlers for storefronts, builder, status & OG images (Prompt 4.8).
 */

import * as storeService from '../services/store.service.js';
import * as ogService from '../services/og-image.service.js';
import * as productRepo from '../repositories/product.repository.js';
import { AppError } from '../plugins/errorHandler.js';

export async function getStore(req, reply) {
  const db = req.db || req.server?.db;
  const { slug } = req.params;

  const data = await storeService.getPublicStore(db, slug);
  return reply.send({ data });
}

export async function checkSlug(req, reply) {
  const db = req.db || req.server?.db;
  const { slug, exclude_id } = req.query;

  const result = await storeService.validateSlugAvailability(db, slug, exclude_id ? parseInt(exclude_id, 10) : null);
  return reply.send({ data: result });
}

export async function getMyStore(req, reply) {
  const db = req.db || req.server?.db;
  const salerId = req.user?.id;

  const data = await storeService.getSalerStore(db, salerId);
  return reply.send({ data });
}

export async function updateMyStore(req, reply) {
  const db = req.db || req.server?.db;
  const salerId = req.user?.id;

  const store = await storeService.saveSalerStore(db, salerId, req.body || {});
  const data = await storeService.getSalerStore(db, salerId);

  return reply.send({ data });
}

export async function updateStoreStatus(req, reply) {
  const db = req.db || req.server?.db;
  const salerId = req.user?.id;
  const { physical_open_status, business_hours } = req.body || {};

  const result = await storeService.updateStoreStatus(db, salerId, {
    physicalOpenStatus: physical_open_status,
    businessHours: business_hours,
  });

  return reply.send({ data: result });
}

export async function updateShelves(req, reply) {
  const db = req.db || req.server?.db;
  const salerId = req.user?.id;
  const { items } = req.body || {};

  await storeService.updateShelves(db, salerId, items);
  return reply.send({ data: { success: true } });
}

export async function getStoreOgImage(req, reply) {
  const db = req.db || req.server?.db;
  const { slug } = req.params;
  const cleanSlug = slug ? slug.replace(/\.png$/i, '').replace(/\.svg$/i, '') : '';

  let store;
  try {
    const publicStore = await storeService.getPublicStore(db, cleanSlug);
    store = publicStore.store;
  } catch {
    store = {
      shop_name: 'Explooro Store',
      slug: cleanSlug,
      bio: 'Verified Bangladeshi Social Commerce Storefront',
      rating: 4.9,
      products_count: 50,
      is_open: true,
    };
  }

  const { buffer, contentType } = await ogService.getStoreOgImageBuffer(store);

  return reply
    .header('Content-Type', contentType)
    .header('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400')
    .send(buffer);
}

export async function getProductOgImage(req, reply) {
  const db = req.db || req.server?.db;
  const { slug } = req.params;
  const cleanSlug = slug ? slug.replace(/\.png$/i, '').replace(/\.svg$/i, '') : '';

  let product = await productRepo.getProductBySlug(db, cleanSlug);
  if (!product && !isNaN(cleanSlug)) {
    product = await productRepo.getProductById(db, parseInt(cleanSlug, 10));
  }

  if (!product) {
    product = {
      title_en: 'Explooro Marketplace Product',
      default_retail_price: 1200,
      brand: 'Explooro',
      rating_avg: 4.8,
    };
  }

  const { buffer, contentType } = await ogService.getProductOgImageBuffer(product);

  return reply
    .header('Content-Type', contentType)
    .header('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400')
    .send(buffer);
}
