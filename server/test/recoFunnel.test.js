/**
 * recoFunnel.test.js — Phase F: knowing which surface works (migration 060: the `source` tag).
 *
 *   1. Tag        — the server keeps a well-formed surface name and drops anything else WITHOUT dropping
 *                   the event it rode on; the tag reaches the INSERT.
 *   2. Migration  — the column is nullable, shape-checked, and indexed only where it is set.
 *   3. Funnel     — impressions, clicks and attributed carts/purchases per surface; ratios are null (not
 *                   0) when there is nothing to divide by; windows are bounded.
 *   4. SQL        — what the read counts and what it deliberately does not.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as feed from '../src/services/discoveryFeed.service.js';
import * as funnel from '../src/services/recoFunnel.service.js';
import * as funnelRepo from '../src/repositories/recoFunnel.repository.js';

const migration = fs.readFileSync(path.resolve(import.meta.dirname, '../src/db/migrations/060_recommendation_cache_metrics.sql'), 'utf8');

function makeDb(routes = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      for (const r of routes) if (r.match(flat)) return r.reply(flat, params);
      return { rows: [] };
    },
  };
}

// ── 1. The tag ──────────────────────────────────────────────────────────────────────────────────
describe('Surface tag — normalizeSource', () => {
  test('keeps rail, feed, grid and search names', () => {
    for (const ok of ['rail:trending', 'rail:also_viewed', 'feed', 'grid', 'search', 'product_page']) {
      assert.equal(feed.normalizeSource(ok), ok);
    }
  });

  test('trims and lowercases', () => {
    assert.equal(feed.normalizeSource('  Rail:Trending '), 'rail:trending');
  });

  test('anything malformed is null: spaces, digits first, a second colon, empty, too long, not a string', () => {
    for (const bad of ['rail trending', '1grid', 'rail:a:b', 'rail:', ':x', '', '   ', 'x'.repeat(41), 42, null, undefined, {}, ['grid'], "grid'; DROP TABLE x;--"]) {
      assert.equal(feed.normalizeSource(bad), null, JSON.stringify(bad));
    }
  });

  test('exactly 40 characters is allowed, 41 is not', () => {
    assert.equal(feed.normalizeSource('a'.repeat(40)), 'a'.repeat(40));
    assert.equal(feed.normalizeSource('a'.repeat(41)), null);
  });

  test('the server accepts exactly the shape the migration enforces', () => {
    const sqlPattern = new RegExp(/source ~ '([^']+)'/.exec(migration)[1]);
    for (const s of ['rail:trending', 'feed', 'grid', 'a_b:c_d', 'a'.repeat(40)]) {
      assert.equal(sqlPattern.test(s) && s.length <= 40, feed.normalizeSource(s) === s, s);
    }
    for (const s of ['1a', 'a:b:c', 'a b', 'a:', 'a-b']) {
      assert.equal(sqlPattern.test(s), false, s);
      assert.equal(feed.normalizeSource(s), null, s);
    }
  });
});

describe('Surface tag — recordEvents', () => {
  const inserted = async (events) => {
    const db = makeDb();
    const res = await feed.recordEvents(db, { userId: 7, audience: 'customer', events });
    return { res, call: db.calls.find((c) => c.sql.startsWith('INSERT INTO product_interaction_events')) };
  };

  test('the tag is the tenth bound value of each row and is selected into the table', async () => {
    const { call } = await inserted([
      { event_type: 'CLICK', product_id: 11, source: 'rail:trending' },
      { event_type: 'VIEW', product_id: 12, source: 'grid' },
    ]);
    assert.equal(call.params.length, 20);
    assert.equal(call.params[9], 'rail:trending');
    assert.equal(call.params[19], 'grid');
    assert.match(call.sql, /v\.audience, v\.source FROM \(VALUES/);
    assert.match(call.sql, /\$10::text/);
  });

  test('an untagged event stores NULL', async () => {
    const { call } = await inserted([{ event_type: 'CLICK', product_id: 11 }]);
    assert.equal(call.params[9], null);
  });

  test('a malformed tag costs the label, never the event', async () => {
    const { res, call } = await inserted([
      { event_type: 'CLICK', product_id: 11, source: 'DROP TABLE; --' },
      { event_type: 'CLICK', product_id: 12, source: 'rail:trending' },
    ]);
    assert.equal(call.params[9], null);
    assert.equal(call.params[19], 'rail:trending');
    assert.equal(res.recorded, 2);
  });
});

// ── 2. Migration ────────────────────────────────────────────────────────────────────────────────
describe('Surface tag — migration 060', () => {
  test('the column is nullable and added once', () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS source TEXT;/);
    assert.doesNotMatch(migration, /source TEXT NOT NULL/);
  });

  test('the shape is checked in the database too, and NULL is allowed', () => {
    assert.match(migration, /CHECK \(source IS NULL OR \(char_length\(source\) <= 40 AND source ~ /);
  });

  test('the index only covers tagged rows, so the untagged majority never pays for it', () => {
    assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_pie_source_created[\s\S]*?\(source, created_at DESC\)\s*WHERE source IS NOT NULL;/);
  });

  test('re-running cannot stamp tuned cache numbers back to the defaults', () => {
    assert.match(migration, /'recommendation\.cache'[\s\S]*?ON CONFLICT \(key\) DO NOTHING/);
  });
});

// ── 3. The funnel ───────────────────────────────────────────────────────────────────────────────
describe('Funnel — service', () => {
  const dbWith = (rows) => makeDb([{ match: (s) => s.includes('WITH tagged'), reply: () => ({ rows }) }]);

  test('rates are fractions, per impression for ctr and per click for the rest', async () => {
    const db = dbWith([{ source: 'rail:trending', impressions: 200, clicks: 20, actors: 15, add_carts: 5, purchases: 2 }]);
    const { surfaces } = await funnel.getFunnel(db);
    assert.deepEqual(surfaces[0], {
      source: 'rail:trending', impressions: 200, clicks: 20, add_carts: 5, purchases: 2, actors: 15,
      ctr: 0.1, cart_rate: 0.25, purchase_rate: 0.1,
    });
  });

  test('nothing to divide by is null, not a 0% performer', async () => {
    const { surfaces } = await funnel.getFunnel(dbWith([{ source: 'grid', impressions: 0, clicks: 0, actors: 0, add_carts: 0, purchases: 0 }]));
    assert.equal(surfaces[0].ctr, null);
    assert.equal(surfaces[0].cart_rate, null);
    assert.equal(surfaces[0].purchase_rate, null);
  });

  test('numbers arriving as strings (bigint columns) are coerced', async () => {
    const { surfaces } = await funnel.getFunnel(dbWith([{ source: 'feed', impressions: '40', clicks: '4', actors: '3', add_carts: '1', purchases: '0' }]));
    assert.equal(surfaces[0].ctr, 0.1);
    assert.equal(surfaces[0].purchase_rate, 0);
  });

  test('no tagged events is an empty list, not an error', async () => {
    assert.deepEqual((await funnel.getFunnel(dbWith([]))).surfaces, []);
  });

  test('the windows are bounded: a bad value falls back, an in-range one is kept', async () => {
    const win = async (opts) => (await funnel.getFunnel(dbWith([]), opts)).window;
    assert.deepEqual(await win({}), { days: 7, attribution_days: 7 });
    assert.deepEqual(await win({ days: 30, attributionDays: 14 }), { days: 30, attribution_days: 14 });
    assert.deepEqual(await win({ days: 9999, attributionDays: 0 }), { days: 7, attribution_days: 7 });
    assert.deepEqual(await win({ days: 'lots', attributionDays: null }), { days: 7, attribution_days: 7 });
    assert.deepEqual(await win({ days: '30' }), { days: 30, attribution_days: 7 }, 'CLI arguments arrive as strings');
  });

  test('only the two audiences exist', async () => {
    const db = dbWith([]);
    await funnel.getFunnel(db, { audience: 'saler' });
    await funnel.getFunnel(db, { audience: "x'; --" });
    assert.deepEqual(db.calls.map((c) => c.params[0]), ['saler', 'customer']);
  });
});

// ── 4. The SQL ──────────────────────────────────────────────────────────────────────────────────
describe('Funnel — SQL', () => {
  const sqlOf = async () => {
    const db = makeDb();
    await funnelRepo.getFunnelBySource(db, { audience: 'customer', days: 7, attributionDays: 7 });
    return db.calls[0];
  };

  test('only tagged events of one audience inside the window are read', async () => {
    const { sql, params } = await sqlOf();
    assert.match(sql, /WHERE source IS NOT NULL AND audience = \$1 AND created_at > now\(\) - \(\$2::int \* interval '1 day'\)/);
    assert.deepEqual(params, ['customer', 7, 7]);
  });

  test('an impression is a VIEW and a click is a CLICK or SEARCH_CLICK, nothing else', async () => {
    const { sql } = await sqlOf();
    assert.match(sql, /COUNT\(\*\) FILTER \(WHERE t\.event_type = 'VIEW'\)::int AS impressions/);
    assert.match(sql, /FILTER \(WHERE t\.event_type IN \('CLICK', 'SEARCH_CLICK'\)\)::int AS clicks/);
  });

  test('carts and purchases are attributed to a click: same shopper, same product, after it, inside the window', async () => {
    const { sql } = await sqlOf();
    const exists = sql.split('SELECT 1 FROM product_interaction_events c').slice(1);
    assert.equal(exists.length, 2, 'one attribution lookup for carts, one for purchases');
    for (const [i, type] of ['ADD_CART', 'PURCHASE'].entries()) {
      const part = exists[i];
      assert.match(part, new RegExp(`c\.event_type = '${type}'`));
      assert.match(part, /c\.product_id = t\.product_id/);
      assert.match(part, /c\.created_at >= t\.created_at/);
      assert.match(part, /c\.created_at < t\.created_at \+ \(\$3::int \* interval '1 day'\)/);
    }
    assert.match(sql, /CASE WHEN t\.user_id IS NOT NULL THEN c\.user_id = t\.user_id ELSE c\.session_id = t\.session_id END/);
  });

  test('a shopper is a user id, else a guest session: the two never collide', async () => {
    const { sql } = await sqlOf();
    assert.match(sql, /'u' \|\| user_id::text ELSE 's' \|\| session_id/);
  });

  test('conversions are counted only for clicks, so an unclicked impression can never "convert"', async () => {
    const { sql } = await sqlOf();
    const carts = sql.slice(sql.indexOf('AS add_carts') - 700, sql.indexOf('AS add_carts'));
    assert.match(carts, /t\.event_type IN \('CLICK', 'SEARCH_CLICK'\) AND EXISTS/);
  });
});
