/**
 * store.api.js — Typed API client for virtual storefronts, builder, shelves & status (Prompt 4.8).
 */

import { api } from '../core/api.js';

/**
 * Checks if a store slug is valid and available.
 */
export async function checkSlugAvailability(slug, excludeId = null) {
  const query = { slug };
  if (excludeId) query.exclude_id = excludeId;
  const res = await api.get('/stores/check-slug', { query });
  return res?.data !== undefined ? res.data : res;
}

/**
 * Retrieves public store profile and curated products by slug.
 */
export async function getStoreBySlug(slug) {
  const res = await api.get(`/stores/${slug}`);
  return res?.data !== undefined ? res.data : res;
}

/**
 * Retrieves the authenticated saler's store profile, shelves & items.
 */
export async function getMyStore() {
  const res = await api.get('/saler/store');
  return res?.data !== undefined ? res.data : res;
}

/**
 * Updates the saler's virtual store profile.
 */
export async function updateMyStore(payload) {
  const res = await api.put('/saler/store', payload);
  return res?.data !== undefined ? res.data : res;
}

/**
 * Toggles physical shop status and updates business hours.
 */
export async function updateStorePhysicalStatus({ physicalOpenStatus, businessHours }) {
  const res = await api.patch('/saler/store/status', {
    physical_open_status: physicalOpenStatus,
    business_hours: businessHours,
  });
  return res?.data !== undefined ? res.data : res;
}

/**
 * Reorders curated shelves and items.
 */
export async function updateStoreShelves(items) {
  const res = await api.put('/saler/store/shelves', { items });
  return res?.data !== undefined ? res.data : res;
}
