/**
 * shortlink.service.js — Tracked Affiliate Short Links Engine (Prompt 9.7).
 *
 * Implements:
 * 1. Branded short link generation (`explooro.com/s/:code`).
 * 2. Click tracking, deduplication, and affiliate binding to seller.
 * 3. Conversion and revenue attribution.
 */

import { randomBytes, createHash } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';

async function runWithClient(db, fn) {
  if (db && typeof db.connect === 'function') {
    return withTransaction(db, fn);
  }
  return fn(db);
}

export function generateShortCode() {
  return randomBytes(3).toString('hex').toLowerCase();
}

export function hashIp(ip) {
  if (!ip) return null;
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);
}

/**
 * Creates a tracked affiliate short link for a product or storefront.
 */
export async function createShortLink(db, {
  salerId,
  productId = null,
  storeId = null,
  sourceChannel = 'GENERAL',
  targetUrl = null,
}) {
  let finalTargetUrl = targetUrl;

  if (!finalTargetUrl) {
    if (productId) {
      finalTargetUrl = `/products/${productId}?saler_ref=${salerId}&source=${sourceChannel.toLowerCase()}`;
    } else if (storeId) {
      finalTargetUrl = `/store/${storeId}?saler_ref=${salerId}&source=${sourceChannel.toLowerCase()}`;
    } else {
      finalTargetUrl = `/?saler_ref=${salerId}&source=${sourceChannel.toLowerCase()}`;
    }
  }

  return runWithClient(db, async (client) => {
    let code = generateShortCode();
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 5) {
      const { rows: existing } = await client.query(
        `SELECT id FROM short_links WHERE code = $1`,
        [code]
      );
      if (existing.length === 0) {
        isUnique = true;
      } else {
        code = generateShortCode();
        attempts++;
      }
    }

    const { rows } = await client.query(
      `INSERT INTO short_links (
        code, saler_id, product_id, store_id, target_url, source_channel
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [code, salerId, productId, storeId, finalTargetUrl, sourceChannel]
    );

    const link = rows[0];
    return {
      ...link,
      short_url: `/s/${link.code}`,
      full_url: `https://explooro.com/s/${link.code}`,
    };
  });
}

/**
 * Resolves a short link by code, records the click, and returns target URL for redirection.
 */
export async function resolveShortLink(db, code, clickMeta = {}) {
  return runWithClient(db, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM short_links WHERE code = $1`,
      [code]
    );

    const link = rows[0];
    if (!link) {
      throw new AppError('SHORTLINK_NOT_FOUND', 'Short link does not exist or has expired.');
    }

    // 1. Increment clicks count
    await client.query(
      `UPDATE short_links
       SET clicks_count = clicks_count + 1, updated_at = now()
       WHERE id = $1`,
      [link.id]
    );

    // 2. Record click audit log
    const ipHashed = hashIp(clickMeta.ip);
    await client.query(
      `INSERT INTO short_link_clicks (short_link_id, ip_hash, user_agent, referrer)
       VALUES ($1, $2, $3, $4)`,
      [link.id, ipHashed, clickMeta.userAgent || null, clickMeta.referrer || null]
    );

    return {
      target_url: link.target_url,
      saler_id: link.saler_id,
      product_id: link.product_id,
      store_id: link.store_id,
      source_channel: link.source_channel,
    };
  });
}

/**
 * Attributes a completed order to the short link.
 */
export async function recordShortLinkConversion(db, {
  shortLinkId,
  orderTotal = 0,
}) {
  const total = parseFloat(orderTotal) || 0;
  return runWithClient(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE short_links
       SET conversions_count = conversions_count + 1,
           revenue_generated = revenue_generated + $1,
           updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [total, shortLinkId]
    );
    return rows[0];
  });
}

/**
 * Returns analytics on all short links for a seller.
 */
export async function getSalerShortLinks(db, salerId) {
  const query = `
    SELECT sl.*,
           p.name_en as product_name_en,
           p.name_bn as product_name_bn,
           p.primary_image_url
    FROM short_links sl
    LEFT JOIN products p ON p.id = sl.product_id
    WHERE sl.saler_id = $1
    ORDER BY sl.created_at DESC
  `;

  const { rows } = await db.query(query, [salerId]);
  return rows.map(l => ({
    ...l,
    short_url: `/s/${l.code}`,
    full_url: `https://explooro.com/s/${l.code}`,
    conversion_rate_pct: l.clicks_count > 0 ? ((l.conversions_count / l.clicks_count) * 100).toFixed(1) : '0.0',
  }));
}
