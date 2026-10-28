/**
 * whatsNewMock.test.js — in mock mode the What's New popup shows what the editor published.
 *
 * The defect: the popup handler answered from a constant and the editor wrote a separate array, so
 * every user saw the same v2.4 note forever. Both handlers now share mocks/releaseNotes.ts.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { contentHandlers } from '../src/mocks/handlers/content.js';
import { notificationHandlers } from '../src/mocks/handlers/notifications.ts';
import { resetReleaseNotesForTests, latestReleaseFor, markReleaseViewed } from '../src/mocks/releaseNotes.ts';

function handler(list, method, path) {
  const entry = list.find((h) => h.method === method && h.path === path);
  if (!entry) throw new Error(`Handler not found: ${method} ${path}`);
  return (ctx = {}) => entry.handler(ctx);
}

const publish = handler(contentHandlers, 'POST', '/editor/whats-new');
const remove = handler(contentHandlers, 'DELETE', '/editor/whats-new/:id');
const popup = handler(notificationHandlers, 'GET', '/notifications/whats-new');
const ack = handler(notificationHandlers, 'POST', '/notifications/whats-new/ack');

const note = (body) => publish({
  body: { version: 'v9.0.0', title_en: 'Faster checkout', summary_en: 'One step.', category: 'FEATURE', target_audience: 'ALL', ...body },
});

describe("What's New mock — editor and popup share one store", () => {
  beforeEach(() => resetReleaseNotesForTests());

  it('the popup shows the note an editor just published', () => {
    const res = note();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.version, 'v9.0.0');

    const shown = popup().body.data.releaseNote;
    assert.equal(shown.version_tag, 'v9.0.0');
    assert.equal(shown.title_en, 'Faster checkout');
    assert.equal(shown.title_bn, 'Faster checkout', 'blank Bangla falls back to English, as on the server');
  });

  it('closing the popup hides that version, and the next release shows again', () => {
    note();
    ack({ body: { version_tag: 'v9.0.0' } });
    assert.equal(popup().body.data.releaseNote, null);

    note({ version: 'v9.1.0', title_en: 'Live shopping' });
    assert.equal(popup().body.data.releaseNote.version_tag, 'v9.1.0');
  });

  it('editing a note changes what the popup shows', () => {
    const { id } = note().body.data;
    publish({ body: { id, version: 'v9.0.0', title_en: 'Faster checkout (fixed)', summary_en: 'Edited.' } });
    assert.equal(popup().body.data.releaseNote.title_en, 'Faster checkout (fixed)');
  });

  it('deleting the newest note falls back to the one before it', () => {
    const { id } = note().body.data;
    remove({ params: { id: String(id) } });
    assert.equal(popup().body.data.releaseNote.version_tag, 'v2.4.0');
  });

  it('a suppliers-only note reaches suppliers but does not hide the ALL note from customers', () => {
    note({ version: 'v9.0.0' });
    note({ version: 'v9.0.1', target_audience: 'SUPPLIERS' });
    assert.equal(latestReleaseFor({ userId: 1, role: 'supplier' }).version_tag, 'v9.0.1');
    assert.equal(latestReleaseFor({ userId: 2, role: 'customer' }).version_tag, 'v9.0.0');
  });

  it('acks are per user', () => {
    note();
    markReleaseViewed({ userId: 1, versionTag: 'v9.0.0' });
    assert.equal(latestReleaseFor({ userId: 1, role: 'customer' }), null);
    assert.equal(latestReleaseFor({ userId: 2, role: 'customer' }).version_tag, 'v9.0.0');
  });

  it('highlight cards reach the popup; an edit without them keeps them; bad cards are refused', () => {
    const card = { icon: '💳', title_en: 'bKash', desc_en: 'Pay with bKash.' };
    const { id } = note({ highlights_json: [card] }).body.data;
    assert.deepEqual(popup().body.data.releaseNote.highlights_json, [
      { icon: '💳', title_en: 'bKash', title_bn: 'bKash', desc_en: 'Pay with bKash.', desc_bn: 'Pay with bKash.' },
    ]);

    publish({ body: { id, version: 'v9.0.0', title_en: 'T', summary_en: 'S' } });
    assert.equal(popup().body.data.releaseNote.highlights_json.length, 1);

    assert.equal(note({ version: 'v9.2', highlights_json: [{ ...card, desc_en: '' }] }).status, 400);
    assert.equal(note({ version: 'v9.3', highlights_json: Array.from({ length: 7 }, () => card) }).status, 400);
  });

  it('refuses a duplicate version and bad input, like the live API', () => {
    note();
    assert.equal(note().status, 409);
    assert.equal(note({ version: '' }).status, 400);
    assert.equal(note({ version: 'v9.9', category: 'MARKETING' }).status, 400);
    assert.equal(note({ version: 'v9.9', target_audience: 'EVERYONE' }).status, 400);
  });
});
