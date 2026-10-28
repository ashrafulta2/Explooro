/**
 * store.api.ts — Typed API client for virtual storefronts, builder, shelves & status (Prompt 4.8).
 */

import { api } from '../core/api.ts';

/** A store payload (profile, shelves, items); the fields are the server's. */
type StoreData = Record<string, any>;

/**
 * Checks if a store slug is valid and available.
 */
export async function checkSlugAvailability(slug: string, excludeId: number | string | null = null): Promise<StoreData> {
  const query: Record<string, unknown> = { slug };
  if (excludeId) query.exclude_id = excludeId;
  const res = await api.get('/stores/check-slug', { query });
  return res?.data !== undefined ? res.data : res;
}

/**
 * Retrieves public store profile and curated products by slug.
 */
export async function getStoreBySlug(slug: string): Promise<StoreData> {
  const res = await api.get(`/stores/${slug}`);
  return res?.data !== undefined ? res.data : res;
}

/**
 * Retrieves the authenticated shop partner's store profile, shelves & items.
 */
export async function getMyStore(): Promise<StoreData> {
  const res = await api.get('/saler/store');
  return res?.data !== undefined ? res.data : res;
}

/**
 * Updates the shop partner's virtual store profile.
 */
export async function updateMyStore(payload: StoreData): Promise<StoreData> {
  const res = await api.put('/saler/store', payload);
  return res?.data !== undefined ? res.data : res;
}

/**
 * Toggles physical shop status and updates business hours.
 */
export async function updateStorePhysicalStatus({ physicalOpenStatus, businessHours }: { physicalOpenStatus: string; businessHours?: unknown }): Promise<StoreData> {
  const res = await api.patch('/saler/store/status', {
    physical_open_status: physicalOpenStatus,
    business_hours: businessHours,
  });
  return res?.data !== undefined ? res.data : res;
}

/**
 * Reorders curated shelves and items.
 */
export async function updateStoreShelves(items: unknown[]): Promise<StoreData> {
  const res = await api.put('/saler/store/shelves', { items });
  return res?.data !== undefined ? res.data : res;
}
