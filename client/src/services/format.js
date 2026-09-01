/**
 * format.js — Bangladesh-specific number, currency, date and phone formatting.
 *
 * Deliberately takes `lang` as an explicit parameter rather than reading services/i18n.js's
 * current language itself: it keeps this module pure and runnable outside a browser (see
 * scripts/verify-format.mjs, which asserts the South Asian grouping example under plain Node —
 * the same "no test runner yet" constraint that pushed the design-token check in Prompt 0.2 into
 * scripts/palette.mjs instead of a proper test suite).
 *
 * South Asian digit grouping (2,2,3), not Western (3,3,3): ৳ 1,23,456.00, not ৳ 123,456.00. This
 * is deterministic string math, not `Intl.NumberFormat('en-IN')` — ICU locale data for the
 * grouping varies by build, and a silently-wrong price is the single most visible bug this file
 * could ship (docs/prompt.md Prompt 1.6 REQUIREMENT 2).
 */

import { getLanguage } from './i18n.js';

const NUMERAL_KEY = 'explooro:numerals';
const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

let numeralPreference = 'bengali';
try {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(NUMERAL_KEY);
    if (saved === 'bengali' || saved === 'latin') numeralPreference = saved;
  }
} catch {
  // Storage unavailable
}

export function getNumeralPreference() {
  return numeralPreference;
}

export function setNumeralPreference(pref) {
  numeralPreference = pref === 'latin' ? 'latin' : 'bengali';
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(NUMERAL_KEY, numeralPreference);
  } catch {
    // Persistence is a convenience, not a guarantee.
  }
}

export function resolveLang(lang) {
  if (lang) return lang;
  try {
    return getLanguage() || 'en';
  } catch {
    return 'en';
  }
}

/** `123456` (number or decimal string) → `{ negative, intPart: '123456', fracPart: '00' }`. */
function splitAmount(amount) {
  if (amount == null || amount === '' || (typeof amount !== 'number' && isNaN(Number(amount)))) {
    return { negative: false, intPart: '0', fracPart: '00' };
  }
  const str = typeof amount === 'number' ? amount.toFixed(2) : String(amount).trim();
  const negative = str.startsWith('-');
  const clean = negative ? str.slice(1) : str;
  const [intRaw, fracRaw = ''] = clean.split('.');
  const intPart = intRaw.replace(/^0+(?=\d)/, '') || '0';
  const fracPart = (fracRaw + '00').slice(0, 2);
  return { negative, intPart, fracPart };
}

/** South Asian grouping: the last 3 digits, then pairs of 2 from the right. `123456` → `1,23,456`. */
export function groupSouthAsian(digits) {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const groups = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length) groups.unshift(rest);
  return [...groups, last3].join(',');
}

/** Converts Western digits to Bengali digits. */
function toBengaliDigits(str) {
  return str.replace(/\d/g, (d) => BENGALI_DIGITS[Number(d)]);
}

function applyNumerals(str, lang, numerals) {
  const activeLang = resolveLang(lang);
  const useBengali = activeLang === 'bn' && (numerals ?? numeralPreference) !== 'latin';
  return useBengali ? toBengaliDigits(str) : str;
}

/** Grouped integer/decimal, no currency symbol. `formatNumber(1234567)` → `'12,34,567'`. */
export function formatNumber(amount, { lang, numerals } = {}) {
  const activeLang = resolveLang(lang);
  const { negative, intPart, fracPart } = splitAmount(amount);
  const grouped = groupSouthAsian(intPart);
  const hasFraction = typeof amount === 'string' ? amount.includes('.') : !Number.isInteger(amount);
  const out = hasFraction ? `${grouped}.${fracPart}` : grouped;
  return `${negative ? '-' : ''}${applyNumerals(out, activeLang, numerals)}`;
}

/** `formatCurrency('123456.00')` → `'৳ 1,23,456.00'` (or `'৳ ১,২৩,৪৫৬.০০'` in Bengali). */
export function formatCurrency(amount, { lang, numerals, symbol } = {}) {
  const activeLang = resolveLang(lang);
  const { negative, intPart, fracPart } = splitAmount(amount);
  const grouped = `${groupSouthAsian(intPart)}.${fracPart}`;
  const defaultSymbol = activeLang === 'bn' ? '৳' : 'Tk';
  const finalSymbol = symbol !== undefined ? symbol : defaultSymbol;
  return `${negative ? '-' : ''}${finalSymbol} ${applyNumerals(grouped, activeLang, numerals)}`;
}

export const formatBdt = formatCurrency;

/** `+8801712345678` → `'+880 1712-345678'`. Always Western digits — an ID, not prose (§3.5.6). */
export function formatPhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  const national = digits.startsWith('880') ? digits.slice(3) : digits.replace(/^0/, '');
  if (national.length !== 10) return String(raw);
  return `+880 ${national.slice(0, 4)}-${national.slice(4)}`;
}

export function formatDate(date, { lang, dateStyle = 'medium' } = {}) {
  const activeLang = resolveLang(lang);
  return new Intl.DateTimeFormat(activeLang === 'bn' ? 'bn' : 'en', { dateStyle }).format(new Date(date));
}

const RELATIVE_UNITS = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Infinity, unit: 'year' },
];

/** `formatRelativeTime(threeHoursAgo, { lang: 'bn' })` → `'৩ ঘণ্টা আগে'`. */
export function formatRelativeTime(date, { lang } = {}) {
  const activeLang = resolveLang(lang);
  const rtf = new Intl.RelativeTimeFormat(activeLang === 'bn' ? 'bn' : 'en', { numeric: 'auto' });
  let duration = (new Date(date).getTime() - Date.now()) / 1000;
  for (const { amount, unit } of RELATIVE_UNITS) {
    if (Math.abs(duration) < amount) return rtf.format(Math.round(duration), unit);
    duration /= amount;
  }
  return rtf.format(Math.round(duration), 'year');
}
