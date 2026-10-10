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
});
