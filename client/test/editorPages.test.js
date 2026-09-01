/**
 * editorPages.test.js — Automated Unit Tests for Editor Portal suite.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contentHandlers } from '../src/mocks/handlers/content.js';
import { navItems } from '../src/config/navigation.js';

describe('Editor Portal — Navigation & Routes Invariants', () => {
  it('1. All 7 editor navigation items are registered with valid paths and roles', () => {
    const editorNavs = navItems.filter((item) => item.roles?.includes('editor'));
    const expectedPaths = [
      '/editor',
      '/editor/banners',
      '/editor/stories',
      '/editor/academy',
      '/editor/whats-new',
      '/editor/help-center',
      '/editor/translations',
    ];

    expectedPaths.forEach((path) => {
      const found = editorNavs.some((item) => item.path === path);
      assert.ok(found, `Expected nav item with path: ${path}`);
    });
  });
});

describe('Editor Portal — Content Handlers & CRUD Integrity', () => {
  function getHandler(method, path) {
    const entry = contentHandlers.find((h) => h.method === method && h.path === path);
    if (!entry) throw new Error(`Handler not found: ${method} ${path}`);
    return (ctx = {}) => {
      const res = entry.handler(ctx);
      if (res && res.status !== undefined && res.body !== undefined) {
        return { status: res.status, ...res.body };
      }
      return res;
    };
  }

  it('2. Banners CRUD: List, Create, Update and Delete', () => {
    const listBanners = getHandler('GET', '/content/banners');
    const upsertBanner = getHandler('POST', '/editor/banners');
    const deleteBanner = getHandler('DELETE', '/editor/banners/:id');

    // List
    const initial = listBanners();
    assert.equal(initial.status, 200);
    assert.ok(Array.isArray(initial.data));
    const initialCount = initial.data.length;

    // Create
    const createRes = upsertBanner({
      body: {
        slot: 'HOMEPAGE_HERO',
        title_en: 'Automated Test Banner',
        title_bn: 'টেস্ট ব্যানার',
        image_url_desktop: 'https://images.unsplash.com/test.jpg',
        target_link: '/stories',
        display_order: 99,
        is_active: true,
      },
    });
    assert.equal(createRes.status, 200);
    assert.equal(createRes.data.title_en, 'Automated Test Banner');
    const createdId = createRes.data.id;

    // Update
    const updateRes = upsertBanner({
      body: {
        id: createdId,
        slot: 'HOMEPAGE_HERO',
        title_en: 'Updated Test Banner',
        title_bn: 'আপডেটেড ব্যানার',
      },
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.data.title_en, 'Updated Test Banner');

    // Delete
    const deleteRes = deleteBanner({ params: { id: String(createdId) } });
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.data.deleted, true);

    // Verify deletion
    const afterDelete = listBanners();
    assert.equal(afterDelete.data.length, initialCount);
  });

  it('3. Stories & Reels: List, Create, and Delete', () => {
    const listStories = getHandler('GET', '/content/stories');
    const createStory = getHandler('POST', '/editor/stories');
    const deleteStory = getHandler('DELETE', '/editor/stories/:id');

    const initial = listStories();
    assert.equal(initial.status, 200);
    const initCount = initial.data.length;

    const created = createStory({
      body: {
        author_name: 'Test Weaver',
        title_en: 'Artisan Story Test',
        title_bn: 'তাঁতি গল্প টেস্ট',
        cover_image_url: 'https://images.unsplash.com/test.jpg',
        content_en: 'Sample story content.',
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.title_en, 'Artisan Story Test');

    const delRes = deleteStory({ params: { id: String(created.data.id) } });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.data.deleted, true);
    assert.equal(listStories().data.length, initCount);
  });

  it('4. Academy Courses: List, Upsert, and Delete', () => {
    const listCourses = getHandler('GET', '/academy/courses');
    const upsertCourse = getHandler('POST', '/editor/courses');
    const deleteCourse = getHandler('DELETE', '/editor/courses/:id');

    const initial = listCourses();
    assert.equal(initial.status, 200);
    const initCount = initial.data.length;

    const created = upsertCourse({
      body: {
        title_en: 'Escrow Mastery 101',
        title_bn: 'এসক্রো পরিচিতি',
        target_role: 'saler',
        category: 'finance',
        difficulty_level: 'BEGINNER',
        estimated_minutes: 15,
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.title_en, 'Escrow Mastery 101');

    const delRes = deleteCourse({ params: { id: String(created.data.id) } });
    assert.equal(delRes.status, 200);
    assert.equal(listCourses().data.length, initCount);
  });

  it('5. What’s New Changelogs: List, Upsert, and Delete', () => {
    const listUpdates = getHandler('GET', '/content/whats-new');
    const upsertUpdate = getHandler('POST', '/editor/whats-new');
    const deleteUpdate = getHandler('DELETE', '/editor/whats-new/:id');

    const initial = listUpdates();
    assert.equal(initial.status, 200);
    const initCount = initial.data.length;

    const created = upsertUpdate({
      body: {
        version: 'v2.5.0',
        title_en: 'Thermal Label Printing',
        category: 'FEATURE',
        target_audience: 'SUPPLIERS',
        summary_en: 'Print courier dispatch barcodes directly.',
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.version, 'v2.5.0');

    const delRes = deleteUpdate({ params: { id: String(created.data.id) } });
    assert.equal(delRes.status, 200);
    assert.equal(listUpdates().data.length, initCount);
  });

  it('6. Help Centre FAQs: List, Upsert, and Delete', () => {
    const listFaqs = getHandler('GET', '/content/help-center');
    const upsertFaq = getHandler('POST', '/editor/help-center');
    const deleteFaq = getHandler('DELETE', '/editor/help-center/:id');

    const initial = listFaqs();
    assert.equal(initial.status, 200);
    const initCount = initial.data.length;

    const created = upsertFaq({
      body: {
        category: 'orders',
        title_en: 'How do I print packing slips?',
        content_en: 'Click Print Packing Slip on the Orders to Pack page.',
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.title_en, 'How do I print packing slips?');

    const delRes = deleteFaq({ params: { id: String(created.data.id) } });
    assert.equal(delRes.status, 200);
    assert.equal(listFaqs().data.length, initCount);
  });

  it('7. Translation Completeness & Export/Import', () => {
    const getCompleteness = getHandler('GET', '/editor/translations/completeness');
    const exportJson = getHandler('GET', '/editor/translations/:locale/export');
    const importJson = getHandler('POST', '/editor/translations/:locale/import');

    const comp = getCompleteness();
    assert.equal(comp.status, 200);
    assert.ok(comp.data.locales.some((l) => l.locale === 'bn'));

    const exported = exportJson({ params: { locale: 'bn' } });
    assert.equal(exported.status, 200);
    assert.ok(typeof exported.data === 'object');

    const imported = importJson({
      params: { locale: 'bn' },
      body: { translations: { automated_test_key: 'স্বয়ংক্রিয় টেস্ট কী' } },
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.locale, 'bn');
    assert.equal(imported.data.imported_keys, 1);
  });
});
