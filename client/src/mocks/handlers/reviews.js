/**
 * Mock handlers for product reviews (Prompt 4.6).
 *
 * Mirrors server/src/services/review.service.js's eligibility rule ("a user who has not purchased
 * a delivered order for this product cannot review it") using fixtures/purchases.json as a stand-in
 * for a real order history, since mock mode has no real per-user session/order data. Reviews are
 * copied into a module-level mutable array so a submission is visible for the rest of the tab's
 * session — the same "no real persistence, just a believable live demo" contract every other mock
 * handler in this app follows.
 */
import seedReviews from '../fixtures/reviews.json';
import purchases from '../fixtures/purchases.json';
import { appStore } from '../../state/appStore.js';

let reviews = seedReviews.map((r) => ({ ...r }));
let nextId = Math.max(...reviews.map((r) => r.id)) + 1;

function traceId() {
  return `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function currentAuth() {
  return appStore.get().auth || { isAuthenticated: false };
}

/** Same shape/semantics as review.service.js's getReviewEligibility. */
function eligibilityFor(productRef) {
  const auth = currentAuth();
  if (!auth.isAuthenticated) return { can_review: false, reason: 'NOT_SIGNED_IN' };

  const order = purchases.orders.find((o) => o.product_ref === productRef);
  if (!order) return { can_review: false, reason: 'NOT_PURCHASED' };
  if (order.status !== 'DELIVERED') return { can_review: false, reason: 'NOT_YET_DELIVERED' };

  const alreadyReviewed = reviews.some(
    (r) => r.product_ref === productRef && r.reviewer_name === 'Dev Customer'
  );
  if (alreadyReviewed) return { can_review: false, reason: 'ALREADY_REVIEWED' };

  return { can_review: true, order_item_id: order.order_item_id };
}

const SORTERS = {
  newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
  oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at),
  helpful: (a, b) => b.helpful_count - a.helpful_count,
  rating_high: (a, b) => b.rating - a.rating,
  rating_low: (a, b) => a.rating - b.rating,
};

export default [
  {
    method: 'GET',
    path: '/products/:productId/reviews',
    handler({ params, query }) {
      let list = reviews.filter((r) => r.product_ref === params.productId);

      const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      for (const r of list) distribution[r.rating] = (distribution[r.rating] || 0) + 1;

      if (query.rating) list = list.filter((r) => r.rating === Number(query.rating));
      if (query.has_photos === '1' || query.has_photos === 'true') {
        list = list.filter((r) => r.media && r.media.length > 0);
      }

      list = [...list].sort(SORTERS[query.sort] || SORTERS.newest);

      const page = Number(query.page) || 1;
      const pageSize = Math.min(Number(query.page_size) || 10, 50);
      const start = (page - 1) * pageSize;
      const pageItems = list.slice(start, start + pageSize);

      return {
        status: 200,
        body: {
          data: { reviews: pageItems, distribution },
          meta: {
            pagination: {
              page,
              page_size: pageSize,
              total_count: list.length,
              total_pages: Math.max(1, Math.ceil(list.length / pageSize)),
            },
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/products/:productId/reviews/eligibility',
    handler({ params }) {
      return { status: 200, body: { data: eligibilityFor(params.productId) } };
    },
  },
  {
    method: 'POST',
    path: '/products/:productId/reviews',
    handler({ params, body }) {
      const eligibility = eligibilityFor(params.productId);
      if (!eligibility.can_review) {
        const messages = {
          NOT_SIGNED_IN: ['Sign in required.', 'সাইন ইন করা প্রয়োজন।', 'AUTH_REQUIRED', 401],
          NOT_PURCHASED: ['You can only review a product you have purchased.', 'আপনি শুধুমাত্র ক্রয়কৃত পণ্যের রিভিউ দিতে পারবেন।', 'FORBIDDEN', 403],
          NOT_YET_DELIVERED: ['You can review this product once your order is delivered.', 'আপনার অর্ডারটি ডেলিভারি হওয়ার পর আপনি এই পণ্যের রিভিউ দিতে পারবেন।', 'FORBIDDEN', 403],
          ALREADY_REVIEWED: ['You have already reviewed this purchase.', 'আপনি ইতিমধ্যে এই ক্রয়ের জন্য রিভিউ দিয়েছেন।', 'VALIDATION_FAILED', 400],
        };
        const [message_en, message_bn, code, status] = messages[eligibility.reason];
        return { status, body: { error: { code, message_en, message_bn, trace_id: traceId() } } };
      }

      const rating = Number(body?.rating);
      if (!rating || rating < 1 || rating > 5) {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message_en: 'Rating must be between 1 and 5.',
              message_bn: 'রেটিং অবশ্যই ১ থেকে ৫ এর মধ্যে হতে হবে।',
              trace_id: traceId(),
            },
          },
        };
      }

      const review = {
        id: nextId++,
        product_ref: params.productId,
        rating,
        title: body?.title || '',
        body: body?.body || '',
        reviewer_name: 'Dev Customer',
        is_verified_purchase: true,
        helpful_count: 0,
        created_at: new Date().toISOString(),
        media: [],
      };
      reviews = [review, ...reviews];
      return { status: 201, body: { data: { review } } };
    },
  },
  {
    method: 'POST',
    path: '/reviews/:reviewId/helpful',
    handler({ params }) {
      const review = reviews.find((r) => String(r.id) === params.reviewId);
      if (!review) {
        return { status: 404, body: { error: { code: 'NOT_FOUND', message_en: 'Review not found.', message_bn: 'রিভিউ পাওয়া যায়নি।', trace_id: traceId() } } };
      }
      review.helpful_count += 1;
      return { status: 200, body: { data: { id: review.id, helpful_count: review.helpful_count } } };
    },
  },
];
