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
 *   5. Draggable pill geometry — the floating "Browse & filter" pill (DiscoverFeedPage.js) clamps
 *      itself inside the feed, distinguishes a tap from a drag, and re-anchors its dropdown under the
 *      moved pill. Mirrors setBarPos()/positionToolbar()/the drag threshold, with a source-parity
 *      guard so the mirror can't silently drift from the component.
 *   6. Keyboard navigation — with the on-screen up/down arrow buttons removed, arrow/page keys drive
 *      the feed (ProductFeed.js onKeydown): they map to a step delta, are ignored while typing in a
 *      field, and the listener is bound at the window (not the feed element) and cleaned up.
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

// Read the page source once; suites 5 pins its own constants from it so the mirror can't drift.
const pageSrc = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/pages/DiscoverFeedPage.js'),
  'utf8'
);
const feedSrc = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/components/product/ProductFeed.js'),
  'utf8'
);

test('Discover — Draggable Pill Geometry', async (t) => {
  // The pill defaults to CSS top-centre and only switches to explicit coordinates once dragged.
  // These mirror the pure geometry inside DiscoverFeedPage.js (setBarPos / positionToolbar / the
  // tap-vs-drag threshold). A parity sub-test asserts the component still contains the same logic.

  // Pull the real constants out of the source so a change there flows into this test automatically.
  const DRAG_THRESHOLD = Number(pageSrc.match(/const DRAG_THRESHOLD = (\d+)/)[1]);
  const DROPDOWN_GUTTER = Number(pageSrc.match(/const DROPDOWN_GUTTER = (\d+)/)[1]);

  const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
  // Mirror of setBarPos(): keep the pill fully inside the feed box.
  const clampBar = (left, top, page, bar) => ({
    left: clamp(left, 0, page.w - bar.w),
    top: clamp(top, 0, page.h - bar.h),
  });
  // Mirror of positionToolbar(): centre the dropdown under the pill, gutter-clamped to the feed.
  const toolbarLeft = (bar, toolbar, pageW) =>
    clamp(bar.left + bar.w / 2 - toolbar.w / 2, DROPDOWN_GUTTER, pageW - toolbar.w - DROPDOWN_GUTTER);
  // Mirror of the onBarPointerMove threshold: a press is a drag only past the threshold on either axis.
  const isDrag = (dx, dy) => Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD;

  await t.test('1. The thresholds are the small, sane pixel values the pill expects', () => {
    assert.equal(DRAG_THRESHOLD, 4);
    assert.equal(DROPDOWN_GUTTER, 8);
  });

  await t.test('2. A tiny press (< threshold on both axes) is a tap, not a drag', () => {
    assert.equal(isDrag(0, 0), false);
    assert.equal(isDrag(3, 3), false, 'just under the threshold stays a tap');
    assert.equal(isDrag(4, 0), true, 'crossing on X alone is a drag');
    assert.equal(isDrag(0, -4), true, 'crossing on Y alone (either direction) is a drag');
  });

  await t.test('3. The pill clamps inside the feed and never escapes an edge', () => {
    const page = { w: 1000, h: 800 };
    const bar = { w: 200, h: 40 };
    // Well inside → unchanged.
    assert.deepEqual(clampBar(300, 100, page, bar), { left: 300, top: 100 });
    // Dragged past the top-left origin → pinned to (0, 0).
    assert.deepEqual(clampBar(-50, -50, page, bar), { left: 0, top: 0 });
    // Dragged past the bottom-right → pinned so the whole pill stays visible.
    assert.deepEqual(clampBar(5000, 5000, page, bar), { left: 800, top: 760 });
  });

  await t.test('4. The dropdown re-anchors centred under the pill, gutter-clamped', () => {
    const pageW = 1000;
    const toolbar = { w: 320 };
    // Pill centred at 500 → dropdown centred there too (500 - 160 = 340).
    assert.equal(toolbarLeft({ left: 400, w: 200 }, toolbar, pageW), 340);
    // Pill dragged hard left → dropdown can't cross the left gutter.
    assert.equal(toolbarLeft({ left: 0, w: 200 }, toolbar, pageW), DROPDOWN_GUTTER);
    // Pill dragged hard right → dropdown can't cross the right gutter.
    assert.equal(toolbarLeft({ left: 900, w: 200 }, toolbar, pageW), pageW - toolbar.w - DROPDOWN_GUTTER);
  });

  await t.test('5. Source parity — DiscoverFeedPage still holds the mirrored logic', () => {
    // Clamp expressions (setBarPos): both axes pinned to [0, max].
    assert.match(pageSrc, /Math\.max\(0,\s*Math\.min\(left,\s*maxLeft\)\)/);
    assert.match(pageSrc, /Math\.max\(0,\s*Math\.min\(top,\s*maxTop\)\)/);
    // Dropdown clamp (positionToolbar): gutter on both sides.
    assert.match(pageSrc, /Math\.max\(DROPDOWN_GUTTER,\s*Math\.min\(left,\s*pw - toolbar\.offsetWidth - DROPDOWN_GUTTER\)\)/);
    // Tap-vs-drag threshold uses both axes with AND (only a tap when under on both).
    assert.match(pageSrc, /Math\.abs\(dx\) < DRAG_THRESHOLD && Math\.abs\(dy\) < DRAG_THRESHOLD/);
    // A drag suppresses the click that would otherwise toggle the dropdown.
    assert.match(pageSrc, /if \(press\.dragging\) suppressClick = true/);
    // Drag is wired through Pointer Events and re-clamps on resize.
    assert.match(pageSrc, /toggle\.addEventListener\('pointerdown', onBarPointerDown\)/);
    assert.match(pageSrc, /window\.addEventListener\('pointermove', onBarPointerMove\)/);
    assert.match(pageSrc, /window\.addEventListener\('resize', onWindowResize\)/);
    // The drag hint is surfaced as the pill's title and exists as a locale key (checked in suite 1's
    // key-usage test); assert it is actually referenced here.
    assert.match(pageSrc, /bar\.title = t\('discover\.controls\.drag_hint'\)/);
  });

  await t.test('6. Cleanup removes every window-level drag listener it added', () => {
    for (const l of ['pointermove', 'pointerup', 'resize']) {
      assert.match(pageSrc, new RegExp(`window\\.removeEventListener\\('${l}',`), `${l} listener is torn down`);
    }
  });
});

test('Discover — Keyboard Navigation', async (t) => {
  // The on-screen up/down arrow buttons were removed; the keyboard is now a primary way to step
  // between products. Mirror ProductFeed.js onKeydown(): map keys to a step delta and honour the
  // typing-field guard, then assert the component still binds/cleans up at the window level.
  const KEY_DELTA = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 };
  const isTypingTarget = (tag, isContentEditable) =>
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!isContentEditable;

  // Returns what the handler would do: { prevented, delta }. delta 0 means "leave the event alone".
  const handleKey = ({ key, tag = null, isContentEditable = false }) => {
    if (isTypingTarget(tag, isContentEditable)) return { prevented: false, delta: 0 };
    const delta = KEY_DELTA[key];
    if (delta) return { prevented: true, delta };
    return { prevented: false, delta: 0 };
  };

  await t.test('1. ArrowDown / PageDown step forward; ArrowUp / PageUp step back', () => {
    assert.deepEqual(handleKey({ key: 'ArrowDown' }), { prevented: true, delta: 1 });
    assert.deepEqual(handleKey({ key: 'PageDown' }), { prevented: true, delta: 1 });
    assert.deepEqual(handleKey({ key: 'ArrowUp' }), { prevented: true, delta: -1 });
    assert.deepEqual(handleKey({ key: 'PageUp' }), { prevented: true, delta: -1 });
  });

  await t.test('2. Unrelated keys are left entirely alone', () => {
    for (const key of ['a', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', ' ']) {
      assert.deepEqual(handleKey({ key }), { prevented: false, delta: 0 }, `${key} is not intercepted`);
    }
  });

  await t.test('3. Arrow keys are ignored while typing in a form field', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      assert.deepEqual(handleKey({ key: 'ArrowDown', tag }), { prevented: false, delta: 0 },
        `ArrowDown in <${tag}> keeps its native caret behaviour`);
    }
    assert.deepEqual(handleKey({ key: 'ArrowUp', isContentEditable: true }), { prevented: false, delta: 0 },
      'contentEditable is treated as a typing field');
  });

  await t.test('4. Source parity — ProductFeed maps the same keys to the same steps', () => {
    assert.match(feedSrc, /e\.key === 'ArrowDown' \|\| e\.key === 'PageDown'/);
    assert.match(feedSrc, /e\.key === 'ArrowUp' \|\| e\.key === 'PageUp'/);
    // Forward key → step(1) directly after its guard; back key → step(-1).
    assert.match(feedSrc, /'ArrowDown' \|\| e\.key === 'PageDown'\)\s*\{[\s\S]*?step\(1\)/);
    assert.match(feedSrc, /'ArrowUp' \|\| e\.key === 'PageUp'\)\s*\{[\s\S]*?step\(-1\)/);
    // The typing-field guard covers all four cases.
    assert.match(feedSrc, /tgt\.tagName === 'INPUT'/);
    assert.match(feedSrc, /tgt\.tagName === 'TEXTAREA'/);
    assert.match(feedSrc, /tgt\.tagName === 'SELECT'/);
    assert.match(feedSrc, /tgt\.isContentEditable/);
  });

  await t.test('5. The listener is bound at the window and torn down on cleanup', () => {
    // Binding at the window (not `el`) is what lets the keys work without first focusing the feed.
    assert.match(feedSrc, /window\.addEventListener\('keydown', onKeydown\)/);
    assert.match(feedSrc, /window\.removeEventListener\('keydown', onKeydown\)/);
  });

  await t.test('6. Regression — the removed on-screen nav buttons stay gone', () => {
    // Step 3 deleted the floating up/down buttons; make sure they are not quietly reintroduced.
    assert.doesNotMatch(feedSrc, /discover-feed__nav-btn/);
    assert.doesNotMatch(feedSrc, /\bupBtn\b|\bdownBtn\b/);
  });
});
