/**
 * adDensity.service.ts — how often sponsored cards appear inside a product grid (migration 090).
 *
 * The client places paid cards among organic ones (client/src/components/ads/adPlacement.ts); this
 * service owns the two numbers per placement that decide where: `first_at`, the organic card the
 * first ad goes in front of, and `every`, the organic cards from one ad to the next.
 *
 * Reads are forgiving (a missing or out-of-range value falls back to the default) because a page
 * must always render. Writes are strict (out of range is refused, never clamped), reasoned, audited
 * with before/after, and stale-checked, so two admins editing at once cannot silently undo each other.
 */

import { AppError } from '../plugins/errorHandler.ts';
import { withTransaction } from '../config/db.ts';
import * as settingRepo from '../repositories/setting.repository.ts';
import { writeAudit } from '../lib/audit.ts';

export const DENSITY_KEY = 'ads.density';
export const PLACEMENTS = Object.freeze(['SEARCH_RESULTS', 'FEED'] as const);

// WHY every >= 4: below that a 4-column grid has an ad in every row, which is the "page full of ads"
// the in-grid placement exists to avoid. It also guarantees two ads never touch.
export const DENSITY_LIMITS = Object.freeze({
  first_at: { min: 0, max: 12 },
  every: { min: 4, max: 40 },
});

/** Kept equal to AD_DENSITY in client/src/components/ads/adPlacement.ts (server/test/adDensity.test.js). */
export const DEFAULT_DENSITY = Object.freeze({
  SEARCH_RESULTS: Object.freeze({ first_at: 0, every: 8 }),
  FEED: Object.freeze({ first_at: 2, every: 8 }),
});

const MIN_REASON_LENGTH = 10;

type Density = Record<(typeof PLACEMENTS)[number], { first_at: number; every: number }>;

const inRange = (v, { min, max }) => Number.isInteger(v) && v >= min && v <= max;

/** Pure. Whatever is stored, cut down to a usable density; a bad value falls back to the default. */
export function resolveDensity(raw): Density {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {} as Density;
  for (const p of PLACEMENTS) {
    const row = r[p] && typeof r[p] === 'object' ? r[p] : {};
    out[p] = {
      first_at: inRange(row.first_at, DENSITY_LIMITS.first_at) ? row.first_at : DEFAULT_DENSITY[p].first_at,
      every: inRange(row.every, DENSITY_LIMITS.every) ? row.every : DEFAULT_DENSITY[p].every,
    };
  }
  return out;
}

/** Pure. A complete proposed density, refused on the first value out of range. */
export function validateDensity(input): Density {
  const r = input && typeof input === 'object' ? input : {};
  const out = {} as Density;
  for (const p of PLACEMENTS) {
    for (const field of ['first_at', 'every'] as const) {
      const v = r[p]?.[field];
      const { min, max } = DENSITY_LIMITS[field];
      if (!inRange(v, DENSITY_LIMITS[field])) {
        throw new AppError(
          'VALIDATION_FAILED',
          `${p}.${field} must be a whole number from ${min} to ${max}.`,
          `${p}.${field} ${min} থেকে ${max} এর মধ্যে একটি পূর্ণসংখ্যা হতে হবে।`,
          { field: `${p}.${field}`, min, max }
        );
      }
    }
    out[p] = { first_at: r[p].first_at, every: r[p].every };
  }
  return out;
}

/** The live density plus when it last changed (the admin form sends that back as its stale check). */
export async function loadDensity(db): Promise<Density & { updated_at: string | null }> {
  try {
    const { rows } = await db.query(`SELECT value_json, updated_at FROM platform_settings WHERE key = $1`, [DENSITY_KEY]);
    return { ...resolveDensity(rows[0]?.value_json), updated_at: rows[0]?.updated_at ?? null };
  } catch {
    // A fresh clone that has not migrated yet still gets the shipped default rather than a 500.
    return { ...resolveDensity(null), updated_at: null };
  }
}

export async function updateDensity(db, { input, reason, userId = null, actorRole = null, expectedUpdatedAt = null, reqContext = {} as any }) {
  const next = validateDensity(input);
  if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
    throw new AppError('VALIDATION_FAILED',
      `Give a reason of at least ${MIN_REASON_LENGTH} characters for this change.`,
      `এই পরিবর্তনের জন্য অন্তত ${MIN_REASON_LENGTH} অক্ষরের একটি কারণ লিখুন।`,
      { field: 'reason' });
  }
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT value_json, updated_at FROM platform_settings WHERE key = $1 FOR UPDATE`,
      [DENSITY_KEY]
    );
    const before = resolveDensity(rows[0]?.value_json);
    if (expectedUpdatedAt && rows[0]?.updated_at && new Date(rows[0].updated_at).toISOString() !== new Date(expectedUpdatedAt).toISOString()) {
      throw new AppError('PRECONDITION_CHANGED',
        'Someone changed the ad density after you opened the page. Reload and try again.',
        'আপনি page খোলার পরে কেউ বিজ্ঞাপনের ঘনত্ব বদলেছেন। Reload করে আবার চেষ্টা করুন।');
    }
    const saved = await settingRepo.upsertSetting(client, {
      key: DENSITY_KEY,
      valueJson: next,
      valueType: 'OBJECT',
      labelEn: 'Sponsored card density',
      labelBn: 'স্পন্সর্ড কার্ডের ঘনত্ব',
      groupKey: 'growth',
      updatedBy: userId,
    });
    await writeAudit(client, {
      action: 'growth.ad_density.update',
      actorId: userId,
      actorRole,
      targetType: 'platform_settings',
      targetRef: DENSITY_KEY,
      before,
      after: next,
      meta: { reason: reason.trim() },
      riskTier: 'HIGH',
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
    return { ...resolveDensity(saved?.value_json ?? next), updated_at: saved?.updated_at ?? null };
  });
}
