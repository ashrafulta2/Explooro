/**
 * flyerDesign.routes.ts — a person's saved Flyer Studio designs (migration 110).
 *
 *   GET    /me/flyer-designs          the list, newest first, with the limit
 *   PUT    /me/flyer-designs/:key     save one (again = move it to the top)
 *   DELETE /me/flyer-designs/:key     unsave one
 *   POST   /me/flyer-designs/merge    bring in designs a device saved before sync existed
 *
 * Every answer is the whole list: { data: { keys, limit } }.
 *
 * WHY no requirePermission: the list is the caller's own bookmarks and reaches nobody else; both
 * studio pages are already guarded (the partner page by role, the supplier page by
 * catalog.product.manage_own). The module gate still applies: with the social kit switched off,
 * there is no studio to save for.
 *
 * WHY no requireRestriction: user_restrictions gate capabilities that affect other people (selling,
 * posting, chatting). Bookmarking a design for yourself is not one, and there is no key for it.
 *
 * WHY no Idempotency-Key handling: PUT and DELETE of a key are idempotent by definition, and merge
 * inserts only missing keys, so a retried request lands in the same state.
 *
 * Registered under /api/v1 only (not at the root like socialKit.routes.ts, which needs /s/:code there).
 */

import * as flyerDesignController from '../controllers/flyerDesign.controller.ts';

// Shape only, as in the service; Ajv answers a malformed key with VALIDATION_FAILED before the handler.
const keyParam = {
  type: 'object',
  required: ['key'],
  properties: { key: { type: 'string', minLength: 9, maxLength: 140 } },
};

export default async function flyerDesignRoutes(app) {
  const guard = [app.authenticate, app.requireModule('social_seller_kit')];

  app.get('/me/flyer-designs', { preHandler: guard }, flyerDesignController.listSaved);

  app.put('/me/flyer-designs/:key', {
    preHandler: guard,
    schema: { params: keyParam },
  }, flyerDesignController.saveDesign);

  app.delete('/me/flyer-designs/:key', {
    preHandler: guard,
    schema: { params: keyParam },
  }, flyerDesignController.removeDesign);

  app.post('/me/flyer-designs/merge', {
    preHandler: guard,
    schema: {
      body: {
        type: 'object',
        required: ['keys'],
        additionalProperties: false,
        // The service keeps the first 60 valid ones; this bounds what a client may send at all.
        properties: { keys: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 140 } } },
      },
    },
  }, flyerDesignController.mergeSaved);
}
