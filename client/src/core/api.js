/**
 * api.js — fetch wrapper implementing docs/api-contract.md.
 *
 * Mock/live switch: `import.meta.env.VITE_API_MODE`. `mock` (the default) resolves against
 * client/src/mocks with simulated 150–400ms latency, so the app is fully previewable for the next
 * ~10 phases before the backend exists. `live` calls the real API through the Vite proxy. Callers
 * never know which — see docs/api-contract.md §1 "Client compatibility rule".
 */
import { handleMockRequest } from '../mocks/index.js';
import { toast } from '../services/toast.js';

const MODE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_MODE === 'live') ? 'live' : 'mock';
const BASE = '/api/v1';
export const API_BASE = BASE;

// docs/api-contract.md §5.1 — endpoints that move money, create an order, or trigger an
// irreversible side effect MUST carry an Idempotency-Key. Kept as a whitelist, not a POST/PATCH
// blanket rule, because a retried key on a non-money endpoint would just be wasted overhead.
const IDEMPOTENT_ROUTES = [
  /^\/orders\/checkout$/,
  /^\/vault\/withdraw$/,
  /^\/payments\/execute$/,
  /^\/returns\/[^/]+\/refund$/,
  /^\/team-purchases\/join$/,
  /^\/coupons\/redeem$/,
  /^\/admin\/pending-actions\/[^/]+$/,
  /^\/admin\/payouts\/batch$/,
];

/** Thrown for every 4xx/5xx response. Carries both language messages per §2.3 "Field rules". */
export class ApiError extends Error {
  constructor({ code, message_en, message_bn, details, trace_id, status }) {
    super(message_en || code);
    this.name = 'ApiError';
    this.code = code;
    this.message_en = message_en;
    this.message_bn = message_bn;
    this.details = details ?? {};
    this.trace_id = trace_id;
    this.status = status;
    // §3.7 — PERMISSION_DENIED carries whether a Request Access flow is possible.
    this.requestable = this.details.requestable ?? false;
  }
}

// Access tokens live in memory only — never localStorage, which any XSS can read (§8).
let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

/** Read-only accessor for hand-rolled requests that can't go through request() — e.g. SSE streams. */
export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
}

function currentLang() {
  return document.documentElement.lang === 'bn' ? 'bn' : 'en';
}

// docs/api-contract.md §8 double-submit pattern: the server sets a JS-readable `csrf` cookie
// alongside the HttpOnly refresh cookie and requires it echoed back as this header on
// cookie-authenticated POSTs (refresh, logout) — read fresh each call since login/refresh rotate it.
function currentCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Picks the error message matching the active UI language, falling back to the other. */
export function pickMessage(err) {
  return currentLang() === 'bn' ? err.message_bn ?? err.message_en : err.message_en ?? err.message_bn;
}

function needsIdempotencyKey(method, path, explicit) {
  if (explicit !== undefined) return explicit;
  return (method === 'POST' || method === 'PATCH') && IDEMPOTENT_ROUTES.some((re) => re.test(path));
}

function buildHeaders(method, path, options) {
  const headers = {
    'Accept-Language': currentLang(),
    ...options.headers,
  };
  // WHY: a Content-Type header on a bodyless request (e.g. api.post('/auth/refresh')) makes
  // Fastify's JSON body parser choke on the empty body, surfacing as an unhandled 500 instead of
  // the harmless no-body case it actually is.
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const csrfToken = currentCsrfToken();
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  if (needsIdempotencyKey(method, path, options.idempotent)) {
    headers['Idempotency-Key'] = options.idempotencyKey ?? crypto.randomUUID();
  }
  return headers;
}

// WHY single-flight: refresh tokens are single-use and rotating, and the server treats a second
// presentation of an already-used one as token theft — it revokes the whole session
// (auth.service.js `refresh_reuse_detected`), which logs the user out for good. A page that fires
// several requests in parallel produces several simultaneous 401s, so without de-duplication the
// *second* refresh would kill the session the first one just renewed. Every caller — the 401 retry
// below and session.js's bootstrap/proactive timer alike — must go through this one promise.
let refreshInFlight = null;

/**
 * Renews the access token from the HttpOnly refresh cookie, at most once at a time.
 * Resolves to the refresh payload (`{ access_token, user, ... }`) on success, `null` on failure.
 */
export function refreshSession() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      // WHY mock is not short-circuited here any more: the mock /auth/refresh handler restores the
      // session persisted at login (sessionStorage), so reloading the page or opening an
      // /account/* URL directly keeps the developer signed in instead of bouncing them to /login.
      if (MODE !== 'live') {
        const { status, body } = await performMock('POST', '/auth/refresh', {});
        if (status !== 200) return null;
        const token = body?.data?.access_token ?? null;
        if (!token) return null;
        accessToken = token;
        return body.data;
      }

      const csrfToken = currentCsrfToken();
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
      });
      if (!res.ok) return null;
      const parsed = await res.json().catch(() => null);
      const token = parsed?.data?.access_token ?? null;
      if (!token) return null;
      accessToken = token;
      return parsed.data;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function performLive(method, path, { body, query, headers }) {
  const url = new URL(BASE + path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, body: parsed };
}

async function performMock(method, path, { body, query, params }) {
  // Simulated network latency (150–400ms) so loading states are real, not instant, in dev.
  const delay = 150 + Math.random() * 250;
  await new Promise((resolve) => setTimeout(resolve, delay));
  const q = query || params || {};
  return handleMockRequest({ method, path, query: q, body });
}

function handleGlobalCodes(err) {
  // §3.2 — the feature is off platform-wide; the calling UI hides the affordance, api.js owns
  // telling the user why in case something still slipped through.
  if (err.code === 'MODULE_DISABLED') {
    toast.warning(pickMessage(err));
  }
  // §3.7 — the locked-state UI (lock icon + Request Access / Submit for approval) is built in
  // Prompt 1.7's PermissionGate; it listens for this event rather than every call site branching
  // on the error code itself.
  if (err.code === 'PERMISSION_DENIED') {
    window.dispatchEvent(new CustomEvent('explooro:permission-denied', { detail: err }));
  }
}

async function request(method, path, options = {}, retried = false) {
  const headers = buildHeaders(method, path, options);
  const { status, body } =
    MODE === 'live'
      ? await performLive(method, path, { ...options, headers })
      : await performMock(method, path, { ...options, headers });

  // §2.2 — deferred: valid and accepted, nothing has changed yet. Never rendered as an error.
  if (status === 202 && body.deferred) {
    return { deferred: body.deferred };
  }

  if (status >= 200 && status < 300) {
    // docs/api-contract.md §2 specifies a { data, meta } envelope, but most endpoints still reply
    // with a bare payload ({ users, total }, { modules }, …). Unwrapping `data` unconditionally
    // turned every one of those into `null` at the call site — the page mounted, the request
    // returned 200, and the table rendered empty with nothing logged. So: keep `data` for
    // enveloped responses, and also spread the raw body so call sites written against the bare
    // shape keep working. `!== undefined` (not `??`) so an explicit `data: null` stays null.
    return { ...body, data: body.data !== undefined ? body.data : body, meta: body.meta ?? {} };
  }

  const err =
    body.error ?? {
      code: 'INTERNAL_ERROR',
      message_en: 'Something went wrong.',
      message_bn: 'কিছু ভুল হয়েছে।',
    };

  if (status === 401 && err.code === 'AUTH_EXPIRED' && !retried) {
    const refreshed = await refreshSession();
    if (refreshed) return request(method, path, options, true);
  }

  // WHY skipAuthRedirect: some calls (guest cart/wishlist reads) are expected to 401 for a
  // browsing guest and must fail silently in place — forcing a redirect here would yank a guest
  // off whatever public page they're looking at just because a background fetch wasn't allowed.
  if (status === 401 && ['AUTH_EXPIRED', 'AUTH_INVALID', 'AUTH_REQUIRED'].includes(err.code)) {
    clearAccessToken();
    if (!options.skipAuthRedirect) {
      window.dispatchEvent(new CustomEvent('explooro:auth-required'));
    }
  }

  handleGlobalCodes(err);

  throw new ApiError({ ...err, status });
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  delete: (path, options) => request('DELETE', path, options),
};

export default api;
