/**
 * i18n.js — English ⇄ Bengali translation engine, zero reload.
 *
 * Responsibility: `t(key, params?)` resolves a namespaced dot-path against the active locale
 * dictionary; `setLanguage()` swaps the dictionary and re-renders every subscribed node with no
 * page reload. No external dependency — pluralisation rides on the built-in `Intl.PluralRules`
 * rather than a library, per the Dependency Policy.
 *
 *   import { initI18n, t, setLanguage, subscribe } from './services/i18n.js';
 *   await initI18n();                    // loads the dictionary for the active language
 *   el.textContent = t('common.back');
 *   subscribe(() => rerenderMyStuff());  // called after every setLanguage()
 *   setLanguage('bn');
 *
 * Static HTML is translated via `data-i18n="key"` — scanned automatically on init and on every
 * language change, so a page built with plain markup never has to call `t()` by hand.
 *
 * ── Where the default language comes from ──────────────────────────────────────────────────────
 * Three layers, most specific first:
 *
 *   1. The visitor's own saved pick (localStorage), honoured only while the platform policy
 *      allows visitors to choose and the locale is still enabled.
 *   2. The platform policy from `GET /localization/policy` — set by a Super Admin (or a user they
 *      granted `platform.localization.update`) on /admin/platform/language, stored in
 *      platform_settings. This is the system default.
 *   3. `VITE_DEFAULT_LOCALE`, then FALLBACK_LANG. A build-time value is the floor, not the
 *      authority: it is what a developer with no API and no cached policy gets.
 *
 * WHY the policy is cached in localStorage: the boot sequence mounts a language synchronously and
 * reconciles against the server afterwards, the same shape services/themePalette.js uses. Awaiting
 * the network before the first paint would trade a round trip for nothing, and NOT reconciling
 * would mean an admin's change reached nobody who already had the site open.
 */

const STORAGE_KEY = 'explooro:lang';
const POLICY_STORAGE_KEY = 'explooro:lang:policy';
const POLICY_ENDPOINT = '/localization/policy';
const SUPPORTED = ['en', 'bn'];
const FALLBACK_LANG = 'en';

const loaders = {
  en: () => import('../locales/en.json'),
  bn: () => import('../locales/bn.json'),
};

const dictionaries = {};
const listeners = new Set();
const policyListeners = new Set();
let currentLang = FALLBACK_LANG;

/** The shipped policy, replaced by the cached one on boot and the server's one shortly after. */
let policy = {
  default_locale: null,
  enabled_locales: [...SUPPORTED],
  allow_user_override: true,
};

/** Flattens `{ nav: { marketplace: '...' } }` into `{ 'nav.marketplace': '...' }`. */
function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

async function loadDictionary(lang) {
  if (!dictionaries[lang]) {
    const mod = await loaders[lang]();
    dictionaries[lang] = flatten(mod.default ?? mod);
  }
  return dictionaries[lang];
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage unavailable (private browsing) — callers fall back to the next layer.
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence is a convenience — a private-browsing tab still works for the session.
  }
}

/** Keeps only locales this build actually ships a dictionary for. */
function sanitisePolicy(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const enabled = Array.isArray(raw.enabled_locales)
    ? raw.enabled_locales.filter((l) => SUPPORTED.includes(l))
    : [];
  const defaultLocale = SUPPORTED.includes(raw.default_locale) ? raw.default_locale : null;
  if (!defaultLocale && enabled.length === 0) return null;
  return {
    default_locale: defaultLocale,
    enabled_locales: enabled.length ? enabled : [...SUPPORTED],
    allow_user_override: typeof raw.allow_user_override === 'boolean' ? raw.allow_user_override : true,
  };
}

function loadCachedPolicy() {
  const raw = readStorage(POLICY_STORAGE_KEY);
  if (!raw) return null;
  try {
    return sanitisePolicy(JSON.parse(raw));
  } catch {
    return null;
  }
}

function cachePolicy(next) {
  writeStorage(POLICY_STORAGE_KEY, JSON.stringify(next));
}

/** The build-time floor: what a developer with no API and no cached policy gets. */
function envDefaultLang() {
  const envDefault = import.meta.env?.VITE_DEFAULT_LOCALE;
  return SUPPORTED.includes(envDefault) ? envDefault : FALLBACK_LANG;
}

/**
 * Resolves the language to show, given the current policy and the visitor's saved pick.
 * Pure apart from reading storage, so the precedence order is testable in one place.
 */
function resolveLang() {
  const enabled = policy.enabled_locales?.length ? policy.enabled_locales : SUPPORTED;
  const systemDefault = policy.default_locale && enabled.includes(policy.default_locale)
    ? policy.default_locale
    : (enabled.includes(envDefaultLang()) ? envDefaultLang() : enabled[0]);

  if (!policy.allow_user_override) return systemDefault;

  const saved = readStorage(STORAGE_KEY);
  if (saved && SUPPORTED.includes(saved) && enabled.includes(saved)) return saved;

  return systemDefault;
}

/** Turns a missing key into a readable label instead of a blank string or the raw dot-path. */
function humanize(key) {
  const last = key.split('.').pop() ?? key;
  return last.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

function pluralCategory(lang, count) {
  try {
    return new Intl.PluralRules(lang).select(count);
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

function resolve(dict, key, params) {
  if (dict && params && typeof params.count === 'number') {
    const category = pluralCategory(currentLang, params.count);
    if (`${key}.${category}` in dict) return dict[`${key}.${category}`];
    if (`${key}.other` in dict) return dict[`${key}.other`];
  }
  return dict?.[key];
}

/**
 * Translates `key`. Missing keys fall back to English, then to an inline default, then to a
 * humanized label — never blank.
 *
 * Two call shapes are supported:
 *   t('cart.title')                          → dictionary lookup
 *   t('cart.items', { count: 3 })            → lookup + plural selection + {{count}} interpolation
 *   t('cart.title', 'Your Cart')             → lookup, using the literal as the last-resort default
 *   t('cart.items', 'Cart', { count: 3 })    → both
 *
 * WHY the string form: ~860 call sites across the app were already written as
 * `t('some.key', 'English text')`, on the reasonable assumption that the second argument was a
 * default. It was being passed straight into `interpolate` as `params` instead, so a missing key
 * rendered a humanized slug ("Btn Explore All") rather than the author's English. Accepting a
 * string here honours the convention the codebase already uses, and keeps the object form intact.
 */
export function t(key, paramsOrDefault, maybeParams) {
  const hasStringDefault = typeof paramsOrDefault === 'string';
  const defaultValue = hasStringDefault ? paramsOrDefault : undefined;
  const params = hasStringDefault ? maybeParams : paramsOrDefault;

  let value = resolve(dictionaries[currentLang], key, params);

  if (value === undefined) {
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[i18n] missing key "${key}" for locale "${currentLang}"`);
    }
    value = resolve(dictionaries[FALLBACK_LANG], key, params);
  }

  if (value === undefined) value = defaultValue;
  if (value === undefined) value = humanize(key);

  return interpolate(value, params);
}

export function scanStaticNodes(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}

export function getLanguage() {
  return currentLang;
}

/** Every locale this build ships a dictionary for, whether or not the platform enables it. */
export function getSupportedLanguages() {
  return [...SUPPORTED];
}

/** The live platform policy. A copy, so a caller cannot mutate the engine's state. */
export function getLocalePolicy() {
  return {
    default_locale: policy.default_locale ?? envDefaultLang(),
    enabled_locales: [...(policy.enabled_locales?.length ? policy.enabled_locales : SUPPORTED)],
    allow_user_override: policy.allow_user_override !== false,
  };
}

/** The locales the switcher may offer right now. */
export function getEnabledLanguages() {
  return getLocalePolicy().enabled_locales;
}

/**
 * Whether a visitor is allowed to change language at all. Controls whose job it is to *hide* the
 * switcher — `setLanguage()` enforces the same rule, so a stale control cannot defeat the policy.
 */
export function isLanguageSwitchAllowed() {
  return getLocalePolicy().allow_user_override && getEnabledLanguages().length > 1;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fires when the platform policy changes, so the shell can add or drop the language switcher. */
export function subscribeLocalePolicy(listener) {
  policyListeners.add(listener);
  return () => policyListeners.delete(listener);
}

/** Swaps the dictionary and notifies subscribers. Does NOT persist — see setLanguage(). */
async function applyLanguage(lang) {
  await loadDictionary(lang);
  currentLang = lang;
  document.documentElement.lang = lang;
  scanStaticNodes();
  for (const listener of listeners) listener(lang);
}

/**
 * A visitor's own language choice. Persisted, and refused when the platform policy does not allow
 * visitors to choose or does not enable the requested locale.
 *
 * Returns true when the language actually changed, so a caller can report a refusal rather than
 * silently appearing to succeed.
 */
export async function setLanguage(lang) {
  if (!SUPPORTED.includes(lang)) return false;
  if (!policy.allow_user_override) return false;
  if (!getEnabledLanguages().includes(lang)) return false;

  await applyLanguage(lang);
  writeStorage(STORAGE_KEY, lang);
  return true;
}

/**
 * Adopts a policy and re-applies the resolved language if it changed.
 *
 * Exported for the admin page: after a successful save, the operator should see the effect of
 * their own change immediately instead of on their next cold load.
 */
export async function applyLocalePolicy(raw, { cache = true } = {}) {
  const next = sanitisePolicy(raw);
  if (!next) return currentLang;

  policy = next;
  if (cache) cachePolicy(next);

  // A visitor whose saved pick the policy no longer permits must not keep it, or disabling a
  // locale would leave existing sessions on it forever.
  if (!next.allow_user_override || !next.enabled_locales.includes(readStorage(STORAGE_KEY))) {
    const resolved = resolveLang();
    if (resolved !== currentLang) await applyLanguage(resolved);
  }

  for (const listener of policyListeners) listener(getLocalePolicy());
  return currentLang;
}

/**
 * Loads the initial language and scans the static shell once.
 *
 * Mounts synchronously from the cached policy (or the build-time default), then reconciles against
 * the server without blocking the first paint.
 */
export async function initI18n() {
  const cached = loadCachedPolicy();
  if (cached) policy = cached;

  const initial = resolveLang();
  await loadDictionary(initial);
  currentLang = initial;
  document.documentElement.lang = initial;
  scanStaticNodes();

  // Fire-and-forget: a slow or missing API must not delay the first route mount. The dynamic
  // import also keeps core/api.js (which pulls in the mock router and the toast service) out of
  // this module's static import graph.
  refreshLocalePolicy();

  return initial;
}

/** Re-reads the platform policy from the API and applies it. Never throws. */
export async function refreshLocalePolicy() {
  try {
    const { api } = await import('../core/api.js');
    const res = await api.get(POLICY_ENDPOINT);
    if (res?.policy) await applyLocalePolicy(res.policy);
  } catch {
    // No API, offline, or the endpoint is not deployed yet — the mounted language stands.
  }
  return getLocalePolicy();
}
