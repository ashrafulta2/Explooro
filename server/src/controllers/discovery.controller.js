/**
 * discovery.controller.js — Handlers for the interest-based discovery feed (/discover).
 *
 * GET  /discovery/feed   — personalized, paginated catalog page (optional auth: guests ranked by
 *                          their session's history, signed-in users by their account's).
 * POST /discovery/events — record interaction signals that feed the ranking.
 */

import * as discoveryService from '../services/discoveryFeed.service.js';

// A guest actor id: an opaque token the browser persists and sends back. Never trusted for auth —
// it only scopes anonymous ranking history to one browser.
function resolveSessionId(req, fromBody) {
  return (
    fromBody ||
    req.headers['x-session-id'] ||
    req.query?.session_id ||
    null
  );
}

function resolveAudience(raw) {
  return raw === 'saler' ? 'saler' : 'customer';
}

export async function getFeed(req, reply) {
  const db = req.db || req.server?.db;
  const {
    category,
    category_id,
    brand,
    min_price,
    max_price,
    supplier_tier,
    district,
    in_stock,
    q,
    audience,
    limit,
    offset,
  } = req.query || {};

  const filters = {
    brand,
    minPrice: min_price ? parseFloat(min_price) : undefined,
    maxPrice: max_price ? parseFloat(max_price) : undefined,
    supplierTier: supplier_tier,
    district,
    q,
  };
  // `category` (from the feed's pills) may be a numeric id or a slug; `category_id` is explicit.
  if (category_id) filters.categoryId = parseInt(category_id, 10);
  else if (category && /^\d+$/.test(String(category))) filters.categoryId = parseInt(category, 10);
  else if (category && category !== 'all') filters.categorySlug = category;
  if (in_stock === '1' || in_stock === 'true') filters.inStock = true;

  const result = await discoveryService.getFeed(db, {
    filters,
    userId: req.user?.id,
    sessionId: resolveSessionId(req),
    audience: resolveAudience(audience),
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({ data: { products: result.products }, meta: result.meta });
}

export async function recordEvents(req, reply) {
  const db = req.db || req.server?.db;
  const body = req.body || {};

  const result = await discoveryService.recordEvents(db, {
    events: body.events ?? body.event,
    userId: req.user?.id,
    sessionId: resolveSessionId(req, body.session_id),
    audience: resolveAudience(body.audience),
  });

  return reply.status(202).send({ data: result });
}
