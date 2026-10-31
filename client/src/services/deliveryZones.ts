/**
 * deliveryZones.ts — which delivery zone (and so which per-parcel charge) a district falls in.
 *
 * The super admin sets the zones at /admin/platform/delivery (Inside Dhaka, Outside Dhaka, ...). The
 * server decides the charge an order pays (server/src/services/deliveryCharge.service.ts
 * `resolveZone`); this is the same rule, so checkout can show the charge the moment the shopper picks
 * a district. Pure: no fetch, no storage. server/test/deliveryZones.test.js runs both and fails if
 * they ever disagree.
 */

export interface DeliveryZone {
  key: string;
  name_en: string;
  name_bn: string;
  charge: number;
  /** Per-member delivery charge for a team purchase to this zone (migration 099). */
  team_charge: number;
  /** Delivery time in whole days; 0 is same-day. */
  days_min: number;
  days_max: number;
  districts: string[];
}

export interface DeliveryPolicy {
  default_zone: string;
  zones: DeliveryZone[];
  /** The default zone's charge; kept by the API for clients from before zones existed. */
  per_parcel_charge?: number;
}

// WHY aliases: an address saved before the cascading form may carry an old spelling.
const DISTRICT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  chattogram: 'chittagong',
  barishal: 'barisal',
  comilla: 'cumilla',
  bogra: 'bogura',
  jessore: 'jashore',
  coxsbazar: 'coxs_bazar',
});

/** One comparable form for a district: "dhaka_city", "Dhaka City" and "Dhaka" all become "dhaka". */
export function canonicalDistrict(value: unknown): string {
  const s = String(value ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_city$/, '');
  return DISTRICT_ALIASES[s] ?? s;
}

/** True when `value` has the shape the API serves; anything else is ignored, never trusted. */
export function isDeliveryPolicy(value: unknown): value is DeliveryPolicy {
  const p = value as DeliveryPolicy;
  return Boolean(p)
    && typeof p.default_zone === 'string'
    && Array.isArray(p.zones)
    && p.zones.length > 0
    && p.zones.every((z) => z && typeof z.key === 'string'
      && Number.isFinite(z.charge) && z.charge >= 0
      && Number.isFinite(z.team_charge) && z.team_charge >= 0
      && Number.isInteger(z.days_min) && Number.isInteger(z.days_max) && z.days_min <= z.days_max
      && Array.isArray(z.districts));
}

/** The zone that delivers to `district`: the zone listing it, else the default zone. */
export function resolveZone(policy: DeliveryPolicy, district: unknown): DeliveryZone {
  const wanted = canonicalDistrict(district);
  if (wanted) {
    const hit = policy.zones.find((z) => z.districts.some((d) => canonicalDistrict(d) === wanted));
    if (hit) return hit;
  }
  return policy.zones.find((z) => z.key === policy.default_zone) ?? policy.zones[0];
}

/** The zone a shopper is charged before they give an address (the cart estimate). */
export function defaultZone(policy: DeliveryPolicy): DeliveryZone {
  return resolveZone(policy, null);
}

/**
 * When an order should arrive: placed date + the zone's days, as two Dates (earliest, latest), or null
 * when the order carries no promised time (placed before migration 099, or a team order of an old
 * member). WHY calendar days: couriers here deliver on Fridays too, and a promise the shopper can
 * check against a calendar is easier to trust than "business days".
 */
export function expectedDeliveryWindow(placedAt: unknown, daysMin: unknown, daysMax: unknown): [Date, Date] | null {
  const start = new Date(placedAt as string);
  const min = Number(daysMin);
  const max = Number(daysMax);
  if (Number.isNaN(start.getTime()) || daysMin == null || daysMax == null || !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
    return null;
  }
  const at = (days: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + days);
  return [at(min), at(max)];
}

/** "Inside Dhaka" or "ঢাকার ভিতরে", by the page language. */
export function zoneName(zone: DeliveryZone | null | undefined, lang: string): string {
  if (!zone) return '';
  return lang === 'bn' ? (zone.name_bn || zone.name_en) : (zone.name_en || zone.name_bn);
}
