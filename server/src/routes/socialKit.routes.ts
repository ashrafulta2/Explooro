/**
 * socialKit.routes.ts — Fastify route definitions for Social Explooro Partner Kit & Short Links (Prompt 9.7).
 */

import * as socialKitController from '../controllers/socialKit.controller.ts';

export default async function socialKitRoutes(app) {
  const requireSocialKit = app.requireModule('social_seller_kit');

  // 1. Public Short Link Redirection
  app.get('/s/:code', socialKitController.redirectShortLink);

  // 1b. Same click, answered as JSON for the client's /s/:code page. Public: the shopper is anonymous.
  app.post('/links/:code/open', {
    preHandler: [requireSocialKit],
    schema: {
      params: { type: 'object', required: ['code'], properties: { code: { type: 'string', maxLength: 120 } } },
      body: { type: ['object', 'null'], properties: { referrer: { type: ['string', 'null'], maxLength: 500 } } },
    },
  }, socialKitController.openShortLink);

  // 2. Generate Tracked Affiliate Short Link
  app.post('/saler/social-kit/links', {
    preHandler: [app.authenticate, requireSocialKit],
  }, socialKitController.createLink);

  // 2b. Flyer formats and themes the renderer accepts
  app.get('/saler/social-kit/templates', {
    preHandler: [app.authenticate, requireSocialKit],
  }, socialKitController.listTemplates);

  // 3. Render Dynamic Vector Poster / Flyer SVG
  app.get('/saler/social-kit/flyer', {
    preHandler: [requireSocialKit],
    schema: { querystring: { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 1, maxLength: 120 }, format: { type: 'string', maxLength: 20 }, theme: { type: 'string', maxLength: 20 } } } },
  }, socialKitController.renderFlyer);

  // 4. Explooro Partner Short Link Analytics
  app.get('/saler/social-kit/analytics', {
    preHandler: [app.authenticate, requireSocialKit],
  }, socialKitController.getAnalytics);
}
