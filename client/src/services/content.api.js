/**
 * content.api.js — Client API service for Editor Portal (Banners, Stories, Reels, Academy, What's New, Help Center, Translations).
 */

import { api } from '../core/api.js';

// Stories & Editorial Articles
export async function listStories(params = {}) {
  return api.get('/content/stories', { query: params });
}

export async function getStoryDetail(idOrSlug) {
  return api.get(`/content/stories/${idOrSlug}`);
}

export async function createStory(payload) {
  return api.post('/content/stories', payload);
}

export async function upsertStory(payload) {
  return api.post('/editor/stories', payload);
}

export async function deleteStory(id) {
  return api.delete(`/editor/stories/${id}`);
}

export async function reviewStory(id, action, notes = '') {
  return api.post(`/content/stories/${id}/review`, { action, notes });
}

// Shoppable Video Reels
export async function listReels(params = {}) {
  return api.get('/content/reels', { query: params });
}

export async function createReel(payload) {
  return api.post('/content/reels', payload);
}

export async function deleteReel(id) {
  return api.delete(`/editor/reels/${id}`);
}

export async function likeReel(id) {
  return api.post(`/content/reels/${id}/like`, {});
}

// Seller & Buyer Academy
export async function listAcademyCourses(params = {}) {
  return api.get('/academy/courses', { query: params });
}

export async function getAcademyCourseDetail(idOrRef) {
  return api.get(`/academy/courses/${idOrRef}`);
}

export async function upsertCourse(payload) {
  return api.post('/editor/courses', payload);
}

export async function deleteCourse(id) {
  return api.delete(`/editor/courses/${id}`);
}

export async function markLessonCompleted(courseId, lessonId) {
  return api.post(`/academy/courses/${courseId}/lessons/${lessonId}/complete`, {});
}

// Banners & Promotional Strips
export async function listBanners(slot = null) {
  return api.get('/content/banners', { query: slot ? { slot } : {} });
}

export async function upsertBanner(payload) {
  return api.post('/editor/banners', payload);
}

export async function deleteBanner(id) {
  return api.delete(`/editor/banners/${id}`);
}

// What's New / Product Release Notes
export async function listWhatsNew(params = {}) {
  return api.get('/content/whats-new', { query: params });
}

export async function upsertWhatsNew(payload) {
  return api.post('/editor/whats-new', payload);
}

export async function deleteWhatsNew(id) {
  return api.delete(`/editor/whats-new/${id}`);
}

// Help Centre / Knowledge Base & FAQs
export async function listHelpArticles(params = {}) {
  return api.get('/content/help-center', { query: params });
}

export async function upsertHelpArticle(payload) {
  return api.post('/editor/help-center', payload);
}

export async function deleteHelpArticle(id) {
  return api.delete(`/editor/help-center/${id}`);
}

// Translations & Localization
export async function listTranslationCompleteness() {
  return api.get('/editor/translations/completeness');
}

export async function getTranslationsForLocale(locale) {
  return api.get(`/editor/translations/${locale}`);
}

export async function upsertTranslationKey(payload) {
  return api.post('/editor/translations', payload);
}

export async function exportTranslationsJson(locale) {
  return api.get(`/editor/translations/${locale}/export`);
}

export async function importTranslationsJson(locale, translations) {
  return api.post(`/editor/translations/${locale}/import`, { translations });
}

export const contentApi = {
  listStories,
  getStoryDetail,
  createStory,
  upsertStory,
  deleteStory,
  reviewStory,
  listReels,
  createReel,
  deleteReel,
  likeReel,
  listAcademyCourses,
  getAcademyCourseDetail,
  upsertCourse,
  deleteCourse,
  markLessonCompleted,
  listBanners,
  upsertBanner,
  deleteBanner,
  listWhatsNew,
  upsertWhatsNew,
  deleteWhatsNew,
  listHelpArticles,
  upsertHelpArticle,
  deleteHelpArticle,
  listTranslationCompleteness,
  getTranslationsForLocale,
  upsertTranslationKey,
  exportTranslationsJson,
  importTranslationsJson,
};
