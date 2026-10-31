/**
 * deliveryCharge.service.ts — the delivery charge a normal checkout adds per supplier parcel,
 * by delivery zone.
 *
 * History: it was a ৳60 constant in checkout.service.ts and cart.service.ts, then one number in
 * platform_settings (`delivery.per_parcel_charge`, migration 069). One number cannot price Bangladesh:
 * couriers charge one rate inside Dhaka and a higher one outside it. Since migration 098 the setting
 * is a list of ZONES (`delivery.zones`, OBJECT): each zone has a name, a per-parcel charge and the
 * districts it covers, and one zone is the DEFAULT for every district no zone names. A super admin
 * edits it at /admin/platform/delivery.
 *
 * The zone is decided by the district of the delivery address and nothing else, here, in
 * `resolveZone`. The client mirrors it in client/src/services/deliveryZones.ts so checkout can show the
 * charge while the shopper picks a district; server/test/deliveryZones.test.js fails if the two
 * disagree. The server always re-resolves: the client's figure is a preview, never an input.
 *
 * Same shape as genie.service.ts: validated here (strict: out of range is refused, never clamped),
 * written in one transaction, audited with before/after JSON, cached briefly because the cart reads it
 * on every request.
 *
 * Team purchase does not use this: each team snapshots its own shipping charge from the
 * group_buying module when it starts (teamPurchase.service.ts).
 */

import * as settingRepo from '../repositories/setting.repository.ts';
import { AppError } from '../plugins/errorHandler.ts';
import { BD_DISTRICT_IDS } from '../config/bdDistricts.ts';

export const SETTINGS_GROUP = 'delivery';
export const SETTING_KEY = 'delivery.zones';
/** The single-number setting migration 098 replaced; read only as a fallback before 098 has run. */
export const LEGACY_SETTING_KEY = 'delivery.per_parcel_charge';

export const CHARGE_LIMITS = Object.freeze({ min: 0, max: 5000 });
export const ZONE_LIMITS = Object.freeze({ minZones: 1, maxZones: 10, nameMaxLength: 60 });
const ZONE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

export interface DeliveryZone {
  key: string;
  name_en: string;
  name_bn: string;
  charge: number;
  districts: string[];
}

export interface DeliveryPolicy {
  default_zone: string;
  zones: DeliveryZone[];
}

/**
 * WHY both zones at ৳60: that was the single charge before zones existed, so shipping this default
 * changes nobody's price. The super admin raises "Outside Dhaka" when they decide to; that number is
 * a business decision, not something a migration should make.
 */
export const DEFAULT_POLICY: Readonly<DeliveryPolicy> = Object.freeze({
  default_zone: 'outside_dhaka',
  zones: [
    { key: 'inside_dhaka', name_en: 'Inside Dhaka', name_bn: 'ঢাকার ভিতরে', charge: 60, districts: ['dhaka_city'] },
    { key: 'outside_dhaka', name_en: 'Outside Dhaka', name_bn: 'ঢাকার বাইরে', charge: 60, districts: [] },
  ],
});

const SETTING_META = {
  valueType: 'OBJECT',
  labelEn: 'Delivery charge zones',
  labelBn: 'ডেলিভারি চার্জের এলাকা',
};

// WHY a new key: entries cached under the old key hold the single-number shape.
const CACHE_KEY = 'delivery:policy:zones';
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

// WHY aliases: an address saved before the cascading form (or typed by an older client) may carry a
// district's name or an old spelling instead of the form's id. They must land in the same zone.
const DISTRICT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  chattogram: 'chittagong',
  barishal: 'barisal',
  comilla: 'cumilla',
  bogra: 'bogura',
  jessore: 'jashore',
  coxsbazar: 'coxs_bazar',
});

/**
 * One comparable form for a district: "dhaka_city", "Dhaka City" and "Dhaka" all become "dhaka".
 * Pure; client/src/services/deliveryZones.ts has the same function and the parity test runs both.
 */
export function canonicalDistrict(value: unknown): string {
  const s = String(value ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_city$/, '');
  return DISTRICT_ALIASES[s] ?? s;
}

function fail(field: string, messageEn: string, messageBn: string, extra: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', messageEn, messageBn, { field, ...extra });
}

/**
 * Pure, so the API, the readers and the tests apply the same rule. Throws VALIDATION_FAILED (HTTP 400).
 * Returns a normalised copy: trimmed names, de-duplicated districts.
 */
export function validatePolicy(input: any = {}): DeliveryPolicy {
  const zonesIn = input?.zones;
  if (!Array.isArray(zonesIn) || zonesIn.length < ZONE_LIMITS.minZones || zonesIn.length > ZONE_LIMITS.maxZones) {
    fail('zones',
      `Set between ${ZONE_LIMITS.minZones} and ${ZONE_LIMITS.maxZones} delivery zones.`,
      `${ZONE_LIMITS.minZones} থেকে ${ZONE_LIMITS.maxZones}টি ডেলিভারি এলাকা রাখুন।`,
      { min: ZONE_LIMITS.minZones, max: ZONE_LIMITS.maxZones });
  }

  const keys = new Set<string>();
  const districtOwner = new Map<string, string>();
  const zones: DeliveryZone[] = zonesIn.map((z: any, i: number) => {
    const key = typeof z?.key === 'string' ? z.key.trim() : '';
    if (!ZONE_KEY_PATTERN.test(key)) {
      fail(`zones.${i}.key`, 'Each zone needs a key of 2–40 lowercase letters, digits or underscores.', 'প্রতিটি এলাকার একটি key লাগবে (২–৪০টি ছোট হাতের অক্ষর, সংখ্যা বা _)।');
    }
    if (keys.has(key)) {
      fail(`zones.${i}.key`, `Two zones share the key "${key}".`, `দুটি এলাকার key একই: "${key}"।`);
    }
    keys.add(key);

    const names = {} as { name_en: string; name_bn: string };
    for (const field of ['name_en', 'name_bn'] as const) {
      const name = typeof z?.[field] === 'string' ? z[field].trim() : '';
      if (!name || name.length > ZONE_LIMITS.nameMaxLength) {
        fail(`zones.${i}.${field}`,
          `Each zone needs a name in English and Bangla, up to ${ZONE_LIMITS.nameMaxLength} characters.`,
          `প্রতিটি এলাকার ইংরেজি ও বাংলা নাম লাগবে, সর্বোচ্চ ${ZONE_LIMITS.nameMaxLength} অক্ষর।`);
      }
      names[field] = name;
    }

    if (!isCharge(z?.charge)) {
      fail(`zones.${i}.charge`,
        `The delivery charge must be between ৳${CHARGE_LIMITS.min} and ৳${CHARGE_LIMITS.max}, in whole paisa.`,
        `ডেলিভারি চার্জ ৳${CHARGE_LIMITS.min} থেকে ৳${CHARGE_LIMITS.max} এর মধ্যে হতে হবে।`,
        { min: CHARGE_LIMITS.min, max: CHARGE_LIMITS.max });
    }

    if (!Array.isArray(z?.districts)) {
      fail(`zones.${i}.districts`, 'Each zone needs a list of districts (it may be empty).', 'প্রতিটি এলাকার জেলার তালিকা লাগবে (খালিও হতে পারে)।');
    }
    const districts: string[] = [];
    for (const d of z.districts) {
      if (typeof d !== 'string' || !BD_DISTRICT_IDS.has(d)) {
        fail(`zones.${i}.districts`, `"${String(d)}" is not a district the address form offers.`, `"${String(d)}" ঠিকানা ফর্মের কোনো জেলা নয়।`);
      }
      if (districts.includes(d)) continue;
      // WHY refused: a district in two zones would have two prices, and which one wins would depend on
      // list order, which nobody looking at the page could see.
      const owner = districtOwner.get(d);
      if (owner) {
        fail(`zones.${i}.districts`, `District "${d}" is already in zone "${owner}".`, `"${d}" জেলাটি আগেই "${owner}" এলাকায় আছে।`, { district: d });
      }
      districtOwner.set(d, key);
      districts.push(d);
    }

    return { key, ...names, charge: z.charge, districts };
  });

  const defaultZone = typeof input?.default_zone === 'string' ? input.default_zone.trim() : '';
  if (!keys.has(defaultZone)) {
    fail('default_zone', 'Pick which zone charges every district no zone lists.', 'কোনো এলাকায় নেই এমন জেলার জন্য কোন এলাকার চার্জ হবে, তা বেছে নিন।');
  }

  return { default_zone: defaultZone, zones };
}

function tryPolicy(value: unknown): DeliveryPolicy | null {
  try {
    return validatePolicy(value);
  } catch {
    return null;
  }
}

/** The shipped zones, every one charging `charge`: what a pre-098 single number means as zones. */
function policyFromSingleCharge(charge: number): DeliveryPolicy {
  return {
    default_zone: DEFAULT_POLICY.default_zone,
    zones: DEFAULT_POLICY.zones.map((z) => ({ ...z, charge, districts: [...z.districts] })),
  };
}

function freshDefault(): DeliveryPolicy {
  return { default_zone: DEFAULT_POLICY.default_zone, zones: DEFAULT_POLICY.zones.map((z) => ({ ...z, districts: [...z.districts] })) };
}

/** The zone that delivers to `district`: the zone listing it, else the default zone. Pure. */
export function resolveZone(policy: DeliveryPolicy, district: unknown): DeliveryZone {
  const wanted = canonicalDistrict(district);
  if (wanted) {
    const hit = policy.zones.find((z) => z.districts.some((d) => canonicalDistrict(d) === wanted));
    if (hit) return hit;
  }
  return policy.zones.find((z) => z.key === policy.default_zone) ?? policy.zones[0];
}

/** What a shopper is shown before they give an address: the default zone's charge. */
export function defaultZone(policy: DeliveryPolicy): DeliveryZone {
  return resolveZone(policy, null);
}

type StoredPolicy = DeliveryPolicy & { updated_at: any; updated_by: any };

async function readStored(db): Promise<StoredPolicy> {
  try {
    const row = await settingRepo.getSettingByKey(db, SETTING_KEY);
    const policy = row ? tryPolicy(readJsonValue(row.value_json)) : null;
    if (policy) return { ...policy, updated_at: row.updated_at ?? null, updated_by: row.updated_by ?? null };

    // Before migration 098 has run: the single number, applied to every zone.
    const legacy = await settingRepo.getSettingByKey(db, LEGACY_SETTING_KEY);
    const charge = Number(readJsonValue(legacy?.value_json));
    if (legacy && isCharge(charge)) {
      return { ...policyFromSingleCharge(charge), updated_at: legacy.updated_at ?? null, updated_by: legacy.updated_by ?? null };
    }
  } catch {
    // Before migration 069 has run, the shipped default is a better answer than a 500.
  }
  return { ...freshDefault(), updated_at: null, updated_by: null };
}

/**
 * The live policy. Pass `{ fresh: true }` from inside an order's transaction so the charge that is
 * written onto the order is the one in the database at that moment, not a cached copy.
 */
export async function getPolicy(db, cache, { fresh = false } = {}): Promise<StoredPolicy> {
  if (cache && !fresh) {
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        const policy = tryPolicy(parsed);
        if (policy) return { ...policy, updated_at: parsed.updated_at ?? null, updated_by: parsed.updated_by ?? null };
      }
    } catch {
      // A miss or a malformed entry falls through to the database.
    }
  }

  const policy = await readStored(db);

  if (cache && !fresh) {
    try {
      await cache.set(CACHE_KEY, JSON.stringify(policy), CACHE_TTL_SECONDS);
    } catch {
      // Caching is an optimisation.
    }
  }
  return policy;
}

/**
 * The zone and per-parcel charge (BDT) for one delivery address. Without a district, the default
 * zone: that is what the cart estimates with before the shopper has said where it is going.
 */
export async function zoneForAddress(db, cache, { district = null }: { district?: unknown } = {}, opts: { fresh?: boolean } = {}) {
  const policy = await getPolicy(db, cache, opts);
  const zone = resolveZone(policy, district);
  return { zone, charge: zone.charge };
}

/** The charge in BDT for one supplier parcel delivered to `district` (default zone if none). */
export async function perParcelCharge(db, cache, opts: { fresh?: boolean; district?: unknown } = {}) {
  const { district = null, ...rest } = opts;
  return (await zoneForAddress(db, cache, { district }, rest)).charge;
}

/** The shape GET /delivery/policy serves: everything checkout needs to preview a zone, no audit fields. */
export function publicView(policy: DeliveryPolicy) {
  return {
    default_zone: policy.default_zone,
    zones: policy.zones.map(({ key, name_en, name_bn, charge, districts }) => ({ key, name_en, name_bn, charge, districts: [...districts] })),
    // WHY kept: a client loaded before zones shipped reads this one number; it now means the default zone.
    per_parcel_charge: defaultZone(policy).charge,
  };
}

async function invalidate(cache) {
  if (!cache) return;
  try {
    await cache.del(CACHE_KEY);
  } catch {
    // Worst case the old value serves for up to CACHE_TTL_SECONDS.
  }
}

const auditShape = (p: DeliveryPolicy) => ({ default_zone: p.default_zone, zones: p.zones });

export async function updatePolicy(
  db,
  cache,
  auditService,
  {
    policy,
    reason,
    userId,
    actorRole = null,
    expectedUpdatedAt = null,
    reqContext = ({} as { ip?: string, userAgent?: string, traceId?: string }),
  }: { policy: any; reason: any; userId: any; actorRole?: any; expectedUpdatedAt?: string | null; reqContext?: { ip?: string, userAgent?: string, traceId?: string } }
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

  let before: StoredPolicy;
  let after: StoredPolicy;
  try {
    if (isDedicatedClient) await client.query('BEGIN');
    await settingRepo.lockSettingsGroup(client, SETTINGS_GROUP);
    before = await readStored(client);
    // WHY the stale check: the zone form is long; two admins editing at once would otherwise have the
    // second silently undo the first.
    if (expectedUpdatedAt && before.updated_at
      && new Date(before.updated_at).toISOString() !== new Date(expectedUpdatedAt).toISOString()) {
      throw new AppError(
        'PRECONDITION_CHANGED',
        'Someone changed the delivery zones after you opened the page. Reload and try again.',
        'আপনি পেজ খোলার পরে কেউ ডেলিভারি এলাকা বদলেছেন। রিলোড করে আবার চেষ্টা করুন।'
      );
    }
    await settingRepo.upsertSetting(client, {
      key: SETTING_KEY,
      valueJson: next,
      groupKey: SETTINGS_GROUP,
      updatedBy: userId ?? null,
      ...SETTING_META,
    });
    after = await readStored(client);
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
      beforeJson: auditShape(before),
      afterJson: auditShape(after),
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
