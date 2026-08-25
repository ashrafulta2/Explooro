/**
 * content.controller.js — Fastify controller for Stories, Reels, Academy, Banners & Translations (Prompt 10.8).
 */

import * as service from '../services/content.service.js';

// -----------------------------------------------------------------------------
// Stories
// -----------------------------------------------------------------------------

export async function listStories(req, reply) {
  const { status, author_id, limit, offset } = req.query || {};
  const data = await service.listStories(req.server.db, {
    status: status || 'PUBLISHED',
    authorId: author_id ? Number(author_id) : null,
    limit: limit ? Number(limit) : 20,
    offset: offset ? Number(offset) : 0,
  });
  return reply.send({ success: true, data });
}

export async function getStoryDetail(req, reply) {
  const { idOrSlug } = req.params;
  const data = await service.getStoryBySlugOrId(req.server.db, idOrSlug);
  return reply.send({ success: true, data });
}

export async function createStory(req, reply) {
  const body = req.body || {};
  const data = await service.createStory(req.server.db, {
    authorId: req.user.id,
    authorRole: req.user.role || 'saler',
    titleEn: body.title_en,
    titleBn: body.title_bn,
    contentEn: body.content_en,
    contentBn: body.content_bn,
    coverImageUrl: body.cover_image_url,
    embeddedProductIds: body.embedded_product_ids || [],
    autoPublish: req.user.role === 'admin' || req.user.role === 'editor',
  });
  return reply.status(201).send({ success: true, data });
}

export async function reviewStory(req, reply) {
  const { id } = req.params;
  const body = req.body || {};
  const data = await service.reviewStory(req.server.db, {
    storyId: Number(id),
    editorId: req.user.id,
    action: body.action || 'PUBLISH',
    notes: body.notes || '',
  });
  return reply.send({ success: true, data });
}

// -----------------------------------------------------------------------------
// Shoppable Reels
// -----------------------------------------------------------------------------

export async function listReels(req, reply) {
  const { limit, offset } = req.query || {};
  const data = await service.listReels(req.server.db, {
    limit: limit ? Number(limit) : 20,
    offset: offset ? Number(offset) : 0,
  });
  return reply.send({ success: true, data });
}

export async function createReel(req, reply) {
  const body = req.body || {};
  const data = await service.createReel(req.server.db, {
    authorId: req.user.id,
    videoUrl: body.video_url,
    thumbnailUrl: body.thumbnail_url,
    durationSeconds: body.duration_seconds || 15,
    captionEn: body.caption_en,
    captionBn: body.caption_bn,
    pinnedProductId: body.pinned_product_id ? Number(body.pinned_product_id) : null,
  });
  return reply.status(201).send({ success: true, data });
}

export async function likeReel(req, reply) {
  const { id } = req.params;
  const data = await service.likeReel(req.server.db, Number(id));
  return reply.send({ success: true, data });
}

// -----------------------------------------------------------------------------
// Seller Academy
// -----------------------------------------------------------------------------

export async function listAcademyCourses(req, reply) {
  const { role, category } = req.query || {};
  const userId = req.user?.id || null;
  const data = await service.listCourses(req.server.db, {
    role,
    category,
    userId,
  });
  return reply.send({ success: true, data });
}

export async function getAcademyCourseDetail(req, reply) {
  const { idOrRef } = req.params;
  const userId = req.user?.id || null;
  const data = await service.getCourseDetail(req.server.db, idOrRef, userId);
  return reply.send({ success: true, data });
}

export async function markLessonCompleted(req, reply) {
  const { id, lessonId } = req.params;
  const data = await service.markLessonCompleted(req.server.db, {
    userId: req.user.id,
    courseId: Number(id),
    lessonId: Number(lessonId),
  });
  return reply.send({ success: true, data });
}

// -----------------------------------------------------------------------------
// Banners (Live Zero-Deploy)
// -----------------------------------------------------------------------------

export async function listBanners(req, reply) {
  const { slot } = req.query || {};
  const data = await service.listBanners(req.server.db, {
    slot,
    activeOnly: req.user?.role !== 'admin' && req.user?.role !== 'editor',
  });
  return reply.send({ success: true, data });
}

export async function upsertBanner(req, reply) {
  const body = req.body || {};
  const data = await service.upsertBanner(req.server.db, {
    id: body.id ? Number(body.id) : null,
    slot: body.slot || 'HOMEPAGE_HERO',
    titleEn: body.title_en,
    titleBn: body.title_bn,
    imageUrlDesktop: body.image_url_desktop,
    imageUrlMobile: body.image_url_mobile,
    targetLink: body.target_link,
    displayOrder: body.display_order || 0,
    isActive: body.is_active !== undefined ? body.is_active : true,
    editorId: req.user.id,
  });
  return reply.send({ success: true, data });
}

export async function deleteBanner(req, reply) {
  const { id } = req.params;
  const data = await service.deleteBanner(req.server.db, {
    bannerId: Number(id),
    editorId: req.user.id,
  });
  return reply.send({ success: true, data });
}

// -----------------------------------------------------------------------------
// Translations (Live Multi-Locale)
// -----------------------------------------------------------------------------

export async function getTranslationsForLocale(req, reply) {
  const { locale } = req.params;
  const data = await service.getTranslationsForLocale(req.server.db, locale);
  return reply.send({ success: true, data });
}

export async function upsertTranslationKey(req, reply) {
  const body = req.body || {};
  const data = await service.upsertTranslationKey(req.server.db, {
    namespace: body.namespace || 'common',
    key: body.key,
    locale: body.locale,
    value: body.value,
    editorId: req.user.id,
  });
  return reply.send({ success: true, data });
}

export async function listTranslationCompleteness(req, reply) {
  const data = await service.listTranslationCompleteness(req.server.db);
  return reply.send({ success: true, data });
}

export async function exportTranslationsJson(req, reply) {
  const { locale } = req.params;
  const data = await service.exportTranslationsJson(req.server.db, locale);
  return reply.send({ success: true, data });
}

export async function importTranslationsJson(req, reply) {
  const { locale } = req.params;
  const body = req.body || {};
  const data = await service.importTranslationsJson(req.server.db, {
    locale,
    data: body.translations || body,
    editorId: req.user.id,
  });
  return reply.send({ success: true, data });
}
