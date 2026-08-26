/**
 * Unit assertions for client/src/services/format.js — Prompt 1.6 ACCEPTANCE line 2:
 * "৳1,23,456.00 renders with correct South Asian grouping — verified with a unit assertion."
 *
 * Run:  node scripts/verify-format.mjs
 *
 * A plain Node + node:assert script rather than a test framework: vitest is not due until
 * Prompt 12.1 per docs/dependency-ledger.md, so this follows the same pattern scripts/palette.mjs
 * already uses for Prompt 0.2 — deterministic checks with zero dependencies, runnable today.
 */
import assert from 'node:assert/strict';
import {
  groupSouthAsian,
  formatNumber,
  formatCurrency,
  formatPhone,
  getNumeralPreference,
  setNumeralPreference,
} from '../client/src/services/format.js';

let passed = 0;
function check(label, actual, expected) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed += 1;
  console.log(`  ok  ${label} → ${actual}`);
}

console.log('## South Asian digit grouping (2,2,3) vs Western (3,3,3)');
check('groupSouthAsian("123456") — the exact spec example', groupSouthAsian('123456'), '1,23,456');
check('groupSouthAsian("1234567")', groupSouthAsian('1234567'), '12,34,567');
check('groupSouthAsian("100000") — where Western and South Asian first diverge', groupSouthAsian('100000'), '1,00,000');
check('groupSouthAsian("999") — no grouping below 1000', groupSouthAsian('999'), '999');

console.log('\n## formatCurrency — the literal PREVIEW example');
check('formatCurrency("123456.00")', formatCurrency('123456.00'), 'Tk 1,23,456.00');
check('formatCurrency(123456)', formatCurrency(123456), 'Tk 1,23,456.00');
check('formatCurrency("-1250.50") — negative sign outside the symbol', formatCurrency('-1250.50'), '-Tk 1,250.50');
check(
  'formatCurrency with Bengali language',
  formatCurrency('123456.00', { lang: 'bn' }),
  '৳ ১,২৩,৪৫৬.০০'
);
check(
  'formatCurrency stays Western when numerals explicitly set to latin',
  formatCurrency('123456.00', { lang: 'bn', numerals: 'latin' }),
  '৳ 1,23,456.00'
);

console.log('\n## formatNumber — grouping without a currency symbol');
check('formatNumber(9876543, { lang: "en" })', formatNumber(9876543, { lang: 'en' }), '98,76,543');
check('formatNumber(9876543, { lang: "bn" })', formatNumber(9876543, { lang: 'bn' }), '৯৮,৭৬,৫৪৩');
check('formatNumber(42, { lang: "en" }) — integer, no forced decimals', formatNumber(42, { lang: 'en' }), '42');

console.log('\n## formatPhone — always Western digits (an ID, not prose)');
check('formatPhone("+8801712345678")', formatPhone('+8801712345678'), '+880 1712-345678');
check('formatPhone("01712345678") — bare local format', formatPhone('01712345678'), '+880 1712-345678');
check('formatPhone with Bengali numerals active — must NOT convert', (() => {
  setNumeralPreference('bengali');
  const result = formatPhone('+8801712345678');
  setNumeralPreference('latin');
  return result;
})(), '+880 1712-345678');

console.log('\n## numeral preference persistence guard (no localStorage under plain Node)');
setNumeralPreference('bengali');
check('getNumeralPreference() bengali', getNumeralPreference(), 'bengali');
setNumeralPreference('latin');
check('getNumeralPreference() latin', getNumeralPreference(), 'latin');

console.log(`\n${passed} assertions passed.`);
