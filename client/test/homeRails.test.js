/**
 * homeRails.test.js — Invariants for the home page rails (personalized feed, Phase C).
 *
 *   1. Locale integrity — every rail the server can return has a title and a subtitle in both
 *      languages (a missing key renders a humanized slug, which no test would otherwise notice).
 *   2. Mock contract   — GET /discovery/rails mirrors services/homeRails.service.js: no product in
 *                        two rails, thin rails dropped, opt-out removes the personal rails, and the
 *                        mock shopper's own clicks surface a "continue browsing" row.
 *   3. Wiring guards   — the home page mounts the rails and hides them while a filter is active; the
 *                        rail stylesheet ships with its component only (a second import from main.css
 *                        would put it in the entry bundle AND a route chunk).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import discoveryHandlers from '../src/mocks/handlers/discovery.js';

const src = path.resolve(import.meta.dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(src, rel), 'utf8');
const locale = (lang) => JSON.parse(read(`locales/${lang}.json`));

const railsHandler = discoveryHandlers.find((h) => h.method === 'GET' && h.path === '/discovery/rails');
const eventsHandler = discoveryHandlers.find((h) => h.method === 'POST' && h.path === '/discovery/events');
const call = (query = {}) => railsHandler.handler({ query }).body;

// The rail keys the server can return: migration 057's seed, plus the rail 059 (Phase E) adds to it.
const SERVER_RAIL_KEYS = ['057_home_rails_settings', '059_covisitation'].flatMap((name) =>
  [...read(`../../server/src/db/migrations/${name}.sql`).matchAll(/"key":\s*"([a-z_]+)"/g)].map((m) => m[1])
);

// ── 1. Locale integrity ─────────────────────────────────────────────────────────────────────────
test('the server seeds the rails this client knows how to name', () => {
  assert.deepEqual(SERVER_RAIL_KEYS, ['continue_browsing', 'for_you', 'trending', 'bestsellers', 'new_arrivals', 'near_you', 'also_viewed']);
});

for (const lang of ['en', 'bn']) {
  test(`${lang}: every rail has a title and a subtitle, and for_you has its popular wording`, () => {
    const rails = locale(lang).discover.rails;
    for (const key of [...SERVER_RAIL_KEYS, 'for_you_popular']) {
      assert.ok(rails[`${key}_title`]?.trim(), `${key}_title`);
      assert.ok(rails[`${key}_sub`]?.trim(), `${key}_sub`);
    }
    assert.ok(rails.manage?.trim(), 'manage');
  });
}

test('en and bn carry exactly the same discover.rails keys', () => {
  assert.deepEqual(Object.keys(locale('en').discover.rails).sort(), Object.keys(locale('bn').discover.rails).sort());
});

test('every discover.rails key the components read exists', () => {
  const used = new Set();
  for (const file of ['components/product/PersonalizedRails.js']) {
    for (const m of read(file).matchAll(/discover\.rails\.([a-z_]+)/g)) used.add(m[1]);
  }
  const en = locale('en').discover.rails;
  for (const k of used) assert.ok(k in en, k);
});

// ── 2. Mock contract ────────────────────────────────────────────────────────────────────────────
test('the mock answers with the live envelope', () => {
  const body = call();
  assert.ok(Array.isArray(body.data.rails));
  assert.equal(body.meta.count, body.data.rails.length);
  for (const r of body.data.rails) {
    assert.ok(SERVER_RAIL_KEYS.includes(r.key), r.key);
    assert.equal(typeof r.personalized, 'boolean');
    assert.ok(r.products.length >= 4, `${r.key} is under the minimum`);
  }
});

test('a product appears in at most one rail', () => {
  const ids = call().data.rails.flatMap((r) => r.products.map((p) => p.ref));
  assert.equal(new Set(ids).size, ids.length);
});

test('no category fills a rail: at most 3 of one category in any 6 consecutive cards', () => {
  for (const r of call().data.rails) {
    for (let i = 0; i + 6 <= r.products.length; i++) {
      const counts = new Map();
      for (const p of r.products.slice(i, i + 6)) counts.set(p.category, (counts.get(p.category) || 0) + 1);
      assert.ok(Math.max(...counts.values()) <= 3, `${r.key} window at ${i}`);
    }
  }
});

test('only in-stock products are offered', () => {
  for (const r of call().data.rails) for (const p of r.products) assert.ok(Number(p.stock) > 0, p.ref);
});

test('a cold shopper gets a non-personal for_you rail', () => {
  const forYou = call().data.rails.find((r) => r.key === 'for_you');
  assert.ok(forYou);
  assert.equal(forYou.personalized, false);
});

test('clicking products surfaces continue_browsing first, and opting out removes it', () => {
  const refs = call().data.rails[0].products.slice(0, 5).map((p) => p.ref);
  eventsHandler.handler({
    body: {
      events: refs.map((ref, i) => ({ event_type: 'CLICK', ref, category: i % 2 ? 'Clothing' : 'Electronics' })),
    },
  });

  const warm = call().data.rails;
  assert.equal(warm[0].key, 'continue_browsing');
  assert.equal(warm[0].personalized, true);
  assert.deepEqual(warm[0].products.map((p) => p.ref).sort(), [...refs].sort());
  assert.equal(warm.find((r) => r.key === 'for_you')?.personalized, true);

  const optedOut = call({ personalize: '0' }).data.rails;
  assert.equal(optedOut.some((r) => r.key === 'continue_browsing'), false);
  assert.equal(optedOut.some((r) => r.personalized), false, 'no personal rail for an opted-out shopper');
});

// ── 3. Wiring guards ────────────────────────────────────────────────────────────────────────────
test('the home page mounts the rails above the catalog and hides them while narrowing', () => {
  const home = read('pages/HomePage.js');
  assert.match(home, /PersonalizedRails\(/);
  assert.match(home, /railsView\.setVisible\(show\)/);
  // Every param that narrows the catalog hides the rails.
  for (const param of ['q', 'sort', 'min_price', 'max_price', 'in_stock', 'tier', 'district', 'min_rating', 'min_margin']) {
    assert.match(home, new RegExp(`'${param}'`), param);
  }
  assert.match(home, /activeFeed !== 'all' \|\| activeCategory !== 'all'/);
  assert.match(home, /isFeatureEnabled\('discovery_feed'\)/);
  // The flash strip must stay above the rails.
  assert.match(home, /railsView\?\.el\.parentNode === page \? railsView\.el : catalogSection/);
});

test('product-rail.css is imported by its component only', () => {
  assert.match(read('components/product/ProductRail.js'), /styles\/components\/product-rail\.css/);
  assert.doesNotMatch(read('styles/main.css'), /product-rail\.css/);
});

test('the rails fetch honours the opt-out switch the feed uses', () => {
  const api = read('services/discovery.api.js');
  const body = api.slice(api.indexOf('export async function getRails'));
  assert.match(body, /isPersonalizationOff\(\)/);
  assert.match(body, /personalize = '0'/);
  assert.match(body, /\/discovery\/rails/);
});

test('the rail component is registered in the dev gallery', () => {
  assert.match(read('pages/dev/gallery-registry.js'), /id: 'product-rail'/);
});
