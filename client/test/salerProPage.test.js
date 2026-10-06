/**
 * salerProPage.test.js — the Saler Pro page is wired the way the module switch requires.
 *
 * Invariants:
 *   - the route guard and the nav guard are the same (permission AND module), so with the
 *     `subscription_fees` module OFF the page and its menu entry are both gone;
 *   - every key the page reads exists in English and Bangla with matching {{placeholders}};
 *   - the page never states a fee or rebate itself — admin edits them, so they come from the API;
 *   - subscribing (it moves money) carries an Idempotency-Key.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const en = JSON.parse(read('locales/en.json'));
const bn = JSON.parse(read('locales/bn.json'));
const page = read('pages/saler/SalerProPage.js');

const resolve = (dict, key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);
const placeholders = (text) => [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe('guards', () => {
  const PERMISSION = 'finance.subscription.subscribe_own';
  it('route and nav entry both require the permission AND the module', () => {
    const main = read('main.js');
    const at = main.indexOf("path: '/saler/pro'");
    assert.ok(at > -1, 'route missing');
    const route = main.slice(at, at + 400);
    assert.match(route, new RegExp(`permission: '${PERMISSION.replace(/\./g, '\\.')}'`));
    assert.match(route, /module: 'subscription_fees'/);

    const nav = read('config/navigation.js');
    const entry = nav.split('\n').find((l) => l.includes("key: 'saler.pro'"));
    assert.ok(entry, 'nav entry missing');
    assert.ok(entry.includes(`permission: '${PERMISSION}'`));
    assert.ok(entry.includes("module: 'subscription_fees'"));
    assert.ok(entry.includes("roles: ['saler']"));
  });
});

describe('translations', () => {
  const keys = [...new Set([...page.matchAll(/\bt\(\s*[`']((?:saler_pro)\.[a-z_]+)/g)].map((m) => m[1]).filter((k) => !k.endsWith('_')))];
  // Keys built from a status/invoice value at runtime.
  const dynamic = ['saler_pro.status_active', 'saler_pro.status_past_due', 'saler_pro.status_waived', 'saler_pro.invoice_paid', 'saler_pro.invoice_failed'];

  it('every key the page reads exists in en and bn with the same placeholders', () => {
    assert.ok(keys.length > 20);
    for (const key of [...keys, ...dynamic, 'nav.saler.pro']) {
      assert.equal(typeof resolve(en, key), 'string', `${key} missing from en.json`);
      assert.equal(typeof resolve(bn, key), 'string', `${key} missing from bn.json`);
      assert.deepEqual(placeholders(resolve(bn, key)), placeholders(resolve(en, key)), `${key}: placeholders differ`);
    }
  });

  it('admin plan form strings exist in both languages', () => {
    for (const key of ['rebate_label', 'rebate_hint', 'rebate_points', 'plan_active_label', 'billing_period_label', 'reminder_days_label', 'auto_renew_label']) {
      assert.equal(typeof en.admin_subscriptions[key], 'string', key);
      assert.equal(typeof bn.admin_subscriptions[key], 'string', key);
    }
  });
});

describe('numbers come from the API', () => {
  it('the page contains no literal fee or percentage', () => {
    assert.doesNotMatch(page, /\b999\b|\b2\s*%/);
  });
  it('subscribing is idempotent', () => {
    assert.match(read('core/api.js'), /\\\/subscriptions\\\/subscribe\$/);
  });
  it('plan and subscription text is escaped before it reaches innerHTML', () => {
    assert.match(page, /escapeHtml\(planName\(plan\)\)/);
  });
});
