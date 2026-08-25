/**
 * themeMaster.test.js — server-side validation of the Master Colour block.
 *
 * The Theme Studio stores a master seed and the LIVE SITE regenerates all 45 ramp steps from it at
 * boot. Two consequences drive everything asserted here:
 *
 *   1. What renders is `generated palette + the section swatches an admin deliberately moved`.
 *      Validating only the submitted sections would certify a theme the browser never shows, so
 *      the gate must run on that merge.
 *   2. The 6 flattened sections cannot express the ramps or the dark theme at all — which is
 *      exactly why the pre-master studio shipped borders, hovers, scrollbars and a dead dark mode
 *      that no contrast check ever looked at. Those invariants are asserted from the regenerated
 *      palette, not from the sections.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import themeRoutes from '../src/routes/theme.routes.js';
import * as themeService from '../src/services/theme.service.js';
import { MASTER_PRESETS } from '../../client/src/config/master-themes.js';
import {
  generatePalette,
  paletteToSectionTokens,
  DEFAULT_MASTER,
  MASTER_RANGES,
} from '../src/services/masterPalette.js';

/** What the Studio actually POSTs: the master config plus the sections it derived from it. */
function masterTokens(master, overrides = {}) {
  const cfg = { ...DEFAULT_MASTER, ...master };
  return { master: cfg, ...paletteToSectionTokens(generatePalette(cfg)), ...overrides };
}

function throwsWithCode(fn, code, matcher) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    if (matcher) assert.ok(matcher(err), `error did not match: ${err.message}`);
    return true;
  });
}

describe('Master Colour block — server-side validation', () => {
  test('every shipped master preset survives the server gate and re-derives identically', () => {
    for (const [key, preset] of Object.entries(MASTER_PRESETS)) {
      const tokens = masterTokens(preset.master);
      assert.equal(themeService.validatePalette(tokens), true, `preset "${key}" was rejected`);

      // The server regenerates from the seed rather than trusting the submitted sections — if the
      // two disagreed, the gate would be certifying a palette the browser never renders.
      const derived = themeService.deriveMasterTokens(preset.master);
      assert.deepEqual(
        derived.sections,
        paletteToSectionTokens(generatePalette(derived.config)),
        `preset "${key}" does not re-derive to itself`,
      );
    }
  });

  test('a malformed seed is rejected, never silently corrected to the default', () => {
    // normaliseMasterConfig() falls back so the RENDER path cannot crash. The WRITE path must not:
    // a silent correction means an admin publishes a colour they never picked.
    for (const seed of ['', 'cobalt', '#12', '#gggggg', 1234, null, undefined]) {
      throwsWithCode(
        () => themeService.validateMasterBlock({ ...DEFAULT_MASTER, seed }),
        'MASTER_CONFIG_INVALID',
        (err) => err.details?.field === 'seed',
      );
    }
    assert.equal(themeService.validateMasterBlock({ ...DEFAULT_MASTER, seed: '#1D4ED8' }).seed, '#1d4ed8');
  });

  test('closed vocabularies and slider bounds are enforced with the offending value named', () => {
    throwsWithCode(
      () => themeService.validateMasterBlock({ ...DEFAULT_MASTER, neutralMode: 'warm' }),
      'MASTER_CONFIG_INVALID',
      (err) => err.details?.field === 'neutralMode' && err.message.includes('warm'),
    );
    throwsWithCode(
      () => themeService.validateMasterBlock({ ...DEFAULT_MASTER, accentHarmony: 'tetrad' }),
      'MASTER_CONFIG_INVALID',
      (err) => err.details?.field === 'accentHarmony',
    );
    throwsWithCode(
      () => themeService.validateMasterBlock({ ...DEFAULT_MASTER, borderTint: 'yes' }),
      'MASTER_CONFIG_INVALID',
      (err) => err.details?.field === 'borderTint',
    );

    for (const [field, range] of Object.entries(MASTER_RANGES)) {
      for (const bad of [range.min - 0.01, range.max + 0.01, Number.NaN, 'x', true]) {
        throwsWithCode(
          () => themeService.validateMasterBlock({ ...DEFAULT_MASTER, [field]: bad }),
          'MASTER_CONFIG_INVALID',
          (err) => err.details?.field === field,
        );
      }
      // The exact slider endpoints must pass — the UI offers them.
      assert.ok(themeService.validateMasterBlock({ ...DEFAULT_MASTER, [field]: range.min }));
      assert.ok(themeService.validateMasterBlock({ ...DEFAULT_MASTER, [field]: range.max }));
    }
  });

  test('unknown master keys are rejected rather than persisted as junk', () => {
    throwsWithCode(
      () => themeService.validateMasterBlock({ ...DEFAULT_MASTER, brandHue: 210 }),
      'MASTER_CONFIG_INVALID',
      (err) => err.details?.unknown?.includes('brandHue'),
    );
  });

  test('section overrides are validated against the GENERATED palette, not the submitted one', () => {
    // The failing pairing exists only in the merge: typography.primary is hand-overridden while
    // surfaces.card comes from the generator. Checking either side alone would pass this.
    const tokens = masterTokens(
      { seed: '#1d4ed8' },
      { typography: { primary: '#c9d4ef', secondary: '#334155', muted: '#475569', inverse: '#ffffff' } },
    );
    throwsWithCode(
      () => themeService.validatePalette(tokens),
      'THEME_CONTRAST_FAILED',
      (err) => err.details?.master_applied === true
        && err.details.failures.some((f) => f.pairing === 'Body Text on Card Surface'),
    );
  });

  test('a non-hex section value is rejected instead of being read as black', () => {
    // hexToRgb() returns {0,0,0} for anything it cannot parse, so an unvalidated junk value would
    // sail through the contrast gate as #000000 and then render as nothing at all.
    const tokens = masterTokens({ seed: '#0f766e' });
    tokens.surfaces.card = 'rgba(255,255,255,0.5)';
    throwsWithCode(
      () => themeService.validatePalette(tokens),
      'THEME_TOKEN_INVALID',
      (err) => err.details?.section === 'surfaces' && err.details?.key === 'card',
    );
  });

  test('dark-mode and ramp invariants are enforced — the sections cannot express them', () => {
    for (const preset of Object.values(MASTER_PRESETS)) {
      const { palette } = themeService.deriveMasterTokens(preset.master);
      const dark = palette.roles.dark.__resolved;
      const light = palette.roles.light.__resolved;
      assert.notEqual(dark.surface0, light.surface0, `${preset.key}: dark mode is dead`);
      assert.ok(
        themeService.getContrastRatio(dark.brand, dark.surface0) >= 4.5,
        `${preset.key}: dark brand fill fails on the dark canvas`,
      );
    }

    // The gate's real job is catching a seed the engine cannot serve. The Studio's colour picker
    // offers all 16.7M of them, so sweep the corners the presets never reach — the mid-lightness
    // dead zone, pure achromatics, and out-of-ladder neon — through the full derive path.
    const corners = [
      '#808080', '#111111', '#f2f2f2', '#00ff88', '#ff00ff', '#7f7f00', '#000000', '#ffffff',
    ];
    for (const seed of corners) {
      for (const neutralMode of ['cool', 'match', 'complement']) {
        assert.doesNotThrow(
          () => themeService.deriveMasterTokens({ ...DEFAULT_MASTER, seed, neutralMode }),
          `seed ${seed} (${neutralMode}) produced a palette the a11y gate rejects`,
        );
      }
    }
  });

  test('the flash-sale strip is themed by the master seed and gated like any other section', () => {
    // The strip used to paint from a raw ramp step (--danger-300) with its ink hardcoded, so it
    // was the one piece of chrome no validator ever looked at. It is a first-class section now.
    for (const [key, preset] of Object.entries(MASTER_PRESETS)) {
      const { sections } = themeService.deriveMasterTokens(preset.master);
      const flash = sections.flash_sale;
      assert.ok(flash, `preset "${key}" generated no flash_sale section`);
      for (const field of ['bg', 'text', 'chip_bg', 'tag_bg', 'tag_text']) {
        assert.match(flash[field], /^#[0-9a-f]{6}$/, `preset "${key}": flash_sale.${field}`);
      }
      assert.equal(themeService.validatePalette(masterTokens(preset.master)), true);
    }

    // An admin override that breaks the strip must fail the gate — the chip is checked against
    // the header's ink, because the countdown digits inherit it rather than carrying their own.
    const base = masterTokens({ seed: '#1d4ed8' });
    throwsWithCode(
      () => themeService.validatePalette({
        ...base,
        flash_sale: { ...base.flash_sale, chip_bg: base.flash_sale.text },
      }),
      'THEME_CONTRAST_FAILED',
      (err) => err.details.failures.some((f) => f.pairing === 'Flash Sale Countdown Digits on Chip'),
    );
  });

  test('a legacy palette with no master block is validated exactly as before', () => {
    const legacy = paletteToSectionTokens(generatePalette(DEFAULT_MASTER));
    assert.equal(themeService.validatePalette(legacy), true);
    const report = themeService.inspectPalette(legacy);
    assert.equal(report.master_applied, false);
    assert.equal(report.effective_tokens, null);
  });

  test('inspectPalette reports the effective palette a master theme will actually render', () => {
    const navbar = { bg: '#131921', text: '#ffffff', border: '#232f3e', search_bg: '#232f3e' };
    const report = themeService.inspectPalette(masterTokens({ seed: '#f59e0b' }, { navbar }));
    assert.equal(report.master_applied, true);
    assert.equal(report.master.seed, '#f59e0b');
    assert.deepEqual(report.effective_tokens.navbar, navbar, 'hand-authored navbar must survive');
    assert.equal(
      report.effective_tokens.surfaces.page,
      paletteToSectionTokens(generatePalette({ ...DEFAULT_MASTER, seed: '#f59e0b' })).surfaces.page,
      'un-overridden sections must come from the generator',
    );
  });
});

describe('Master Colour block — API surface', () => {
  let app;
  let saved = [];

  before(async () => {
    saved = [];
    const db = {
      async query(sql, params = []) {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('INSERT INTO theme_palettes')) {
          const row = {
            id: saved.length + 1,
            name: params[0],
            preset_key: params[1],
            tokens_json: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2],
            created_by: params[3],
            is_active: false,
            is_published: false,
          };
          saved.push(row);
          return { rows: [row] };
        }
        return { rows: [] };
      },
    };

    app = Fastify({ logger: false });
    app.decorate('db', db);
    app.decorate('cache', null);
    app.addHook('onRequest', (req, reply, done) => {
      req.user = { id: 7, roles: ['super_admin'], role: 'super_admin' };
      done();
    });
    app.decorate('requirePermission', () => async () => {});
    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    await app.register(themeRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => { await app.close(); });

  test('POST /admin/theme/draft rejects a bad master block with a 4xx naming the field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/theme/draft',
      payload: {
        name: 'Broken Master',
        tokens: masterTokens({ seed: '#1d4ed8', vividness: 99 }),
      },
    });
    assert.ok(res.statusCode >= 400 && res.statusCode < 500, `got ${res.statusCode}`);
    const body = res.json();
    assert.equal(body.error?.code, 'MASTER_CONFIG_INVALID');
    assert.equal(body.error?.details?.field, 'vividness');
    assert.equal(saved.length, 0, 'an invalid master block must not be persisted');
  });

  test('POST /admin/theme/draft persists the NORMALISED master block', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/theme/draft',
      payload: {
        name: 'Cobalt Trust',
        preset_key: 'cobalt_trust',
        // Deliberately shouty hex and a partial config — what is stored must be what was certified.
        tokens: masterTokens({ seed: '#1D4ED8', neutralMode: 'match' }),
      },
    });
    assert.equal(res.statusCode, 201);
    const stored = res.json().draft.tokens_json;
    assert.equal(stored.master.seed, '#1d4ed8');
    assert.equal(stored.master.neutralMode, 'match');
    for (const key of Object.keys(DEFAULT_MASTER)) {
      assert.notEqual(stored.master[key], undefined, `stored master is missing ${key}`);
    }
  });

  test('POST /admin/theme/validate-contrast reports the effective master palette', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/theme/validate-contrast',
      payload: { tokens: masterTokens({ seed: '#7c3aed', accentHarmony: 'triad' }) },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.valid, true);
    assert.equal(body.master_applied, true);
    assert.equal(body.master.accentHarmony, 'triad');
    assert.ok(body.effective_tokens.brand.primary.startsWith('#'));
  });
});
