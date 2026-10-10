/**
 * liveQuoteMock.test.js — the live drawer's quote works in mock mode too, with the same arithmetic as
 * the server's quoteInStreamBuy (price x quantity + the per-parcel delivery charge).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mockQuote } from '../src/mocks/handlers/live.js';
import { mockDeliveryCharge } from '../src/mocks/handlers/delivery.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('live in-stream quote (mock)', () => {
  it('adds the mock delivery charge to price x quantity', () => {
    const q = mockQuote(1, 1, 2);
    assert.equal(q.unit_price, 3500);
    assert.equal(q.items_amount, 7000);
    assert.equal(q.shipping_amount, mockDeliveryCharge());
    assert.equal(q.total_amount, 7000 + mockDeliveryCharge());
  });

  it('flags a quantity above stock and refuses a product not on the stream', () => {
    assert.equal(mockQuote(1, 1, 99).in_stock, false);
    assert.equal(mockQuote(1, 12345, 1), null);
    assert.equal(mockQuote(999, 1, 1), null);
  });

  it('the drawer prefills and validates the local 11-digit phone, not the stored +880 form', () => {
    const src = read('pages/LiveStreamPage.js');
    assert.match(src, /function toLocalBdPhone/);
    assert.match(src, /value="\$\{toLocalBdPhone\(user\.phone\)\}"/);
    assert.match(src, /const phoneVal = toLocalBdPhone\(phoneInput\.value\)/);
  });

  it('the drawer asks the quote endpoint the server serves', () => {
    assert.match(read('services/live.api.js'), /\/live\/streams\/\$\{streamId\}\/quote/);
    assert.match(read('pages/LiveStreamPage.js'), /getInStreamQuote\(streamId/);
  });

  it('the drawer has a quantity stepper that re-quotes and sends the chosen quantity', () => {
    const src = read('pages/LiveStreamPage.js');
    assert.match(src, /id="chk-qty-inc"/);
    assert.match(src, /quantity: qty,[\s]*recipient_name/);
    assert.match(src, /getInStreamQuote\(streamId, \{ productId: [^}]*quantity: qty, couponCode \}\)/);
    // a slow answer for an earlier quantity must not overwrite a later one
    assert.match(src, /if \(seq !== quoteSeq\) return;/);
  });

  it('the stepper strings exist in both languages', () => {
    for (const lang of ['en', 'bn']) {
      const live = JSON.parse(read(`locales/${lang}.json`)).live;
      for (const k of ['chk_qty_label', 'chk_qty_dec', 'chk_qty_inc', 'chk_only_left']) {
        assert.ok(live[k], `${lang}.live.${k}`);
      }
    }
  });

  it('a valid coupon lowers the mock total and a bad one is reported, not applied', () => {
    const ok = mockQuote(1, 1, 1, 'live10');
    assert.equal(ok.coupon.valid, true);
    assert.equal(ok.discount_amount, 350);
    assert.equal(ok.total_amount, 3500 + mockDeliveryCharge() - 350);
    const bad = mockQuote(1, 1, 1, 'NOPE');
    assert.equal(bad.coupon.valid, false);
    assert.equal(bad.discount_amount, 0);
    assert.equal(bad.total_amount, 3500 + mockDeliveryCharge());
    assert.equal(mockQuote(1, 1, 1).coupon, null);
  });

  it('the drawer sends the applied coupon with the order and the strings exist in both languages', () => {
    const src = read('pages/LiveStreamPage.js');
    assert.match(src, /coupon_code: couponCode \|\| undefined/);
    assert.match(src, /id="chk-coupon-apply"/);
    assert.match(read('services/live.api.js'), /query\.coupon_code = couponCode/);
    for (const lang of ['en', 'bn']) {
      const live = JSON.parse(read(`locales/${lang}.json`)).live;
      for (const k of ['chk_coupon_label', 'chk_coupon_apply', 'chk_coupon_applied']) assert.ok(live[k], `${lang}.live.${k}`);
    }
  });
});
