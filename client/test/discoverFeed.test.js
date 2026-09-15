/**
 * discoverFeed.test.js — Invariants for the /discover surface (Discovery feed, module
 * `discovery_feed`): the full-screen, one-product-at-a-time personalized feed.
 *
 * Suites:
 *   1. Locale integrity — en/bn parity for the `discover` block, no double-rendered emoji, and
 *      every `discover.*` key the page and feed component render actually exists.
 *   2. Event-weight parity — the mock handler's ranking weights match the server service's, so the
 *      "algorithm" behaves the same in preview and in production.
 *   3. Filter ⇄ URL round trip — the page keeps all filter/search state in the query string, so a
 *      filtered feed is shareable and back-button-safe (mirrors filtersFromUrl/setUrlParam).
 *   4. Mock feed contract — the in-memory handler filters (AND-composed), ranks engaged categories
 *      up, and paginates with a correct has_more / next_offset.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import discoveryHandlers from '../src/mocks/handlers/discovery.js';

const localeDir = path.resolve(import.meta.dirname, '../src/locales');
const readLocale = (lang) => JSON.parse(fs.readFileSync(path.join(localeDir, `${lang}.json`), 'utf8'));

// Recursively collect leaf key paths ("page.title", "cta.add_to_cart", ...) of an object.
function leafPaths(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leafPaths(v, p));
    else out.push(p);
  }
  return out;
}

test('Discover — Locale Integrity', async (t) => {
  const en = readLocale('en');
  const bn = readLocale('bn');

  await t.test('1. The discover block exists in both locales', () => {
    assert.ok(en.discover, 'en.discover present');
    assert.ok(bn.discover, 'bn.discover present');
    assert.ok(en.nav?.discover, 'en.nav.discover (topbar label) present');
    assert.ok(bn.nav?.discover, 'bn.nav.discover present');
  });

  await t.test('2. en/bn key parity across the whole discover block', () => {
    const enKeys = leafPaths(en.discover).sort();
    const bnKeys = leafPaths(bn.discover).sort();
    assert.deepEqual(enKeys, bnKeys, 'every English discover key has a Bangla counterpart');
    assert.ok(enKeys.length > 15, 'the surface renders many strings, not a handful');
  });

  await t.test('3. No emoji baked into dictionary values (the UI supplies its own icons)', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const [lang, dict] of [['en', en], ['bn', bn]]) {
      for (const key of leafPaths(dict.discover)) {
        const value = key.split('.').reduce((o, k) => o[k], dict.discover);
        assert.ok(!emoji.test(value), `${lang}.discover.${key} must not embed an emoji: ${value}`);
      }
    }
  });

  await t.test('4. Every discover.* key the page and feed render exists in the dictionary', () => {
    const sources = [
      '../src/pages/DiscoverFeedPage.js',
      '../src/components/product/ProductFeed.js',
    ].map((rel) => fs.readFileSync(path.resolve(import.meta.dirname, rel), 'utf8')).join('\n');

    const used = new Set();
    for (const m of sources.matchAll(/'discover\.([a-z0-9_.]+)'/g)) used.add(m[1]);
    assert.ok(used.size > 10, 'sanity: found the keys the page uses');

    const has = (dict, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), dict.discover) != null;
    const missing = [...used].filter((k) => !has(en, k));
    assert.deepEqual(missing, [], `discover keys used in source but absent from en.json: ${missing.join(', ')}`);
  });

  await t.test('5. Interpolated strings keep their {{placeholders}} in both locales', () => {
    // e.g. discover.reviews "{{count}} reviews", discover.saler.margin "{{pct}}% margin".
    const pairs = [['reviews', 'count'], ['saler.margin', 'pct'], ['supplier.ships_from', 'name']];
    for (const [dotted, token] of pairs) {
      for (const [lang, dict] of [['en', en], ['bn', bn]]) {
        const val = dotted.split('.').reduce((o, k) => o[k], dict.discover);
        assert.match(val, new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`), `${lang}.discover.${dotted} must keep {{${token}}}`);
      }
    }
  });
});

test('Discover — Event Weight Parity (mock ⇄ server)', async (t) => {
  // The recency-ranking "algorithm" only feels consistent if a CLICK is worth the same in the
  // preview mock as it is on the server. Parse both sources and demand identical weight tables.
  const parseWeights = (src, marker) => {
    const start = src.indexOf(marker);
    const block = src.slice(start, src.indexOf('}', start));
    const out = {};
    for (const m of block.matchAll(/([A-Z_]+):\s*([\d.]+)/g)) out[m[1]] = Number(m[2]);
    return out;
  };

  const mockSrc = fs.readFileSync(path.resolve(import.meta.dirname, '../src/mocks/handlers/discovery.js'), 'utf8');
  const serverSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../server/src/services/discoveryFeed.service.js'),
    'utf8'
  );

  const mockWeights = parseWeights(mockSrc, 'EVENT_WEIGHTS = {');
  const serverWeights = parseWeights(serverSrc, 'EVENT_WEIGHTS = {');

  await t.test('1. Both define the same six event types with the same weights', () => {
    assert.deepEqual(mockWeights, serverWeights);
    assert.deepEqual(Object.keys(mockWeights).sort(), ['ADD_CART', 'CLICK', 'DWELL', 'PURCHASE', 'VIEW', 'WISHLIST']);
  });

  await t.test('2. A purchase outweighs a passive view (the ordering premise)', () => {
    assert.ok(mockWeights.PURCHASE > mockWeights.VIEW);
    assert.ok(mockWeights.ADD_CART > mockWeights.CLICK);
  });
});

test('Discover — Filter State ⇄ URL Round Trip', async (t) => {
  // Mirrors filtersFromUrl() / setUrlParam() in DiscoverFeedPage.js: default/"all" values are
  // omitted so a clean feed has a clean URL, and everything else survives a reload.
  const setUrlParam = (params, key, value) => {
    if (value == null || value === '' || value === 'all') params.delete(key);
    else params.set(key, value);
  };

  const filtersFromUrl = (qs) => {
    const sp = new URLSearchParams(qs);
    const f = {};
    if (sp.get('q')) f.q = sp.get('q');
    const category = sp.get('category');
    if (category && category !== 'all') f.category = category;
    if (sp.get('min_price')) f.min_price = sp.get('min_price');
    if (sp.get('max_price')) f.max_price = sp.get('max_price');
    if (sp.get('in_stock') === '1') f.in_stock = '1';
    const tiers = sp.getAll('tier');
    if (tiers.length) f.supplier_tier = tiers.join(',');
    if (sp.get('district')) f.district = sp.get('district');
    if (sp.get('min_rating')) f.min_rating = sp.get('min_rating');
    if (sp.get('min_margin')) f.min_margin = sp.get('min_margin');
    return f;
  };

  await t.test('1. The default view carries no filters and a clean URL', () => {
    const sp = new URLSearchParams();
    setUrlParam(sp, 'category', 'all'); // selecting "All" clears rather than sets
    assert.equal(sp.toString(), '');
    assert.deepEqual(filtersFromUrl(''), {});
  });

  await t.test('2. A search term survives a reload', () => {
    const sp = new URLSearchParams();
    setUrlParam(sp, 'q', 'watch');
    assert.deepEqual(filtersFromUrl(sp.toString()), { q: 'watch' });
  });

  await t.test('3. A composite filter round-trips exactly', () => {
    const sp = new URLSearchParams('category=Electronics&min_price=500&in_stock=1&min_rating=4');
    assert.deepEqual(filtersFromUrl(sp.toString()), {
      category: 'Electronics',
      min_price: '500',
      in_stock: '1',
      min_rating: '4',
    });
  });

  await t.test('4. Bangla search terms and spaces survive encoding', () => {
    const sp = new URLSearchParams();
    setUrlParam(sp, 'q', 'হাতঘড়ি সেট');
    assert.deepEqual(filtersFromUrl(sp.toString()), { q: 'হাতঘড়ি সেট' });
  });

  await t.test('5. Multiple supplier tiers collapse to a comma list', () => {
    const sp = new URLSearchParams();
    sp.append('tier', 'verified');
    sp.append('tier', 'elite');
    assert.deepEqual(filtersFromUrl(sp.toString()), { supplier_tier: 'verified,elite' });
  });
});

test('Discover — Mock Feed Contract', async (t) => {
  const feed = discoveryHandlers.find((h) => h.method === 'GET' && h.path === '/discovery/feed');
  const events = discoveryHandlers.find((h) => h.method === 'POST' && h.path === '/discovery/events');
  const call = (query = {}) => feed.handler({ query });

  await t.test('1. Shape matches the live contract', () => {
    const res = call({});
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data.products));
    for (const k of ['count', 'has_more', 'next_offset', 'personalized']) {
      assert.ok(k in res.body.meta, `meta.${k} present`);
    }
  });

  await t.test('2. Category filter narrows to that category only', () => {
    const res = call({ category: 'Electronics', limit: 100 });
    assert.ok(res.body.data.products.length > 0, 'fixture has electronics');
    assert.ok(res.body.data.products.every((p) => p.category === 'Electronics'));
  });

  await t.test('3. Search and price filters compose (AND, not OR)', () => {
    const all = call({ limit: 100 }).body.meta.total;
    const priced = call({ max_price: '1000', limit: 100 });
    assert.ok(priced.body.data.products.every((p) => Number(p.price) <= 1000));
    assert.ok(priced.body.meta.total <= all, 'a price ceiling never grows the result set');

    const inStock = call({ in_stock: '1', limit: 100 });
    assert.ok(inStock.body.data.products.every((p) => Number(p.stock) > 0));
  });

  await t.test('4. Pagination reports has_more and a matching next_offset', () => {
    const first = call({ limit: 5, offset: 0 });
    assert.equal(first.body.data.products.length, 5);
    assert.equal(first.body.meta.has_more, true);
    assert.equal(first.body.meta.next_offset, 5);

    // Walking next_offset must not repeat products already seen on the first page.
    const second = call({ limit: 5, offset: first.body.meta.next_offset });
    const firstRefs = new Set(first.body.data.products.map((p) => p.ref));
    assert.ok(second.body.data.products.every((p) => !firstRefs.has(p.ref)), 'pages do not overlap');
  });

  await t.test('5. Recording events personalizes the feed toward the engaged category', () => {
    // Baseline: nothing engaged yet, so the feed is not marked personalized.
    assert.equal(call({}).body.meta.personalized, false);

    // Engage hard with one category, then it should rank near the top and the flag flips.
    const target = 'Jewellery';
    events.handler({ body: { events: [
      { event_type: 'PURCHASE', category: target },
      { event_type: 'ADD_CART', category: target },
      { event_type: 'WISHLIST', category: target },
    ] } });

    const res = call({ limit: 60 });
    assert.equal(res.body.meta.personalized, true, 'the personalized flag flips after engagement');
    const topCats = res.body.data.products.slice(0, 5).map((p) => p.category);
    assert.ok(topCats.includes(target), `an engaged category (${target}) is boosted into the top slots`);
  });
});
