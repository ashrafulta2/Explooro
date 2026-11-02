/**
 * qrEncoder.test.js — the server's QR encoder and flyer renderer (Prompt 9.7 requirement 3).
 *
 * The encoder exists twice (server/src/lib/qr.ts for the server flyer, client/src/lib/qr.ts for the
 * flyer studio). client/test/qr.test.js decodes the client's symbols; this file pins the server copy
 * to it, so a fix applied to one side only fails here.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import * as serverQr from '../src/lib/qr.ts';
import * as clientQr from '../../client/src/lib/qr.ts';
import * as flyerService from '../src/services/flyer.service.ts';

const SAMPLES = [
  'https://explooro.com/s/exp-jvx1i',
  'http://localhost:3000/s/abc',
  `https://explooro.com/store/priyo-collection?ref=${'a'.repeat(120)}`,
  'শাড়ি',
];

describe('QR encoder parity and flyer QR', () => {
  test('server and client encoders draw identical symbols', () => {
    for (const text of SAMPLES) {
      const a = serverQr.encodeQr(text);
      const b = clientQr.encodeQr(text);
      assert.equal(a.version, b.version, text);
      assert.equal(a.mask, b.mask, text);
      assert.deepEqual(a.modules, b.modules, text);
    }
  });

  test('generateLocalQrSvg draws the encoded modules, not a hash pattern', () => {
    const url = 'https://explooro.com/s/7f9x2a';
    const svg = flyerService.generateLocalQrSvg(url, 200);
    assert.ok(svg.includes(`d="${serverQr.qrPathData(serverQr.encodeQr(url))}"`));
  });

  test('renderFlyerForLink prints the link it was asked for, with the real product and store', async () => {
    process.env.PUBLIC_WEB_URL = 'https://shop.example.test/';
    const db = {
      async query(sql, params) {
        assert.match(sql, /FROM short_links/);
        if (params[0] !== 'abc123') return { rows: [] };
        return { rows: [{ code: 'abc123', title_en: 'Tangail Saree & Shawl', title_bn: 'টাঙ্গাইল শাড়ি', default_retail_price: '1450.00', shop_name: 'Priyo Collection' }] };
      },
    };
    const svg = await flyerService.renderFlyerForLink(db, { code: 'ABC123', format: 'STORY', theme: 'GOLD' });
    assert.ok(svg.includes('width="1080" height="1920"'));
    assert.ok(svg.includes('Tangail Saree &amp; Shawl'), 'names come from title_en and are escaped');
    assert.ok(svg.includes('Priyo Collection'));
    assert.ok(svg.includes('৳1450.00'));
    const qr = serverQr.encodeQr('https://shop.example.test/s/abc123');
    assert.ok(svg.includes(serverQr.qrPathData(qr)), 'the QR encodes the public short link');

    await assert.rejects(() => flyerService.renderFlyerForLink(db, { code: 'nope' }), { code: 'SHORTLINK_NOT_FOUND' });
  });

  test('a whole-store link flyer shows no invented product or price', async () => {
    const db = { async query() { return { rows: [{ code: 'st0re1', title_en: null, shop_name: 'Priyo Collection' }] }; } };
    const svg = await flyerService.renderFlyerForLink(db, { code: 'st0re1' });
    assert.ok(svg.includes('Shop my full collection'));
    assert.ok(!svg.includes('৳'), 'no price for a store link');
    assert.ok(!svg.includes('Handcrafted'), 'no demo product name');
  });
});
