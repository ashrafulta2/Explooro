/**
 * deliveryDistrict.ts — the district the shopper is estimating cart delivery to.
 *
 * The cart has no confirmed address, so delivery used to be estimated with the default zone. This
 * remembers a district the shopper picks on the cart (or the one the server resolved from their
 * default saved address) so the estimate matches where it is actually going. It is only an estimate:
 * checkout re-resolves the zone from the address the shopper confirms, and that is what is charged.
 *
 * Kept in localStorage so it survives a reload; read synchronously by the local guest-cart estimate
 * (services/cart.ts), which cannot await a fetch.
 */

const STORAGE_KEY = 'explooro:delivery:district';

/** The remembered district id, or null when the shopper has not chosen one. */
export function getDeliveryDistrict(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** Remembers (or, with null, forgets) the district the cart estimates delivery to. */
export function setDeliveryDistrict(district: string | null): void {
  try {
    if (district && district.trim()) localStorage.setItem(STORAGE_KEY, district);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing: the estimate falls back to the default zone, which is fine.
  }
}
