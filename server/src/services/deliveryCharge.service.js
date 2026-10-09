/**
 * deliveryCharge.service.js — the delivery charge a normal checkout adds per supplier parcel.
 *
 * It used to be a ৳60 constant in checkout.service.js and cart.service.js (and three more copies in
 * the client). It is a business number, so it lives in platform_settings (group `delivery`, seeded by
 * 069_delivery_charge_and_cod_gate.sql) and a super admin sets it at /admin/platform/delivery.
 *
 * Same shape as genie.service.js: validated here, written in one transaction, audited with
 * before/after JSON, cached briefly because the cart reads it on every request.
 *
 * Team purchase does not use this: each team snapshots its own shipping charge from the
 * group_buying module when it starts (teamPurchase.service.js).
 */

import * as settingRepo from '../repositories/setting.repository.js';
import { AppError } from '../plugins/errorHandler.js';

export const SETTINGS_GROUP = 'delivery';
export const SETTING_KEY = 'delivery.per_parcel_charge';
export const CHARGE_LIMITS = Object.freeze({ min: 0, max: 5000 });
export const DEFAULT_POLICY = Object.freeze({ per_parcel_charge: 60 });

const SETTING_META = {
  valueType: 'NUMBER',
  labelEn: 'Delivery charge per parcel (৳)',
  labelBn: 'প্রতি পার্সেলে ডেলিভারি চার্জ (৳)',
};

const CACHE_KEY = 'delivery:policy';
const CACHE_TTL_SECONDS = 300;

function readJsonValue(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Whole paisa only, within the limits. */
function isCharge(n) {
  return typeof n === 'number'
    && Number.isFinite(n)
    && n >= CHARGE_LIMITS.min
    && n <= CHARGE_LIMITS.max
    && Math.round(n * 100) === n * 100;
}

function rowToPolicy(row) {
  const value = Number(readJsonValue(row?.value_json));
  return {
    per_parcel_charge: row && isCharge(value) ? value : DEFAULT_POLICY.per_parcel_charge,
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

/** Pure, so the API and the tests assert the same rule. Throws VALIDATION_FAILED (HTTP 400). */
export function validatePolicy(input = {}) {
  const charge = input.per_parcel_charge;
  if (!isCharge(charge)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `The delivery charge must be between ৳${CHARGE_LIMITS.min} and ৳${CHARGE_LIMITS.max}, in whole paisa.`,
      `ডেলিভারি চার্জ ৳${CHARGE_LIMITS.min} থেকে ৳${CHARGE_LIMITS.max} এর মধ্যে হতে হবে।`,
      { field: 'per_parcel_charge', min: CHARGE_LIMITS.min, max: CHARGE_LIMITS.max }
    );
  }
  return { per_parcel_charge: charge };
}

/**
 * The live policy. Pass `{ fresh: true }` from inside an order's transaction so the charge that is
 * written onto the order is the one in the database at that moment, not a cached copy.
 */
export async function getPolicy(db, cache, { fresh = false } = {}) {
  if (cache && !fresh) {
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (isCharge(parsed?.per_parcel_charge)) return parsed;
      }
    } catch {
      // A miss or a malformed entry falls through to the database.
    }
  }

  let policy = { ...DEFAULT_POLICY, updated_at: null, updated_by: null };
  try {
    policy = rowToPolicy(await settingRepo.getSettingByKey(db, SETTING_KEY));
  } catch {
    // Before migration 069 has run, the shipped default is a better answer than a 500.
  }

  if (cache && !fresh) {
    try {
      await cache.set(CACHE_KEY, JSON.stringify(policy), CACHE_TTL_SECONDS);
    } catch {
      // Caching is an optimisation.
    }
  }
  return policy;
}

/** The charge in BDT for one supplier parcel. */
export async function perParcelCharge(db, cache, opts) {
  return (await getPolicy(db, cache, opts)).per_parcel_charge;
}

async function invalidate(cache) {
  if (!cache) return;
  try {
    await cache.del(CACHE_KEY);
  } catch {
    // Worst case the old value serves for up to CACHE_TTL_SECONDS.
  }
}

export async function updatePolicy(
  db,
  cache,
  auditService,
  { policy, reason, userId, actorRole = null, reqContext = {} }
) {
  const next = validatePolicy(policy);

  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Give a reason of at least 10 characters for this change.',
      'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।',
      { field: 'reason' }
    );
  }

  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  let before;
  let after;
  try {
    if (isDedicatedClient) await client.query('BEGIN');
    await settingRepo.lockSettingsGroup(client, SETTINGS_GROUP);
    before = rowToPolicy(await settingRepo.getSettingByKey(client, SETTING_KEY));
    await settingRepo.upsertSetting(client, {
      key: SETTING_KEY,
      valueJson: next.per_parcel_charge,
      groupKey: SETTINGS_GROUP,
      updatedBy: userId ?? null,
      ...SETTING_META,
    });
    after = rowToPolicy(await settingRepo.getSettingByKey(client, SETTING_KEY));
    if (isDedicatedClient) await client.query('COMMIT');
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }

  await invalidate(cache);

  if (auditService?.record) {
    await auditService.record(db, {
      action: 'platform.delivery.update',
      targetType: 'platform_settings',
      targetRef: SETTING_KEY,
      beforeJson: { per_parcel_charge: before.per_parcel_charge },
      afterJson: { per_parcel_charge: after.per_parcel_charge },
      meta: { reason: reason.trim() },
      riskTier: 'CRITICAL',
      actorId: userId ?? null,
      actorRole,
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
  }

  return after;
}
