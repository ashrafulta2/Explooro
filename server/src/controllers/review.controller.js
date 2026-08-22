/**
 * review.controller.js — Handlers for product review endpoints (Prompt 4.6).
 */

import * as reviewService from '../services/review.service.js';
import * as productRepo from '../repositories/product.repository.js';
import { AppError } from '../plugins/errorHandler.js';

/** `:productId` route params are `product.ref` everywhere in the client (see product.service.js's
 * getProductDetail) — resolve the same way so review endpoints accept the same URLs. */
async function resolveProduct(db, idOrRef) {
  const product = /^\d+$/.test(idOrRef)
    ? await productRepo.getProductById(db, parseInt(idOrRef, 10))
    : await productRepo.getProductByRef(db, idOrRef);
  if (!product) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'প্রোডাক্ট পাওয়া যায়নি।');
  }
  return product;
}

export async function listReviews(req, reply) {
  const db = req.db || req.server?.db;
  const product = await resolveProduct(db, req.params.productId);
  const { rating, has_photos, sort, page, page_size } = req.query || {};

  const result = await reviewService.listReviews(db, product.id, {
    rating: rating ? parseInt(rating, 10) : undefined,
    hasPhotos: has_photos === '1' || has_photos === 'true',
    sort,
    page: page ? parseInt(page, 10) : 1,
    pageSize: page_size ? parseInt(page_size, 10) : 10,
  });

  return reply.send({
    data: { reviews: result.reviews, distribution: result.distribution },
    meta: { pagination: result.pagination },
  });
}

export async function getEligibility(req, reply) {
  const db = req.db || req.server?.db;
  const product = await resolveProduct(db, req.params.productId);
  const eligibility = await reviewService.getReviewEligibility(db, req.user?.id, product.id);
  return reply.send({ data: eligibility });
}

export async function submitReview(req, reply) {
  const db = req.db || req.server?.db;
  const product = await resolveProduct(db, req.params.productId);
  const { rating, title, body } = req.body || {};

  const review = await reviewService.submitReview(db, {
    userId: req.user.id,
    productId: product.id,
    rating: rating != null ? parseInt(rating, 10) : undefined,
    title,
    body,
  });

  return reply.status(201).send({ data: { review } });
}

export async function markHelpful(req, reply) {
  const db = req.db || req.server?.db;
  const { reviewId } = req.params;
  const updated = await reviewService.markHelpful(db, parseInt(reviewId, 10));
  return reply.send({ data: updated });
}
