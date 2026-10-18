/**
 * communityPost.routes.ts — the community timeline (migration 080).
 *
 * The module `community_posts` gates every route. Reading the timeline is open to guests (they see
 * posts meant for everyone); writing, liking and reporting need an account; staff routes need
 * `community.post.moderate` / `community.post.announce`.
 */

import * as controller from '../controllers/communityPost.controller.ts';
import { requireRestriction } from '../middlewares/requireRestriction.ts';

const idParams = {
  type: 'object', required: ['id'],
  properties: { id: { type: 'string', pattern: '^\\d+$' } },
};

export default async function communityPostRoutes(app) {
  const requireModule = app.requireModule('community_posts');
  // Existing restriction capability: a user blocked from posting reviews is blocked from every post.
  const canPost = requireRestriction('can_post_review');
  const optionalAuth = async (req) => {
    try {
      if (app.authenticateOptional) await app.authenticateOptional(req);
    } catch {
      // A stale token reads as a guest here; the timeline is public.
    }
  };

  app.get('/community/posts', {
    preHandler: [optionalAuth, requireModule],
  }, controller.listPosts);

  app.get('/community/composer/products', {
    preHandler: [app.authenticate, requireModule, app.requirePermission('community.post.create_own')],
  }, controller.composerProducts);

  app.post('/community/posts', {
    preHandler: [app.authenticate, requireModule, app.requirePermission('community.post.create_own'), canPost],
    schema: {
      body: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', maxLength: 30 },
        product_id: { type: ['integer', 'string'] },
        order_item_id: { type: ['integer', 'string'] },
        title: { type: 'string', maxLength: 300 },
        body: { type: 'string', maxLength: 5000 },
        details: { type: 'object' },
      } },
    },
  }, controller.createPost);

  app.post('/community/announcements', {
    preHandler: [app.authenticate, requireModule, app.requirePermission('community.post.announce')],
    schema: {
      body: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', maxLength: 30 },
        title: { type: 'string', maxLength: 300 },
        body: { type: 'string', maxLength: 5000 },
        audience: { type: 'string', maxLength: 20 },
        is_pinned: { type: 'boolean' },
      } },
    },
  }, controller.createAnnouncement);

  app.post('/community/posts/:id/like', {
    preHandler: [app.authenticate, requireModule],
    schema: { params: idParams },
  }, controller.toggleLike);

  app.post('/community/posts/:id/report', {
    preHandler: [app.authenticate, requireModule, app.requirePermission('community.post.report')],
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, required: ['reason'], properties: {
        reason: { type: 'string', maxLength: 20 },
        note: { type: 'string', maxLength: 1000 },
      } },
    },
  }, controller.reportPost);

  app.get('/admin/community/queue', {
    preHandler: [app.authenticate, requireModule, app.requirePermission('community.post.moderate')],
  }, controller.getQueue);

  app.post('/admin/community/posts/:id/moderate', {
    preHandler: [app.authenticate, requireModule, app.requirePermission('community.post.moderate')],
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, required: ['action'], properties: {
        action: { type: 'string', maxLength: 10 },
      } },
    },
  }, controller.moderatePost);
}
