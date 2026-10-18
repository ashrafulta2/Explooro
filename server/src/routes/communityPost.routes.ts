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
        media_ids: { type: 'array', maxItems: 4, items: { type: ['integer', 'string'] } },
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
        media_ids: { type: 'array', maxItems: 4, items: { type: ['integer', 'string'] } },
      } },
    },
  }, controller.createAnnouncement);

  app.post('/community/posts/:id/like', {
    preHandler: [app.authenticate, requireModule],
    schema: { params: idParams },
  }, controller.toggleLike);

  app.get('/community/posts/:id/comments', {
    preHandler: [optionalAuth, requireModule],
    schema: { params: idParams },
  }, controller.listComments);

  app.post('/community/posts/:id/comments', {
    preHandler: [app.authenticate, requireModule, app.requirePermission('community.comment.create'), canPost],
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, required: ['body'], properties: {
        // Type and an outer bound only: the real limit (and the trimming) is the service's rule.
        body: { type: 'string', maxLength: 5000 },
      } },
    },
  }, controller.addComment);

  // A member's own comment. The service refuses anyone else's, so this needs no permission key.
  app.delete('/community/comments/:id', {
    preHandler: [app.authenticate, requireModule],
    schema: { params: idParams },
  }, controller.deleteComment);

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

  // The one business number of this feature (how many reports hide a post). Viewing it needs only
  // moderate (the queue returns it); changing it needs its own permission and a reason.
  app.post('/admin/community/comments/:id/remove', {
    preHandler: [app.authenticate, requireModule, app.requirePermission('community.post.moderate')],
    schema: { params: idParams },
  }, controller.removeComment);

  app.put('/admin/community/settings', {
    preHandler: [app.authenticate, requireModule, app.requirePermission('community.settings.update')],
    schema: {
      body: { type: 'object', additionalProperties: false, required: ['auto_hide_report_threshold', 'reason'], properties: {
        // Type only: the range is the service's rule.
        auto_hide_report_threshold: { type: 'number' },
        reason: { type: 'string', minLength: 10, maxLength: 500 },
      } },
    },
  }, controller.updateSettings);

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
