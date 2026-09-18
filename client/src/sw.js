/**
 * sw.js — Progressive Web Application Service Worker (Prompt 11.6 / Master Spec §L1).
 *
 * Source copy corresponding to client/public/sw.js.
 */

export const SW_VERSION = 'explooro-v1.1.0';

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }

  // WHY: never run the service worker under `npm run dev`. Its cache-first shell strategy serves
  // stale bundles that fight Vite HMR (interactions silently hit old JS, the app looks "frozen"),
  // and precaching shell assets that the dev server doesn't emit makes registration fail with a
  // bare "unknown error occurred when fetching the script". Instead, tear down any SW + caches a
  // previous production visit (or an earlier build of this app) may have left registered, so a
  // developer who once loaded the built app isn't stuck on stale assets.
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations?.()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
    if (typeof caches !== 'undefined') {
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
    }
    return Promise.resolve(null);
  }

  return navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      console.log('[PWA] Service Worker registered with scope:', registration.scope);
      return registration;
    })
    .catch((err) => {
      console.warn('[PWA] Service Worker registration failed:', err);
      return null;
    });
}
