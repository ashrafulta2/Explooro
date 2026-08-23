/**
 * socialKit.routes.js — Fastify route definitions for Social Seller Kit & Short Links (Prompt 9.7).
 */

import * as socialKitController from '../controllers/socialKit.controller.js';

export default async function socialKitRoutes(app) {
  const requireSocialKit = app.requireModule('social_seller_kit');

  // 1. Public Short Link Redirection
  app.get('/s/:code', socialKitController.redirectShortLink);

  // 2. Generate Tracked Affiliate Short Link
  app.post('/saler/social-kit/links', {
    preHandler: [app.authenticate, requireSocialKit],
  }, socialKitController.createLink);

  // 3. Render Dynamic Vector Poster / Flyer SVG
  app.get('/saler/social-kit/flyer', {
    preHandler: [requireSocialKit],
  }, socialKitController.renderFlyer);

  // 4. Saler Short Link Analytics
  app.get('/saler/social-kit/analytics', {
    preHandler: [app.authenticate, requireSocialKit],
  }, socialKitController.getAnalytics);
}
