/**
 * review.service.js — Review eligibility, submission, listing & helpful votes (Prompt 4.6).
 */

import * as reviewRepo from '../repositories/review.repository.js';
import { AppError } from '../plugins/errorHandler.js';
import { evaluateAndFlag } from './ai/reviewIntegrity.js';

/**
 * Whether the current user may submit a review right now, and why not if they can't. Mirrors the
 * shape the ReviewList "write a review" CTA needs to render the right state instead of a bare 403.
 */
export async function getReviewEligibility(db, userId, productId) {
  if (!userId) return { can_review: false, reason: 'NOT_SIGNED_IN' };

  const reviewable = await reviewRepo.findReviewableOrderItem(db, userId, productId);
  if (reviewable) return { can_review: true, order_item_id: reviewable.order_item_id };

  const anyOrder = await reviewRepo.hasAnyOrderForProduct(db, userId, productId);
  if (!anyOrder) return { can_review: false, reason: 'NOT_PURCHASED' };
  if (anyOrder.status !== 'DELIVERED') return { can_review: false, reason: 'NOT_YET_DELIVERED' };
  return { can_review: false, reason: 'ALREADY_REVIEWED' };
}

export async function submitReview(db, { userId, productId, rating, title, body }) {
  if (!rating || rating < 1 || rating > 5) {
    throw new AppError('VALIDATION_FAILED', 'Rating must be between 1 and 5.', 'রেটিং অবশ্যই ১ থেকে ৫ এর মধ্যে হতে হবে।');
  }

  const reviewable = await reviewRepo.findReviewableOrderItem(db, userId, productId);
  if (!reviewable) {
    const anyOrder = await reviewRepo.hasAnyOrderForProduct(db, userId, productId);
    if (!anyOrder) {
      throw new AppError(
        'FORBIDDEN',
        'You can only review a product you have purchased.',
        'আপনি শুধুমাত্র ক্রয়কৃত পণ্যের রিভিউ দিতে পারবেন।'
      );
    }
    if (anyOrder.status !== 'DELIVERED') {
      throw new AppError(
        'FORBIDDEN',
        'You can review this product once your order is delivered.',
        'আপনার অর্ডারটি ডেলিভারি হওয়ার পর আপনি এই পণ্যের রিভিউ দিতে পারবেন।'
      );
    }
    throw new AppError(
      'VALIDATION_FAILED',
      'You have already reviewed this purchase.',
      'আপনি ইতিমধ্যে এই ক্রয়ের জন্য রিভিউ দিয়েছেন।'
    );
  }

  const review = await reviewRepo.insertReview(db, {
    productId,
    orderItemId: reviewable.order_item_id,
    userId,
    rating,
    title,
    body,
  });

  // Prompt 10.3: score for fake-review signals before the rating average is recomputed, so a
  // flagged review (moved to PENDING by evaluateAndFlag) is correctly excluded from rating_avg.
  const integrity = await evaluateAndFlag(db, { userId, review });

  await reviewRepo.recomputeProductRating(db, productId);
  return { ...review, integrity_score: integrity.score, flagged_for_review: integrity.flagged };
}

export async function listReviews(db, productId, { rating, hasPhotos, sort, page = 1, pageSize = 10 } = {}) {
  const limit = Math.min(Number(pageSize) || 10, 50);
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;

  const [reviews, totalCount, distribution] = await Promise.all([
    reviewRepo.listReviewsByProduct(db, productId, { rating, hasPhotos, sort, limit, offset }),
    reviewRepo.countReviewsByProduct(db, productId, { rating, hasPhotos }),
    reviewRepo.getRatingDistribution(db, productId),
  ]);

  return {
    reviews,
    distribution,
    pagination: {
      page: Number(page) || 1,
      page_size: limit,
      total_count: totalCount,
      total_pages: Math.max(1, Math.ceil(totalCount / limit)),
    },
  };
}

export async function markHelpful(db, reviewId) {
  const updated = await reviewRepo.incrementHelpfulCount(db, reviewId);
  if (!updated) {
    throw new AppError('NOT_FOUND', 'Review not found.', 'রিভিউ পাওয়া যায়নি।');
  }
  return updated;
}
