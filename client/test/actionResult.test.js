/**
 * actionResult.test.js — the result panel that ends a key action (Prompt 13.3).
 *
 * Invariants: the primary button is the next journey step whenever it can be done now, and the dead
 * end's follow-up otherwise; a blocked step's reason becomes the waiting line; all nine of 13.3's
 * actions end on a panel; every panel string exists in English and Bangla.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveActionResult, deadEndById } from '../src/components/guide/ActionResult.ts';
import { DEAD_ENDS } from '../src/config/journeys.ts';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const en = JSON.parse(readFileSync(join(src, 'locales/en.json'), 'utf8'));
const bn = JSON.parse(readFileSync(join(src, 'locales/bn.json'), 'utf8'));
const resolve = (dict, key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'mocks' ? [] : sources(path);
    return name.endsWith('.ts') ? [readFileSync(path, 'utf8')] : [];
  });
}
const callLines = sources(src).flatMap((text) => text.split('\n').filter((line) => line.includes('showActionResult(')));

const step = (over = {}) => ({
  id: 'name_store',
  order: 3,
  route: '/saler/store-builder',
  title_key: 'journey.saler.name_store.title',
  next_key: 'journey.saler.name_store.next',
  status: 'todo',
  blocked_by: null,
  ...over,
});
const next = (current) => ({ enabled: true, reason: null, journey: 'saler', progress: { done: 2, total: 7 }, current, upcoming: [] });

describe('action result — which buttons', () => {
  const kyc = deadEndById('kyc_saler');

  it('a next step that can be done now is the primary; the follow-up is the secondary', () => {
    const out = resolveActionResult(deadEndById('product_added_saler'), next(step()));
    assert.deepEqual(out.primary, { label_key: 'journey.result.next_step', params: { step: 'journey.saler.name_store.title' }, route: '/saler/store-builder' });
    assert.deepEqual(out.secondary, { label_key: 'journey.result.product_added_saler.follow_up', route: '/saler/social-kit' });
    assert.equal(out.waiting_key, null);
  });

  it('no second button when the next step is the follow-up page itself', () => {
    const out = resolveActionResult(kyc, next(step()));
    assert.equal(kyc.followUp, '/saler/store-builder');
    assert.equal(out.primary.route, '/saler/store-builder');
    assert.equal(out.secondary, null);
  });

  it('a blocked next step shows who it waits on and offers the follow-up instead', () => {
    const blocked = step({ id: 'add_product', route: null, status: 'blocked', blocked_by: { reason: 'kyc_review', message_key: 'journey.block.kyc_review' } });
    const out = resolveActionResult(deadEndById('kyc_supplier'), next(blocked));
    assert.equal(out.waiting_key, 'journey.block.kyc_review');
    assert.deepEqual(out.primary, { label_key: 'journey.result.kyc_supplier.follow_up', route: '/supplier/store-status' });
    assert.equal(out.secondary, null);
  });

  it('waiting on a shopper keeps the follow-up as the button even though the step has a page', () => {
    const waiting = step({ id: 'receive_order', route: '/account/orders', status: 'blocked', blocked_by: { reason: 'waiting_for_delivery', message_key: 'journey.block.waiting_for_delivery' } });
    const out = resolveActionResult(deadEndById('checkout'), next(waiting));
    assert.equal(out.primary.route, '/account/orders');
    assert.equal(out.waiting_key, 'journey.block.waiting_for_delivery');
  });

  it('with no next step (journey done, opted out, module off) the follow-up is the button', () => {
    for (const data of [null, next(null)]) {
      const out = resolveActionResult(deadEndById('order_shipped'), data);
      assert.deepEqual(out.primary, { label_key: 'journey.result.order_shipped.follow_up', route: '/supplier/shipments' });
      assert.equal(out.secondary, null);
      assert.equal(out.waiting_key, null);
    }
  });

  it('an unknown dead end is a programming error', () => {
    assert.throws(() => deadEndById('nope'), /no dead end/);
  });
});

describe('action result — coverage', () => {
  const cleared = DEAD_ENDS.filter((d) => d.cleared === '13.3');

  it("all nine of Prompt 13.3's actions end on a panel", () => {
    const actions = new Set(cleared.map((d) => d.action));
    for (const a of [
      'order placed',
      'KYC submitted',
      'product added',
      'store published',
      'withdrawal requested',
      'order shipped',
      'return approved',
      'sample requested',
      'ad campaign created',
    ]) {
      // "product added" is covered by the supplier's entry; the Explooro partner's reads "added to store".
      assert.ok(actions.has(a), a);
    }
  });

  it('every cleared dead end is actually shown by a page', () => {
    const missing = cleared.filter((d) => !callLines.some((line) => line.includes(`'${d.id}'`))).map((d) => d.id);
    assert.deepEqual(missing, []);
  });

  it('only cleared dead ends are shown, so an uncleared one cannot slip in half done', () => {
    const shown = DEAD_ENDS.filter((d) => callLines.some((line) => line.includes(`'${d.id}'`)));
    assert.deepEqual(shown.filter((d) => d.cleared !== '13.3').map((d) => d.id), []);
  });

  it('every panel string exists in English and Bangla', () => {
    const keys = ['journey.result.next_step', 'journey.result.dismiss', ...DEAD_ENDS.flatMap((d) => [d.title_key, d.follow_up_key, d.hint_key])];
    const missing = keys.filter((k) => typeof resolve(en, k) !== 'string' || !/[ঀ-৿]/.test(resolve(bn, k) || ''));
    assert.deepEqual(missing, []);
    assert.ok(resolve(en, 'journey.result.next_step').includes('{{step}}'));
    assert.ok(resolve(bn, 'journey.result.next_step').includes('{{step}}'));
  });
});
