/**
 * subscriptionPlans.test.js — Saler Pro plan rules (admin side).
 *
 * Invariants guarded here:
 *   - a plan's commission rebate can never exceed the platform's own share;
 *   - plan numbers are validated, never silently coerced (a negative fee must not reach the DB);
 *   - the engine settings accept only known keys, so a typo cannot create a phantom setting;
 *   - the admin routes stay behind finance.subscription.manage.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsePlanInput,
  parseEngineSettings,
  parseWaiverDuration,
  assertRebateWithinPlatformShare,
  slugifyCode,
  ENGINE_DEFAULTS,
  MODULE_KEY,
} from '../src/services/subscription.service.js';

const validationFailed = (fn) =>
  assert.throws(fn, (err) => err.code === 'VALIDATION_FAILED' && typeof err.messageBn === 'string' && err.messageBn.length > 0);

describe('parsePlanInput', () => {
  test('accepts the shape the admin plan editor sends', () => {
    const out = parsePlanInput({
      name_en: ' Saler Pro ', name_bn: 'সেলার প্রো', monthly_fee: 999,
      free_listings: 1000, extra_listing_fee: 2, commission_rebate_pct: 2,
    });
    assert.equal(out.name_en, 'Saler Pro');
    assert.equal(out.commission_rebate_pct, 2);
    assert.equal(out.monthly_fee, 999);
  });

  test('falls back to the English name when no Bangla name is given', () => {
    assert.equal(parsePlanInput({ name_en: 'Gold' }).name_bn, 'Gold');
  });

  test('rejects a negative fee, an over-100 rebate and a fractional listing quota', () => {
    validationFailed(() => parsePlanInput({ name_en: 'x', monthly_fee: -1 }));
    validationFailed(() => parsePlanInput({ name_en: 'x', commission_rebate_pct: 100.5 }));
    validationFailed(() => parsePlanInput({ name_en: 'x', free_listings: 10.5 }));
    validationFailed(() => parsePlanInput({ name_en: 'x', monthly_fee: 'abc' }));
    validationFailed(() => parsePlanInput({ name_en: 'x', monthly_fee: '' }));
  });

  test('create requires a name, update does not', () => {
    validationFailed(() => parsePlanInput({}));
    assert.deepEqual(parsePlanInput({ monthly_fee: 5 }, { partial: true }), { monthly_fee: 5 });
  });

  test('ignores unknown keys instead of storing them (code is immutable)', () => {
    const out = parsePlanInput({ name_en: 'x', code: 'hijack', id: 9, status: 'x' });
    assert.equal('code' in out, false);
    assert.equal('id' in out, false);
  });

  test('rejects an unknown role and an oversized feature list', () => {
    validationFailed(() => parsePlanInput({ name_en: 'x', role: 'customer' }));
    validationFailed(() => parsePlanInput({ name_en: 'x', features_en: Array(13).fill('a') }));
    validationFailed(() => parsePlanInput({ name_en: 'x', features_en: [''] }));
  });
});

describe('assertRebateWithinPlatformShare', () => {
  test('a rebate up to the platform share is allowed', () => {
    assert.equal(assertRebateWithinPlatformShare(2, 60), 2);
    assert.equal(assertRebateWithinPlatformShare(60, 60), 60);
  });

  test('a rebate above the platform share is refused — it would push the platform below zero', () => {
    validationFailed(() => assertRebateWithinPlatformShare(60.01, 60));
    validationFailed(() => assertRebateWithinPlatformShare(5, 4));
  });
});

describe('parseEngineSettings', () => {
  test('every default is itself a valid setting', () => {
    assert.deepEqual(parseEngineSettings({ ...ENGINE_DEFAULTS }), { ...ENGINE_DEFAULTS });
  });

  test('rejects an unknown key rather than creating a phantom setting', () => {
    validationFailed(() => parseEngineSettings({ grace_period_dayz: 3 }));
  });

  test('rejects a fractional or negative day count', () => {
    validationFailed(() => parseEngineSettings({ grace_period_days: 2.5 }));
    validationFailed(() => parseEngineSettings({ billing_period_days: -30 }));
  });
});

describe('parseWaiverDuration', () => {
  test('N_MONTHS yields N, PERMANENT yields no end date', () => {
    assert.equal(parseWaiverDuration('3_MONTHS'), 3);
    assert.equal(parseWaiverDuration('6_MONTHS'), 6);
    assert.equal(parseWaiverDuration('PERMANENT'), null);
  });

  test('anything else is refused', () => {
    validationFailed(() => parseWaiverDuration('0_MONTHS'));
    validationFailed(() => parseWaiverDuration('FOREVER'));
    validationFailed(() => parseWaiverDuration('99_MONTHS'));
  });
});

describe('slugifyCode', () => {
  test('makes a stable ASCII code, with a fallback for names with no ASCII letters', () => {
    assert.equal(slugifyCode('Saler Pro!'), 'saler_pro');
    assert.equal(slugifyCode('সেলার প্রো'), 'plan');
  });
});

describe('subscription admin routes', () => {
  const src = readFileSync(new URL('../src/routes/finance.routes.js', import.meta.url), 'utf8');
  const routes = [...src.matchAll(/app\.(get|put|post|patch)\('(\/admin\/finance\/subscriptions[^']*)'[\s\S]*?\}\);/g)];

  test('all five routes exist and each is guarded by finance.subscription.manage', () => {
    assert.equal(routes.length, 5);
    for (const [block] of routes) assert.match(block, /requirePermission\('finance\.subscription\.manage'\)/);
  });

  test('id params are validated as digits', () => {
    const withParam = routes.filter(([, , path]) => path.includes(':id'));
    assert.equal(withParam.length, 2);
    for (const [block] of withParam) assert.match(block, /pattern: '\^\\\\d\+\$'/);
  });
});

describe('module wiring', () => {
  test('the switch is the existing subscription_fees module, default OFF', () => {
    const seed = JSON.parse(readFileSync(new URL('../src/config/modules.seed.json', import.meta.url), 'utf8'));
    const mod = (seed.modules || seed).find((m) => m.key === MODULE_KEY);
    assert.ok(mod, 'subscription_fees must exist in modules.seed.json');
    assert.equal(mod.default_enabled, false);
    for (const key of Object.keys(ENGINE_DEFAULTS)) {
      assert.ok(key in mod.sub_settings_schema.properties, `schema is missing ${key}`);
      assert.equal(mod.sub_settings_schema.properties[key].default, ENGINE_DEFAULTS[key], `default drift on ${key}`);
    }
  });
});
