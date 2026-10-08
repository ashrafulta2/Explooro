/**
 * discovery.controller.js — Handlers for the interest-based discovery feed (/discover).
 *
 * GET  /discovery/feed   — personalized, paginated catalog page (optional auth: guests ranked by
 *                          their session's history, signed-in users by their account's).
 * GET  /discovery/rails  — the home page's themed rails (for you / trending / best sellers / ...).
 * POST /discovery/events — record interaction signals that feed the ranking.
 * POST /discovery/search-events — record one deliberate search (query, result count).
 */

import * as discoveryService from '../services/discoveryFeed.service.js';
import * as homeRailsService from '../services/homeRails.service.js';

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
    personalize,
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
    // `personalize=0` is the shopper opting out of profiling (client signals.js); anything else keeps it on.
    personalize: !(personalize === '0' || personalize === 'false'),
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({ data: { products: result.products }, meta: result.meta });
}

export async function getRails(req, reply) {
  const db = req.db || req.server?.db;
  const { audience, personalize } = req.query || {};

  const result = await homeRailsService.getRails(db, {
    userId: req.user?.id,
    sessionId: resolveSessionId(req),
    audience: resolveAudience(audience),
    // Same opt-out switch as the feed (client signals.js sends personalize=0).
    personalize: !(personalize === '0' || personalize === 'false'),
  });

  return reply.send({ data: { rails: result.rails }, meta: result.meta });
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

export async function recordSearch(req, reply) {
  const db = req.db || req.server?.db;
  const body = req.body || {};

  const result = await discoveryService.recordSearch(db, {
    query: body.query ?? body.q,
    resultCount: body.result_count,
    categoryId: body.category_id,
    userId: req.user?.id,
    sessionId: resolveSessionId(req, body.session_id),
    audience: resolveAudience(body.audience),
  });

  return reply.status(202).send({ data: result });
}
