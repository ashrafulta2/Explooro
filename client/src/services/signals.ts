/**
 * signals.ts — Site-wide behavioural signal tracker (Phase A of the personalized home feed).
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
import { api, getAccessToken, API_BASE } from '../core/api.ts';

const LIVE = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_MODE === 'live';

// WHY these are constants here and not fetched: they are the CLIENT-side defaults of the
// `personalization_signals` module's capture policy (migration 055 seeds the same numbers), and the
// server re-enforces the authoritative values on every write (see discoveryFeed.service.ts
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

/** What an event reports; the server's vocabulary. */
export type SignalType = 'VIEW' | 'DWELL' | 'CLICK' | 'SEARCH_CLICK' | 'ADD_CART' | 'WISHLIST' | 'SHARE' | 'FOLLOW_STORE' | 'PURCHASE';

export type SignalAudience = 'customer' | 'saler';

/** The part of a product a signal needs: an id, and optionally what the server would otherwise look up. */
export interface SignalProduct {
  id?: number | string;
  product_id?: number | string;
  isSponsored?: boolean;
  category_id?: number | string | null;
  supplier_id?: number | string | null;
  supplier?: { id?: number | string } | null;
  category?: string;
}

/** One event as it goes over the wire (POST /discovery/events). */
export interface SignalEvent {
  event_type: string;
  product_id: number | string;
  category_id?: number | string;
  supplier_id?: number | string;
  category?: string;
  dwell_ms?: number;
  query?: string;
  source?: string;
}

export interface TrackOptions {
  audience?: SignalAudience;
  dwellMs?: number;
  /** For SEARCH_CLICK: the query that produced the result. */
  query?: string;
  /** The surface that showed the product (`rail:trending`, `feed`, `grid`, `search`). */
  source?: string;
}

/**
 * The guest ranking id: an opaque token persisted in this browser so an anonymous shopper's history
 * is stable across visits. Never an auth credential — it only scopes personalization. Returns null
 * if storage is unavailable (private mode); the feed then simply ranks by popularity.
 *
 * Lives here (not in discovery.api.ts) so the tracker and the feed reader share it without an
 * import cycle; discovery.api.ts re-exports it for the callers that already import it from there.
 */
export function getDiscoverySessionId(): string | null {
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

const consentListeners = new Set<(enabled: boolean) => void>();

// Holds the choice ONLY when localStorage throws (private mode, blocked site data), so the toggle
// still works for this page view. WHY not a general mirror: storage is the source of truth, and a
// stale in-memory copy would keep overriding it after the shopper clears site data elsewhere.
let memoryPreference: string | null = null;

function readPreference(): string | null {
  try {
    return localStorage.getItem(PREFERENCE_KEY);
  } catch {
    return memoryPreference;
  }
}

function doNotTrack() {
  if (typeof navigator === 'undefined') return false;
  return navigator.doNotTrack === '1' || (navigator as unknown as { msDoNotTrack?: string }).msDoNotTrack === '1' || (globalThis as unknown as { doNotTrack?: string }).doNotTrack === '1';
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

export function setPersonalizationEnabled(enabled: boolean) {
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

export function onPersonalizationChange(fn: (enabled: boolean) => void) {
  consentListeners.add(fn);
  return () => consentListeners.delete(fn);
}

// ── Event building ───────────────────────────────────────────────────────────

/**
 * A product is trackable when it is a real catalog row. Sponsored cards (`ad_…` ids) are ad units,
 * not products, and in live mode the server wants numeric ids — one non-numeric id would otherwise
 * be rejected and take the rest of its batch with it.
 */
function trackableId(product: SignalProduct | null | undefined): number | string | null {
  if (!product || product.isSponsored) return null;
  const id = product.id ?? product.product_id;
  if (id == null || id === '') return null;
  const text = String(id);
  if (text.startsWith('ad_')) return null;
  if (LIVE && !/^\d+$/.test(text)) return null;
  return /^\d+$/.test(text) ? Number(text) : text;
}

// Where an event came from: `rail:<key>` for a home rail, or a bare name (feed, grid, search). The same
// shape the server stores (migration 060) and validates; anything else is simply not sent.
const SOURCE_PATTERN = /^[a-z][a-z_]*(:[a-z][a-z_]*)?$/;
const validSource = (s: unknown): string | null => (typeof s === 'string' && s.length <= 40 && SOURCE_PATTERN.test(s) ? s : null);

function buildEvent(type: string, product: SignalProduct, { dwellMs, query, source }: TrackOptions = {}): SignalEvent | null {
  const id = trackableId(product);
  if (id == null) return null;
  const event: SignalEvent = { event_type: type, product_id: id };
  const categoryId = product.category_id;
  const supplierId = product.supplier_id ?? product.supplier?.id;
  // WHY optional: the server backfills category and supplier from the product row, so a call site
  // that only knows the id (the cart, the wishlist) can still report a complete event.
  if (categoryId != null) event.category_id = categoryId;
  if (supplierId != null) event.supplier_id = supplierId;
  if (product.category) event.category = product.category; // mock-mode affinity keys on the name
  if (dwellMs) event.dwell_ms = Math.round(dwellMs);
  if (query) event.query = query;
  // WHY the surface rides on the event: it is what lets the server tell a click on the Trending rail
  // from the same click in the grid, which is the only way to judge a rail by whether it gets opened.
  const tag = validSource(source);
  if (tag) event.source = tag;
  return event;
}

// ── Queue + transport ────────────────────────────────────────────────────────

const queue: { audience: SignalAudience; event: SignalEvent }[] = [];
const seenViews = new Map<string, number>(); // `${audience}:${id}` → timestamp
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushSignals();
  }, FLUSH_INTERVAL_MS);
}

function sessionHeaders(sid: string | null): Record<string, string> | undefined {
  return sid ? { 'x-session-id': sid } : undefined;
}

function sendBatch(audience: SignalAudience, events: SignalEvent[], unloading: boolean) {
  const sid = getDiscoverySessionId();
  const body = { events, audience, session_id: sid };

  if (unloading && LIVE && typeof fetch === 'function') {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...sessionHeaders(sid) };
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
export function flushSignals({ unloading = false }: { unloading?: boolean } = {}) {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  const items = queue.splice(0);

  const byAudience = new Map<SignalAudience, SignalEvent[]>();
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

function enqueue(audience: SignalAudience, event: SignalEvent) {
  queue.push({ audience, event });
  if (queue.length >= BATCH_SIZE) flushSignals();
  else scheduleFlush();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Records one interaction.
 * `product` needs `id` (or `product_id`); `category_id` / `supplier_id` are optional.
 */
export function track(type: SignalType | string, product: SignalProduct, { audience = 'customer', dwellMs, query, source }: TrackOptions = {}) {
  if (!isPersonalizationEnabled()) return;
  if (type === 'DWELL' && !(dwellMs >= MIN_DWELL_MS)) return;

  const event = buildEvent(type, product, { dwellMs, query, source });
  if (!event) return;

  if (type === 'VIEW') {
    // WHY the source is in the key: seeing a product in a rail and again in the grid is two
    // impressions of two surfaces; one shared key would credit only whichever came first.
    const key = `${audience}:${event.source || ''}:${event.product_id}`;
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
export function recordEvent(event: Partial<SignalEvent> | Partial<SignalEvent>[], { audience = 'customer' }: { audience?: SignalAudience } = {}) {
  const list = Array.isArray(event) ? event : [event];
  for (const e of list) {
    if (!e) continue;
    track(
      String(e.event_type || '').toUpperCase(),
      { id: e.product_id, category_id: e.category_id, supplier_id: e.supplier_id, category: e.category },
      { audience, dwellMs: e.dwell_ms, query: e.query, source: e.source || 'feed' }
    );
  }
}

// ── Impressions ──────────────────────────────────────────────────────────────

interface WatchRecord {
  product: SignalProduct;
  audience: SignalAudience;
  source?: string;
  timer: ReturnType<typeof setTimeout> | null;
}

let observer: IntersectionObserver | null = null;
const watched = new WeakMap<Element, WatchRecord>();

function onIntersect(entries: IntersectionObserverEntry[]) {
  for (const entry of entries) {
    const rec = watched.get(entry.target);
    if (!rec) continue;
    if (entry.isIntersecting) {
      if (rec.timer == null) {
        rec.timer = setTimeout(() => {
          rec.timer = null;
          track('VIEW', rec.product, { audience: rec.audience, source: rec.source });
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
export function observeImpression(el: Element | null, product: SignalProduct, { audience = 'customer', source }: { audience?: SignalAudience; source?: string } = {}): () => void {
  if (!el || typeof IntersectionObserver === 'undefined' || trackableId(product) == null) {
    return () => {};
  }
  observer ||= new IntersectionObserver(onIntersect, { threshold: 0.5 });
  watched.set(el, { product, audience, source, timer: null });
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
export function startDwell(product: SignalProduct, { audience = 'customer' }: { audience?: SignalAudience } = {}): () => void {
  if (trackableId(product) == null || typeof document === 'undefined') return () => {};

  let accumulated = 0;
  let since: number | null = document.visibilityState === 'hidden' ? null : Date.now();
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

const recentSearches = new Map<string, number>(); // `${audience}:${query}` → timestamp

/**
 * Records that the shopper ran a search. Call once per results page load with the real result count,
 * never per typeahead keystroke. A repeat of the same query within a few seconds (re-render, back
 * button) is ignored.
 */
export function trackSearch({ query, resultCount, categoryId, audience = 'customer' }: { query?: string; resultCount?: number; categoryId?: number | string | null; audience?: SignalAudience } = {}) {
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
