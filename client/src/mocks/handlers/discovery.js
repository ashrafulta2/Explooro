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

const EVENT_WEIGHTS = { VIEW: 1, DWELL: 1.5, CLICK: 2, ADD_CART: 4, WISHLIST: 3, PURCHASE: 6 };
const categoryAffinity = new Map();

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
      const page = ordered.slice(offset, offset + limit);
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
            personalized: categoryAffinity.size > 0,
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
