/**
 * signals.js — Site-wide behavioural signal tracker (Phase A of the personalized home feed).
 *
 * Before this, only the /discover swipe feed told the server what a shopper did, so a shopper who
 * never opened /discover had an empty interest profile and no surface could personalize for them.
 * This module is the one place every surface reports through:
 *
 *   track(type, product, opts)      one interaction (VIEW, CLICK, ADD_CART, WISHLIST, …), batched
 *   observeImpression(el, product)  VIEW once a card has genuinely been on screen
 *   startDwell(product)             time on a product page → DWELL when the returned fn is called
 *   trackSearch({query, …})         one deliberate search (not a typeahead keystroke)
 *   flushSignals()                  send the queue now
 *
 * Properties the rest of the app relies on:
 *   - FIRE-AND-FORGET. A ranking signal must never block, slow or break browsing; every failure is
 *     swallowed.
 *   - BATCHED. Cards fire many events; one request per ~20 events or ~4s, not one per event.
 *   - CONSENT. The shopper can switch personalization off (and a browser Do-Not-Track signal is
 *     honoured until they say otherwise). Off means nothing is queued, nothing is sent, and the feed
 *     is asked to rank by popularity only.
 *   - SAFE ON UNLOAD. The last events before a tab closes are sent with fetch({keepalive:true}), not
 *     sendBeacon, because a beacon cannot carry the Authorization header and would attribute a
 *     signed-in shopper's final events to their anonymous session instead.
 *
 * Zero dependencies (client runtime-dependency policy) — only this repo's api wrapper.
 */
import { api, getAccessToken, API_BASE } from '../core/api.js';

const LIVE = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_MODE === 'live';

// WHY these are constants here and not fetched: they are the CLIENT-side defaults of the
// `personalization_signals` module's capture policy (migration 055 seeds the same numbers), and the
// server re-enforces the authoritative values on every write (see discoveryFeed.service.js
// resolveCapturePolicy). test/signals.test.js fails if the two sets drift.
export const BATCH_SIZE = 20;
export const FLUSH_INTERVAL_MS = 4000;
export const MIN_DWELL_MS = 1200;

// A card must stay at least half visible this long before it counts as seen, so fast scrolling past
// a grid does not register every card it flicks by.
export const IMPRESSION_MS = 500;
// Re-seeing the same product inside this window is not a new VIEW (back/forward, re-render).
const VIEW_DEDUPE_MS = 30 * 60 * 1000;
const SEARCH_DEDUPE_MS = 30 * 1000;
// A tab left open on a product page for an hour is not an hour of interest.
const MAX_DWELL_MS = 10 * 60 * 1000;
// Mirrors the server's MAX_EVENTS_PER_CALL; a bigger batch is rejected outright.
const MAX_BATCH = 50;

const SESSION_KEY = 'explooro_discovery_sid';

/**
 * The guest ranking id: an opaque token persisted in this browser so an anonymous shopper's history
 * is stable across visits. Never an auth credential — it only scopes personalization. Returns null
 * if storage is unavailable (private mode); the feed then simply ranks by popularity.
 *
 * Lives here (not in discovery.api.js) so the tracker and the feed reader share it without an
 * import cycle; discovery.api.js re-exports it for the callers that already import it from there.
 */
export function getDiscoverySessionId() {
  try {
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = `sid_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return null;
  }
}

export const PREFERENCE_KEY = 'explooro_personalization';

// ── Consent ──────────────────────────────────────────────────────────────────

const consentListeners = new Set();

// Holds the choice ONLY when localStorage throws (private mode, blocked site data), so the toggle
// still works for this page view. WHY not a general mirror: storage is the source of truth, and a
// stale in-memory copy would keep overriding it after the shopper clears site data elsewhere.
let memoryPreference = null;

function readPreference() {
  try {
    return localStorage.getItem(PREFERENCE_KEY);
  } catch {
    return memoryPreference;
  }
}

function doNotTrack() {
  if (typeof navigator === 'undefined') return false;
  return navigator.doNotTrack === '1' || navigator.msDoNotTrack === '1' || globalThis.doNotTrack === '1';
}

/**
 * Whether signals may be recorded. An explicit choice always wins; with none, a browser
 * Do-Not-Track signal means "off", otherwise the platform default (on) applies.
 */
export function isPersonalizationEnabled() {
  const pref = readPreference();
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return !doNotTrack();
}

/** True when personalization is off only because the browser sent Do-Not-Track (no explicit choice yet). */
export function isOffByBrowserSignal() {
  return readPreference() == null && doNotTrack();
}

/** True when the shopper (or their browser) has opted out — drives `personalize=0` on feed reads. */
export function isPersonalizationOff() {
  return !isPersonalizationEnabled();
}

export function setPersonalizationEnabled(enabled) {
  const value = enabled ? 'on' : 'off';
  try {
    localStorage.setItem(PREFERENCE_KEY, value);
  } catch {
    memoryPreference = value; // storage unavailable — carry the choice for this page view only
  }
  if (!enabled) {
    // WHY drop the queue: events captured a moment ago were gathered under consent that has just
    // been withdrawn; sending them would honour the toggle only for future behaviour.
    queue.length = 0;
    seenViews.clear();
  }
  for (const fn of consentListeners) {
    try {
      fn(enabled);
    } catch {
      // A listener must not break the toggle.
    }
  }
}

export function onPersonalizationChange(fn) {
  consentListeners.add(fn);
  return () => consentListeners.delete(fn);
}

// ── Event building ───────────────────────────────────────────────────────────

/**
 * A product is trackable when it is a real catalog row. Sponsored cards (`ad_…` ids) are ad units,
 * not products, and in live mode the server wants numeric ids — one non-numeric id would otherwise
 * be rejected and take the rest of its batch with it.
 */
function trackableId(product) {
  if (!product || product.isSponsored) return null;
  const id = product.id ?? product.product_id;
  if (id == null || id === '') return null;
  const text = String(id);
  if (text.startsWith('ad_')) return null;
  if (LIVE && !/^\d+$/.test(text)) return null;
  return /^\d+$/.test(text) ? Number(text) : text;
}

function buildEvent(type, product, { dwellMs, query } = {}) {
  const id = trackableId(product);
  if (id == null) return null;
  const event = { event_type: type, product_id: id };
  const categoryId = product.category_id;
  const supplierId = product.supplier_id ?? product.supplier?.id;
  // WHY optional: the server backfills category and supplier from the product row, so a call site
  // that only knows the id (the cart, the wishlist) can still report a complete event.
  if (categoryId != null) event.category_id = categoryId;
  if (supplierId != null) event.supplier_id = supplierId;
  if (product.category) event.category = product.category; // mock-mode affinity keys on the name
  if (dwellMs) event.dwell_ms = Math.round(dwellMs);
  if (query) event.query = query;
  return event;
}

// ── Queue + transport ────────────────────────────────────────────────────────

const queue = []; // [{ audience, event }]
const seenViews = new Map(); // `${audience}:${id}` → timestamp
let flushTimer = null;

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushSignals();
  }, FLUSH_INTERVAL_MS);
}

function sessionHeaders(sid) {
  return sid ? { 'x-session-id': sid } : undefined;
}

function sendBatch(audience, events, unloading) {
  const sid = getDiscoverySessionId();
  const body = { events, audience, session_id: sid };

  if (unloading && LIVE && typeof fetch === 'function') {
    try {
      const headers = { 'Content-Type': 'application/json', ...sessionHeaders(sid) };
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      fetch(`${API_BASE}/discovery/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Best-effort.
    }
    return;
  }

  try {
    api
      .post('/discovery/events', body, { headers: sessionHeaders(sid), skipAuthRedirect: true })
      .catch(() => {});
  } catch {
    // Best-effort.
  }
}

/** Sends everything queued, one request per audience (a request carries a single audience). */
export function flushSignals({ unloading = false } = {}) {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  const items = queue.splice(0);

  const byAudience = new Map();
  for (const { audience, event } of items) {
    if (!byAudience.has(audience)) byAudience.set(audience, []);
    byAudience.get(audience).push(event);
  }
  for (const [audience, events] of byAudience) {
    for (let i = 0; i < events.length; i += MAX_BATCH) {
      sendBatch(audience, events.slice(i, i + MAX_BATCH), unloading);
    }
  }
}

function enqueue(audience, event) {
  queue.push({ audience, event });
  if (queue.length >= BATCH_SIZE) flushSignals();
  else scheduleFlush();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Records one interaction.
 * @param {string} type  VIEW | DWELL | CLICK | SEARCH_CLICK | ADD_CART | WISHLIST | SHARE | FOLLOW_STORE | PURCHASE
 * @param {object} product  needs `id` (or `product_id`); `category_id`/`supplier_id` optional
 * @param {object} [opts]
 * @param {'customer'|'saler'} [opts.audience]
 * @param {number} [opts.dwellMs]
 * @param {string} [opts.query]  for SEARCH_CLICK: the query that produced the result
 */
export function track(type, product, { audience = 'customer', dwellMs, query } = {}) {
  if (!isPersonalizationEnabled()) return;
  if (type === 'DWELL' && !(dwellMs >= MIN_DWELL_MS)) return;

  const event = buildEvent(type, product, { dwellMs, query });
  if (!event) return;

  if (type === 'VIEW') {
    const key = `${audience}:${event.product_id}`;
    const last = seenViews.get(key);
    const now = Date.now();
    if (last != null && now - last < VIEW_DEDUPE_MS) return;
    seenViews.set(key, now);
  }
  enqueue(audience, event);
}

/**
 * Drop-in for the old discovery.api `recordEvent`: takes the already-shaped `{event_type, product_id,
 * …}` object the /discover feed builds. Kept so that feed reports through the same consent-aware,
 * batched path as every other surface.
 */
export function recordEvent(event, { audience = 'customer' } = {}) {
  const list = Array.isArray(event) ? event : [event];
  for (const e of list) {
    if (!e) continue;
    track(
      String(e.event_type || '').toUpperCase(),
      { id: e.product_id, category_id: e.category_id, supplier_id: e.supplier_id, category: e.category },
      { audience, dwellMs: e.dwell_ms, query: e.query }
    );
  }
}

// ── Impressions ──────────────────────────────────────────────────────────────

let observer = null;
const watched = new WeakMap(); // element → { product, audience, timer }

function onIntersect(entries) {
  for (const entry of entries) {
    const rec = watched.get(entry.target);
    if (!rec) continue;
    if (entry.isIntersecting) {
      if (rec.timer == null) {
        rec.timer = setTimeout(() => {
          rec.timer = null;
          track('VIEW', rec.product, { audience: rec.audience });
          watched.delete(entry.target);
          observer?.unobserve(entry.target);
        }, IMPRESSION_MS);
      }
    } else if (rec.timer != null) {
      clearTimeout(rec.timer);
      rec.timer = null;
    }
  }
}

/**
 * Reports a VIEW once `el` has been at least half visible for IMPRESSION_MS. Returns a function that
 * stops watching (call it when the card is torn down). A no-op where IntersectionObserver is absent.
 */
export function observeImpression(el, product, { audience = 'customer' } = {}) {
  if (!el || typeof IntersectionObserver === 'undefined' || trackableId(product) == null) {
    return () => {};
  }
  observer ||= new IntersectionObserver(onIntersect, { threshold: 0.5 });
  watched.set(el, { product, audience, timer: null });
  observer.observe(el);
  return () => {
    const rec = watched.get(el);
    if (rec?.timer != null) clearTimeout(rec.timer);
    watched.delete(el);
    observer?.unobserve(el);
  };
}

// ── Dwell ────────────────────────────────────────────────────────────────────

/**
 * Starts timing a product page. Time with the tab hidden does not count. Call the returned function
 * when the page is left (the router's cleanup) to emit one DWELL.
 */
export function startDwell(product, { audience = 'customer' } = {}) {
  if (trackableId(product) == null || typeof document === 'undefined') return () => {};

  let accumulated = 0;
  let since = document.visibilityState === 'hidden' ? null : Date.now();
  let stopped = false;

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (since != null) {
        accumulated += Date.now() - since;
        since = null;
      }
    } else if (since == null) {
      since = Date.now();
    }
  };
  const onPageHide = () => {
    stop();
    flushSignals({ unloading: true });
  };

  function stop() {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibility);
    globalThis.removeEventListener?.('pagehide', onPageHide);
    if (since != null) accumulated += Date.now() - since;
    track('DWELL', product, { audience, dwellMs: Math.min(accumulated, MAX_DWELL_MS) });
  }

  document.addEventListener('visibilitychange', onVisibility);
  globalThis.addEventListener?.('pagehide', onPageHide);
  return stop;
}

// ── Search ───────────────────────────────────────────────────────────────────

const recentSearches = new Map(); // `${audience}:${query}` → timestamp

/**
 * Records that the shopper ran a search. Call once per results page load with the real result count,
 * never per typeahead keystroke. A repeat of the same query within a few seconds (re-render, back
 * button) is ignored.
 */
export function trackSearch({ query, resultCount, categoryId, audience = 'customer' } = {}) {
  if (!isPersonalizationEnabled()) return;
  const text = String(query ?? '').trim();
  if (!text) return;

  const key = `${audience}:${text.toLowerCase()}`;
  const now = Date.now();
  const last = recentSearches.get(key);
  if (last != null && now - last < SEARCH_DEDUPE_MS) return;
  recentSearches.set(key, now);

  const sid = getDiscoverySessionId();
  try {
    api
      .post(
        '/discovery/search-events',
        {
          query: text,
          result_count: Number.isFinite(Number(resultCount)) ? Number(resultCount) : 0,
          ...(categoryId != null ? { category_id: categoryId } : {}),
          audience,
          session_id: sid,
        },
        { headers: sessionHeaders(sid), skipAuthRedirect: true }
      )
      .catch(() => {});
  } catch {
    // Best-effort.
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && typeof globalThis.addEventListener === 'function') {
  // `visibilitychange → hidden` is the last reliable signal on mobile browsers (pagehide/unload are
  // often skipped when the OS suspends the tab), so flush there as well as on pagehide.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSignals({ unloading: true });
  });
  globalThis.addEventListener('pagehide', () => flushSignals({ unloading: true }));
}
