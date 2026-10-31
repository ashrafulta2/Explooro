/**
 * variantOptions.test.js — which variant options a category offers (services/variantOptions.service.ts).
 *
 * Invariants: nothing set means every option (the old behaviour); a subcategory without its own
 * entry follows its nearest parent; a save is strict, a read is forgiving; the variant save refuses
 * an option the category does not offer.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFor, sanitizeRules, validateRules } from '../src/services/variantOptions.service.ts';
import { assertCategoryOptions, normalizeVariantInput, VARIANT_ATTRIBUTE_KEYS } from '../src/services/productVariant.service.ts';

// 1 Groceries > 2 Rice > 3 Basmati ; 4 Fashion
const parents = new Map([
  ['1', null],
  ['2', '1'],
  ['3', '2'],
  ['4', null],
]);

describe('resolveFor', () => {
  test('nothing set offers every option', () => {
    assert.deepEqual(resolveFor({ categories: {} }, 3, parents), [...VARIANT_ATTRIBUTE_KEYS]);
  });

  test('a subcategory follows its nearest parent with an entry', () => {
    const rules = { categories: { 1: ['weight', 'pack_size'] } };
    assert.deepEqual(resolveFor(rules, 3, parents), ['weight', 'pack_size']);
    assert.deepEqual(resolveFor(rules, 4, parents), [...VARIANT_ATTRIBUTE_KEYS], 'an unrelated category is untouched');
  });

  test('its own entry wins over the parent', () => {
    const rules = { categories: { 1: ['weight'], 2: ['pack_size'] } };
    assert.deepEqual(resolveFor(rules, 3, parents), ['pack_size']);
  });

  test('a parent cycle in bad data ends instead of looping', () => {
    const loop = new Map([['7', '8'], ['8', '7']]);
    assert.deepEqual(resolveFor({ categories: {} }, 7, loop), [...VARIANT_ATTRIBUTE_KEYS]);
  });
});

describe('the admin page preview uses the same rule as the server', () => {
  test('client resolveFor equals server resolveFor on every case', async () => {
    const { resolveFor: clientResolve } = await import('../../client/src/config/variantDimensions.ts');
    const cases = [
      { categories: {} },
      { categories: { 1: ['weight', 'pack_size'] } },
      { categories: { 1: ['weight'], 2: ['pack_size'] } },
      { categories: { 3: ['color'], 4: ['size', 'material'] } },
    ];
    for (const rules of cases) {
      for (const id of [1, 2, 3, 4, 99, null]) {
        assert.deepEqual(clientResolve(rules, id, parents), resolveFor(rules, id, parents), `rules ${JSON.stringify(rules)} id ${id}`);
      }
    }
  });
});

describe('validateRules (a save is strict)', () => {
  test('keeps the list in the standard order', () => {
    assert.deepEqual(validateRules({ categories: { 1: ['pack_size', 'weight'] } }, [1]), { categories: { 1: ['weight', 'pack_size'] } });
  });
  test('refuses an unknown option', () => {
    assert.throws(() => validateRules({ categories: { 1: ['flavour'] } }, [1]), /not a variant option/);
  });
  test('refuses a category that does not exist', () => {
    assert.throws(() => validateRules({ categories: { 99: ['size'] } }, [1]), /does not exist/);
  });
  test('refuses an empty list (remove the entry to allow everything)', () => {
    assert.throws(() => validateRules({ categories: { 1: [] } }, [1]), /at least one option/);
  });
  test('an empty object is valid: every category back to every option', () => {
    assert.deepEqual(validateRules({ categories: {} }, [1]), { categories: {} });
  });
});

describe('sanitizeRules (a read is forgiving)', () => {
  test('drops unknown options and malformed entries instead of throwing', () => {
    assert.deepEqual(sanitizeRules({ categories: { 1: ['weight', 'flavour'], x: ['size'], 2: 'size', 3: ['nope'] } }), {
      categories: { 1: ['weight'] },
    });
  });
  test('a missing row is no rules', () => {
    assert.deepEqual(sanitizeRules(null), { categories: {} });
  });
});

describe('the variant save follows the category', () => {
  test('refuses an option the category does not offer', () => {
    const rows = normalizeVariantInput([{ attributes: { size: 'M' }, stock_qty: 1 }]);
    assert.throws(() => assertCategoryOptions(rows, ['weight', 'pack_size']), /does not offer "size"/);
  });
  test('accepts the options it does offer', () => {
    const rows = normalizeVariantInput([{ attributes: { weight: '1 kg' }, stock_qty: 1 }]);
    assert.doesNotThrow(() => assertCategoryOptions(rows, ['weight', 'pack_size']));
  });
});
