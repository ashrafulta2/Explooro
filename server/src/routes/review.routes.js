/**
 * review.routes.js — Routes for product reviews (Prompt 4.6).
 */

import * as reviewController from '../controllers/review.controller.js';
import { requireRestriction } from '../middlewares/requireRestriction.js';

export default async function reviewRoutes(app) {
  const requireRestr = app.requireRestriction || requireRestriction;

  app.get('/products/:productId/reviews', reviewController.listReviews);

  app.get(
    '/products/:productId/reviews/eligibility',
    { preHandler: [app.authenticate] },
    reviewController.getEligibility
  );

  app.post(
    '/products/:productId/reviews',
    { preHandler: [app.authenticate, requireRestr('can_post_review')] },
    reviewController.submitReview
  );

  app.post(
    '/reviews/:reviewId/helpful',
    { preHandler: [app.authenticate] },
    reviewController.markHelpful
  );
}
