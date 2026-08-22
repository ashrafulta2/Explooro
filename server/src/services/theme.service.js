/**
 * theme.service.js — Theme Studio service, contrast verification & critical publishing (Prompt 3.5).
 */

import * as themeRepo from '../repositories/theme.repository.js';
import { AppError } from '../plugins/errorHandler.js';

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

  const nav = tokens.navbar || {};
  const surf = tokens.surfaces || {};
  const brand = tokens.brand || {};
  const typo = tokens.typography || {};
  const badges = tokens.badges || {};
  const footer = tokens.footer || {};

  check('Navbar Text on Navbar BG', nav.text, nav.bg, 4.5);
  check('Body Text on Page Canvas', typo.primary, surf.page, 4.5);
  check('Body Text on Card Surface', typo.primary, surf.card, 4.5);
  check('Secondary Text on Card Surface', typo.secondary, surf.card, 3.5);
  check('Brand Button Contrast Text on Brand Primary', brand.contrast, brand.primary, 4.5);
  check('Success Badge Text on BG', badges.success_text, badges.success_bg, 4.5);
  check('Warning Badge Text on BG', badges.warning_text, badges.warning_bg, 4.5);
  check('Danger Badge Text on BG', badges.danger_text, badges.danger_bg, 4.5);
  check('Info Badge Text on BG', badges.info_text, badges.info_bg, 4.5);
  check('Footer Text on Footer BG', footer.text, footer.bg, 4.5);

  if (failures.length > 0) {
    const first = failures[0];
    throw new AppError(
      'THEME_CONTRAST_FAILED',
      `WCAG AA Contrast check failed: ${first.message}`,
      `ডব্লিউসিএজি এএ কনট্রাস্ট ব্যর্থ: ${first.pairing} এর অনুপাত ${first.ratio}:1 (প্রয়োজন ${first.required}:1)`,
      { failures }
    );
  }

  return true;
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
  return themeRepo.saveThemeDraft(db, {
    name: name || 'Custom Theme Draft',
    presetKey,
    tokensJson: tokens,
    createdBy: userId,
  });
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
