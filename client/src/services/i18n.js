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
 */

const STORAGE_KEY = 'explooro:lang';
const SUPPORTED = ['en', 'bn'];
const FALLBACK_LANG = 'en';

const loaders = {
  en: () => import('../locales/en.json'),
  bn: () => import('../locales/bn.json'),
};

const dictionaries = {};
const listeners = new Set();
let currentLang = FALLBACK_LANG;

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

function detectInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch {
    // Storage unavailable (private browsing) — fall through to the env default.
  }
  const envDefault = import.meta.env.VITE_DEFAULT_LOCALE;
  return SUPPORTED.includes(envDefault) ? envDefault : FALLBACK_LANG;
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
    if (import.meta.env.DEV) {
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

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function setLanguage(lang) {
  if (!SUPPORTED.includes(lang)) return;
  await loadDictionary(lang);
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Persistence is a convenience — a private-browsing tab still works for the session.
  }
  document.documentElement.lang = lang;
  scanStaticNodes();
  for (const listener of listeners) listener(lang);
}

/** Loads the initial (persisted or env-default) language and scans the static shell once. */
export async function initI18n() {
  const initial = detectInitialLang();
  await loadDictionary(initial);
  currentLang = initial;
  document.documentElement.lang = initial;
  scanStaticNodes();
  return initial;
}
