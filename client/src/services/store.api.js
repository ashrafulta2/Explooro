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
  const { data } = await api.get('/stores/check-slug', { query });
  return data;
}

/**
 * Retrieves public store profile and curated products by slug.
 */
export async function getStoreBySlug(slug) {
  const res = await api.get(`/stores/${slug}`);
  return res?.data || res;
}

/**
 * Retrieves the authenticated saler's store profile, shelves & items.
 */
export async function getMyStore() {
  const { data } = await api.get('/saler/store');
  return data;
}

/**
 * Updates the saler's virtual store profile.
 */
export async function updateMyStore(payload) {
  const { data } = await api.put('/saler/store', payload);
  return data;
}

/**
 * Toggles physical shop status and updates business hours.
 */
export async function updateStorePhysicalStatus({ physicalOpenStatus, businessHours }) {
  const { data } = await api.patch('/saler/store/status', {
    physical_open_status: physicalOpenStatus,
    business_hours: businessHours,
  });
  return data;
}

/**
 * Reorders curated shelves and items.
 */
export async function updateStoreShelves(items) {
  const { data } = await api.put('/saler/store/shelves', { items });
  return data;
}
