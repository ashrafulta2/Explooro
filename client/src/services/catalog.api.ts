/**
 * catalog.api.ts — Typed wrapper around the product detail / review / Q&A endpoints (Prompt 4.6).
 *
 * Per docs/how-to-add-a-feature.md Step 8: never call `api.js`'s fetch wrapper directly from a
 * component — this is the one place that knows the request/response shape for each endpoint, so a
 * server contract change only has to be fixed here.
 */
import { api } from '../core/api.ts';
import { resolveProductImage } from '../components/product/ProductCard.ts';

// The server's trust_scores.tier vocabulary (STARTER/VERIFIED_TRADER/ELITE_PARTNER, docs/erd.md
// §1) doesn't match the client's existing tier vocabulary (standard/verified/elite — the same one
// FilterPanel.js's `filter.tier_*` i18n keys already use since Prompt 4.5) or the mock fixture's
// flat `supplier_tier` field — normalized to the client's existing vocabulary here so ProductCard,
// FilterPanel, and this page's supplier card all read one consistent set of values.
const SERVER_TIER_TO_CLIENT: Record<string, string> = { STARTER: 'standard', VERIFIED_TRADER: 'verified', ELITE_PARTNER: 'elite' };

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, unknown>;

/** A variant as the server (attributes_json) or the mock (attributes) sends it. */
export interface RawVariant {
  id: number | string;
  sku?: string;
  attributes?: Record<string, string>;
  attributes_json?: Record<string, string>;
  price_delta?: number | string | null;
  available_qty?: number;
  stock_qty?: number;
  is_active?: boolean;
  image_url?: string | null;
  image_index?: number | null;
}

/** The one variant shape every component reads, whatever the driver. */
export interface CatalogVariant {
  id: number | string;
  sku?: string;
  attributes: Record<string, string>;
  price_delta: number;
  stock_qty: number;
  is_active: boolean;
  image_url: string | null;
  image_index: number | null;
}

export interface RawImage {
  id?: number | string;
  url?: string | null;
  is_primary?: boolean;
  image_index?: number;
  media_kind?: string;
  mime_type?: string;
}

/** The one image shape the gallery reads. */
export interface CatalogImage {
  id: number | string;
  url: string | null;
  is_primary: boolean;
  image_index: number;
  media_kind: string;
}

/** A product row from either driver. The named fields are the ones this file reads; the rest pass through. */
export interface CatalogProduct {
  id?: number | string;
  ref?: string;
  images?: RawImage[];
  variants?: RawVariant[];
  supplier?: { tier?: string; [field: string]: unknown } | null;
  supplier_name?: string;
  district?: string | null;
  image_index?: number;
  image_url?: string | null;
  primary_image_url?: string | null;
  primary_image?: string | null;
  available_qty?: number;
  stock_qty?: number;
  [field: string]: any;
}

function normalizeTier(tier?: string) {
  if (!tier) return 'standard';
  return SERVER_TIER_TO_CLIENT[tier] || tier.toLowerCase();
}

/**
 * The server (raw SQL columns: attributes_json, image_url from a joined media_assets row) and the
 * mock fixtures (plain `attributes`, `image_index` for the placeholder palette since no real
 * photography exists yet) don't share a wire shape — normalize once here so every component below
 * this call only ever sees one shape, regardless of VITE_API_MODE.
 */
export function normalizeProduct(product: CatalogProduct | null | undefined) {
  if (!product) return product;
  const fallbackUrl = resolveProductImage(product);
  const rawImages = (product.images && product.images.length > 0) ? product.images : [];
  const images = rawImages.length > 0
    ? rawImages.map((img, idx): CatalogImage => ({
        id: img.id,
        url: img.url || (idx === 0 ? fallbackUrl : null),
        is_primary: !!img.is_primary,
        image_index: img.image_index ?? (product.image_index ?? 0),
        media_kind: img.media_kind || (img.mime_type?.startsWith('video') ? 'VIDEO' : 'IMAGE'),
      }))
    : [
        {
          id: `${product.ref || product.id || 'p'}-img0`,
          url: fallbackUrl,
          is_primary: true,
          image_index: product.image_index ?? 0,
          media_kind: 'IMAGE',
        },
      ];

  return {
    ...product,
    image_url: product.image_url || fallbackUrl,
    primary_image_url: product.primary_image_url || fallbackUrl,
    // WHY available_qty: the server keeps stock_qty raw (the admin editor writes it back on save) and
    // sends what can actually be bought, net of open-team reservations, beside it. Everything below
    // this call reads stock_qty, so it is swapped once here for shoppers.
    stock_qty: product.available_qty ?? product.stock_qty,
    variants: (product.variants || []).map((v): CatalogVariant => ({
      id: v.id,
      sku: v.sku,
      attributes: v.attributes || v.attributes_json || {},
      price_delta: Number(v.price_delta) || 0,
      stock_qty: v.available_qty ?? v.stock_qty ?? 0,
      is_active: v.is_active !== false,
      image_url: v.image_url || null,
      image_index: v.image_index ?? null,
    })),
    images,
    supplier: product.supplier ? { ...product.supplier, tier: normalizeTier(product.supplier.tier) } : null,
  };
}

export async function getProduct(idOrRef: number | string) {
  const res = await api.get(`/products/${idOrRef}`);
  const prod = res?.product || res?.data?.product || res?.data || res;
  return normalizeProduct(prod);
}

/**
 * The server's list endpoint (GET /products) returns raw DB columns — stock_qty, rating_avg, and
 * retail price nested under pricing.retail_price — while the mock fixture uses the flatter
 * price/stock/rating shape ProductCard, ProductGrid, and FlashSaleWidget already read. `??`
 * backfills only when the flat field is missing, so mock-mode products (which already carry it)
 * pass through unchanged.
 */
export function normalizeProductListItem(product: CatalogProduct) {
  // Present a consistent `supplier` shape whether the row carried a nested object (mock feed /
  // product detail) or the flat supplier_name + district columns the live listing selects, so a
  // list-item consumer can render the supplier line without a second detail fetch.
  const supplier =
    product.supplier ||
    (product.supplier_name
      ? { name: product.supplier_name, district: product.district ?? null }
      : null);
  // Present the same variant shape as normalizeProduct() so a list-item consumer (the discovery
  // feed's inline buy box) can mount VariantSelector straight from the list row — the live feed
  // returns attributes under `attributes_json` and price_delta as a NUMERIC string, the mock returns
  // `attributes` and a number; both settle to one shape here.
  const variants = Array.isArray(product.variants)
    ? product.variants.map((v): CatalogVariant => ({
        id: v.id,
        sku: v.sku,
        attributes: v.attributes || v.attributes_json || {},
        price_delta: Number(v.price_delta) || 0,
        stock_qty: v.stock_qty ?? 0,
        is_active: v.is_active !== false,
        image_url: v.image_url ?? null,
        image_index: v.image_index ?? null,
      }))
    : null;
  return {
    ...product,
    price: product.price ?? product.pricing?.retail_price ?? product.default_retail_price,
    stock: product.stock ?? product.stock_qty,
    rating: product.rating ?? product.rating_avg,
    margin_pct: product.margin_pct ?? product.pricing?.saler_margin_pct,
    supplier,
    ...(variants ? { variants } : {}),
    has_variants: product.has_variants ?? (variants ? variants.length > 0 : undefined),
    image_url: product.image_url ?? product.primary_image_url ?? product.primary_image ?? product.images?.[0]?.url ?? null,
  };
}

export async function listProducts(query: Params = {}) {
  // net_stock: shoppers see stock net of open-team reservations; admin screens read raw counts.
  const { data, meta } = await api.get('/products', { query: { net_stock: 1, ...query } });
  const products = (data?.products ?? []).map(normalizeProductListItem);
  return { products, meta };
}

/**
 * Typeahead for the TopBar search box (Prompt 4.4 `GET /search/suggest`). Returns a short list of
 * matching products plus the full match count so the dropdown can offer "see all N results".
 * The mock driver ships a seed Banglish→Bengali map; the live engine does the real transliteration.
 */
export async function searchSuggest(q: string | null | undefined, { limit = 6 }: { limit?: number } = {}) {
  const term = (q ?? '').trim();
  if (!term) return { suggestions: [], total: 0, query: '' };
  const res = await api.get('/search/suggest', { query: { q: term, limit } });
  const suggestions = (res?.suggestions ?? res?.data?.suggestions ?? []).map(normalizeProductListItem);
  return { suggestions, total: res?.total ?? suggestions.length, query: res?.query ?? term };
}

export interface ReviewListOptions {
  rating?: number;
  hasPhotos?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export async function listReviews(productId: number | string, { rating, hasPhotos, sort, page = 1, pageSize = 10 }: ReviewListOptions = {}) {
  const query: Record<string, unknown> = { page, page_size: pageSize };
  if (rating) query.rating = rating;
  if (hasPhotos) query.has_photos = '1';
  if (sort) query.sort = sort;

  const { data, meta } = await api.get(`/products/${productId}/reviews`, { query });
  return { reviews: data.reviews, distribution: data.distribution, pagination: meta.pagination };
}

export async function getReviewEligibility(productId: number | string) {
  // A guest with no session 401s here by design (ReviewList.js treats that the same as an
  // explicit NOT_SIGNED_IN reason) — it must not force a redirect off the product page.
  const { data } = await api.get(`/products/${productId}/reviews/eligibility`, { skipAuthRedirect: true });
  return data;
}

export async function submitReview(productId: number | string, { rating, title, body }: { rating: number; title?: string; body?: string }) {
  const { data } = await api.post(`/products/${productId}/reviews`, { rating, title, body });
  return data.review;
}

export async function markReviewHelpful(reviewId: number | string) {
  const { data } = await api.post(`/reviews/${reviewId}/helpful`, {});
  return data;
}

export async function listQuestions(productId: number | string, { page = 1, pageSize = 10 }: { page?: number; pageSize?: number } = {}) {
  const { data, meta } = await api.get(`/products/${productId}/questions`, { query: { page, page_size: pageSize } });
  return { questions: data.questions, pagination: meta.pagination };
}

export async function askQuestion(productId: number | string, body: string) {
  const { data } = await api.post(`/products/${productId}/questions`, { body });
  return data.question;
}

export async function answerQuestion(questionId: number | string, body: string) {
  const { data } = await api.post(`/questions/${questionId}/answers`, { body });
  return data.answer;
}

export async function upvoteQuestion(questionId: number | string) {
  const { data } = await api.post(`/questions/${questionId}/upvote`, {});
  return data;
}

/**
 * Calls POST /api/v1/pricing/preview.
 * Pure server-calculated breakdown — client never performs split math directly.
 */
export interface PricingPreviewOptions {
  baseCost: number;
  wholesaleMargin?: number;
  retailPrice: number;
  /** The calculator also sends its starting price; the server ignores it. */
  defaultRetailPrice?: number;
  categoryId?: number | null;
  productId?: number | string | null;
  mode?: string;
}

export async function previewPricing({ baseCost, wholesaleMargin = 0, retailPrice, categoryId, productId, mode }: PricingPreviewOptions) {
  const payload = {
    base_cost: baseCost,
    wholesale_margin: wholesaleMargin,
    retail_price: retailPrice,
    category_id: categoryId,
    product_id: productId,
    ...(mode ? { mode } : {}),
  };
  const { data } = await api.post('/pricing/preview', payload);
  return data.preview || data;
}

/**
 * Lists supplier products suitable for shop partner sourcing with margin info.
 */
export interface SourcingFilters {
  minMarginPct?: number | string;
  categoryId?: number | string;
  category?: string;
  brand?: string;
  shippingSpeed?: string;
  verificationTier?: string;
  inStock?: boolean;
  sortBy?: string;
  limit?: number;
  offset?: number;
}

export async function listSourcingCatalog(filters: SourcingFilters = {}) {
  const query: Record<string, unknown> = {};
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

// Sponsored Sourcing Slot: see services/sponsoredSourcing.ts (fetch + billable-event beacons).

/**
 * Shop Partner adds a product to their virtual storefront. The supplier's price applies (migration 085),
 * so no price is sent; the server answers 422 PRICE_LOCKED if one is.
 */
export async function addToSalerStore({ productId, collectionName }: { productId: number | string; collectionName?: string }) {
  const payload = {
    product_id: productId,
    collection_name: collectionName || 'General',
  };
  const { data } = await api.post('/sourcing/add-to-store', payload);
  return data?.item || data;
}

/**
 * Gets all curated items in the shop partner's store.
 */
export async function getSalerStoreItems() {
  const { data } = await api.get('/sourcing/my-store');
  return data?.store_items || [];
}
