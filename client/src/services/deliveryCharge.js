/**
 * deliveryCharge.js — the per-parcel delivery charge a super admin sets at /admin/platform/delivery.
 *
 * The server owns the number (GET /delivery/policy); the server cart already returns
 * `estimated_shipping` with it. This module is for the two places that price without a server cart:
 * the local guest cart estimate (services/cart.js) and Quick Buy's summary.
 *
 * WHY the last value is kept in localStorage: buildCartFromItems() is synchronous, so it can only use
 * a number it already has. A remembered value is right on every visit after the first; on the very
 * first one the estimate is replaced as soon as the server cart or the policy arrives.
 */

import { api } from '../core/api.js';

const STORAGE_KEY = 'explooro:delivery:per_parcel_charge';

function readStored() {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return localStorage.getItem(STORAGE_KEY) !== null && Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

let current = readStored();
let pending = null;

/** The last known charge in BDT, or null when it has never been loaded. */
export function knownDeliveryCharge() {
  return current;
}

/** Loads the charge once per page load and remembers it. Never rejects: null when unavailable. */
export function loadDeliveryCharge() {
  if (!pending) {
    pending = api.get('/delivery/policy', { skipAuthRedirect: true })
      .then((res) => {
        const n = Number(res?.policy?.per_parcel_charge);
        if (Number.isFinite(n) && n >= 0) {
          current = n;
          try {
            localStorage.setItem(STORAGE_KEY, String(n));
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
