/**
 * theme.service.js — Theme Studio service, contrast verification & critical publishing (Prompt 3.5).
 */

import * as themeRepo from '../repositories/theme.repository.js';
import { AppError } from '../plugins/errorHandler.js';
import {
  generatePalette,
  paletteToSectionTokens,
  normaliseMasterConfig,
  contrastRatio,
  DEFAULT_MASTER,
  MASTER_NEUTRAL_MODES,
  MASTER_ACCENT_HARMONIES,
  MASTER_RANGES,
  TOKEN_SECTIONS,
} from './masterPalette.js';

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function getRelativeLuminance({ r, g, b }) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

export function getContrastRatio(hex1, hex2) {
  const lum1 = getRelativeLuminance(hexToRgb(hex1));
  const lum2 = getRelativeLuminance(hexToRgb(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  const ratio = (brightest + 0.05) / (darkest + 0.05);
  return Math.round(ratio * 10) / 10;
}

export function validateNoGradients(tokens) {
  const checkValue = (val) => {
    if (typeof val === 'string' && /gradient/i.test(val)) return false;
    if (typeof val === 'object' && val !== null) {
      return Object.values(val).every(checkValue);
    }
    return true;
  };
  return checkValue(tokens);
}

function masterError(en, bn, details) {
  return new AppError('MASTER_CONFIG_INVALID', en, bn, details);
}

/**
 * Strictly validates a stored/submitted master block and returns it fully normalised.
 *
 * WHY reject instead of reusing normaliseMasterConfig's silent fallbacks: that function exists so
 * the RENDER path can never crash on a half-written blob. The WRITE path has the opposite duty —
 * silently correcting a malformed seed to the default pink means an admin publishes a colour they
 * never picked, and only finds out when the storefront comes back the wrong colour.
 */
export function validateMasterBlock(raw) {
  if (raw === null || raw === undefined) return null;

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw masterError(
      'Theme master block must be an object.',
      'থিম মাস্টার ব্লক অবশ্যই একটি অবজেক্ট হতে হবে।'
    );
  }

  const allowed = Object.keys(DEFAULT_MASTER);
  const unknown = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw masterError(
      `Unknown master config key(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}.`,
      `অজানা মাস্টার কনফিগ কী: ${unknown.join(', ')}।`,
      { unknown, allowed }
    );
  }

  const seed = typeof raw.seed === 'string' ? raw.seed.trim() : '';
  if (!HEX6.test(seed)) {
    throw masterError(
      `Master seed must be a 6-digit hex colour (received ${JSON.stringify(raw.seed)}).`,
      'মাস্টার সিড অবশ্যই ৬-ডিজিটের হেক্স রঙ হতে হবে।',
      { field: 'seed', value: raw.seed }
    );
  }

  const enums = [
    ['neutralMode', MASTER_NEUTRAL_MODES],
    ['accentHarmony', MASTER_ACCENT_HARMONIES],
  ];
  for (const [field, vocabulary] of enums) {
    if (raw[field] !== undefined && !vocabulary.includes(raw[field])) {
      throw masterError(
        `Master ${field} must be one of: ${vocabulary.join(', ')} (received ${JSON.stringify(raw[field])}).`,
        `মাস্টার ${field} অবশ্যই এর মধ্যে একটি হতে হবে: ${vocabulary.join(', ')}।`,
        { field, value: raw[field], allowed: vocabulary }
      );
    }
  }

  // Bounds come from MASTER_RANGES, the same constant the Studio builds its sliders from, so the
  // API can never refuse a value the UI let an admin choose.
  for (const [field, range] of Object.entries(MASTER_RANGES)) {
    if (raw[field] === undefined) continue;
    const value = Number(raw[field]);
    if (typeof raw[field] === 'boolean' || !Number.isFinite(value)) {
      throw masterError(
        `Master ${field} must be a number (received ${JSON.stringify(raw[field])}).`,
        `মাস্টার ${field} অবশ্যই একটি সংখ্যা হতে হবে।`,
        { field, value: raw[field] }
      );
    }
    if (value < range.min || value > range.max) {
      throw masterError(
        `Master ${field} must be between ${range.min} and ${range.max} (received ${value}).`,
        `মাস্টার ${field} অবশ্যই ${range.min} থেকে ${range.max} এর মধ্যে হতে হবে।`,
        { field, value, min: range.min, max: range.max }
      );
    }
  }

  for (const field of ['surfaceWash', 'borderTint']) {
    if (raw[field] !== undefined && typeof raw[field] !== 'boolean') {
      throw masterError(
        `Master ${field} must be a boolean (received ${JSON.stringify(raw[field])}).`,
        `মাস্টার ${field} অবশ্যই বুলিয়ান হতে হবে।`,
        { field, value: raw[field] }
      );
    }
  }

  return normaliseMasterConfig({ ...raw, seed });
}

/** Every section value that survives validation is a plain hex colour — no rgba(), no var(). */
function assertSectionsAreHex(tokens) {
  for (const section of TOKEN_SECTIONS) {
    const bag = tokens[section];
    if (bag === undefined) continue;
    if (typeof bag !== 'object' || bag === null || Array.isArray(bag)) {
      throw new AppError(
        'THEME_TOKEN_INVALID',
        `Theme section "${section}" must be an object of hex colours.`,
        `থিম সেকশন "${section}" অবশ্যই হেক্স রঙের অবজেক্ট হতে হবে।`,
        { section }
      );
    }
    for (const [key, value] of Object.entries(bag)) {
      if (typeof value !== 'string' || !HEX6.test(value.trim())) {
        // WHY this matters: hexToRgb() falls back to black for anything it cannot parse, so an
        // unvalidated junk value would sail through the contrast gate as #000000 and then render
        // as nothing at all.
        throw new AppError(
          'THEME_TOKEN_INVALID',
          `Theme token ${section}.${key} must be a 6-digit hex colour (received ${JSON.stringify(value)}).`,
          `থিম টোকেন ${section}.${key} অবশ্যই ৬-ডিজিটের হেক্স রঙ হতে হবে।`,
          { section, key, value }
        );
      }
    }
  }
}

/**
 * The rendered result of a master theme is `generated palette + the section swatches an admin
 * deliberately moved`. Validating the submitted sections alone would certify a theme the browser
 * never shows, so the gate runs on the merge — exactly what themePalette.applyTheme() produces.
 */
function mergeSectionOverrides(derived, submitted) {
  const merged = {};
  for (const section of TOKEN_SECTIONS) {
    merged[section] = { ...(derived[section] || {}), ...(submitted[section] || {}) };
  }
  return merged;
}

/**
 * Invariants the 6 flattened sections cannot express, because they describe the RAMPS and the dark
 * theme — precisely the surfaces the pre-master studio could not re-theme and therefore never
 * checked. Only a11y contracts are asserted here; the engine's aesthetic properties belong to
 * client/test/colorRamp.test.js.
 */
function validateGeneratedPalette(palette) {
  const failures = [];
  const light = palette.roles.light;
  const dark = palette.roles.dark.__resolved;
  const lightResolved = light.__resolved;

  const check = (pairing, fg, bg, required) => {
    const ratio = Math.round(contrastRatio(fg, bg) * 10) / 10;
    if (ratio < required) {
      failures.push({
        pairing,
        fg,
        bg,
        ratio,
        required,
        message: `${pairing} has contrast ratio of ${ratio}:1, failing the minimum (${required}:1)`,
      });
    }
  };

  // An input boundary the customer cannot see is an input they cannot find (themes.css §2).
  const ref = /^var\(--(brand|neutral)-(\d+)\)$/.exec(light['--border-interactive'] || '');
  if (ref) {
    const hex = ref[1] === 'brand' ? palette.brand[ref[2]] : palette.neutral[ref[2]];
    check('Input Boundary on Page Canvas', hex, lightResolved.surface0, 3);
  }

  if (dark.surface0 === lightResolved.surface0) {
    failures.push({
      pairing: 'Dark Theme Canvas',
      fg: dark.surface0,
      bg: lightResolved.surface0,
      ratio: 1,
      required: 1.5,
      message: 'Dark theme canvas is identical to the light theme canvas — dark mode would be dead',
    });
  }
  check('Dark Brand Fill on Dark Canvas', dark.brand, dark.surface0, 4.5);
  check('Dark Body Text on Dark Canvas', palette.neutral[100], dark.surface0, 4.5);

  if (failures.length > 0) {
    const first = failures[0];
    throw new AppError(
      'THEME_MASTER_CONTRAST_FAILED',
      `Generated master palette failed accessibility: ${first.message}`,
      `জেনারেট করা মাস্টার প্যালেট অ্যাক্সেসিবিলিটিতে ব্যর্থ: ${first.pairing} এর অনুপাত ${first.ratio}:1 (প্রয়োজন ${first.required}:1)`,
      { failures, seed: palette.config.seed }
    );
  }
}

/** Regenerates a master theme server-side: config -> 45-step palette -> flattened sections. */
export function deriveMasterTokens(master) {
  const config = validateMasterBlock(master);
  if (!config) return null;
  const palette = generatePalette(config);
  validateGeneratedPalette(palette);
  return { config, palette, sections: paletteToSectionTokens(palette) };
}

function runContrastChecks(sections) {
  const failures = [];
  const check = (name, fg, bg, minRatio = 4.5) => {
    if (!fg || !bg) return;
    const ratio = getContrastRatio(fg, bg);
    if (ratio < minRatio) {
      failures.push({
        pairing: name,
        fg,
        bg,
        ratio,
        required: minRatio,
        message: `${name} has contrast ratio of ${ratio}:1, failing WCAG AA minimum (${minRatio}:1)`,
      });
    }
  };

  const nav = sections.navbar || {};
  const side = sections.sidebar || {};
  const surf = sections.surfaces || {};
  const brand = sections.brand || {};
  const typo = sections.typography || {};
  const badges = sections.badges || {};
  const footer = sections.footer || {};
  const flash = sections.flash_sale || {};

  check('Navbar Text on Navbar BG', nav.text, nav.bg, 4.5);
  if (side.text && side.bg) check('Sidebar Text on Sidebar BG', side.text, side.bg, 4.5);
  if (side.active_text && side.active_bg) check('Sidebar Active Text on Active BG', side.active_text, side.active_bg, 4.5);
  check('Body Text on Page Canvas', typo.primary, surf.page, 4.5);
  check('Body Text on Card Surface', typo.primary, surf.card, 4.5);
  check('Secondary Text on Card Surface', typo.secondary, surf.card, 3.5);
  check('Brand Button Contrast Text on Brand Primary', brand.contrast, brand.primary, 4.5);
  check('Success Badge Text on BG', badges.success_text, badges.success_bg, 4.5);
  check('Warning Badge Text on BG', badges.warning_text, badges.warning_bg, 4.5);
  check('Danger Badge Text on BG', badges.danger_text, badges.danger_bg, 4.5);
  check('Info Badge Text on BG', badges.info_text, badges.info_bg, 4.5);
  check('Footer Text on Footer BG', footer.text, footer.bg, 4.5);
  // The countdown digits inherit the strip's ink, so the chip is checked against flash.text
  // rather than against a foreground of its own.
  check('Flash Sale Header Text on Header BG', flash.text, flash.bg, 4.5);
  check('Flash Sale Countdown Digits on Chip', flash.text, flash.chip_bg, 4.5);
  check('Flash Sale Tag Text on Tag BG', flash.tag_text, flash.tag_bg, 4.5);

  return failures;
}

export function validatePalette(tokens = {}) {
  if (!tokens || typeof tokens !== 'object') {
    throw new AppError('VALIDATION_FAILED', 'Theme tokens object is required.', 'থিম টোকেন অবজেক্ট আবশ্যক।');
  }

  if (!validateNoGradients(tokens)) {
    throw new AppError(
      'GRADIENTS_FORBIDDEN',
      'Zero gradients permitted anywhere in theme tokens. Only solid colors are allowed.',
      'থিম টোকেনে কোনো গ্রেডিয়েন্ট অনুমোদিত নয়। শুধুমাত্র সলিড রং প্রযোজ্য।'
    );
  }

  let sections = tokens;
  let master = null;

  if (tokens.master !== undefined && tokens.master !== null) {
    assertSectionsAreHex(tokens);
    const derived = deriveMasterTokens(tokens.master);
    master = derived.config;
    sections = mergeSectionOverrides(derived.sections, tokens);
  }

  const failures = runContrastChecks(sections);
  if (failures.length > 0) {
    const first = failures[0];
    throw new AppError(
      'THEME_CONTRAST_FAILED',
      `WCAG AA Contrast check failed: ${first.message}`,
      `ডব্লিউসিএজি এএ কনট্রাস্ট ব্যর্থ: ${first.pairing} এর অনুপাত ${first.ratio}:1 (প্রয়োজন ${first.required}:1)`,
      { failures, master_applied: Boolean(master) }
    );
  }

  return true;
}

/** Same gate as validatePalette, but reports what it certified instead of only pass/fail. */
export function inspectPalette(tokens = {}) {
  validatePalette(tokens);
  const master = tokens.master ? validateMasterBlock(tokens.master) : null;
  return {
    valid: true,
    master_applied: Boolean(master),
    master,
    effective_tokens: master
      ? mergeSectionOverrides(paletteToSectionTokens(generatePalette(master)), tokens)
      : null,
  };
}

export async function getActiveTheme(db, cache) {
  if (cache) {
    const cached = await cache.get('theme:active');
    if (cached) {
      try {
        return typeof cached === 'string' ? JSON.parse(cached) : cached;
      } catch {
        // Parse error fallback
      }
    }
  }

  const active = await themeRepo.getActiveTheme(db);
  if (active && cache) {
    await cache.set('theme:active', JSON.stringify(active), 600);
  }
  return active;
}

export async function listPalettes(db) {
  return themeRepo.listThemePalettes(db);
}

export async function saveDraft(db, { name, presetKey = null, tokens, userId }) {
  validatePalette(tokens);
  // Persist the NORMALISED master block, so what is stored is exactly what the validator
  // certified — a draft holding `#EEA1CE` and a partial config would otherwise be re-normalised
  // differently by every later reader.
  const master = tokens?.master ? validateMasterBlock(tokens.master) : null;
  const tokensJson = master ? { ...tokens, master } : tokens;
  return themeRepo.saveThemeDraft(db, {
    name: name || 'Custom Theme Draft',
    presetKey,
    tokensJson,
    createdBy: userId,
  });
}

export async function renameTheme(db, auditService, { id, name, userId, reqContext = {} }) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw new AppError('VALIDATION_FAILED', 'A theme name is required.', 'থিমের নাম আবশ্যক।');
  }

  const target = await themeRepo.getThemePaletteById(db, id);
  if (!target) {
    throw new AppError('NOT_FOUND', `Theme palette #${id} not found.`, `থিম প্যালেট #${id} পাওয়া যায়নি।`);
  }

  const renamed = await themeRepo.renameThemePalette(db, id, trimmed);

  if (auditService) {
    await auditService.record(db, {
      actor: userId,
      action: 'theme.rename',
      targetType: 'theme_palette',
      targetRef: String(id),
      before: { name: target.name },
      after: { name: renamed.name },
      traceId: reqContext.traceId,
      ip: reqContext.ip,
      userAgent: reqContext.userAgent,
    });
  }

  return renamed;
}

export async function deleteTheme(db, auditService, { id, userId, reqContext = {} }) {
  const target = await themeRepo.getThemePaletteById(db, id);
  if (!target) {
    throw new AppError('NOT_FOUND', `Theme palette #${id} not found.`, `থিম প্যালেট #${id} পাওয়া যায়নি।`);
  }

  // The live site theme cannot be deleted out from under itself — publish a replacement first.
  // WHY code CONFLICT rather than a new THEME_* code: the error code enum in
  // docs/api-contract.md §3 is closed, and this is a state conflict (existing generic code fits).
  if (target.is_active) {
    throw new AppError(
      'CONFLICT',
      'The theme currently live on the site cannot be deleted. Publish a different theme first.',
      'সাইটে বর্তমানে লাইভ থাকা থিম মুছে ফেলা যাবে না। প্রথমে অন্য একটি থিম পাবলিশ করুন।'
    );
  }

  await themeRepo.deleteThemePalette(db, id);

  if (auditService) {
    await auditService.record(db, {
      actor: userId,
      action: 'theme.delete',
      targetType: 'theme_palette',
      targetRef: String(id),
      before: { name: target.name, preset_key: target.preset_key },
      after: {},
      traceId: reqContext.traceId,
      ip: reqContext.ip,
      userAgent: reqContext.userAgent,
    });
  }

  return { id };
}

export async function publishTheme(db, cache, auditService, { id, userId, reqContext = {} }) {
  const target = await themeRepo.getThemePaletteById(db, id);
  if (!target) {
    throw new AppError('NOT_FOUND', `Theme palette #${id} not found.`, `থিম প্যালেট #${id} পাওয়া যায়নি।`);
  }

  // Validate target tokens strictly
  validatePalette(target.tokens_json);

  const previousActive = await themeRepo.getActiveTheme(db);

  const published = await themeRepo.publishThemePalette(db, id, { publishedBy: userId });

  if (cache) {
    await cache.del('theme:active');
  }

  // Audit record (Prompt 3.5: CRITICAL publishing is audited with before/after color diff)
  if (auditService) {
    await auditService.record(db, {
      actor: userId,
      action: 'theme.publish',
      targetType: 'theme_palette',
      targetRef: String(id),
      before: previousActive ? previousActive.tokens_json : {},
      after: published.tokens_json,
      meta: {
        palette_name: published.name,
        preset_key: published.preset_key,
      },
      traceId: reqContext.traceId,
      ip: reqContext.ip,
      userAgent: reqContext.userAgent,
    });
  }

  return published;
}
