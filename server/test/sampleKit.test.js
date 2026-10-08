/**
 * sampleKit.test.js — the rules behind sample requests and marketing kits.
 *
 *   1. The platform's share, the supplier's share and the saler's payment always reconcile to the paisa,
 *      and the platform's share is taken from the sample PRICE only, never the shipping.
 *   2. Offers and kits are validated strictly: out-of-range input is refused, never clamped.
 *   3. A request can only move along legal transitions, so it cannot end twice (and so cannot pay twice).
 *   4. Every number is a platform setting; a malformed stored value falls back field by field.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, TRANSITIONS, resolveRules, splitSample, validateOffer, validateKit, validateShipTo,
} from '../src/services/sampleKit.service.js';

const rules = resolveRules(null);

test('resolveRules falls back field by field and refuses nonsense', () => {
  assert.deepEqual(resolveRules(undefined), { ...DEFAULT_RULES, blocked_grades: ['D'] });
  const r = resolveRules({ platform_fee_pct: 90, response_days: 'soon', auto_confirm_days: 5, blocked_grades: ['A', 'Z'] });
  assert.equal(r.platform_fee_pct, DEFAULT_RULES.platform_fee_pct); // above the 50 cap -> default
  assert.equal(r.response_days, DEFAULT_RULES.response_days);
  assert.equal(r.auto_confirm_days, 5);
  assert.deepEqual(r.blocked_grades, ['A']);
});

test('resolveRules never lets min_price exceed max_price', () => {
  const r = resolveRules({ min_price: 900, max_price: 100 });
  assert.equal(r.min_price, DEFAULT_RULES.min_price);
  assert.equal(r.max_price, DEFAULT_RULES.max_price);
});

test('splitSample: fee + supplier always equal the total, to the paisa, and fee ignores shipping', () => {
  for (const [price, shipping, pct] of [[199.99, 60, 10], [10, 0, 10], [1234.56, 120.5, 7.5], [0.01, 0, 50], [5000, 300, 0], [333.33, 33.33, 33.33]]) {
    const s = splitSample({ price, shippingFee: shipping, platformFeePct: pct });
    assert.equal(s.feePaisa + s.supplierPaisa, s.totalPaisa, `reconcile ${price}/${shipping}/${pct}`);
    assert.equal(s.totalPaisa, Math.round(price * 100) + Math.round(shipping * 100));
    assert.equal(s.feePaisa, Math.round((Math.round(price * 100) * pct) / 100), 'fee comes from the price only');
    assert.ok(s.supplierPaisa >= Math.round(shipping * 100), 'supplier always receives at least the shipping');
  }
  const s = splitSample({ price: 200, shippingFee: 60, platformFeePct: 10 });
  assert.deepEqual([s.total, s.fee, s.supplier], ['260.00', '20.00', '240.00']);
});

test('validateOffer accepts a good offer and defaults shipping to zero', () => {
  assert.deepEqual(validateOffer({ price: '150', shipping_fee: '40' }, rules), { price: 150, shipping_fee: 40, is_active: true });
  assert.deepEqual(validateOffer({ price: 150, is_active: false }, rules), { price: 150, shipping_fee: 0, is_active: false });
});

test('validateOffer refuses every way an offer can be out of bounds', () => {
  const bad = (input) => assert.throws(() => validateOffer(input, rules), (e) => e.code === 'VALIDATION_FAILED');
  bad(null);
  bad({});
  bad({ price: 'free' });
  bad({ price: '' });
  bad({ price: rules.min_price - 0.01 });
  bad({ price: rules.max_price + 0.01 });
  bad({ price: 100.123 });                                    // finer than a paisa
  bad({ price: 100, shipping_fee: -1 });
  bad({ price: 100, shipping_fee: rules.max_shipping_fee + 1 });
});

test('validateKit trims, de-duplicates and normalises hashtags', () => {
  const kit = validateKit({
    caption_en: '  Fresh stock  ',
    hashtags: ['eid', '#Eid', ' ##panjabi ', 'two words', '', '#'],
    selling_points: ['100% cotton', '100% COTTON', 'Free size'],
    video_url: 'https://example.com/v/1',
  }, rules);
  assert.equal(kit.caption_en, 'Fresh stock');
  assert.equal(kit.caption_bn, null);
  assert.deepEqual(kit.hashtags, ['#eid', '#panjabi', '#twowords']);
  assert.deepEqual(kit.selling_points, ['100% cotton', 'Free size']);
  assert.equal(kit.video_url, 'https://example.com/v/1');
  assert.equal(kit.is_published, true);
});

test('validateKit refuses an empty kit, a non-web video link, and over-limit content', () => {
  const bad = (input) => assert.throws(() => validateKit(input, rules), (e) => e.code === 'VALIDATION_FAILED');
  bad({});
  bad({ caption_en: '   ' });
  bad({ caption_en: 'ok', video_url: 'javascript:alert(1)' });
  bad({ caption_en: 'ok', video_url: 'ftp://example.com/x' });
  bad({ caption_en: 'ok', video_url: 'not a url' });
  bad({ caption_en: 'x'.repeat(rules.caption_max_chars + 1) });
  bad({ hashtags: Array.from({ length: rules.max_hashtags + 1 }, (_, i) => `tag${i}`) });
  bad({ selling_points: Array.from({ length: rules.max_selling_points + 1 }, (_, i) => `point ${i}`) });
  bad({ hashtags: 'eid' });
});

test('validateShipTo needs a name, a real-looking phone and an address', () => {
  assert.deepEqual(validateShipTo({ name: ' Rahim ', phone: '01712-345678', address: 'House 1, Road 2' }), { name: 'Rahim', phone: '01712-345678', address: 'House 1, Road 2' });
  const bad = (input) => assert.throws(() => validateShipTo(input), (e) => e.code === 'VALIDATION_FAILED');
  bad(null);
  bad({ name: 'A', phone: '01712345678' });
  bad({ name: 'A', address: 'x', phone: 'call me' });
  bad({ name: 'A', address: 'x', phone: '123' });
  bad({ address: 'x', phone: '01712345678' });
});

test('transitions: only legal moves exist, and a finished request has no way out', () => {
  const finished = ['DELIVERED', 'DECLINED', 'CANCELLED', 'EXPIRED'];
  for (const [action, rule] of Object.entries(TRANSITIONS)) {
    for (const status of finished) {
      assert.ok(!rule.from.includes(status), `${action} must not start from the finished status ${status}`);
    }
  }
  // Money is only released once the sample has actually been shipped.
  assert.deepEqual(TRANSITIONS.confirm.from, ['SHIPPED']);
  assert.deepEqual(TRANSITIONS.auto_confirm.from, ['SHIPPED']);
  // A saler can cancel only before the supplier has committed to it.
  assert.deepEqual(TRANSITIONS.cancel.from, ['REQUESTED']);
  // The saler cannot decline, ship or accept on the supplier's behalf, nor the reverse.
  assert.equal(TRANSITIONS.accept.actor, 'supplier');
  assert.equal(TRANSITIONS.ship.actor, 'supplier');
  assert.equal(TRANSITIONS.confirm.actor, 'saler');
  assert.equal(TRANSITIONS.cancel.actor, 'saler');
});
