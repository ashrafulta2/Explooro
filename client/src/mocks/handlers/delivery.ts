/**
 * delivery.ts — Mock API handlers for the per-parcel delivery charge, by delivery zone.
 *
 * Mirrors server/src/routes/deliveryCharge.routes.ts and the rules of
 * server/src/services/deliveryCharge.service.ts `validatePolicy` (the ones the page can trip). The
 * mock cart (handlers/cart.ts) and live quote (handlers/live.ts) price delivery with the same zones,
 * so a change here shows up there, as it does against the API. Persisted to localStorage for the same
 * reason handlers/genie.ts does: "does it survive a reload?"
 */

import type { MockRoute } from '../types.ts';
import { BANGLADESH_DIVISIONS } from '../../data/bangladeshGeo.ts';
import { defaultZone, isDeliveryPolicy, resolveZone } from '../../services/deliveryZones.ts';
import type { DeliveryPolicy } from '../../services/deliveryZones.ts';

const STORAGE_KEY = 'explooro:mock:delivery:zones:v2';
const LIMITS = { min: 0, max: 5000, minZones: 1, maxZones: 10, nameMaxLength: 60, days: { min: 0, max: 30 }, cutoff: { min: 0, max: 23 } };
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
const DISTRICTS_BY_DIVISION = Object.fromEntries(BANGLADESH_DIVISIONS.map((d) => [d.id, d.districts.map((x) => x.id)]));
const DISTRICT_IDS = new Set(Object.values(DISTRICTS_BY_DIVISION).flat());

type StoredPolicy = DeliveryPolicy & { updated_at: string | null; updated_by: number | null };

const DEFAULT_POLICY: StoredPolicy = {
  default_zone: 'outside_dhaka',
  cutoff_hour: null,
  zones: [
    { key: 'inside_dhaka', name_en: 'Inside Dhaka', name_bn: 'ঢাকার ভিতরে', charge: 60, team_charge: 60, days_min: 1, days_max: 2, districts: ['dhaka_city'] },
    { key: 'outside_dhaka', name_en: 'Outside Dhaka', name_bn: 'ঢাকার বাইরে', charge: 60, team_charge: 60, days_min: 3, days_max: 5, districts: [] },
  ],
  updated_at: null,
  updated_by: null,
};

const cloneDefault = (): StoredPolicy => ({ ...DEFAULT_POLICY, zones: DEFAULT_POLICY.zones.map((z) => ({ ...z, districts: [...z.districts] })) });

function loadPolicy(): StoredPolicy {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isDeliveryPolicy(parsed)) return { updated_at: null, updated_by: null, ...parsed };
    }
  } catch {
    // Private browsing — the shipped default.
  }
  return cloneDefault();
}

let mockPolicy = loadPolicy();
let mockHistory = [];

/** The default zone's charge: what the mock cart estimates with before an address is known. */
export function mockDeliveryCharge() {
  return defaultZone(mockPolicy).charge;
}

/** The charge for one parcel to `district` (the default zone when none). */
export function mockDeliveryChargeFor(district: unknown) {
  return resolveZone(mockPolicy, district);
}

const bad = (message_en, message_bn) => ({ status: 400, body: { error: { code: 'VALIDATION_FAILED', message_en, message_bn } } });

const isCharge = (n) => typeof n === 'number' && Number.isFinite(n) && n >= LIMITS.min && n <= LIMITS.max && Math.round(n * 100) === n * 100;

const publicView = (p: DeliveryPolicy) => ({
  default_zone: p.default_zone,
  cutoff_hour: p.cutoff_hour ?? null,
  zones: p.zones.map(({ key, name_en, name_bn, charge, team_charge, days_min, days_max, districts }) => ({
    key, name_en, name_bn, charge, team_charge, days_min, days_max, districts: [...districts],
  })),
  per_parcel_charge: defaultZone(p).charge,
});

/** The same refusals as validatePolicy on the server, in the same order. Null when valid. */
function check(body): ReturnType<typeof bad> | null {
  const zones = body.zones;
  if (!Array.isArray(zones) || zones.length < LIMITS.minZones || zones.length > LIMITS.maxZones) {
    return bad(`Set between ${LIMITS.minZones} and ${LIMITS.maxZones} delivery zones.`, `${LIMITS.minZones} থেকে ${LIMITS.maxZones}টি ডেলিভারি এলাকা রাখুন।`);
  }
  const keys = new Set();
  const owners = new Map();
  for (const z of zones) {
    if (!KEY_PATTERN.test(z?.key ?? '') || keys.has(z.key)) return bad('Each zone needs its own key.', 'প্রতিটি এলাকার আলাদা key লাগবে।');
    keys.add(z.key);
    for (const f of ['name_en', 'name_bn']) {
      const v = typeof z[f] === 'string' ? z[f].trim() : '';
      if (!v || v.length > LIMITS.nameMaxLength) return bad('Each zone needs a name in English and Bangla.', 'প্রতিটি এলাকার ইংরেজি ও বাংলা নাম লাগবে।');
    }
    const isDays = (n) => Number.isInteger(n) && n >= LIMITS.days.min && n <= LIMITS.days.max;
    if (!isDays(z.days_min) || !isDays(z.days_max) || z.days_min > z.days_max) {
      return bad(`Delivery time must be whole days from ${LIMITS.days.min} to ${LIMITS.days.max}, and "from" cannot be more than "to".`, `ডেলিভারির সময় ${LIMITS.days.min} থেকে ${LIMITS.days.max} দিনের পূর্ণ সংখ্যা হতে হবে।`);
    }
    if (!isCharge(z.charge) || !isCharge(z.team_charge)) {
      return bad(`The delivery charge must be between ৳${LIMITS.min} and ৳${LIMITS.max}, in whole paisa.`, `ডেলিভারি চার্জ ৳${LIMITS.min} থেকে ৳${LIMITS.max} এর মধ্যে হতে হবে।`);
    }
    if (!Array.isArray(z.districts)) return bad('Each zone needs a list of districts.', 'প্রতিটি এলাকার জেলার তালিকা লাগবে।');
    for (const d of z.districts) {
      if (!DISTRICT_IDS.has(d)) return bad(`"${d}" is not a district the address form offers.`, `"${d}" ঠিকানা ফর্মের কোনো জেলা নয়।`);
      if (owners.has(d) && owners.get(d) !== z.key) return bad(`District "${d}" is already in zone "${owners.get(d)}".`, `"${d}" জেলাটি আগেই "${owners.get(d)}" এলাকায় আছে।`);
      owners.set(d, z.key);
    }
  }
  if (!keys.has(body.default_zone)) return bad('Pick which zone charges every district no zone lists.', 'ডিফল্ট এলাকা বেছে নিন।');
  const cutoff = body.cutoff_hour;
  if (!(cutoff == null || (Number.isInteger(cutoff) && cutoff >= LIMITS.cutoff.min && cutoff <= LIMITS.cutoff.max))) {
    return bad(`The order cut-off must be an hour from ${LIMITS.cutoff.min} to ${LIMITS.cutoff.max}, or none.`, `অর্ডারের কাট-অফ ${LIMITS.cutoff.min} থেকে ${LIMITS.cutoff.max}টার মধ্যে একটি ঘণ্টা হতে হবে, নয়তো কিছু নয়।`);
  }
  if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
    return bad('Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।');
  }
  return null;
}

export const deliveryHandlers = [
  {
    method: 'GET',
    path: '/delivery/policy',
    handler() {
      return { status: 200, body: { policy: publicView(mockPolicy) } };
    },
  },
  {
    method: 'GET',
    path: '/admin/platform/delivery',
    handler() {
      return {
        status: 200,
        body: {
          policy: { ...mockPolicy, zones: mockPolicy.zones.map((z) => ({ ...z, districts: [...z.districts] })) },
          limits: { ...LIMITS },
          districts_by_division: DISTRICTS_BY_DIVISION,
          history: mockHistory,
          can_update: true,
        },
      };
    },
  },
  {
    method: 'PUT',
    path: '/admin/platform/delivery',
    handler({ body = {} }: { body?: Record<string, any> } = {}) {
      const refused = check(body);
      if (refused) return refused;
      if (body.expected_updated_at && mockPolicy.updated_at && body.expected_updated_at !== mockPolicy.updated_at) {
        return {
          status: 409,
          body: { error: { code: 'PRECONDITION_CHANGED', message_en: 'Someone changed the delivery zones after you opened the page. Reload and try again.', message_bn: 'আপনি পেজ খোলার পরে কেউ ডেলিভারি এলাকা বদলেছেন। রিলোড করে আবার চেষ্টা করুন।' } },
        };
      }
      const before = publicView(mockPolicy);
      mockPolicy = {
        default_zone: body.default_zone,
        cutoff_hour: body.cutoff_hour ?? null,
        zones: body.zones.map((z) => ({
          key: z.key, name_en: z.name_en.trim(), name_bn: z.name_bn.trim(), charge: z.charge,
          team_charge: z.team_charge, days_min: z.days_min, days_max: z.days_max, districts: [...new Set<string>(z.districts)],
        })),
        updated_at: new Date().toISOString(),
        updated_by: 1,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mockPolicy));
      } catch {
        // Non-fatal.
      }
      const after = publicView(mockPolicy);
      mockHistory = [{
        id: mockHistory.length + 1,
        action: 'platform.delivery.update',
        actor_ref: 'USR-SUPERADMIN',
        created_at: mockPolicy.updated_at,
        before_json: { default_zone: before.default_zone, zones: before.zones },
        after_json: { default_zone: after.default_zone, zones: after.zones },
        meta_json: { reason: body.reason.trim() },
      }, ...mockHistory].slice(0, 10);
      return {
        status: 200,
        body: {
          policy: { ...mockPolicy },
          message_en: 'Delivery charges updated. New carts and orders use them now.',
          message_bn: 'ডেলিভারি চার্জ হালনাগাদ হয়েছে। নতুন কার্ট ও অর্ডারে এখন থেকেই এটি প্রযোজ্য।',
        },
      };
    },
  },
] satisfies MockRoute[];

export default deliveryHandlers;
