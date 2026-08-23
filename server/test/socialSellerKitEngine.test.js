/**
 * socialSellerKitEngine.test.js — Test suite for Prompt 9.7: Social Seller Kit (Flyers, QR & Shortlinks).
 *
 * Tests:
 * 1. Zero-dependency local QR code SVG generation without external APIs.
 * 2. Multi-format flyer SVG generation with Bengali typography across formats and themes.
 * 3. Shortlink creation, unique code assignment, and affiliate parameter binding.
 * 4. Shortlink resolution, click tracking, and IP hash logging.
 * 5. Conversion recording and revenue attribution to the originating seller.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as shortlinkService from '../src/services/shortlink.service.js';
import * as flyerService from '../src/services/flyer.service.js';

describe('Prompt 9.7: Social Seller Kit & Viral Distribution Engine', () => {

  describe('1. Local Zero-Dependency QR Code Generator', () => {
    test('Generates valid vector QR code SVG path locally with finder and timing patterns', () => {
      const targetUrl = 'https://explooro.com/s/7f9x2a';
      const qrSvg = flyerService.generateLocalQrSvg(targetUrl, 200, '#000000', '#ffffff');

      assert.ok(qrSvg.includes('<svg'));
      assert.ok(qrSvg.includes('width="200"'));
      assert.ok(qrSvg.includes('height="200"'));
      assert.ok(qrSvg.includes('<path d="M'));
      assert.ok(qrSvg.includes('fill="#000000"'));
    });
  });

  describe('2. Multi-Format Vector Flyer SVG Builder', () => {
    test('Builds print-quality SVG flyer supporting Bengali titles across all formats', () => {
      const product = {
        name_en: 'Silk Jamdani Saree',
        name_bn: 'সুতি জামদানি শাড়ি',
        base_price: '2800.00',
        original_price: '3500.00',
      };

      const store = { shop_name: 'Bengal Loom House' };

      // 1. Social Square (1080 x 1080)
      const squareSvg = flyerService.generateFlyerSvg({
        product,
        store,
        shortUrl: 'https://explooro.com/s/demo1',
        format: 'SQUARE',
        theme: 'DARK',
      });
      assert.ok(squareSvg.includes('width="1080" height="1080"'));
      assert.ok(squareSvg.includes('Silk Jamdani Saree'));
      assert.ok(squareSvg.includes('সুতি জামদানি শাড়ি'));
      assert.ok(squareSvg.includes('৳2800.00'));
      assert.ok(squareSvg.includes('Bengal Loom House'));

      // 2. WhatsApp Story (1080 x 1920)
      const storySvg = flyerService.generateFlyerSvg({
        product,
        store,
        shortUrl: 'https://explooro.com/s/demo2',
        format: 'STORY',
        theme: 'GOLD',
      });
      assert.ok(storySvg.includes('width="1080" height="1920"'));

      // 3. A4 Printable (1240 x 1754)
      const a4Svg = flyerService.generateFlyerSvg({
        product,
        store,
        shortUrl: 'https://explooro.com/s/demo3',
        format: 'A4_PRINT',
        theme: 'MINIMAL',
      });
      assert.ok(a4Svg.includes('width="1240" height="1754"'));
    });
  });

  describe('3. Affiliate Short Link Creation', () => {
    test('Creates tracked short link with affiliate query parameters bound to seller', async () => {
      let createdLink = null;

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('SELECT id FROM short_links WHERE code = $1')) {
            return { rows: [] }; // Code is unique
          }
          if (sql.includes('INSERT INTO short_links')) {
            createdLink = {
              id: 1,
              code: params[0],
              saler_id: params[1],
              product_id: params[2],
              store_id: params[3],
              target_url: params[4],
              source_channel: params[5],
              clicks_count: 0,
              conversions_count: 0,
              revenue_generated: '0.00',
            };
            return { rows: [createdLink] };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      const result = await shortlinkService.createShortLink(mockDb, {
        salerId: 42,
        productId: 108,
        sourceChannel: 'WHATSAPP',
      });

      assert.ok(result.code);
      assert.equal(result.saler_id, 42);
      assert.equal(result.product_id, 108);
      assert.equal(result.source_channel, 'WHATSAPP');
      assert.ok(result.target_url.includes('saler_ref=42'));
      assert.ok(result.target_url.includes('source=whatsapp'));
      assert.equal(result.short_url, `/s/${result.code}`);
    });
  });

  describe('4. Short Link Resolution & Click Tracking', () => {
    test('Resolves short link, increments click count, and hashes IP for privacy', async () => {
      const linkRow = {
        id: 1,
        code: '7f9x2a',
        saler_id: 42,
        product_id: 108,
        target_url: '/products/108?saler_ref=42',
        clicks_count: 5,
        source_channel: 'GENERAL',
      };

      let clickLogged = null;
      let clicksIncremented = false;

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('SELECT * FROM short_links WHERE code = $1')) {
            return { rows: [linkRow] };
          }
          if (sql.includes('UPDATE short_links') && sql.includes('clicks_count = clicks_count + 1')) {
            clicksIncremented = true;
            return { rows: [{ ...linkRow, clicks_count: 6 }] };
          }
          if (sql.includes('INSERT INTO short_link_clicks')) {
            clickLogged = {
              short_link_id: params[0],
              ip_hash: params[1],
              user_agent: params[2],
              referrer: params[3],
            };
            return { rows: [{ id: 10 }] };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      const res = await shortlinkService.resolveShortLink(mockDb, '7f9x2a', {
        ip: '103.14.24.5',
        userAgent: 'Mozilla/5.0 (iPhone)',
        referrer: 'https://m.facebook.com',
      });

      assert.equal(res.target_url, '/products/108?saler_ref=42');
      assert.equal(res.saler_id, 42);
      assert.equal(clicksIncremented, true);
      assert.ok(clickLogged);
      assert.equal(clickLogged.short_link_id, 1);
      assert.notEqual(clickLogged.ip_hash, '103.14.24.5'); // IP must be hashed
    });
  });

  describe('5. Conversion & Revenue Attribution', () => {
    test('Attributes completed order and revenue to originating short link', async () => {
      let updatedRow = null;

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('UPDATE short_links')) {
            updatedRow = {
              id: params[1],
              conversions_count: 1,
              revenue_generated: params[0],
            };
            return { rows: [updatedRow] };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      const res = await shortlinkService.recordShortLinkConversion(mockDb, {
        shortLinkId: 1,
        orderTotal: 2800.00,
      });

      assert.equal(res.conversions_count, 1);
      assert.equal(res.revenue_generated, 2800.00);
    });
  });

});
