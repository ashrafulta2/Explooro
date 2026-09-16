/**
 * discoveryFeed.service.js — Ranking + signal recording for the /discover feed (interest-based,
 * one-product-at-a-time swipe feed).
 *
 * getFeed reuses the catalog listing (filters, joins, pricing enrichment) but asks for the
 * `recommended` sort, feeding it the actor's affinity profile so the ordering reflects what the
 * shopper actually engages with. recordEvents validates and persists the raw signals that profile
 * is built from.
 *
 * The customer feed and the saler sourcing feed share this code; `audience` keeps their histories
 * (and therefore their rankings) separate.
 */

import * as productService from './product.service.js';
import * as feedRepo from '../repositories/discoveryFeed.repository.js';
import { AppError } from '../plugins/errorHandler.js';

// How much each kind of interaction says about intent. A purchase is a far stronger signal than a
// glance, so they must not count equally. These are ranking coefficients, not business figures —
// they live here (one place) rather than in the DB; retuning them is a deliberate code change.
const EVENT_WEIGHTS = {
  VIEW: 1,
  DWELL: 1.5,
  CLICK: 2,
  ADD_CART: 4,
  WISHLIST: 3,
  PURCHASE: 6,
};
const VALID_EVENT_TYPES = Object.keys(EVENT_WEIGHTS);
const VALID_AUDIENCES = ['customer', 'saler'];

// Contribution of each matched dimension to a product's score in the `recommended` sort. Mirrored
// as the default in product.repository.js's listProducts.
const AFFINITY_WEIGHTS = { category: 3, brand: 2, supplier: 2 };

// Fallbacks used only when the discovery_feed module row carries no override. The module's
// sub_settings_schema documents both as admin-tunable (affinity_window_days, page_size), so the
// real values come from settings, per "business numbers live in settings, not in code".
const DEFAULT_AFFINITY_WINDOW_DAYS = 30;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 30;
const MAX_EVENTS_PER_CALL = 50;

/**
 * Reads the admin-tunable feed settings off the discovery_feed module row, falling back to the
 * defaults above if the row or a field is missing/unreadable (same read-with-fallback shape as
 * product.service.js's resolveLowStockThreshold).
 */
export async function resolveFeedSettings(db) {
  const settings = { affinityWindowDays: DEFAULT_AFFINITY_WINDOW_DAYS, pageSize: DEFAULT_PAGE_SIZE };
  try {
    const { rows } = await db.query(
      `SELECT settings_json FROM platform_modules WHERE key = 'discovery_feed'`
    );
    const raw = rows[0]?.settings_json;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      const w = Number(parsed.affinity_window_days);
      if (Number.isFinite(w) && w > 0) settings.affinityWindowDays = Math.floor(w);
      const p = Number(parsed.page_size);
      if (Number.isFinite(p) && p > 0) settings.pageSize = Math.min(Math.floor(p), MAX_PAGE_SIZE);
    }
  } catch {
    // Module row unreadable on a partial dev DB — the feed is still worth serving with defaults.
  }
  return settings;
}

/**
 * Returns a personalized, paginated page of the catalog for the discovery feed.
 *
 * @param {object} db
 * @param {object} opts
 * @param {object} opts.filters   catalog filters (categoryId, brand, minPrice, maxPrice, q, ...)
 * @param {number} [opts.userId]  signed-in actor
 * @param {string} [opts.sessionId] guest actor
 * @param {string} [opts.audience] 'customer' | 'saler'
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 */
export async function getFeed(db, { filters = {}, userId, sessionId, audience = 'customer', limit, offset = 0 } = {}) {
  const { affinityWindowDays, pageSize } = await resolveFeedSettings(db);
  const effectiveLimit = Math.min(Number(limit) || pageSize, MAX_PAGE_SIZE);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const affinity = await feedRepo.getAffinity(db, {
    userId,
    sessionId,
    audience,
    windowDays: affinityWindowDays,
  });

  // Over-fetch by one to know whether another page exists without a second COUNT query.
  const products = await productService.listCatalog(db, {
    ...filters,
    status: 'ACTIVE',
    sortBy: 'recommended',
    boostCategoryIds: affinity.categoryIds,
    boostBrands: affinity.brands,
    boostSupplierIds: affinity.supplierIds,
    affinityWeights: AFFINITY_WEIGHTS,
    // The feed slide renders an inline buy box with a Size selector, so it needs each row's variants
    // up front — otherwise they'd pop in after a per-slide detail fetch. Only the discovery feed
    // asks for this; the plain catalog grid leaves it off.
    withVariants: true,
    limit: effectiveLimit + 1,
    offset: safeOffset,
  });

  const hasMore = products.length > effectiveLimit;
  const page = hasMore ? products.slice(0, effectiveLimit) : products;

  return {
    products: page,
    meta: {
      count: page.length,
      has_more: hasMore,
      next_offset: hasMore ? safeOffset + effectiveLimit : null,
      personalized: affinity.categoryIds.length + affinity.brands.length + affinity.supplierIds.length > 0,
    },
  };
}

/**
 * Validates and persists a batch of interaction events. Unknown event types / audiences are
 * rejected rather than silently dropped so a client bug surfaces loudly. product_id is required;
 * everything else is optional context that improves ranking when present.
 */
export async function recordEvents(db, { events, userId, sessionId, audience = 'customer' }) {
  const list = Array.isArray(events) ? events : events ? [events] : [];
  if (list.length === 0) return { recorded: 0 };
  if (list.length > MAX_EVENTS_PER_CALL) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Too many events in one call (max ${MAX_EVENTS_PER_CALL}).`,
      `একবারে অনেক বেশি ইভেন্ট (সর্বোচ্চ ${MAX_EVENTS_PER_CALL})।`
    );
  }
  if (!userId && !sessionId) {
    throw new AppError(
      'VALIDATION_FAILED',
      'A session_id is required to record discovery events for a guest.',
      'গেস্টের জন্য ইভেন্ট রেকর্ড করতে session_id প্রয়োজন।'
    );
  }
  const feedAudience = VALID_AUDIENCES.includes(audience) ? audience : 'customer';

  const normalized = [];
  for (const e of list) {
    const eventType = String(e.event_type || e.eventType || '').toUpperCase();
    if (!VALID_EVENT_TYPES.includes(eventType)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Unknown discovery event type "${eventType}".`,
        `অজানা ইভেন্ট টাইপ "${eventType}"।`
      );
    }
    const productId = Number(e.product_id ?? e.productId);
    if (!Number.isFinite(productId)) {
      throw new AppError('VALIDATION_FAILED', 'Each event needs a numeric product_id.', 'প্রতিটি ইভেন্টে সংখ্যাসূচক product_id প্রয়োজন।');
    }
    const categoryId = Number(e.category_id ?? e.categoryId);
    const supplierId = Number(e.supplier_id ?? e.supplierId);
    const dwellMs = Math.max(0, Math.floor(Number(e.dwell_ms ?? e.dwellMs) || 0));

    normalized.push({
      userId: userId ?? null,
      sessionId: userId ? null : sessionId,
      productId,
      categoryId: Number.isFinite(categoryId) ? categoryId : null,
      supplierId: Number.isFinite(supplierId) ? supplierId : null,
      eventType,
      dwellMs,
      weight: EVENT_WEIGHTS[eventType],
      audience: feedAudience,
    });
  }

  const recorded = await feedRepo.recordEvents(db, normalized);
  return { recorded };
}
