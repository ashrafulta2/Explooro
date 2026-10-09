/**
 * bengaliDigitsInText.test.js — a count inside a translated sentence follows the UI language.
 *
 * WHY: money already printed Bengali digits, but `t('…days_left', { count: 7 })` printed "7 দিন".
 * The i18n engine now passes every number param through localizeDigits.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localizeDigits } from '../src/services/format.js';

describe('Bengali digits inside translated text', () => {
  test('Bengali UI gets Bengali digits, with no grouping added', () => {
    assert.equal(localizeDigits(7, { lang: 'bn' }), '৭');
    assert.equal(localizeDigits(2026, { lang: 'bn' }), '২০২৬');
    assert.equal(localizeDigits(12.5, { lang: 'bn' }), '১২.৫');
  });

  test('English UI and a Latin-numeral choice are unchanged', () => {
    assert.equal(localizeDigits(2026, { lang: 'en' }), '2026');
    assert.equal(localizeDigits(7, { lang: 'bn', numerals: 'latin' }), '7');
  });

  test('t() converts number params only, never strings such as refs', () => {
    const src = readFileSync(new URL('../src/services/i18n.js', import.meta.url), 'utf8');
    assert.match(src, /typeof value === 'number' && Number\.isFinite\(value\)\s*\?\s*localizeDigits\(value, \{ lang: currentLang \}\)\s*:\s*String\(value\)/);
  });
});
