/**
 * deliveryCharge.ts — the per-parcel delivery charges a super admin sets, per delivery zone, at
 * /admin/platform/delivery.
 *
 * The server owns the numbers (GET /delivery/policy) and re-resolves the zone on every order; the
 * server cart already returns `estimated_shipping` for the default zone. This module is for the places
 * that price without a server cart or before the server has seen the address: the local guest cart
 * estimate (services/cart.ts), checkout's summary, Quick Buy and the live-stream drawer.
 *
 * WHY the last policy is kept in localStorage: buildCartFromItems() is synchronous, so it can only use
 * a value it already has. A remembered policy is right on every visit after the first; on the very
 * first one the estimate is replaced as soon as the server cart or the policy arrives.
 */

import { api } from '../core/api.ts';
import { t } from './i18n.ts';
import { formatNumber } from './format.ts';
import type { ApiResponse } from '../core/api.ts';
import { defaultZone, isDeliveryPolicy, resolveZone } from './deliveryZones.ts';
import type { DeliveryPolicy, DeliveryZone } from './deliveryZones.ts';

// WHY a versioned key: a policy stored before zones carried team charge and days fails the check and
// is simply re-fetched.
const STORAGE_KEY = 'explooro:delivery:policy:v2';

function readStored(): DeliveryPolicy | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return isDeliveryPolicy(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let current: DeliveryPolicy | null = readStored();
let pending: Promise<DeliveryPolicy | null> | null = null;

/** The last known policy, or null when it has never been loaded. */
export function knownDeliveryPolicy(): DeliveryPolicy | null {
  return current;
}

/** The default zone's charge in BDT (what a cart is estimated with), or null when never loaded. */
export function knownDeliveryCharge(): number | null {
  return current ? defaultZone(current).charge : null;
}

/** The zone for a district from the last known policy, or null when never loaded. */
export function knownZoneFor(district: unknown): DeliveryZone | null {
  return current ? resolveZone(current, district) : null;
}

/** Loads the policy once per page load and remembers it. Never rejects: null when unavailable. */
export function loadDeliveryPolicy(): Promise<DeliveryPolicy | null> {
  if (!pending) {
    pending = api.get('/delivery/policy', { skipAuthRedirect: true })
      .then((res: ApiResponse) => {
        const policy = res?.policy;
        if (isDeliveryPolicy(policy)) {
          current = policy;
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
          } catch {
            // Storage blocked: the value still holds for this page load.
          }
        }
        return current;
      })
      .catch(() => {
        pending = null;
        return current;
      });
  }
  return pending;
}

/** "1–2 days" / "১–২ দিন", or "Same day" for a 0–0 zone; '' for no zone. */
export function deliveryEtaText(zone: Pick<DeliveryZone, 'days_min' | 'days_max'> | null | undefined): string {
  if (!zone || !Number.isInteger(zone.days_min) || !Number.isInteger(zone.days_max)) return '';
  if (zone.days_max === 0) return t('delivery.eta_same_day');
  if (zone.days_min === zone.days_max) return t('delivery.eta_days_one', { n: formatNumber(zone.days_max) });
  return t('delivery.eta_days', { min: formatNumber(zone.days_min), max: formatNumber(zone.days_max) });
}

/** Loads the policy and answers with the default zone's charge (the cart estimate). */
export function loadDeliveryCharge(): Promise<number | null> {
  return loadDeliveryPolicy().then(() => knownDeliveryCharge());
}
