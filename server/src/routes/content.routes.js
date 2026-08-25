/**
 * content.routes.js — Fastify Route Registrations for Content Commerce, Reels, Academy, Banners & Translations (Prompt 10.8).
 */

import * as controller from '../controllers/content.controller.js';

export default async function contentRoutes(fastify) {
  const requireContentModule = fastify.requireModule ? fastify.requireModule('content_commerce') : async () => {};
  const requireAcademyModule = fastify.requireModule ? fastify.requireModule('seller_academy') : async () => {};

  // ---------------------------------------------------------------------------
  // PUBLIC CONTENT COMMERCE & STORIES
  // ---------------------------------------------------------------------------
  fastify.get('/content/stories', { preHandler: [requireContentModule] }, controller.listStories);
  fastify.get('/content/stories/:idOrSlug', { preHandler: [requireContentModule] }, controller.getStoryDetail);

  fastify.post('/content/stories', {
    preHandler: [requireContentModule, fastify.authenticate],
  }, controller.createStory);

  fastify.post('/content/stories/:id/review', {
    preHandler: [requireContentModule, fastify.authenticate],
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
    preHandler: [fastify.authenticate],
  }, controller.upsertBanner);

  fastify.delete('/editor/banners/:id', {
    preHandler: [fastify.authenticate],
  }, controller.deleteBanner);

  // ---------------------------------------------------------------------------
  // DYNAMIC TRANSLATION MANAGER (ZERO-DEPLOY MULTI-LOCALE)
  // ---------------------------------------------------------------------------
  fastify.get('/editor/translations/completeness', {
    preHandler: [fastify.authenticate],
  }, controller.listTranslationCompleteness);

  fastify.get('/editor/translations/:locale', {
    preHandler: [fastify.authenticate],
  }, controller.getTranslationsForLocale);

  fastify.post('/editor/translations', {
    preHandler: [fastify.authenticate],
  }, controller.upsertTranslationKey);

  fastify.get('/editor/translations/:locale/export', {
    preHandler: [fastify.authenticate],
  }, controller.exportTranslationsJson);

  fastify.post('/editor/translations/:locale/import', {
    preHandler: [fastify.authenticate],
  }, controller.importTranslationsJson);
}
