/**
 * catalog.api.js — Typed wrapper around the product detail / review / Q&A endpoints (Prompt 4.6).
 *
 * Per docs/how-to-add-a-feature.md Step 8: never call `api.js`'s fetch wrapper directly from a
 * component — this is the one place that knows the request/response shape for each endpoint, so a
 * server contract change only has to be fixed here.
 */
import { api } from '../core/api.js';

// The server's trust_scores.tier vocabulary (STARTER/VERIFIED_TRADER/ELITE_PARTNER, docs/erd.md
// §1) doesn't match the client's existing tier vocabulary (standard/verified/elite — the same one
// FilterPanel.js's `filter.tier_*` i18n keys already use since Prompt 4.5) or the mock fixture's
// flat `supplier_tier` field — normalized to the client's existing vocabulary here so ProductCard,
// FilterPanel, and this page's supplier card all read one consistent set of values.
const SERVER_TIER_TO_CLIENT = { STARTER: 'standard', VERIFIED_TRADER: 'verified', ELITE_PARTNER: 'elite' };

function normalizeTier(tier) {
  if (!tier) return 'standard';
  return SERVER_TIER_TO_CLIENT[tier] || tier.toLowerCase();
}

/**
 * The server (raw SQL columns: attributes_json, image_url from a joined media_assets row) and the
 * mock fixtures (plain `attributes`, `image_index` for the placeholder palette since no real
 * photography exists yet) don't share a wire shape — normalize once here so every component below
 * this call only ever sees one shape, regardless of VITE_API_MODE.
 */
function normalizeProduct(product) {
  return {
    ...product,
    variants: (product.variants || []).map((v) => ({
      id: v.id,
      sku: v.sku,
      attributes: v.attributes || v.attributes_json || {},
      price_delta: Number(v.price_delta) || 0,
      stock_qty: v.stock_qty ?? 0,
      is_active: v.is_active !== false,
      image_url: v.image_url || null,
      image_index: v.image_index ?? null,
    })),
    images: (product.images || []).map((img) => ({
      id: img.id,
      url: img.url || null,
      is_primary: !!img.is_primary,
      image_index: img.image_index ?? 0,
      media_kind: img.media_kind || (img.mime_type?.startsWith('video') ? 'VIDEO' : 'IMAGE'),
    })),
    supplier: product.supplier ? { ...product.supplier, tier: normalizeTier(product.supplier.tier) } : null,
  };
}

export async function getProduct(idOrRef) {
  const { data } = await api.get(`/products/${idOrRef}`);
  return normalizeProduct(data.product);
}

/**
 * The server's list endpoint (GET /products) returns raw DB columns — stock_qty, rating_avg, and
 * retail price nested under pricing.retail_price — while the mock fixture uses the flatter
 * price/stock/rating shape ProductCard, ProductGrid, and FlashSaleWidget already read. `??`
 * backfills only when the flat field is missing, so mock-mode products (which already carry it)
 * pass through unchanged.
 */
function normalizeProductListItem(product) {
  return {
    ...product,
    price: product.price ?? product.pricing?.retail_price ?? product.default_retail_price,
    stock: product.stock ?? product.stock_qty,
    rating: product.rating ?? product.rating_avg,
    margin_pct: product.margin_pct ?? product.pricing?.saler_margin_pct,
  };
}

export async function listProducts(query = {}) {
  const { data, meta } = await api.get('/products', { query });
  const products = (data?.products ?? []).map(normalizeProductListItem);
  return { products, meta };
}

export async function listReviews(productId, { rating, hasPhotos, sort, page = 1, pageSize = 10 } = {}) {
  const query = { page, page_size: pageSize };
  if (rating) query.rating = rating;
  if (hasPhotos) query.has_photos = '1';
  if (sort) query.sort = sort;

  const { data, meta } = await api.get(`/products/${productId}/reviews`, { query });
  return { reviews: data.reviews, distribution: data.distribution, pagination: meta.pagination };
}

export async function getReviewEligibility(productId) {
  const { data } = await api.get(`/products/${productId}/reviews/eligibility`);
  return data;
}

export async function submitReview(productId, { rating, title, body }) {
  const { data } = await api.post(`/products/${productId}/reviews`, { rating, title, body });
  return data.review;
}

export async function markReviewHelpful(reviewId) {
  const { data } = await api.post(`/reviews/${reviewId}/helpful`, {});
  return data;
}

export async function listQuestions(productId, { page = 1, pageSize = 10 } = {}) {
  const { data, meta } = await api.get(`/products/${productId}/questions`, { query: { page, page_size: pageSize } });
  return { questions: data.questions, pagination: meta.pagination };
}

export async function askQuestion(productId, body) {
  const { data } = await api.post(`/products/${productId}/questions`, { body });
  return data.question;
}

export async function answerQuestion(questionId, body) {
  const { data } = await api.post(`/questions/${questionId}/answers`, { body });
  return data.answer;
}

export async function upvoteQuestion(questionId) {
  const { data } = await api.post(`/questions/${questionId}/upvote`, {});
  return data;
}

/**
 * Calls POST /api/v1/pricing/preview.
 * Pure server-calculated breakdown — client never performs split math directly.
 */
export async function previewPricing({ baseCost, wholesaleMargin = 0, retailPrice, categoryId, productId }) {
  const payload = {
    base_cost: baseCost,
    wholesale_margin: wholesaleMargin,
    retail_price: retailPrice,
    category_id: categoryId,
    product_id: productId,
  };
  const { data } = await api.post('/pricing/preview', payload);
  return data.preview || data;
}

/**
 * Lists supplier products suitable for saler sourcing with margin info.
 */
export async function listSourcingCatalog(filters = {}) {
  const query = {};
  if (filters.minMarginPct) query.min_margin_pct = filters.minMarginPct;
  if (filters.categoryId) query.category_id = filters.categoryId;
  if (filters.category && filters.category !== 'all') query.category = filters.category;
  if (filters.brand) query.brand = filters.brand;
  if (filters.shippingSpeed && filters.shippingSpeed !== 'all') query.shipping_speed = filters.shippingSpeed;
  if (filters.verificationTier && filters.verificationTier !== 'all') query.verification_tier = filters.verificationTier;
  if (filters.inStock) query.in_stock = 'true';
  if (filters.sortBy) query.sort_by = filters.sortBy;
  if (filters.limit) query.limit = filters.limit;
  if (filters.offset) query.offset = filters.offset;

  const { data, meta } = await api.get('/sourcing/catalog', { query });
  const catalog = data?.catalog || data || [];
  return {
    catalog,
    total: meta?.total ?? catalog.length,
  };
}

/**
 * Saler adds a product to their virtual storefront with optional custom retail price.
 */
export async function addToSalerStore({ productId, customRetailPrice, collectionName }) {
  const payload = {
    product_id: productId,
    custom_retail_price: customRetailPrice !== undefined && customRetailPrice !== '' ? Number(customRetailPrice) : undefined,
    collection_name: collectionName || 'General',
  };
  const { data } = await api.post('/sourcing/add-to-store', payload);
  return data?.item || data;
}

/**
 * Gets all curated items in the saler's store.
 */
export async function getSalerStoreItems() {
  const { data } = await api.get('/sourcing/my-store');
  return data?.store_items || [];
}
