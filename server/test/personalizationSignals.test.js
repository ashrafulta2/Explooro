/**
 * personalizationSignals.test.js — Invariants for Phase A of the personalized home feed
 * (site-wide behavioural signal capture, migration 055).
 *
 *   1. Capture policy   — the personalization_signals module gates writes AND the read side.
 *   2. Event vocabulary — the new intent signals are accepted and weighted above plain browsing.
 *   3. Dwell threshold  — sub-threshold glances are dropped server-side, not just client-side.
 *   4. recordSearch     — validation, actor scoping, normalization.
 *   5. SEARCH_CLICK     — closes the loop on the search that produced it.
 *   6. Zero-result report and the search_events migration shape.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as svc from '../src/services/discoveryFeed.service.js';

// A mock db: `module` is the personalization_signals row (null = row missing → defaults apply).
function makeDb({ module = undefined } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: text, params });
      if (text.includes("FROM platform_modules WHERE key = 'personalization_signals'")) {
        return { rows: module === undefined ? [] : module === null ? [] : [module] };
      }
      return { rows: [] };
    },
    inserts(table) {
      return calls.filter((c) => c.sql.startsWith(`INSERT INTO ${table}`));
    },
  };
}

const policyRow = (over = {}, enabled = true) => ({
  is_enabled: enabled,
  settings_json: { track_guests: true, min_dwell_ms: 1200, ...over },
});

describe('Signals — capture policy', () => {
  test('a missing module row falls back to recording (partial dev DB must not lose data)', async () => {
    const policy = await svc.resolveCapturePolicy(makeDb());
    assert.deepEqual(policy, { enabled: true, trackGuests: true, minDwellMs: 1200 });
  });

  test('reads the admin-tunable knobs off the module row', async () => {
    const policy = await svc.resolveCapturePolicy(makeDb({ module: policyRow({ track_guests: false, min_dwell_ms: 3000 }) }));
    assert.deepEqual(policy, { enabled: true, trackGuests: false, minDwellMs: 3000 });
  });

  test('module switched off: events are not written', async () => {
    const db = makeDb({ module: policyRow({}, false) });
    const res = await svc.recordEvents(db, { userId: 1, events: [{ event_type: 'VIEW', product_id: 5 }] });
    assert.equal(res.recorded, 0);
    assert.equal(res.skipped, 'capture_disabled');
    assert.equal(db.inserts('product_interaction_events').length, 0);
  });

  test('track_guests off: guests are not recorded but signed-in users still are', async () => {
    const db = makeDb({ module: policyRow({ track_guests: false }) });
    const guest = await svc.recordEvents(db, { sessionId: 's1', events: [{ event_type: 'VIEW', product_id: 5 }] });
    assert.equal(guest.skipped, 'guest_tracking_disabled');
    const user = await svc.recordEvents(db, { userId: 9, events: [{ event_type: 'VIEW', product_id: 5 }] });
    assert.equal(user.recorded, 1);
  });

  test('module off degrades the feed to popularity: no affinity query is issued', async () => {
    const db = makeDb({ module: policyRow({}, false) });
    const res = await svc.getFeed(db, { userId: 1 });
    assert.equal(res.meta.personalized, false);
    assert.equal(db.calls.filter((c) => c.sql.includes('product_interaction_events e')).length, 0);
  });
});

describe('Signals — event vocabulary and weights', () => {
  test('SEARCH_CLICK, SHARE and FOLLOW_STORE are accepted', async () => {
    const db = makeDb();
    const res = await svc.recordEvents(db, {
      userId: 1,
      events: ['SEARCH_CLICK', 'SHARE', 'FOLLOW_STORE'].map((event_type) => ({ event_type, product_id: 4 })),
    });
    assert.equal(res.recorded, 3);
  });

  test('a query-driven click outweighs a browse click; a purchase outweighs everything', async () => {
    const db = makeDb();
    await svc.recordEvents(db, {
      userId: 1,
      events: ['CLICK', 'SEARCH_CLICK', 'PURCHASE'].map((event_type) => ({ event_type, product_id: 4 })),
    });
    const params = db.inserts('product_interaction_events')[0].params;
    const weights = [params[7], params[17], params[27]]; // 10 params per row, weight at offset 7
    assert.ok(weights[1] > weights[0], 'SEARCH_CLICK > CLICK');
    assert.ok(weights[2] > weights[1], 'PURCHASE > SEARCH_CLICK');
  });
});

describe('Signals — dwell threshold', () => {
  test('DWELL below min_dwell_ms is dropped; at or above is kept', async () => {
    const db = makeDb({ module: policyRow({ min_dwell_ms: 1500 }) });
    const res = await svc.recordEvents(db, {
      userId: 1,
      events: [
        { event_type: 'DWELL', product_id: 1, dwell_ms: 900 },
        { event_type: 'DWELL', product_id: 2, dwell_ms: 1500 },
        { event_type: 'VIEW', product_id: 3 },
      ],
    });
    assert.equal(res.recorded, 2);
    const params = db.inserts('product_interaction_events')[0].params;
    assert.deepEqual([params[2], params[12]], [2, 3], 'the 900ms glance (product 1) never reached the INSERT');
  });

  test('a batch of only sub-threshold dwells issues no INSERT at all', async () => {
    const db = makeDb();
    const res = await svc.recordEvents(db, { userId: 1, events: [{ event_type: 'DWELL', product_id: 1, dwell_ms: 10 }] });
    assert.equal(res.recorded, 0);
    assert.equal(db.inserts('product_interaction_events').length, 0);
  });
});

describe('Signals — recordSearch', () => {
  test('normalizes the query for grouping but keeps the raw text verbatim', async () => {
    const db = makeDb();
    await svc.recordSearch(db, { query: '  Red   SHOE ', resultCount: 12, sessionId: 's1' });
    const [ins] = db.inserts('search_events');
    assert.equal(ins.params[2], 'Red   SHOE'); // raw: trimmed only, inner spacing kept
    assert.equal(ins.params[3], 'red shoe');
    assert.equal(ins.params[4], 12);
  });

  test('a signed-in user is stored by user_id, never also by session_id', async () => {
    const db = makeDb();
    await svc.recordSearch(db, { query: 'saree', resultCount: 3, userId: 7, sessionId: 's1' });
    const [ins] = db.inserts('search_events');
    assert.equal(ins.params[0], 7);
    assert.equal(ins.params[1], null);
  });

  test('rejects an empty query and an unattributable actor', async () => {
    await assert.rejects(() => svc.recordSearch(makeDb(), { query: '   ', sessionId: 's1' }), /query/i);
    await assert.rejects(() => svc.recordSearch(makeDb(), { query: 'x' }), /session_id/);
  });

  test('negative or junk result counts are clamped to zero', async () => {
    const db = makeDb();
    await svc.recordSearch(db, { query: 'x', resultCount: -5, sessionId: 's1' });
    await svc.recordSearch(db, { query: 'y', resultCount: 'abc', sessionId: 's1' });
    const rows = db.inserts('search_events');
    assert.equal(rows[0].params[4], 0);
    assert.equal(rows[1].params[4], 0);
  });

  test('respects the capture policy', async () => {
    const db = makeDb({ module: policyRow({}, false) });
    const res = await svc.recordSearch(db, { query: 'x', sessionId: 's1' });
    assert.equal(res.skipped, 'capture_disabled');
    assert.equal(db.inserts('search_events').length, 0);
  });

  test('over-long queries are truncated, not rejected', async () => {
    const db = makeDb();
    await svc.recordSearch(db, { query: 'a'.repeat(500), sessionId: 's1' });
    assert.equal(db.inserts('search_events')[0].params[2].length, 200);
  });
});

describe('Signals — SEARCH_CLICK closes the loop', () => {
  test('a SEARCH_CLICK carrying its query stamps clicked_product_id on that search', async () => {
    const db = makeDb();
    await svc.recordEvents(db, {
      sessionId: 's1',
      events: [{ event_type: 'SEARCH_CLICK', product_id: 42, category_id: 3, query: ' Red  Shoe' }],
    });
    const upd = db.calls.find((c) => c.sql.startsWith('UPDATE search_events'));
    assert.ok(upd, 'an UPDATE on search_events was issued');
    assert.ok(upd.params.includes('red shoe'), 'matched on the normalized query');
    assert.ok(upd.params.includes(42));
    assert.match(upd.sql, /clicked_product_id IS NULL/, 'only an unclicked search can be credited');
    assert.match(upd.sql, /30 minutes/, 'a stale search cannot absorb a later click');
  });

  test('a plain CLICK never touches search_events', async () => {
    const db = makeDb();
    await svc.recordEvents(db, { sessionId: 's1', events: [{ event_type: 'CLICK', product_id: 42, query: 'red shoe' }] });
    assert.equal(db.calls.some((c) => c.sql.startsWith('UPDATE search_events')), false);
  });

  test('a failing search_events update does not lose the interaction event', async () => {
    const db = makeDb();
    const orig = db.query.bind(db);
    db.query = async (sql, params) => {
      if (sql.includes('UPDATE search_events')) throw new Error('relation does not exist');
      return orig(sql, params);
    };
    const res = await svc.recordEvents(db, {
      sessionId: 's1',
      events: [{ event_type: 'SEARCH_CLICK', product_id: 42, query: 'red shoe' }],
    });
    assert.equal(res.recorded, 1);
  });
});

describe('Signals — zero-result report', () => {
  test('clamps days and limit before they reach SQL', async () => {
    const db = makeDb();
    await svc.getZeroResultQueries(db, { days: 99999, limit: 99999 });
    const q = db.calls.find((c) => c.sql.includes('FROM search_events'));
    assert.deepEqual(q.params, [365, 200]);
    assert.match(q.sql, /result_count = 0/);
  });
});

describe('Signals — migration 055 shape', () => {
  const sql = fs.readFileSync(path.resolve(import.meta.dirname, '../src/db/migrations/055_personalization_signals.sql'), 'utf8');

  test('search_events requires an actor and a valid audience', () => {
    assert.match(sql, /user_id IS NOT NULL OR session_id IS NOT NULL/);
    assert.match(sql, /audience IN \('customer', 'saler'\)/);
  });

  test('the module row is seeded in modules.seed.json too (both seed paths must agree)', () => {
    const seed = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/config/modules.seed.json'), 'utf8'));
    const list = Array.isArray(seed) ? seed : seed.modules;
    assert.ok(list.some((m) => m.key === 'personalization_signals'));
  });
});
