/**
 * genieSettings.js — the platform's genie-effect policy, on the client.
 *
 * A Super Admin (or anyone they granted `platform.genie.update`) sets three things on
 * /admin/platform/genie: whether the popup genie plays at all, how long it takes, and how finely it
 * is drawn. They are stored in platform_settings (group `genie`) and served, unauthenticated, from
 * `GET /genie/policy`. This module is the only bridge between that endpoint and the engine in
 * lib/genie.js.
 *
 * WHY the policy is cached in localStorage and applied before the network answers: the same shape
 * services/i18n.js uses for the default language. Every modal opened in the first second of a visit
 * should already honour the last-known policy, and NOT reconciling afterwards would mean an admin's
 * change reached nobody who already had the site open.
 *
 * Nothing here can fail loudly: a missing API, offline browser or unreadable cache all leave the
 * engine on its shipped defaults (genie on, 650 ms, balanced), which is a working state.
 */

import { configureGenie, sanitiseGenieConfig } from '../lib/genie.js';

const STORAGE_KEY = 'explooro:genie:policy';
const POLICY_ENDPOINT = '/genie/policy';

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitiseGenieConfig(JSON.parse(raw)) : null;
  } catch {
    // Storage unavailable (private browsing) or a corrupt entry — the shipped defaults stand.
    return null;
  }
}

function writeCache(policy) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
  } catch {
    // Persistence is a convenience; the policy still applies for this session.
  }
}

/**
 * Adopts a policy in this tab. Also used by the admin page after a save, so the operator sees the
 * effect of their own change at once instead of on their next cold load.
 *
 * @returns the config now in force
 */
export function applyGeniePolicy(raw, { cache = true } = {}) {
  const next = sanitiseGenieConfig(raw);
  if (!next) return configureGenie(null);
  if (cache) writeCache(next);
  return configureGenie(next);
}

/** Re-reads the policy from the API and applies it. Never throws. */
export async function refreshGenieSettings() {
  try {
    // Dynamic import keeps core/api.js (mock router, toast) out of this module's static graph.
    const { api } = await import('../core/api.js');
    const res = await api.get(POLICY_ENDPOINT);
    if (res?.policy) return applyGeniePolicy(res.policy);
  } catch {
    // No API, offline, or the endpoint is not deployed yet — the cached / default policy stands.
  }
  return configureGenie(null);
}

/**
 * Mounts synchronously from the cache, then reconciles with the server in the background so a slow
 * or absent API never delays the first route.
 */
export function initGenieSettings() {
  const cached = readCache();
  if (cached) configureGenie(cached);
  refreshGenieSettings();
}
