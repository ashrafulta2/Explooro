/**
 * featureFlags.js — Client-side feature flag management & DOM gate scanning (Prompt 3.2).
 *
 * Responsibilities:
 * - Fetches live flag set from `GET /api/v1/modules` and keeps `appStore.modules` in sync.
 * - Exposes `isFeatureEnabled(key)` for programmatic JS gating.
 * - `<div data-module="key">` scanner that live-gates DOM nodes without a full page reload.
 * - Dispatches updates to listeners when flags change.
 */

import { api } from '../core/api.js';
import { appStore } from '../state/appStore.js';

let flagsCache = {};
const listeners = new Set();

/**
 * Initializes and fetches live feature flags from the API.
 */
export async function initFeatureFlags() {
  try {
    const res = await api.get('/modules');
    if (res?.modules) {
      setFlags(res.modules);
    }
  } catch {
    // If backend endpoint is unavailable, use store defaults or fallback
    const fallback = appStore.get()?.modules || {};
    setFlags(fallback);
  }
}

/**
 * Set internal flags and broadcast to store and listeners.
 */
export function setFlags(newFlags = {}) {
  flagsCache = { ...flagsCache, ...newFlags };
  appStore.update((state) => ({
    ...state,
    modules: {
      ...(state.modules || {}),
      ...newFlags,
    },
  }));

  // Re-scan DOM gates immediately
  scanDomForModuleGates();

  for (const fn of listeners) {
    try {
      fn(flagsCache);
    } catch {
      // Ignore listener error
    }
  }
}

/**
 * Returns whether a feature module is enabled.
 */
export function isFeatureEnabled(moduleKey) {
  if (!moduleKey) return true;
  if (flagsCache[moduleKey] !== undefined) {
    return Boolean(flagsCache[moduleKey]);
  }
  const storeModules = appStore.get()?.modules;
  if (storeModules && storeModules[moduleKey] !== undefined) {
    return Boolean(storeModules[moduleKey]);
  }
  // Default to true unless explicitly disabled in flags
  return true;
}

/**
 * Scans DOM for [data-module="key"] elements and toggles visibility based on flag state.
 */
export function scanDomForModuleGates(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  const elements = root.querySelectorAll('[data-module]');
  for (const el of elements) {
    const key = el.getAttribute('data-module');
    if (!key) continue;

    const enabled = isFeatureEnabled(key);
    if (!enabled) {
      el.setAttribute('data-module-disabled', 'true');
      el.setAttribute('hidden', '');
      el.style.setProperty('display', 'none', 'important');
    } else {
      el.removeAttribute('data-module-disabled');
      el.removeAttribute('hidden');
      el.style.removeProperty('display');
    }
  }
}

/**
 * Subscribe to feature flag changes.
 */
export function subscribeFeatureFlags(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Automatically sync when appStore modules change
appStore.subscribe((state) => {
  if (state.modules) {
    flagsCache = { ...flagsCache, ...state.modules };
    scanDomForModuleGates();
  }
});
