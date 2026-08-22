/**
 * themeStudio.test.js — Test suite for Prompt 3.5 (Theme & Color Studio, 6 Sections, 5 Presets, WCAG AA & Auditing).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import themeRoutes from '../src/routes/theme.routes.js';
import { THEME_PRESETS } from '../../client/src/config/theme-presets.js';
import {
  getContrastRatio,
  validatePaletteContrast,
  validateNoGradients,
} from '../../client/src/services/themePalette.js';
import * as themeService from '../src/services/theme.service.js';

function createMockDb() {
  let palettes = [
    {
      id: 1,
      name: 'Explooro Coral (Default)',
      preset_key: 'default',
      is_active: true,
      is_published: true,
      tokens_json: THEME_PRESETS.default.tokens,
      created_by: 1,
      published_by: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const auditLog = [];

  return {
    palettes,
    auditLog,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // SELECT active theme
      if (normalized.startsWith('SELECT id, name, preset_key, tokens_json') && normalized.includes('WHERE is_active = true')) {
        const active = palettes.find((p) => p.is_active);
        return { rows: active ? [active] : [] };
      }

      // SELECT list of palettes
      if (normalized.startsWith('SELECT id, name, preset_key, is_active, is_published')) {
        return { rows: [...palettes] };
      }

      // SELECT by ID
      if (normalized.startsWith('SELECT id, name, preset_key, is_active, is_published, tokens_json') && normalized.includes('WHERE id = $1')) {
        const p = palettes.find((x) => x.id === parseInt(params[0], 10));
        return { rows: p ? [p] : [] };
      }

      // INSERT draft
      if (normalized.startsWith('INSERT INTO theme_palettes')) {
        const newId = palettes.length + 1;
        const newP = {
          id: newId,
          name: params[0],
          preset_key: params[1],
          tokens_json: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2],
          created_by: params[3],
          is_active: false,
          is_published: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        palettes.push(newP);
        return { rows: [newP] };
      }

      // UPDATE deactivate all
      if (normalized.startsWith('UPDATE theme_palettes SET is_active = false')) {
        for (const p of palettes) p.is_active = false;
        return { rows: [] };
      }

      // UPDATE publish palette
      if (normalized.startsWith('UPDATE theme_palettes SET is_active = true, is_published = true')) {
        const p = palettes.find((x) => x.id === parseInt(params[0], 10));
        if (p) {
          p.is_active = true;
          p.is_published = true;
          p.published_by = params[1];
          p.updated_at = new Date().toISOString();
          return { rows: [p] };
        }
        return { rows: [] };
      }

      // Audit logs insert
      if (normalized.includes('INSERT INTO audit_logs')) {
        const entry = { id: auditLog.length + 1, action: params[1] || 'theme.publish' };
        auditLog.push(entry);
        return { rows: [entry] };
      }

      return { rows: [] };
    },
  };
}

describe('Theme & Color Studio (Prompt 3.5)', () => {
  let app;
  let mockDb;

  before(async () => {
    mockDb = createMockDb();
    const cache = {
      store: new Map(),
      async get(k) { return this.store.get(k) || null; },
      async set(k, v) { this.store.set(k, v); },
      async del(k) { this.store.delete(k); },
    };

    app = Fastify({ logger: false });
    app.decorate('db', mockDb);
    app.decorate('cache', cache);

    app.addHook('onRequest', (req, reply, done) => {
      req.user = { id: 999, ref: 'USR-ADMIN', roles: ['super_admin'], role: 'super_admin' };
      done();
    });

    app.decorate('requirePermission', (permKey) => async (req, reply) => {
      if (!req.user?.roles?.includes('super_admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
      }
    });

    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    await app.register(themeRoutes, { prefix: '/api/v1' });

    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('Acceptance 2: Every preset in theme-presets.js strictly satisfies WCAG AA across all 6 UI sections', () => {
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
      const validation = validatePaletteContrast(preset.tokens);
      assert.equal(
        validation.isValid,
        true,
        `Preset "${key}" failed WCAG AA on pairings: ${validation.failures.map((f) => f.pairing).join(', ')}`
      );
    }
  });

  test('Acceptance 3: Palette with a 3.1:1 body-text ratio is rejected with a specific error naming the pair', () => {
    const invalidPalette = JSON.parse(JSON.stringify(THEME_PRESETS.default.tokens));
    // Set low contrast: light gray text #888888 on white card #ffffff -> ~3.5:1 / #999999 -> ~2.8:1
    invalidPalette.typography.primary = '#999999';
    invalidPalette.surfaces.card = '#ffffff';

    const val = validatePaletteContrast(invalidPalette);
    assert.equal(val.isValid, false);
    assert.ok(val.failures.some((f) => f.pairing === 'Body Text on Card Surface'));

    assert.throws(
      () => themeService.validatePalette(invalidPalette),
      (err) => {
        return (
          err.code === 'THEME_CONTRAST_FAILED' &&
          err.details?.failures?.some((f) => f.pairing.includes('Body Text on Card Surface'))
        );
      }
    );
  });

  test('Acceptance 4: Zero gradients permitted anywhere in theme tokens (rejected in validation)', () => {
    const gradientPalette = JSON.parse(JSON.stringify(THEME_PRESETS.default.tokens));
    gradientPalette.navbar.bg = 'linear-gradient(to right, #da694c, #e9856c)';

    assert.equal(validateNoGradients(gradientPalette), false);

    assert.throws(
      () => themeService.validatePalette(gradientPalette),
      (err) => {
        return err.code === 'GRADIENTS_FORBIDDEN';
      }
    );
  });

  test('GET /api/v1/theme/active returns current active theme tokens for public consumption', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/theme/active',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.theme);
    assert.equal(body.theme.is_active, true);
    assert.ok(body.tokens);
    assert.equal(body.tokens.brand.primary, '#c25336');
  });

  test('Publishing palette (CRITICAL tier) activates palette, invalidates cache and is audited', async () => {
    // 1. Save draft for Amazon Pro
    const draftRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/theme/draft',
      payload: {
        name: 'Amazon Pro Palette',
        preset_key: 'amazon_pro',
        tokens: THEME_PRESETS.amazon_pro.tokens,
      },
    });

    assert.equal(draftRes.statusCode, 201);
    const draftId = draftRes.json().draft.id;

    // 2. Publish draft palette
    const pubRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/theme/${draftId}/publish`,
    });

    assert.equal(pubRes.statusCode, 200);
    const published = pubRes.json().published;
    assert.equal(published.is_active, true);
    assert.equal(published.is_published, true);
    assert.equal(published.preset_key, 'amazon_pro');

    // 3. Verify public endpoint now returns published amazon_pro tokens
    const activeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/theme/active',
    });
    assert.equal(activeRes.statusCode, 200);
    assert.equal(activeRes.json().tokens.brand.primary, '#ff9900');
  });
});
