/**
 * socialKit.controller.ts — Route handlers for Social Shop Partner Kit & Short Links (Prompt 9.7).
 */

import * as shortlinkService from '../services/shortlink.service.ts';
import * as flyerService from '../services/flyer.service.ts';
import { landingPathFor } from '../services/attribution.service.ts';

export async function redirectShortLink(req, reply) {
  const db = req.db || req.server?.db;
  const { code } = req.params;

  const result = await shortlinkService.resolveShortLink(db, code, {
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
    referrer: req.headers['referer'],
  });

  // WHY `?ref=<code>`: the landing page records it as the shopper's touch, which is what credits
  // the shop partner at add-to-cart (attribution.service.ts).
  return reply.redirect(landingPathFor(result.target_url, String(code).toLowerCase()), 302);
}

/**
 * The SPA's /s/:code page: records the click exactly as the redirect does and returns where to go.
 * The dev server proxies only /api, so a link opened on the client origin comes through here.
 */
export async function openShortLink(req, reply) {
  const db = req.db || req.server?.db;
  const code = String(req.params.code).toLowerCase();

  const result = await shortlinkService.resolveShortLink(db, code, {
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
    referrer: req.body?.referrer || req.headers['referer'],
  });

  return reply.send({ path: landingPathFor(result.target_url, code), code });
}

export async function createLink(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;
  const { product_id, store_id, source_channel, target_url } = req.body || {};

  const result = await shortlinkService.createShortLink(db, {
    salerId: user.id,
    productId: product_id ? parseInt(product_id, 10) : null,
    storeId: store_id ? parseInt(store_id, 10) : null,
    sourceChannel: source_channel || 'GENERAL',
    targetUrl: target_url || null,
  });

  return reply.status(201).send(result);
}

export async function listTemplates(req, reply) {
  return reply.send({
    templates: Object.entries(flyerService.FLYER_FORMATS).map(([id, f]) => ({ id, ...f })),
    themes: [...flyerService.FLYER_THEMES],
  });
}

export async function renderFlyer(req, reply) {
  const db = req.db || req.server?.db;
  const { product_id, format, theme } = req.query || {};

  let product = null;
  if (product_id) {
    const { rows } = await db.query(
      `SELECT * FROM products WHERE id = $1`,
      [parseInt(product_id, 10)]
    );
    product = rows[0];
  }

  const flyerSvg = flyerService.generateFlyerSvg({
    product: product || {
      name_en: 'Premium Tangail Silk Saree',
      name_bn: 'প্রিমিয়াম টাঙ্গাইল সিল্ক শাড়ি',
      base_price: 2450.00,
    },
    store: {
      shop_name: 'Bengal Loom & Craft',
    },
    shortUrl: `https://explooro.com/s/${product_id || 'demo'}`,
    format: format || 'SQUARE',
    theme: theme || 'DARK',
  });

  return reply
    .header('Content-Type', 'image/svg+xml')
    .header('Cache-Control', 'public, max-age=3600')
    .send(flyerSvg);
}

export async function getAnalytics(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;

  const links = await shortlinkService.getSalerShortLinks(db, user.id);
  return reply.send({
    short_links: links,
  });
}
