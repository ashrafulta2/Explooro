/**
 * content.routes.ts — Fastify Route Registrations for Content Commerce, Reels, Academy, Banners & Translations (Prompt 10.8).
 */

import * as controller from '../controllers/content.controller.ts';
import { AppError } from '../plugins/errorHandler.ts';

export default async function contentRoutes(fastify) {
  const requireContentModule = fastify.requireModule ? fastify.requireModule('content_commerce') : async () => {};
  const requireAcademyModule = fastify.requireModule ? fastify.requireModule('seller_academy') : async () => {};
  const requireI18nModule = fastify.requireModule ? fastify.requireModule('i18n') : async () => {};
  // WHY fail closed: these guards were missing entirely, so any signed-in customer could publish a
  // homepage banner, overwrite live translations or approve a story. If the permission plugin is
  // ever absent the editor endpoints must refuse rather than fall open like the module guards do.
  const requirePerm = (perm) => (fastify.requirePermission
    ? fastify.requirePermission(perm)
    : async () => {
      throw new AppError('PERMISSION_DENIED', 'You do not have permission to do this.', 'এই কাজের অনুমতি আপনার নেই।');
    });

  // ---------------------------------------------------------------------------
  // PUBLIC CONTENT COMMERCE & STORIES
  // ---------------------------------------------------------------------------
  fastify.get('/content/stories', { preHandler: [requireContentModule] }, controller.listStories);
  fastify.get('/content/stories/:idOrSlug', { preHandler: [requireContentModule] }, controller.getStoryDetail);

  fastify.post('/content/stories', {
    preHandler: [requireContentModule, fastify.authenticate],
  }, controller.createStory);

  fastify.post('/content/stories/:id/review', {
    preHandler: [requireContentModule, fastify.authenticate, requirePerm('content.story.curate')],
  }, controller.reviewStory);

  // ---------------------------------------------------------------------------
  // SHOPPABLE REELS
  // ---------------------------------------------------------------------------
  fastify.get('/content/reels', { preHandler: [requireContentModule] }, controller.listReels);
  fastify.post('/content/reels', {
    preHandler: [requireContentModule, fastify.authenticate],
  }, controller.createReel);
  fastify.post('/content/reels/:id/like', { preHandler: [requireContentModule] }, controller.likeReel);

  // ---------------------------------------------------------------------------
  // SELLER ACADEMY
  // ---------------------------------------------------------------------------
  fastify.get('/academy/courses', {
    preHandler: [requireAcademyModule, fastify.authenticateOptional || (async () => {})],
  }, controller.listAcademyCourses);

  fastify.get('/academy/courses/:idOrRef', {
    preHandler: [requireAcademyModule, fastify.authenticateOptional || (async () => {})],
  }, controller.getAcademyCourseDetail);

  fastify.post('/academy/courses/:id/lessons/:lessonId/complete', {
    preHandler: [requireAcademyModule, fastify.authenticate],
  }, controller.markLessonCompleted);

  // ---------------------------------------------------------------------------
  // HOMEPAGE BANNERS (PUBLIC & EDITOR)
  // ---------------------------------------------------------------------------
  fastify.get('/content/banners', controller.listBanners);

  fastify.post('/editor/banners', {
    preHandler: [fastify.authenticate, requirePerm('content.banner.publish')],
  }, controller.upsertBanner);

  fastify.delete('/editor/banners/:id', {
    preHandler: [fastify.authenticate, requirePerm('content.banner.publish')],
  }, controller.deleteBanner);

  // ---------------------------------------------------------------------------
  // WHAT'S NEW RELEASE NOTES (EDITOR) — the popup reads the same table via
  // GET /notifications/whats-new. Shared by /editor/whats-new and /admin/content/whats-new, so no
  // `config.page` guard (see requirePage.ts: a two-page endpoint stays visibility-only).
  // ---------------------------------------------------------------------------
  const requireWhatsNewModule = fastify.requireModule ? fastify.requireModule('whats_new') : async () => {};

  fastify.get('/content/whats-new', {
    preHandler: [fastify.authenticate, requireWhatsNewModule, requirePerm('content.announcement.publish')],
  }, controller.listReleaseNotes);

  fastify.post('/editor/whats-new', {
    preHandler: [fastify.authenticate, requireWhatsNewModule, requirePerm('content.announcement.publish')],
  }, controller.upsertReleaseNote);

  fastify.delete('/editor/whats-new/:id', {
    preHandler: [fastify.authenticate, requireWhatsNewModule, requirePerm('content.announcement.publish')],
  }, controller.deleteReleaseNote);

  // ---------------------------------------------------------------------------
  // DYNAMIC TRANSLATION MANAGER (ZERO-DEPLOY MULTI-LOCALE)
  // ---------------------------------------------------------------------------
  fastify.get('/editor/translations/completeness', {
    preHandler: [fastify.authenticate, requireI18nModule, requirePerm('content.i18n.update')],
  }, controller.listTranslationCompleteness);

  fastify.get('/editor/translations/:locale', {
    preHandler: [fastify.authenticate, requireI18nModule, requirePerm('content.i18n.update')],
  }, controller.getTranslationsForLocale);

  fastify.post('/editor/translations', {
    preHandler: [fastify.authenticate, requireI18nModule, requirePerm('content.i18n.update')],
  }, controller.upsertTranslationKey);

  fastify.get('/editor/translations/:locale/export', {
    preHandler: [fastify.authenticate, requireI18nModule, requirePerm('content.i18n.update')],
  }, controller.exportTranslationsJson);

  fastify.post('/editor/translations/:locale/import', {
    preHandler: [fastify.authenticate, requireI18nModule, requirePerm('content.i18n.update')],
  }, controller.importTranslationsJson);
}
