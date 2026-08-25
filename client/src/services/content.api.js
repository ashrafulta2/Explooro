/**
 * content.api.js — Client API service for Stories, Shoppable Reels, Academy, Banners & Translations (Prompt 10.8).
 */

import { api } from '../core/api.js';

// Stories
export async function listStories(params = {}) {
  return api.get('/content/stories', { query: params });
}

export async function getStoryDetail(idOrSlug) {
  return api.get(`/content/stories/${idOrSlug}`);
}

export async function createStory(payload) {
  return api.post('/content/stories', payload);
}

export async function reviewStory(id, action, notes = '') {
  return api.post(`/content/stories/${id}/review`, { action, notes });
}

// Reels
export async function listReels(params = {}) {
  return api.get('/content/reels', { query: params });
}

export async function createReel(payload) {
  return api.post('/content/reels', payload);
}

export async function likeReel(id) {
  return api.post(`/content/reels/${id}/like`, {});
}

// Academy
export async function listAcademyCourses(params = {}) {
  return api.get('/academy/courses', { query: params });
}

export async function getAcademyCourseDetail(idOrRef) {
  return api.get(`/academy/courses/${idOrRef}`);
}

export async function markLessonCompleted(courseId, lessonId) {
  return api.post(`/academy/courses/${courseId}/lessons/${lessonId}/complete`, {});
}

// Banners
export async function listBanners(slot = null) {
  return api.get('/content/banners', { query: slot ? { slot } : {} });
}

export async function upsertBanner(payload) {
  return api.post('/editor/banners', payload);
}

export async function deleteBanner(id) {
  return api.delete(`/editor/banners/${id}`);
}

// Translations
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
