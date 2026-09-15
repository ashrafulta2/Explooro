/**
 * discovery.routes.js — Interest-based discovery feed (/discover surface).
 *
 * Both endpoints use optional auth: a signed-in shopper is ranked by (and records against) their
 * account, a guest by their browser's session_id. The `discovery_feed` module gate is enforced on
 * the client route; these endpoints stay reachable so the feed degrades to popularity rather than
 * erroring if a request arrives while the module is briefly toggling.
 */

import * as discoveryController from '../controllers/discovery.controller.js';

export default async function discoveryRoutes(app) {
  // Attach req.user when a valid session is present, but never reject an anonymous caller —
  // mirrors module.routes.js's optionalAuth.
  const optionalAuth = async (req, reply) => {
    try {
      if (app.authenticate) await app.authenticate(req, reply);
    } catch {
      // Anonymous is fine for the public feed.
    }
  };

  app.get('/discovery/feed', { preHandler: [optionalAuth] }, discoveryController.getFeed);
  app.post('/discovery/events', { preHandler: [optionalAuth] }, discoveryController.recordEvents);
}
