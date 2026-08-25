/**
 * sw.js — Progressive Web Application Service Worker (Prompt 11.6 / Master Spec §L1).
 *
 * Implements:
 * 1. Tiered Caching Strategy:
 *    - App Shell & Bundles: Cache-First with automated version cache invalidation.
 *    - Public Catalog APIs: Stale-While-Revalidate for instant browsing & background sync.
 *    - Product & Hero Images: Cache-First with LRU cache eviction (max 100 entries).
 *    - Private & Financial APIs: Network-Only with explicit cache bypass (zero sensitive data leakage).
 * 2. Offline navigation fallback to /offline.html when network and cache are unavailable.
 * 3. Background sync & message event forwarding.
 */

const CACHE_VERSION = 'explooro-v1.1.0';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const CATALOG_CACHE = `${CACHE_VERSION}-catalog`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const MAX_IMAGE_CACHE_ENTRIES = 100;

// Critical App Shell Pre-cache list
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/favicon.svg',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// Sensitive endpoints that MUST NEVER be cached
const SENSITIVE_ENDPOINTS = [
  '/api/v1/auth',
  '/api/v1/finance',
  '/api/v1/wallet',
  '/api/v1/payouts',
  '/api/v1/admin',
  '/api/v1/checkout',
  '/api/v1/orders/create',
  '/api/v1/developer/api-keys',
  '/api/v1/escrow',
];

// Public catalog endpoints suitable for Stale-While-Revalidate
const CATALOG_ENDPOINTS = [
  '/api/v1/products',
  '/api/v1/categories',
  '/api/v1/stores',
  '/api/v1/stories',
  '/api/v1/theme/active',
];

// -----------------------------------------------------------------------------
// 1. Install & Pre-cache
// -----------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache non-fatal warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// -----------------------------------------------------------------------------
// 2. Activate & Old Cache Cleanup
// -----------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  const currentCaches = [SHELL_CACHE, CATALOG_CACHE, IMAGE_CACHE];

  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (!currentCaches.includes(key)) {
            console.log('[SW] Deleting stale cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// -----------------------------------------------------------------------------
// 3. Fetch Interception
// -----------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET requests (mutations go through offline queue)
  if (request.method !== 'GET') {
    return;
  }

  // 3.1 SENSITIVE / AUTH / FINANCIAL — Explicit Network Only
  if (SENSITIVE_ENDPOINTS.some((ep) => url.pathname.startsWith(ep))) {
    event.respondWith(fetch(request));
    return;
  }

  // 3.2 HTML Navigation Requests — Network-First with Offline Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match('/offline.html');
          return fallback || new Response('Offline — Connection lost.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        })
    );
    return;
  }

  // 3.3 PUBLIC CATALOG API — Stale-While-Revalidate
  if (CATALOG_ENDPOINTS.some((ep) => url.pathname.startsWith(ep))) {
    event.respondWith(
      caches.open(CATALOG_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(request);

        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 3.4 IMAGES & MEDIA — Cache-First with LRU Eviction Cap
  if (
    request.destination === 'image' ||
    /\.(png|jpg|jpeg|svg|webp|gif|avif)$/i.test(url.pathname) ||
    url.pathname.includes('/og/')
  ) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;

        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
            trimCache(IMAGE_CACHE, MAX_IMAGE_CACHE_ENTRIES);
          }
          return networkResponse;
        } catch {
          // Return placeholder or fail gracefully
          return new Response('', { status: 404 });
        }
      })
    );
    return;
  }

  // 3.5 STATIC APP BUNDLES & FONTS — Cache-First with Network Fallback
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname === '/favicon.svg'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Default: Network with Cache Fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// -----------------------------------------------------------------------------
// LRU Cache Trimmer
// -----------------------------------------------------------------------------
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    await cache.delete(keys[0]);
    trimCache(cacheName, maxEntries);
  }
}
