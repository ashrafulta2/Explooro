/**
 * whatsNewReleaseNotes.test.js — the What's New editor and the popup share one table.
 *
 * The defect this guards: the editor posted to /editor/whats-new, which had no server route, and the
 * popup read `release_notes`, which nothing wrote. Every user saw the same note forever. These tests
 * publish through the editor service and read back through the popup service.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as contentService from '../src/services/content.service.ts';
import * as notifService from '../src/services/notification.service.ts';
import { HIGHLIGHT_LIMITS as MOCK_HIGHLIGHT_LIMITS } from '../../client/src/mocks/releaseNotes.js';

// Just enough of `release_notes` / `user_release_views` / `audit_logs` to run the two services.
function createReleaseDb() {
  const notes = [];
  const views = [];
  const audits = [];
  let nextId = 1;
  let clock = Date.parse('2026-10-01T00:00:00Z');

  async function query(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('INSERT INTO release_notes')) {
      const [version_tag, category, target_audience, title_en, title_bn, summary_en, summary_bn, , created_by] = [
        params[0], params[1], params[2], params[3], params[4], params[5], params[6], null, params[7],
      ];
      if (notes.some((n) => n.version_tag === version_tag)) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      clock += 60_000;
      const row = {
        id: nextId++, version_tag, category, target_audience, title_en, title_bn, summary_en, summary_bn,
        highlights_json: JSON.parse(params[8]), published_at: new Date(clock), created_by,
      };
      notes.push(row);
      return { rows: [{ ...row }] };
    }
    if (q.startsWith('UPDATE release_notes')) {
      const row = notes.find((n) => n.id === params[7]);
      if (notes.some((n) => n.id !== params[7] && n.version_tag === params[0])) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      Object.assign(row, {
        version_tag: params[0], category: params[1], target_audience: params[2],
        title_en: params[3], title_bn: params[4], summary_en: params[5], summary_bn: params[6],
      });
      if (params[8] !== null) row.highlights_json = JSON.parse(params[8]);
      return { rows: [{ ...row }] };
    }
    if (q.startsWith('DELETE FROM release_notes')) {
      const i = notes.findIndex((n) => n.id === params[0]);
      return { rows: i === -1 ? [] : notes.splice(i, 1) };
    }
    if (q.startsWith('SELECT * FROM release_notes WHERE id = $1')) {
      return { rows: notes.filter((n) => n.id === params[0]).map((n) => ({ ...n })) };
    }
    if (q.startsWith('SELECT COUNT(*)::int AS total FROM release_notes')) {
      return { rows: [{ total: notes.length }] };
    }
    if (q.startsWith('SELECT * FROM release_notes ORDER BY')) {
      const sorted = [...notes].sort((a, b) => b.published_at - a.published_at || b.id - a.id);
      return { rows: sorted.slice(params[1], params[1] + params[0]) };
    }
    if (q.includes('FROM release_notes r')) {
      const audiences = params[0];
      const match = notes
        .filter((n) => audiences.includes(n.target_audience))
        .sort((a, b) => b.published_at - a.published_at || b.id - a.id);
      return { rows: match.slice(0, 1) };
    }
    if (q.includes('FROM user_release_views')) {
      return { rows: views.filter((v) => v.user_id === params[0] && v.version_tag === params[1]) };
    }
    if (q.startsWith('INSERT INTO user_release_views')) {
      views.push({ user_id: params[0], version_tag: params[1] });
      return { rows: [] };
    }
    if (q.includes('audit_logs')) {
      audits.push({ sql: q, params });
      return { rows: [{ id: audits.length }] };
    }
    return { rows: [] };
  }

  const db = { query, async connect() { return { query, release() {} }; } };
  return { db, notes, audits };
}

function publish(db, overrides = {}) {
  return contentService.upsertReleaseNote(db, {
    versionTag: 'v2.5.0',
    category: 'FEATURE',
    targetAudience: 'ALL',
    titleEn: 'Faster checkout',
    titleBn: 'দ্রুত চেকআউট',
    summaryEn: 'Checkout now takes one step.',
    summaryBn: 'চেকআউট এখন এক ধাপে।',
    editorId: 7,
    ...overrides,
  });
}

describe("What's New — editor publishes, popup shows it", () => {
  test('a note published in the editor is what the popup returns', async () => {
    const { db } = createReleaseDb();
    assert.equal(await notifService.getLatestReleaseNotes(db, 1, 'customer'), null);

    const saved = await publish(db);
    assert.equal(saved.version, 'v2.5.0', 'editor pages read `version`');

    const shown = await notifService.getLatestReleaseNotes(db, 1, 'customer');
    assert.equal(shown.version_tag, 'v2.5.0');
    assert.equal(shown.title_en, 'Faster checkout');
  });

  test('a newer release replaces the old one, even after the old one was acknowledged', async () => {
    const { db } = createReleaseDb();
    await publish(db);
    await notifService.markReleaseViewed(db, 1, 'v2.5.0');
    assert.equal(await notifService.getLatestReleaseNotes(db, 1, 'customer'), null, 'acked note stays closed');

    await publish(db, { versionTag: 'v2.6.0', titleEn: 'Live shopping' });
    const shown = await notifService.getLatestReleaseNotes(db, 1, 'customer');
    assert.equal(shown.version_tag, 'v2.6.0');
    assert.equal(shown.title_en, 'Live shopping');
  });

  test('editing a note changes what the popup shows', async () => {
    const { db } = createReleaseDb();
    const saved = await publish(db);
    await contentService.upsertReleaseNote(db, {
      id: saved.id, versionTag: 'v2.5.0', titleEn: 'Faster checkout (fixed)', summaryEn: 'Edited.', editorId: 7,
    });
    const shown = await notifService.getLatestReleaseNotes(db, 1, 'customer');
    assert.equal(shown.title_en, 'Faster checkout (fixed)');
    assert.equal(shown.title_bn, 'Faster checkout (fixed)', 'blank Bangla falls back to English');
  });

  test('audience: a suppliers-only note reaches suppliers but does not hide the ALL note from others', async () => {
    const { db } = createReleaseDb();
    await publish(db, { versionTag: 'v2.5.0', targetAudience: 'ALL' });
    await publish(db, { versionTag: 'v2.5.1', targetAudience: 'SUPPLIERS', titleEn: 'Warehouse desk' });

    assert.equal((await notifService.getLatestReleaseNotes(db, 2, 'supplier')).version_tag, 'v2.5.1');
    assert.equal((await notifService.getLatestReleaseNotes(db, 1, 'customer')).version_tag, 'v2.5.0');
    assert.equal((await notifService.getLatestReleaseNotes(db, 3, 'saler')).version_tag, 'v2.5.0');
  });

  test('a version tag can only be published once', async () => {
    const { db } = createReleaseDb();
    await publish(db);
    await assert.rejects(publish(db), (err) => err.code === 'CONFLICT');
  });

  test('bad input is refused, not stored', async () => {
    const { db, notes } = createReleaseDb();
    await assert.rejects(publish(db, { versionTag: '' }), (err) => err.code === 'VALIDATION_FAILED');
    await assert.rejects(publish(db, { category: 'MARKETING' }), (err) => err.code === 'VALIDATION_FAILED');
    await assert.rejects(publish(db, { targetAudience: 'EVERYONE' }), (err) => err.code === 'VALIDATION_FAILED');
    assert.equal(notes.length, 0);
  });

  test('create, update and delete each write an audit row', async () => {
    const { db, audits } = createReleaseDb();
    const saved = await publish(db);
    await contentService.upsertReleaseNote(db, { id: saved.id, versionTag: 'v2.5.0', titleEn: 'X', summaryEn: 'Y', editorId: 7 });
    await contentService.deleteReleaseNote(db, { noteId: saved.id, editorId: 7 });
    const actions = audits.flatMap((a) => a.params).filter((p) => typeof p === 'string' && p.startsWith('release_note.'));
    assert.deepEqual(actions, ['release_note.create', 'release_note.update', 'release_note.delete']);
    assert.equal(await notifService.getLatestReleaseNotes(db, 1, 'customer'), null, 'deleted note is gone from the popup');
  });

  test('list is paginated and newest first', async () => {
    const { db } = createReleaseDb();
    await publish(db, { versionTag: 'v1' });
    await publish(db, { versionTag: 'v2' });
    await publish(db, { versionTag: 'v3' });
    const page = await contentService.listReleaseNotes(db, { limit: 2, offset: 0 });
    assert.equal(page.total, 3);
    assert.deepEqual(page.items.map((n) => n.version), ['v3', 'v2']);
  });
});

describe("What's New — highlight cards", () => {
  const card = { icon: '💳', title_en: 'bKash', desc_en: 'Pay with bKash.' };

  test('highlights published in the editor reach the popup, Bangla falling back to English', async () => {
    const { db } = createReleaseDb();
    await publish(db, { highlights: [card] });
    const shown = await notifService.getLatestReleaseNotes(db, 1, 'customer');
    assert.deepEqual(shown.highlights_json, [
      { icon: '💳', title_en: 'bKash', title_bn: 'bKash', desc_en: 'Pay with bKash.', desc_bn: 'Pay with bKash.' },
    ]);
  });

  test('an edit that does not send highlights keeps them; an empty list clears them', async () => {
    const { db } = createReleaseDb();
    const saved = await publish(db, { highlights: [card] });
    const base = { id: saved.id, versionTag: 'v2.5.0', titleEn: 'T', summaryEn: 'S', editorId: 7 };
    await contentService.upsertReleaseNote(db, base);
    assert.equal((await notifService.getLatestReleaseNotes(db, 1, 'customer')).highlights_json.length, 1);
    await contentService.upsertReleaseNote(db, { ...base, highlights: [] });
    assert.equal((await notifService.getLatestReleaseNotes(db, 1, 'customer')).highlights_json.length, 0);
  });

  test('bad highlight cards are refused', () => {
    const { maxItems, iconMax, titleMax, descMax } = contentService.HIGHLIGHT_LIMITS;
    const bad = [
      'not a list',
      Array.from({ length: maxItems + 1 }, () => card),
      [{ ...card, title_en: '' }],
      [{ ...card, desc_en: '' }],
      [{ ...card, icon: 'x'.repeat(iconMax + 1) }],
      [{ ...card, title_en: 'x'.repeat(titleMax + 1) }],
      [{ ...card, desc_en: 'x'.repeat(descMax + 1) }],
    ];
    for (const input of bad) {
      assert.throws(() => contentService.sanitizeHighlights(input), (err) => err.code === 'VALIDATION_FAILED');
    }
  });

  test('the mock store uses the same limits as the server', () => {
    assert.deepEqual(MOCK_HIGHLIGHT_LIMITS, contentService.HIGHLIGHT_LIMITS);
  });
});
