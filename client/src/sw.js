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

  // Register in production or modern browsers
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
