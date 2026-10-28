/**
 * content.api.ts — Client API service for Editor Portal (Banners, Stories, Reels, Academy, What's New, Help Center, Translations).
 */

import { api } from '../core/api.ts';

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, any>;

// Stories & Editorial Articles
export async function listStories(params: Params = {}) {
  return api.get('/content/stories', { query: params });
}

export async function getStoryDetail(idOrSlug: number | string) {
  return api.get(`/content/stories/${idOrSlug}`);
}

export async function createStory(payload: Params) {
  return api.post('/content/stories', payload);
}

export async function upsertStory(payload: Params) {
  return api.post('/editor/stories', payload);
}

export async function deleteStory(id: number | string) {
  return api.delete(`/editor/stories/${id}`);
}

export async function reviewStory(id: number | string, action: string, notes = '') {
  return api.post(`/content/stories/${id}/review`, { action, notes });
}

// Shoppable Video Reels
export async function listReels(params: Params = {}) {
  return api.get('/content/reels', { query: params });
}

export async function createReel(payload: Params) {
  return api.post('/content/reels', payload);
}

export async function deleteReel(id: number | string) {
  return api.delete(`/editor/reels/${id}`);
}

export async function likeReel(id: number | string) {
  return api.post(`/content/reels/${id}/like`, {});
}

// Shop Partner & Buyer Academy
export async function listAcademyCourses(params: Params = {}) {
  return api.get('/academy/courses', { query: params });
}

export async function getAcademyCourseDetail(idOrRef: number | string) {
  return api.get(`/academy/courses/${idOrRef}`);
}

export async function upsertCourse(payload: Params) {
  return api.post('/editor/courses', payload);
}

export async function deleteCourse(id: number | string) {
  return api.delete(`/editor/courses/${id}`);
}

export async function markLessonCompleted(courseId: number | string, lessonId: number | string) {
  return api.post(`/academy/courses/${courseId}/lessons/${lessonId}/complete`, {});
}

// Banners & Promotional Strips
export async function listBanners(slot: string | null = null) {
  return api.get('/content/banners', { query: slot ? { slot } : {} });
}

export async function upsertBanner(payload: Params) {
  return api.post('/editor/banners', payload);
}

export async function deleteBanner(id: number | string) {
  return api.delete(`/editor/banners/${id}`);
}

// What's New / Product Release Notes
export async function listWhatsNew(params: Params = {}) {
  return api.get('/content/whats-new', { query: params });
}

export async function upsertWhatsNew(payload: Params) {
  return api.post('/editor/whats-new', payload);
}

export async function deleteWhatsNew(id: number | string) {
  return api.delete(`/editor/whats-new/${id}`);
}

// Help Centre / Knowledge Base & FAQs
export async function listHelpArticles(params: Params = {}) {
  return api.get('/content/help-center', { query: params });
}

export async function upsertHelpArticle(payload: Params) {
  return api.post('/editor/help-center', payload);
}

export async function deleteHelpArticle(id: number | string) {
  return api.delete(`/editor/help-center/${id}`);
}

// Translations & Localization
export async function listTranslationCompleteness() {
  return api.get('/editor/translations/completeness');
}

export async function getTranslationsForLocale(locale: string) {
  return api.get(`/editor/translations/${locale}`);
}

export async function upsertTranslationKey(payload: Params) {
  return api.post('/editor/translations', payload);
}

export async function exportTranslationsJson(locale: string) {
  return api.get(`/editor/translations/${locale}/export`);
}

export async function importTranslationsJson(locale: string, translations: Record<string, string>) {
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
