/**
 * reservedSlugs.js — Canonical list of blacklisted store slugs (Prompt 4.1).
 *
 * Prevents conflicts with system, admin, API, and platform routes.
 */

export const RESERVED_STORE_SLUGS = new Set([
  'admin',
  'api',
  'store',
  'stores',
  'checkout',
  'account',
  'saler',
  'supplier',
  'moderator',
  'editor',
  'dev',
  'live',
  'help',
  'legal',
  'search',
  'cart',
  's',
  'c',
  'team',
  'auth',
  'login',
  'register',
  'platform',
  'system',
  'settings',
  'terms',
  'privacy',
  'contact',
  'about',
]);

/**
 * Checks if a given store slug is reserved.
 * @param {string} slug
 * @returns {boolean}
 */
export function isReservedStoreSlug(slug) {
  if (!slug || typeof slug !== 'string') return true;
  const clean = slug.trim().toLowerCase();
  return RESERVED_STORE_SLUGS.has(clean);
}
