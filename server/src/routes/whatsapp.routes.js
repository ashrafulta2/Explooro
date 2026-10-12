/**
 * whatsapp.routes.js — Meta WhatsApp Cloud API Webhook & Public Checkout Routes (Prompt 8.3).
 */

import * as webhookController from '../controllers/whatsappWebhook.controller.js';
import * as inboxController from '../controllers/salerInbox.controller.js';

export default async function whatsappRoutes(app) {
  // WHY: the HMAC must cover the exact bytes Meta sent. This parser is scoped to this plugin only, so
  // every other route keeps Fastify's default JSON parsing.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body;
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // 1. Meta Webhook Verification Challenge
  app.get('/integrations/whatsapp/webhook', webhookController.verifyWebhook);

  // 2. Meta Inbound Message Webhook
  app.post('/integrations/whatsapp/webhook', webhookController.handleWebhook);

  // 3. 1-Tap Checkout Token Resolution (Public endpoint for customer clicking WhatsApp Buy Now link)
  app.get('/checkout/token/:token', inboxController.resolveCheckoutToken);
}
