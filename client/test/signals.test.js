/**
 * signals.test.js — Phase A of the personalized home feed: the site-wide signal tracker.
 *
 * Behaviour (services/signals.js, run in Node with the browser globals stubbed):
 *   - events are batched, grouped per audience, and carry the guest session id;
 *   - a VIEW is counted once per product per window, a CLICK every time;
 *   - a glance shorter than the dwell threshold is not a DWELL;
 *   - sponsored ad units are never reported as products;
 *   - consent: opting out stops capture, drops what was already queued, and Do-Not-Track is honoured
 *     until the shopper says otherwise;
 *   - impressions need the card to stay on screen, not merely to render.
 *
 * Wiring (static, on the call sites): each surface reports through the one tracker, exactly once.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(here, '..', 'src', rel), 'utf8');
const serverSrc = (rel) => readFileSync(join(here, '..', '..', 'server', 'src', rel), 'utf8');

// ── Browser stubs, installed BEFORE the module under test is imported ─────────────────────────────
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
const docListeners = [];
globalThis.document = {
  visibilityState: 'visible',
  cookie: '',
  documentElement: { lang: 'en' },
  addEventListener: (type, fn) => docListeners.push({ type, fn }),
  removeEventListener: () => {},
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};

// Intersection observer stub: tests drive `emit()` by hand.
class FakeObserver {
  static instances = [];
  constructor(cb) {
    this.cb = cb;
    this.targets = new Set();
    FakeObserver.instances.push(this);
  }
  observe(el) { this.targets.add(el); }
  unobserve(el) { this.targets.delete(el); }
  emit(target, isIntersecting) { this.cb([{ target, isIntersecting }]); }
}
globalThis.IntersectionObserver = FakeObserver;

const signals = await import('../src/services/signals.js');
const { api } = await import('../src/core/api.js');

const posts = [];
api.post = async (path, body, opts) => {
  posts.push({ path, body, opts });
  return { data: {} };
};

function setDoNotTrack(value) {
  Object.defineProperty(globalThis, 'navigator', { value: { doNotTrack: value }, configurable: true, writable: true });
}

beforeEach(() => {
  storage.clear();
  posts.length = 0;
  setDoNotTrack(null);
  signals.setPersonalizationEnabled(false); // withdrawing consent clears the queue + view de-dupe
  storage.clear();
  posts.length = 0;
});

const eventPosts = () => posts.filter((p) => p.path === '/discovery/events');
const sentEvents = () => eventPosts().flatMap((p) => p.body.events);

describe('batching and transport', () => {
  it('queues events and sends them in one request carrying the guest session id', () => {
    signals.track('CLICK', { id: 11, category_id: 3, supplier_id: 9 });
    signals.track('ADD_CART', { id: 12 });
    assert.equal(eventPosts().length, 0, 'nothing is sent until the batch fills or the timer fires');

    signals.flushSignals();
    assert.equal(eventPosts().length, 1, 'one request for the whole batch');
    const [post] = eventPosts();
    assert.equal(post.body.audience, 'customer');
    assert.match(post.body.session_id, /^sid_/);
    assert.deepEqual(post.body.events.map((e) => e.event_type), ['CLICK', 'ADD_CART']);
    assert.equal(post.body.events[0].category_id, 3);
    assert.equal(post.opts.skipAuthRedirect, true, 'a signal must never bounce a shopper to /login');
  });

  it('omits category and supplier when the call site only knows the product id', () => {
    signals.track('ADD_CART', { id: 12 });
    signals.flushSignals();
    const [event] = sentEvents();
    assert.equal('category_id' in event, false);
    assert.equal('supplier_id' in event, false);
  });

  it('flushes by itself when the batch fills', () => {
    for (let i = 1; i <= signals.BATCH_SIZE; i++) signals.track('CLICK', { id: i });
    assert.equal(eventPosts().length, 1);
    assert.equal(sentEvents().length, signals.BATCH_SIZE);
  });

  it('sends one request per audience, because a request carries a single audience', () => {
    signals.track('CLICK', { id: 1 }, { audience: 'customer' });
    signals.track('CLICK', { id: 2 }, { audience: 'saler' });
    signals.flushSignals();
    const audiences = eventPosts().map((p) => p.body.audience).sort();
    assert.deepEqual(audiences, ['customer', 'saler']);
  });

  it('never sends a request larger than the server accepts', () => {
    const serverMax = Number(/MAX_EVENTS_PER_CALL = (\d+)/.exec(serverSrc('services/discoveryFeed.service.js'))[1]);
    assert.ok(signals.BATCH_SIZE <= serverMax);
  });

  it('a failed request is swallowed — a signal must never break browsing', () => {
    const original = api.post;
    api.post = () => Promise.reject(new Error('offline'));
    assert.doesNotThrow(() => {
      signals.track('CLICK', { id: 1 });
      signals.flushSignals();
    });
    api.post = original;
  });

  it('an empty queue sends nothing', () => {
    signals.flushSignals();
    assert.equal(posts.length, 0);
  });
});

describe('what counts as a product', () => {
  it('ignores sponsored ad units and ad_ ids', () => {
    signals.track('CLICK', { id: 'ad_7', isSponsored: true });
    signals.track('CLICK', { id: 'ad_8' });
    signals.track('CLICK', null);
    signals.track('CLICK', {});
    signals.flushSignals();
    assert.equal(sentEvents().length, 0);
  });

  it('coerces numeric string ids to numbers (the server needs a numeric product_id)', () => {
    signals.track('CLICK', { id: '42' });
    signals.flushSignals();
    assert.strictEqual(sentEvents()[0].product_id, 42);
  });
});

describe('VIEW and DWELL rules', () => {
  it('counts a VIEW once per product, but every CLICK', () => {
    signals.track('VIEW', { id: 5 });
    signals.track('VIEW', { id: 5 });
    signals.track('VIEW', { id: 6 });
    signals.track('CLICK', { id: 5 });
    signals.track('CLICK', { id: 5 });
    signals.flushSignals();
    const types = sentEvents().map((e) => `${e.event_type}:${e.product_id}`);
    assert.deepEqual(types, ['VIEW:5', 'VIEW:6', 'CLICK:5', 'CLICK:5']);
  });

  it('the same product seen by the saler audience is a separate VIEW', () => {
    signals.track('VIEW', { id: 5 }, { audience: 'customer' });
    signals.track('VIEW', { id: 5 }, { audience: 'saler' });
    signals.flushSignals();
    assert.equal(sentEvents().length, 2);
  });

  it('drops a glance shorter than the dwell threshold, keeps one at the threshold', () => {
    signals.track('DWELL', { id: 5 }, { dwellMs: signals.MIN_DWELL_MS - 1 });
    signals.track('DWELL', { id: 6 }, { dwellMs: signals.MIN_DWELL_MS });
    signals.flushSignals();
    const events = sentEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].product_id, 6);
    assert.equal(events[0].dwell_ms, signals.MIN_DWELL_MS);
  });

  it('a SEARCH_CLICK carries the query that produced it', () => {
    signals.track('SEARCH_CLICK', { id: 5 }, { query: 'red saree' });
    signals.flushSignals();
    assert.equal(sentEvents()[0].query, 'red saree');
  });

  it('the legacy recordEvent shim reports through the same path', () => {
    signals.recordEvent({ event_type: 'click', product_id: 9, category_id: 2 }, { audience: 'saler' });
    signals.flushSignals();
    const [post] = eventPosts();
    assert.equal(post.body.audience, 'saler');
    assert.equal(post.body.events[0].event_type, 'CLICK');
  });
});

describe('consent', () => {
  it('opting out stops capture', () => {
    signals.setPersonalizationEnabled(false);
    signals.track('CLICK', { id: 1 });
    signals.flushSignals();
    assert.equal(posts.length, 0);
    assert.equal(signals.isPersonalizationOff(), true);
  });

  it('opting out drops events already queued under the consent that was just withdrawn', () => {
    signals.track('CLICK', { id: 1 });
    signals.setPersonalizationEnabled(false);
    signals.flushSignals();
    assert.equal(posts.length, 0);
  });

  it('the choice survives a reload (it is persisted)', () => {
    signals.setPersonalizationEnabled(false);
    assert.equal(storage.get(signals.PREFERENCE_KEY), 'off');
    signals.setPersonalizationEnabled(true);
    assert.equal(storage.get(signals.PREFERENCE_KEY), 'on');
  });

  it('Do-Not-Track means off until the shopper explicitly opts in', () => {
    storage.clear();
    setDoNotTrack('1');
    assert.equal(signals.isPersonalizationEnabled(), false);
    storage.set(signals.PREFERENCE_KEY, 'on');
    assert.equal(signals.isPersonalizationEnabled(), true, 'an explicit choice beats the browser default');
  });

  it('when storage throws, the choice still applies for this page view', () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    try {
      signals.setPersonalizationEnabled(false);
      assert.equal(signals.isPersonalizationEnabled(), false);
    } finally {
      globalThis.localStorage = real;
    }
  });

  it('with no signal at all the platform default (on) applies', () => {
    storage.clear();
    setDoNotTrack(null);
    assert.equal(signals.isPersonalizationEnabled(), true);
  });

  it('notifies listeners so a toggle UI can stay in sync', () => {
    const seen = [];
    const off = signals.onPersonalizationChange((v) => seen.push(v));
    signals.setPersonalizationEnabled(false);
    signals.setPersonalizationEnabled(true);
    off();
    signals.setPersonalizationEnabled(false);
    assert.deepEqual(seen, [false, true]);
  });
});

describe('search tracking', () => {
  it('posts the query with its real result count', () => {
    signals.trackSearch({ query: '  red saree ', resultCount: 12 });
    const [post] = posts.filter((p) => p.path === '/discovery/search-events');
    assert.equal(post.body.query, 'red saree');
    assert.equal(post.body.result_count, 12);
  });

  it('records a zero-result search (the catalog-gap signal) as 0, not as missing', () => {
    signals.trackSearch({ query: 'zzzqq', resultCount: 0 });
    assert.strictEqual(posts.find((p) => p.path === '/discovery/search-events').body.result_count, 0);
  });

  it('ignores an empty query', () => {
    signals.trackSearch({ query: '   ', resultCount: 3 });
    assert.equal(posts.length, 0);
  });

  it('the same query re-rendered straight away (back button) counts once', () => {
    signals.trackSearch({ query: 'unique one', resultCount: 3 });
    signals.trackSearch({ query: 'Unique One', resultCount: 3 });
    assert.equal(posts.filter((p) => p.path === '/discovery/search-events').length, 1);
  });

  it('respects consent', () => {
    signals.setPersonalizationEnabled(false);
    signals.trackSearch({ query: 'private thing', resultCount: 3 });
    assert.equal(posts.length, 0);
  });
});

describe('impressions', () => {
  const observerFor = () => FakeObserver.instances.at(-1);

  it('counts a VIEW only after the card stays visible for the impression window', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const el = {};
      signals.observeImpression(el, { id: 77 });
      observerFor().emit(el, true);
      mock.timers.tick(signals.IMPRESSION_MS - 1);
      signals.flushSignals();
      assert.equal(sentEvents().length, 0, 'not yet: still inside the window');

      mock.timers.tick(1);
      signals.flushSignals();
      assert.deepEqual(sentEvents().map((e) => `${e.event_type}:${e.product_id}`), ['VIEW:77']);
    } finally {
      mock.timers.reset();
    }
  });

  it('scrolling past (leaving before the window ends) is not a VIEW', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const el = {};
      signals.observeImpression(el, { id: 78 });
      observerFor().emit(el, true);
      mock.timers.tick(signals.IMPRESSION_MS - 100);
      observerFor().emit(el, false);
      mock.timers.tick(1000);
      signals.flushSignals();
      assert.equal(sentEvents().length, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('does not observe a sponsored card at all', () => {
    const el = {};
    const stop = signals.observeImpression(el, { id: 'ad_1', isSponsored: true });
    assert.equal(typeof stop, 'function', 'still returns a cleanup so callers need no special case');
    assert.equal(FakeObserver.instances.some((o) => o.targets.has(el)), false);
  });
});

describe('dwell timing', () => {
  it('emits one DWELL for the time spent, when the page is left', () => {
    mock.timers.enable({ apis: ['Date'] });
    try {
      const stop = signals.startDwell({ id: 90 });
      mock.timers.tick(5000);
      stop();
      stop(); // idempotent
      signals.flushSignals();
      const dwell = sentEvents().filter((e) => e.event_type === 'DWELL');
      assert.equal(dwell.length, 1);
      assert.equal(dwell[0].dwell_ms, 5000);
    } finally {
      mock.timers.reset();
    }
  });

  it('a page left within the glance threshold reports nothing', () => {
    mock.timers.enable({ apis: ['Date'] });
    try {
      const stop = signals.startDwell({ id: 91 });
      mock.timers.tick(300);
      stop();
      signals.flushSignals();
      assert.equal(sentEvents().length, 0);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('client defaults match the seeded capture policy (migration 055)', () => {
  const migration = serverSrc('db/migrations/055_personalization_signals.sql');
  const seeded = JSON.parse(/'(\{"track_guests"[^']*\})'::jsonb/.exec(migration)[1]);

  it('batch size, flush interval and dwell threshold agree with the module row', () => {
    assert.equal(signals.BATCH_SIZE, seeded.batch_size);
    assert.equal(signals.FLUSH_INTERVAL_MS, seeded.flush_interval_ms);
    assert.equal(signals.MIN_DWELL_MS, seeded.min_dwell_ms);
  });
});

describe('wiring — every surface reports through the one tracker, once', () => {
  it('addToCart reports ADD_CART by product id only (its supplier_id default is a placeholder)', () => {
    const cart = src('services/cart.js');
    assert.match(cart, /track\('ADD_CART', \{ id: product_id \}\)/);
  });

  it('the /discover feed no longer double-reports ADD_CART on top of addToCart', () => {
    const feed = src('components/product/ProductFeed.js');
    assert.doesNotMatch(feed, /recordEvent\(\{ event_type: 'ADD_CART'/);
    assert.match(feed, /from '\.\.\/\.\.\/services\/signals\.js'/);
  });

  it('a confirmed wishlist save reports WISHLIST; the optimistic flip and un-save do not', () => {
    const cart = src('services/cart.js');
    const at = cart.indexOf("track('WISHLIST'");
    assert.ok(at > -1);
    assert.match(cart.slice(Math.max(0, at - 400), at), /if \(res\.data\.in_wishlist\)/);
  });

  it('checkout reads the cart lines BEFORE clearing them, and only after the order succeeds', () => {
    const order = src('services/order.api.js');
    const fn = order.slice(order.indexOf('export async function placeCheckout'));
    const post = fn.indexOf("api.post('/orders/checkout'");
    // Anchor on real code, not the same words inside the explanatory comment.
    const read = fn.indexOf('of getCart()');
    const clear = fn.indexOf('\n  clearCart();');
    assert.ok(post > -1 && read > post, 'purchase is read after the checkout call resolves');
    assert.ok(clear > read, 'cart is read before clearCart() empties it');
    assert.match(fn, /track\('PURCHASE'/);
  });

  it('a search-result card reports SEARCH_CLICK with its query; a normal card reports CLICK', () => {
    const card = src('components/product/ProductCard.js');
    assert.match(card, /signalContext\?\.query \? 'SEARCH_CLICK' : 'CLICK'/);
    assert.match(card, /observeImpression\(card, product/);
    assert.match(src('pages/SearchResultsPage.js'), /signalContext: \{ query: term \}/);
    assert.match(src('pages/SearchResultsPage.js'), /trackSearch\(/);
    assert.match(src('components/product/ProductGrid.js'), /signalContext/);
  });

  it('the product page reports a VIEW and times the visit, stopping the timer on leave', () => {
    const pdp = src('pages/ProductDetailPage.js');
    assert.match(pdp, /track\('VIEW', product/);
    assert.match(pdp, /cleanups\.push\(startDwell\(product/);
  });

  it('the feed read tells the server when the shopper opted out', () => {
    const api = src('services/discovery.api.js');
    assert.match(api, /isPersonalizationOff\(\)\) query\.personalize = '0'/);
  });

  it('nothing but the tracker posts to /discovery/events any more', () => {
    for (const rel of ['services/discovery.api.js', 'components/product/ProductFeed.js']) {
      assert.doesNotMatch(src(rel), /\/discovery\/events/, rel);
    }
  });
});

// ── Surface attribution (Phase F) ────────────────────────────────────────────────────────────────
describe('surface attribution', () => {
  it('an event carries the surface that showed the product', () => {
    signals.track('CLICK', { id: 5 }, { source: 'rail:trending' });
    signals.flushSignals();
    assert.equal(sentEvents()[0].source, 'rail:trending');
  });

  it('no surface, no key', () => {
    signals.track('CLICK', { id: 5 });
    signals.flushSignals();
    assert.equal('source' in sentEvents()[0], false);
  });

  it('a malformed surface is dropped but the event still goes: the click matters more than its label', () => {
    for (const bad of ['Rail:Trending', 'rail trending', 'rail:', '1grid', 'x'.repeat(41), 42, '']) {
      signals.track('CLICK', { id: 5 }, { source: bad });
    }
    signals.flushSignals();
    const events = sentEvents();
    assert.equal(events.length, 7);
    assert.ok(events.every((e) => !('source' in e)));
  });

  it('the same product seen on two surfaces is two impressions; on one surface it is still one', () => {
    signals.track('VIEW', { id: 8 }, { source: 'rail:trending' });
    signals.track('VIEW', { id: 8 }, { source: 'grid' });
    signals.track('VIEW', { id: 8 }, { source: 'grid' });
    signals.flushSignals();
    assert.deepEqual(sentEvents().map((e) => e.source), ['rail:trending', 'grid']);
  });

  it('the swipe feed reports itself as the feed', () => {
    signals.recordEvent({ event_type: 'CLICK', product_id: 4 });
    signals.flushSignals();
    assert.equal(sentEvents()[0].source, 'feed');
  });

  it('the client and the server accept exactly the same shape of surface name', () => {
    const client = /SOURCE_PATTERN = (\/.+\/);/.exec(src('services/signals.js'))[1];
    const server = /SOURCE_PATTERN = (\/.+\/);/.exec(serverSrc('services/discoveryFeed.service.js'))[1];
    assert.equal(client, server);
    const sql = /source ~ '([^']+)'/.exec(readFileSync(join(here, '..', '..', 'server', 'src', 'db', 'migrations', '060_recommendation_cache_metrics.sql'), 'utf8'))[1];
    assert.equal(`/${sql}/`, client, 'migration 060 constrains the column to the same shape');
  });

  it('every surface names itself: rails by key, the grid, search results', () => {
    assert.match(src('components/product/ProductRail.js'), /source: `rail:\$\{railKey\}`/);
    assert.match(src('components/product/ProductGrid.js'), /source: signalContext\?\.query \? 'search' : 'grid'/);
    const card = src('components/product/ProductCard.js');
    assert.match(card, /source: signalContext\?\.source/);
    assert.match(card, /observeImpression\(card, product, \{ audience: signalAudience, source: signalContext\?\.source \}\)/);
  });
});
