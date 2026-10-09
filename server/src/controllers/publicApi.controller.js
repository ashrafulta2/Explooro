/**
 * publicApi.controller.js — Controller for Public REST API, Partner Integration & Developer Portal (Prompt 10.7).
 */

import * as apiKeyService from '../services/apiKey.service.js';
import * as webhookService from '../services/webhookDelivery.service.js';
import * as orderService from '../services/order.service.js';
import { AppError } from '../plugins/errorHandler.js';
import { primaryImageKeySql, toPublicImageUrl } from '../lib/productImage.js';

// -----------------------------------------------------------------------------
// PUBLIC READ-ONLY CATALOG ENDPOINTS
// -----------------------------------------------------------------------------

// WHY: products has no media column — images live in product_images → media_assets. This returns
// the storage keys in display order; the response maps them to public URLs.
const IMAGE_KEYS_SQL = `COALESCE((
    SELECT json_agg(m.storage_key ORDER BY pi.is_primary DESC, pi.display_order ASC)
    FROM product_images pi
    JOIN media_assets m ON m.id = pi.media_id
    WHERE pi.product_id = p.id
  ), '[]'::json)`;

// WHY: an explicit column list, never p.* — products carries base_cost and wholesale_margin, which
// are supplier cost data and must not leave through an unauthenticated endpoint.
const PUBLIC_PRODUCT_COLUMNS = `
    p.id, p.ref, p.slug, p.title_en, p.title_bn, p.description_en, p.description_bn, p.brand,
    p.default_retail_price AS retail_price, p.stock_qty AS stock_quantity, p.category_id, p.supplier_id,
    p.has_variants, p.warranty_months, p.rating_avg, p.rating_count, p.sold_count, p.created_at,
    ${IMAGE_KEYS_SQL} AS image_keys`;

function toPublicProduct(p) {
  const { image_keys: imageKeys, ...rest } = p;
  return {
    ...rest,
    retail_price: parseFloat(p.retail_price),
    is_in_stock: (p.stock_quantity || 0) > 0,
    // Shape matches what client/public/widget.js reads (media[0].url).
    media: (Array.isArray(imageKeys) ? imageKeys : []).map((key) => ({ url: toPublicImageUrl(key) })),
  };
}

export async function getPublicProducts(req, reply) {
  const {
    category_id,
    search,
    min_price,
    max_price,
    in_stock,
    store_id,
    limit = 20,
    offset = 0,
  } = req.query;

  let sql = `
    SELECT ${PUBLIC_PRODUCT_COLUMNS},
           c.name_en as category_name_en, c.name_bn as category_name_bn
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.status = 'ACTIVE' AND p.deleted_at IS NULL
  `;
  const params = [];

  if (category_id) {
    params.push(category_id);
    sql += ` AND p.category_id = $${params.length}`;
  }
  if (store_id) {
    params.push(store_id);
    sql += ` AND p.id IN (SELECT product_id FROM saler_store_items WHERE store_id = $${params.length} AND is_active = true)`;
  }
  if (min_price) {
    params.push(parseFloat(min_price));
    sql += ` AND p.default_retail_price >= $${params.length}`;
  }
  if (max_price) {
    params.push(parseFloat(max_price));
    sql += ` AND p.default_retail_price <= $${params.length}`;
  }
  if (in_stock === 'true' || in_stock === true) {
    sql += ` AND p.stock_qty > 0`;
  }
  if (search) {
    params.push(`%${search.trim()}%`);
    sql += ` AND (p.title_en ILIKE $${params.length} OR p.title_bn ILIKE $${params.length})`;
  }

  params.push(parseInt(limit, 10) || 20);
  const limitIdx = params.length;
  params.push(parseInt(offset, 10) || 0);
  const offsetIdx = params.length;

  sql += ` ORDER BY p.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx};`;

  const { rows } = await req.server.db.query(sql, params);

  return reply.send({
    success: true,
    data: rows.map(toPublicProduct),
    count: rows.length,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });
}

export async function getPublicProductById(req, reply) {
  const { idOrSlug } = req.params;
  const isNumeric = /^\d+$/.test(idOrSlug);
  const whereClause = isNumeric ? 'p.id = $1' : 'p.slug = $1';

  const sql = `
    SELECT ${PUBLIC_PRODUCT_COLUMNS},
           c.name_en as category_name_en, c.name_bn as category_name_bn,
           COALESCE(up.display_name, up.full_name) as supplier_name,
           (SELECT json_agg(json_build_object(
              'id', v.id, 'sku', v.sku, 'attributes_json', v.attributes_json,
              'price', p.default_retail_price + v.price_delta, 'stock_qty', v.stock_qty))
            FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true) as variants
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN users u ON p.supplier_id = u.id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE ${whereClause} AND p.status = 'ACTIVE' AND p.deleted_at IS NULL;
  `;

  const { rows } = await req.server.db.query(sql, [idOrSlug]);
  if (!rows.length) {
    throw new AppError('NOT_FOUND', `Product "${idOrSlug}" not found.`, 404);
  }

  const p = rows[0];
  return reply.send({
    success: true,
    data: {
      ...toPublicProduct(p),
      variants: p.variants || [],
    },
  });
}

// WHY: Saler storefronts are virtual_stores; the public field names (store_name, tagline, logo_url,
// banner_url) are kept so existing API consumers do not break.
const PUBLIC_STORE_COLUMNS = `
    s.id, s.ref, s.slug, s.shop_name AS store_name, s.bio AS tagline,
    (SELECT m.storage_key FROM media_assets m WHERE m.id = s.logo_media_id) AS logo_key,
    (SELECT m.storage_key FROM media_assets m WHERE m.id = s.banner_media_id) AS banner_key,
    s.created_at`;

function toPublicStore(s) {
  const { logo_key: logoKey, banner_key: bannerKey, ...rest } = s;
  return { ...rest, logo_url: toPublicImageUrl(logoKey), banner_url: toPublicImageUrl(bannerKey) };
}

export async function getPublicStores(req, reply) {
  const { limit = 20, offset = 0 } = req.query;
  const sql = `
    SELECT ${PUBLIC_STORE_COLUMNS}
    FROM virtual_stores s
    WHERE s.is_active = true AND s.deleted_at IS NULL
    ORDER BY s.created_at DESC
    LIMIT $1 OFFSET $2;
  `;
  const { rows } = await req.server.db.query(sql, [parseInt(limit, 10) || 20, parseInt(offset, 10) || 0]);

  return reply.send({
    success: true,
    data: rows.map(toPublicStore),
  });
}

export async function getPublicStoreById(req, reply) {
  const { idOrSlug } = req.params;
  const isNumeric = /^\d+$/.test(idOrSlug);
  const whereClause = isNumeric ? 's.id = $1' : 's.slug = $1';

  const sql = `
    SELECT ${PUBLIC_STORE_COLUMNS},
           (SELECT json_agg(json_build_object(
              'product_id', p.id,
              'product_ref', p.ref,
              'title_en', p.title_en,
              'title_bn', p.title_bn,
              'retail_price', p.default_retail_price,
              'custom_price', i.custom_retail_price,
              'image_key', ${primaryImageKeySql('p')},
              'stock_quantity', p.stock_qty
            ) ORDER BY i.display_order)
            FROM saler_store_items i
            JOIN products p ON i.product_id = p.id
            WHERE i.store_id = s.id AND i.is_active = true AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
           ) as items
    FROM virtual_stores s
    WHERE ${whereClause} AND s.is_active = true AND s.deleted_at IS NULL;
  `;

  const { rows } = await req.server.db.query(sql, [idOrSlug]);
  if (!rows.length) {
    throw new AppError('NOT_FOUND', `Store "${idOrSlug}" not found.`, 404);
  }

  const store = toPublicStore(rows[0]);
  store.items = (rows[0].items || []).map(({ image_key: imageKey, ...item }) => ({
    ...item,
    image_url: toPublicImageUrl(imageKey),
  }));

  return reply.send({
    success: true,
    data: store,
  });
}

export async function getPublicCategories(req, reply) {
  const sql = `
    SELECT id, parent_id, slug, name_en, name_bn, icon_key, display_order
    FROM categories
    WHERE is_active = true
    ORDER BY display_order ASC, name_en ASC;
  `;
  const { rows } = await req.server.db.query(sql);

  return reply.send({
    success: true,
    data: rows,
  });
}

// -----------------------------------------------------------------------------
// PARTNER ORDER CREATION (WRITE)
// -----------------------------------------------------------------------------

export async function createPartnerOrder(req, reply) {
  const apiKey = req.apiKey;
  if (!apiKey || !apiKeyService.hasScope(apiKey, 'orders.create')) {
    throw new AppError('FORBIDDEN', 'API key does not have the required "orders.create" permission scope.', 403);
  }

  const {
    customer,
    items,
    shipping_address,
    payment_method = 'COD',
    notes = '',
    idempotency_key = null,
  } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'At least 1 item is required to place an order.', 400);
  }
  if (!customer || !customer.phone || !customer.name) {
    throw new AppError('VALIDATION_FAILED', 'Customer name and phone number are required.', 400);
  }

  // Create order via core orderService
  const orderResult = await orderService.createOrder(req.server.db, {
    customerId: apiKey.userId, // partner's user account acts as agent/buyer
    customerPhone: customer.phone,
    customerName: customer.name,
    items,
    shippingAddress: shipping_address,
    paymentMethod: payment_method,
    notes: `Partner API Order (Key: ${apiKey.ref}) — ${notes}`,
    idempotencyKey: idempotency_key,
  });

  // Trigger outbound webhook event asynchronously
  webhookService.dispatchWebhookEvent(req.server.db, {
    eventName: 'order.created',
    payload: {
      order_ref: orderResult.order?.ref,
      total_amount: orderResult.order?.total_amount,
      customer_name: customer.name,
      partner_key: apiKey.ref,
      created_at: new Date().toISOString(),
    },
  }).catch(() => {});

  return reply.status(201).send({
    success: true,
    data: orderResult,
  });
}

// -----------------------------------------------------------------------------
// DEVELOPER PORTAL: API KEYS
// -----------------------------------------------------------------------------

export async function createApiKey(req, reply) {
  const userId = req.user.id;
  const { name, scopes, rate_limit_rpm, ip_allowlist, expires_in_days } = req.body;

  const result = await apiKeyService.generateApiKey(req.server.db, {
    userId,
    name,
    scopes,
    rateLimitRpm: rate_limit_rpm,
    ipAllowlist: ip_allowlist,
    expiresInDays: expires_in_days,
  });

  return reply.status(201).send({
    success: true,
    data: result,
  });
}

export async function listApiKeys(req, reply) {
  const keys = await apiKeyService.listApiKeys(req.server.db, {
    userId: req.user.id,
    role: req.user.role,
  });

  return reply.send({
    success: true,
    data: keys,
  });
}

export async function rotateApiKey(req, reply) {
  const { id } = req.params;
  const result = await apiKeyService.rotateApiKey(req.server.db, {
    keyId: id,
    userId: req.user.id,
    role: req.user.role,
  });

  return reply.send({
    success: true,
    data: result,
  });
}

export async function revokeApiKey(req, reply) {
  const { id } = req.params;
  const result = await apiKeyService.revokeApiKey(req.server.db, {
    keyId: id,
    userId: req.user.id,
    role: req.user.role,
  });

  return reply.send({
    success: true,
    data: result,
  });
}

// -----------------------------------------------------------------------------
// DEVELOPER PORTAL: WEBHOOKS & DLQ
// -----------------------------------------------------------------------------

export async function createWebhookSubscription(req, reply) {
  const userId = req.user.id;
  const { target_url, events, secret } = req.body;

  const sub = await webhookService.createSubscription(req.server.db, {
    userId,
    targetUrl: target_url,
    events,
    secret,
  });

  return reply.status(201).send({
    success: true,
    data: sub,
  });
}

export async function listWebhookSubscriptions(req, reply) {
  const subs = await webhookService.listSubscriptions(req.server.db, {
    userId: req.user.id,
    role: req.user.role,
  });

  return reply.send({
    success: true,
    data: subs,
  });
}

export async function deleteWebhookSubscription(req, reply) {
  const { id } = req.params;
  const result = await webhookService.deleteSubscription(req.server.db, {
    subscriptionId: id,
    userId: req.user.id,
    role: req.user.role,
  });

  return reply.send({
    success: true,
    data: result,
  });
}

export async function listWebhookDeliveries(req, reply) {
  const { subscription_id, status, limit = 50, offset = 0 } = req.query;
  const deliveries = await webhookService.listDeliveries(req.server.db, {
    subscriptionId: subscription_id,
    status,
    limit: parseInt(limit, 10) || 50,
    offset: parseInt(offset, 10) || 0,
  });

  return reply.send({
    success: true,
    data: deliveries,
  });
}

export async function replayWebhookDelivery(req, reply) {
  const { id } = req.params;
  const result = await webhookService.replayWebhookDelivery(req.server.db, {
    deliveryId: id,
  });

  return reply.send({
    success: true,
    data: result,
  });
}
