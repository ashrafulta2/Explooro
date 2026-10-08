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

// Mirrors server/src/services/discoveryFeed.service.js EVENT_WEIGHTS (test/discoverFeed.test.js pins the parity).
const EVENT_WEIGHTS = {
  VIEW: 1,
  DWELL: 1.5,
  CLICK: 2,
  SEARCH_CLICK: 3,
  SHARE: 2.5,
  FOLLOW_STORE: 3,
  ADD_CART: 4,
  WISHLIST: 3,
  PURCHASE: 6,
};
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

function determineRecommendationReason(p) {
  if (p._tier === 'top') {
    return p.recommendation_reason || 'trending';
  }
  if (p._tier === 'bottom') {
    return 'catalog';
  }
  return p.recommendation_reason || 'explore';
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

      // 1. Separate bottom tier: low interest / low engagement / unrated items (rating < 4.0 or rating_count < 30)
      const bottomList = [];
      const candidateList = [];

      for (const p of list) {
        if (num(p.rating) < 4.0 || num(p.rating_count) < 30) {
          bottomList.push({ ...p, _tier: 'bottom', recommendation_reason: 'catalog' });
        } else {
          candidateList.push({ ...p });
        }
      }

      // Sort candidateList by popularity & affinity
      candidateList.sort((a, b) => {
        const scoreA = (categoryAffinity.get(a.category) || 0) * 4 + popularityScore(a);
        const scoreB = (categoryAffinity.get(b.category) || 0) * 4 + popularityScore(b);
        return scoreB - scoreA;
      });

      // 2. Select TOP showcase (exactly top 4 to 6 standout items)
      const topList = [];
      const usedRefs = new Set();

      // Top interest items if user engaged with or searched categories
      if (categoryAffinity.size > 0) {
        for (const p of candidateList) {
          if (topList.length >= 2) break;
          const aff = categoryAffinity.get(p.category) || 0;
          if (aff >= 2 && !usedRefs.has(p.ref)) {
            topList.push({ ...p, _tier: 'top', recommendation_reason: 'interest' });
            usedRefs.add(p.ref);
          }
        }
      }

      // Top trending in Bangladesh (flash sales with top ratings)
      for (const p of candidateList) {
        if (topList.filter((x) => x.recommendation_reason === 'trending').length >= 2) break;
        if (topList.length >= 4) break;
        if (p.is_flash_sale && num(p.rating) >= 4.6 && !usedRefs.has(p.ref)) {
          topList.push({ ...p, _tier: 'top', recommendation_reason: 'trending' });
          usedRefs.add(p.ref);
        }
      }

      // Top bestsellers in Bangladesh (highest ratings and review counts)
      for (const p of candidateList) {
        if (topList.filter((x) => x.recommendation_reason === 'bestseller').length >= 2) break;
        if (topList.length >= 6) break;
        if (num(p.rating_count) >= 140 && !usedRefs.has(p.ref)) {
          topList.push({ ...p, _tier: 'top', recommendation_reason: 'bestseller' });
          usedRefs.add(p.ref);
        }
      }

      // 3. Mid tier: Category-wise showcase of ALL remaining quality products
      const remainingCandidates = candidateList.filter((p) => !usedRefs.has(p.ref));
      let midList = [];

      if (!query.category || query.category === 'all') {
        // Interleave category-by-category so the user explores diverse categories as they scroll
        const byCategory = new Map();
        for (const p of remainingCandidates) {
          if (!byCategory.has(p.category)) byCategory.set(p.category, []);
          byCategory.get(p.category).push(p);
        }
        for (const items of byCategory.values()) {
          items.sort((a, b) => popularityScore(b) - popularityScore(a));
        }
        let round = 0;
        let added = true;
        while (added) {
          added = false;
          for (const items of byCategory.values()) {
            if (round < items.length) {
              const item = items[round];
              const reason = round % 2 === 0 ? 'explore' : 'crowd';
              midList.push({ ...item, _tier: 'mid', recommendation_reason: reason });
              added = true;
            }
          }
          round++;
        }
      } else {
        remainingCandidates.sort((a, b) => popularityScore(b) - popularityScore(a));
        midList = remainingCandidates.map((p, idx) => ({
          ...p,
          _tier: 'mid',
          recommendation_reason: idx % 2 === 0 ? 'explore' : 'crowd',
        }));
      }

      // 4. Bottom tier: low-interest / long-tail catalog products placed at the bottom
      bottomList.sort((a, b) => popularityScore(b) - popularityScore(a));

      // In all cases, 100% of all filtered products are preserved
      const ordered = [...topList, ...midList, ...bottomList];

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
          recommendation_reason: p.recommendation_reason || determineRecommendationReason(p),
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
  {
    // One deliberate search (query + result count). Mock mode keeps no search history, so this only
    // has to accept the call the way the live endpoint does.
    method: 'POST',
    path: '/discovery/search-events',
    handler({ body }) {
      const query = String(body?.query ?? body?.q ?? '').trim();
      if (!query) {
        return {
          status: 400,
          body: { error: { code: 'VALIDATION_FAILED', message_en: 'A non-empty query is required.', message_bn: 'একটি অ-খালি কোয়েরি প্রয়োজন।' } },
        };
      }
      return { status: 202, body: { data: { recorded: 1 } } };
    },
  },
];
