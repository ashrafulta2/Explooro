/**
 * socialKitTemplates.test.js — the template picker and the flyer renderer share one format table.
 *
 * Invariants:
 *  1. Every format the templates endpoint offers renders at exactly the advertised size.
 *  2. An unknown format falls back to the square, never to a broken canvas.
 *  3. The endpoint sits behind authentication and the social_seller_kit module.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import * as flyerService from '../src/services/flyer.service.js';
import socialKitRoutes from '../src/routes/socialKit.routes.js';

describe('social kit templates', () => {
  test('each advertised format renders at its advertised size', () => {
    for (const [id, f] of Object.entries(flyerService.FLYER_FORMATS)) {
      const svg = flyerService.generateFlyerSvg({ product: { name_en: 'X', base_price: 10 }, format: id });
      assert.ok(svg.includes(`width="${f.width}"`) && svg.includes(`height="${f.height}"`), `${id} must be ${f.width}x${f.height}`);
    }
  });

  test('an unknown format falls back to the square', () => {
    const svg = flyerService.generateFlyerSvg({ product: { name_en: 'X', base_price: 10 }, format: 'POSTER' });
    assert.ok(svg.includes('width="1080"') && svg.includes('height="1080"'));
  });

  test('GET /saler/social-kit/templates is authenticated and module-gated, and lists formats and themes', async () => {
    const app = Fastify();
    const found = [];
    app.decorate('authenticate', async () => {});
    app.decorate('requireModule', (key) => { const fn = async () => {}; fn.moduleKey = key; return fn; });
    app.addHook('onRoute', (r) => found.push({ m: [].concat(r.method).join(','), u: r.url, chain: [].concat(r.preHandler || []) }));
    await app.register(socialKitRoutes);
    const route = found.find((r) => r.m === 'GET' && r.u === '/saler/social-kit/templates');
    assert.ok(route, 'route must exist');
    assert.ok(route.chain.includes(app.authenticate));
    assert.deepEqual(route.chain.map((f) => f.moduleKey).filter(Boolean), ['social_seller_kit']);

    const res = await app.inject({ method: 'GET', url: '/saler/social-kit/templates' });
    const body = res.json();
    assert.deepEqual(body.templates.map((t) => t.id), Object.keys(flyerService.FLYER_FORMATS));
    assert.deepEqual(body.themes, ['DARK', 'MINIMAL', 'GOLD']);
  });
});
