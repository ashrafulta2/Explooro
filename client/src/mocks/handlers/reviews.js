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
import seedReviews from '../fixtures/reviews.json' with { type: 'json' };
import purchases from '../fixtures/purchases.json' with { type: 'json' };
import products from '../fixtures/products.json' with { type: 'json' };
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
  // ── Customer Account Review Endpoints ────────────────────────────────────
  {
    method: 'GET',
    path: '/account/reviews',
    handler({ query }) {
      const auth = currentAuth();
      const reviewerName = auth.name || 'Dev Customer';

      // Find all reviews by the current customer
      let userReviews = reviews.filter(
        (r) => r.reviewer_name === reviewerName || r.reviewer_name === 'Dev Customer'
      );

      // Sorters
      const sorters = {
        newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
        oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at),
        helpful: (a, b) => (b.helpful_count || 0) - (a.helpful_count || 0),
        rating_high: (a, b) => b.rating - a.rating,
        rating_low: (a, b) => a.rating - b.rating,
      };

      if (query.sort && sorters[query.sort]) {
        userReviews = [...userReviews].sort(sorters[query.sort]);
      } else {
        userReviews = [...userReviews].sort(sorters.newest);
      }

      if (query.rating) {
        userReviews = userReviews.filter((r) => r.rating === Number(query.rating));
      }

      if (query.has_media === '1' || query.has_media === 'true') {
        userReviews = userReviews.filter((r) => r.media && r.media.length > 0);
      }

      if (query.q) {
        const q = String(query.q).toLowerCase();
        userReviews = userReviews.filter((r) => {
          const product = products.find((p) => p.ref === r.product_ref);
          return (
            (r.title && r.title.toLowerCase().includes(q)) ||
            (r.body && r.body.toLowerCase().includes(q)) ||
            (product && (product.title_en.toLowerCase().includes(q) || product.title_bn.includes(q)))
          );
        });
      }

      // Enrich reviews with product info
      const enrichedReviews = userReviews.map((r) => {
        const product = products.find((p) => p.ref === r.product_ref) || {
          ref: r.product_ref,
          title_en: 'Authentic Handloom Saree',
          title_bn: 'ঐতিহ্যবাহী তাঁতের শাড়ি',
          price: '2,450.00',
          image_url: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=500&auto=format&fit=crop&q=80',
          store_ref: 'STR-RAHIM001',
        };

        const hasVideo = r.media?.some((m) => m.media_kind === 'VIDEO');
        const hasImage = r.media?.some((m) => m.media_kind === 'IMAGE');
        const coinsEarned = hasVideo ? 40 : hasImage ? 20 : 10;

        return {
          ...r,
          product_title_en: product.title_en,
          product_title_bn: product.title_bn,
          product_image: product.image_url,
          product_price: product.price,
          store_ref: product.store_ref,
          coins_earned: coinsEarned,
          status: 'PUBLISHED',
        };
      });

      // Calculate pending reviews count
      const reviewedRefs = new Set(reviews.filter((r) => r.reviewer_name === 'Dev Customer').map((r) => r.product_ref));
      const pendingOrders = purchases.orders.filter(
        (o) => o.status === 'DELIVERED' && !reviewedRefs.has(o.product_ref)
      );

      const totalCoinsEarned = enrichedReviews.reduce((sum, r) => sum + (r.coins_earned || 10), 0);
      const totalHelpfulVotes = enrichedReviews.reduce((sum, r) => sum + (r.helpful_count || 0), 0);

      const kpis = {
        total_reviews: enrichedReviews.length,
        coins_earned: totalCoinsEarned,
        helpful_votes: totalHelpfulVotes,
        pending_count: pendingOrders.length,
        video_reviews_count: enrichedReviews.filter((r) => r.media?.some((m) => m.media_kind === 'VIDEO')).length,
      };

      return {
        status: 200,
        body: {
          data: {
            reviews: enrichedReviews,
            kpis,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/account/reviews/pending',
    handler() {
      const reviewedRefs = new Set(
        reviews.filter((r) => r.reviewer_name === 'Dev Customer').map((r) => r.product_ref)
      );

      // Include delivered purchases and extra realistic delivered demo orders
      const pendingList = purchases.orders
        .filter((o) => o.status === 'DELIVERED' && !reviewedRefs.has(o.product_ref))
        .map((o) => {
          const product = products.find((p) => p.ref === o.product_ref) || {
            ref: o.product_ref,
            title_en: 'Premium Cotton Apparel',
            title_bn: 'প্রিমিয়াম কটন পোশাক',
            price: '1,850.00',
            image_url: 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=500&auto=format&fit=crop&q=80',
            store_ref: 'STR-DHKTEX02',
          };

          return {
            order_item_id: o.order_item_id,
            product_ref: o.product_ref,
            product_title_en: product.title_en,
            product_title_bn: product.title_bn,
            product_image: product.image_url,
            product_price: product.price,
            store_ref: product.store_ref,
            store_name: product.store_ref === 'STR-RAHIM001' ? 'Rahim Handloom & Silks' : 'Dhaka Textiles',
            order_ref: `ORD-${o.order_item_id.replace('MOCK-OI-', '849')}`,
            delivered_at: '2026-08-24T14:30:00.000Z',
            potential_coins: {
              text_photo: 20,
              video: 40,
            },
          };
        });

      return {
        status: 200,
        body: {
          data: {
            pending: pendingList,
            total_pending: pendingList.length,
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/account/reviews',
    handler({ body }) {
      const productRef = body?.product_ref;
      if (!productRef) {
        return {
          status: 400,
          body: { error: { code: 'MISSING_PRODUCT', message_en: 'Product reference is required.', message_bn: 'পণ্যের তথ্য প্রয়োজন।' } },
        };
      }

      const rating = Number(body?.rating);
      if (!rating || rating < 1 || rating > 5) {
        return {
          status: 400,
          body: { error: { code: 'INVALID_RATING', message_en: 'Rating must be 1 to 5.', message_bn: 'রেটিং অবশ্যই ১ থেকে ৫ এর মধ্যে হতে হবে।' } },
        };
      }

      const hasVideo = body?.media?.some((m) => m.media_kind === 'VIDEO');
      const hasImage = body?.media?.some((m) => m.media_kind === 'IMAGE');
      const coinsAwarded = hasVideo ? 40 : hasImage ? 20 : 10;

      const newReview = {
        id: nextId++,
        product_ref: productRef,
        rating,
        title: body?.title || '',
        body: body?.body || '',
        reviewer_name: 'Dev Customer',
        is_verified_purchase: true,
        helpful_count: 0,
        created_at: new Date().toISOString(),
        media: body?.media || [],
      };

      reviews = [newReview, ...reviews];

      return {
        status: 201,
        body: {
          data: {
            review: newReview,
            coins_awarded: coinsAwarded,
            message_en: `Review submitted! You earned +${coinsAwarded} Coins!`,
            message_bn: `রিভিউ সফলভাবে জমা হয়েছে! আপনি পেয়েছেন +${coinsAwarded} কয়েন বোনাস!`,
          },
        },
      };
    },
  },
  {
    method: 'PUT',
    path: '/account/reviews/:id',
    handler({ params, body }) {
      const reviewIndex = reviews.findIndex((r) => String(r.id) === String(params.id));
      if (reviewIndex === -1) {
        return {
          status: 404,
          body: { error: { code: 'NOT_FOUND', message_en: 'Review not found.', message_bn: 'রিভিউ পাওয়া যায়নি।' } },
        };
      }

      const rating = Number(body?.rating);
      if (rating && (rating < 1 || rating > 5)) {
        return {
          status: 400,
          body: { error: { code: 'INVALID_RATING', message_en: 'Rating must be 1 to 5.', message_bn: 'রেটিং অবশ্যই ১ থেকে ৫ এর মধ্যে হতে হবে।' } },
        };
      }

      const existing = reviews[reviewIndex];
      const updated = {
        ...existing,
        rating: rating || existing.rating,
        title: body?.title !== undefined ? body.title : existing.title,
        body: body?.body !== undefined ? body.body : existing.body,
        media: body?.media !== undefined ? body.media : existing.media,
        updated_at: new Date().toISOString(),
      };

      reviews[reviewIndex] = updated;

      return {
        status: 200,
        body: {
          data: {
            review: updated,
            message_en: 'Review updated successfully.',
            message_bn: 'রিভিউ সফলভাবে আপডেট করা হয়েছে।',
          },
        },
      };
    },
  },
  {
    method: 'DELETE',
    path: '/account/reviews/:id',
    handler({ params }) {
      const reviewIndex = reviews.findIndex((r) => String(r.id) === String(params.id));
      if (reviewIndex === -1) {
        return {
          status: 404,
          body: { error: { code: 'NOT_FOUND', message_en: 'Review not found.', message_bn: 'রিভিউ পাওয়া যায়নি।' } },
        };
      }

      reviews.splice(reviewIndex, 1);

      return {
        status: 200,
        body: {
          data: {
            success: true,
            message_en: 'Review deleted successfully.',
            message_bn: 'রিভিউ সফলভাবে মুছে ফেলা হয়েছে।',
          },
        },
      };
    },
  },
];
