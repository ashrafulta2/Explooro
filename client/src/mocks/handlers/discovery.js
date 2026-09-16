/**
 * Mock handlers for the interest-based discovery feed (/discover).
 *
 * Mirrors the live contract in server/src/{controllers,services}/discovery*:
 *   GET  /discovery/feed   → { data: { products }, meta: { count, has_more, next_offset, personalized } }
 *   POST /discovery/events → { data: { recorded } }
 *
 * So the "algorithm" is visible during preview, this keeps a tiny in-memory affinity map: every
 * event nudges the score of its category, and later feed pages lean toward the categories the
 * shopper has been engaging with. It resets on reload — real history lives server-side.
 */
import products from '../fixtures/products.json' with { type: 'json' };
import { synthesizeSupplier, synthesizeDescription, synthesizeVariants } from './products.js';

const EVENT_WEIGHTS = { VIEW: 1, DWELL: 1.5, CLICK: 2, ADD_CART: 4, WISHLIST: 3, PURCHASE: 6 };
const categoryAffinity = new Map();
const viewedProductRefs = new Set();

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function matchesQuery(p, raw) {
  const q = String(raw || '').toLowerCase().trim();
  if (!q) return true;
  return [p.title_en, p.title_bn, p.category, p.category_bn, p.district, p.ref]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function popularityScore(p) {
  // Rough proxy for the server's sold_count/rating ordering, using the fields the fixture has.
  return num(p.rating) * Math.log(1 + num(p.rating_count)) + (p.is_flash_sale ? 2 : 0);
}

function determineRecommendationReason(p, idx) {
  const isViewed = viewedProductRefs.has(String(p.ref)) || viewedProductRefs.has(String(p.id));
  if (isViewed) return 'browsed';
  const affinity = categoryAffinity.get(p.category) || 0;
  if (affinity >= 3) return 'interest';
  if (p.is_flash_sale || num(p.rating) >= 4.7) return 'trending';
  if (num(p.rating_count) >= 140) return 'bestseller';

  // Multi-parameter interleaved sequence for balanced variety
  const reasons = ['trending', 'bestseller', 'crowd', 'interest'];
  return reasons[idx % reasons.length];
}

export default [
  {
    method: 'GET',
    path: '/discovery/feed',
    handler({ query }) {
      let list = [...products];

      if (query.q) list = list.filter((p) => matchesQuery(p, query.q));
      if (query.category && query.category !== 'all') list = list.filter((p) => p.category === query.category);
      if (query.min_price) list = list.filter((p) => num(p.price) >= num(query.min_price));
      if (query.max_price) list = list.filter((p) => num(p.price) <= num(query.max_price));
      if (query.in_stock === '1' || query.in_stock === 'true') list = list.filter((p) => num(p.stock) > 0);
      if (query.supplier_tier) {
        const tiers = String(query.supplier_tier).split(',').map((s) => s.trim());
        list = list.filter((p) => tiers.includes(p.supplier_tier));
      }
      if (query.district) {
        const target = String(query.district).toLowerCase().trim();
        list = list.filter((p) => String(p.district || '').toLowerCase() === target);
      }
      if (query.min_rating) list = list.filter((p) => num(p.rating) >= num(query.min_rating));
      if (query.min_margin) list = list.filter((p) => num(p.margin_pct) >= num(query.min_margin));

      const ordered = list
        .map((p) => ({ p, score: (categoryAffinity.get(p.category) || 0) * 3 + popularityScore(p) }))
        .sort((a, b) => b.score - a.score)
        .map((s) => s.p);

      const limit = Math.min(num(query.limit) || 10, 30);
      const offset = Math.max(0, num(query.offset));
      // Carry the whole above-the-fold buy box (supplier line + short description + the variant
      // set that drives the Size selector) on the list item itself, synthesized the same way the
      // product-detail handler does. WHY: the feed slide must paint complete in one frame — if any
      // of this only arrived via the later per-slide getProduct() fetch, it would pop in after the
      // rest of the card (a visible late load). This mirrors the live contract, where the discovery
      // feed asks listCatalog for description_en/bn, a supplier_name column, and (withVariants) the
      // product's variants.
      const page = ordered.slice(offset, offset + limit).map((p, idx) => {
        const supplier = synthesizeSupplier(p);
        const desc = synthesizeDescription(p);
        const variants = synthesizeVariants(p);
        return {
          ...p,
          supplier,
          supplier_name: supplier.name,
          description_en: p.description_en || desc.description_en,
          description_bn: p.description_bn || desc.description_bn,
          variants,
          has_variants: variants.length > 0,
          recommendation_reason: determineRecommendationReason(p, offset + idx),
        };
      });
      const hasMore = offset + limit < ordered.length;

      return {
        status: 200,
        body: {
          data: { products: page },
          meta: {
            count: page.length,
            total: ordered.length,
            has_more: hasMore,
            next_offset: hasMore ? offset + limit : null,
            personalized: categoryAffinity.size > 0 || viewedProductRefs.size > 0,
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/discovery/events',
    handler({ body }) {
      const events = Array.isArray(body?.events) ? body.events : body?.event ? [body.event] : [];
      for (const e of events) {
        if (e.ref || e.product_id) {
          viewedProductRefs.add(String(e.ref || e.product_id));
        }
        const category = e.category || e.category_name;
        if (category) {
          const weight = EVENT_WEIGHTS[String(e.event_type || '').toUpperCase()] || 1;
          categoryAffinity.set(category, (categoryAffinity.get(category) || 0) + weight);
        }
      }
      return { status: 202, body: { data: { recorded: events.length } } };
    },
  },
];
