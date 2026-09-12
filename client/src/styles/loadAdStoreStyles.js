/**
 * loadAdStoreStyles.js — loads ad-store.css for the two pages that need it.
 *
 * WHY this indirection exists, rather than `import './components/ad-store.css'` at the top of each
 * page:
 *
 *   1. It must not go into main.css. Entry CSS is on a 70KB gzipped budget and was measured at
 *      67.17KB before this feature — ad-store.css would eat more than half the remaining headroom
 *      for two pages most visitors never open. Kept here, Vite emits it as its own chunk that only
 *      downloads when someone actually opens an ad page.
 *
 *   2. It must not be a STATIC import in the page module either. client/test/salerPages.test.js
 *      and client/test/adminGovernancePages.test.js import every page module into plain Node to
 *      check its default export, and Node cannot parse a `.css` import (ERR_UNKNOWN_FILE_EXTENSION).
 *      A dynamic import inside a function is never evaluated by that check, but is still statically
 *      analysed and bundled by Vite.
 *
 * Idempotent: the promise is cached, so mounting the page twice does not re-request the chunk.
 */

let stylesPromise = null;

export function loadAdStoreStyles() {
  if (!stylesPromise) {
    stylesPromise = import('./components/ad-store.css').catch(() => {
      // A failed stylesheet must never take the page down with it — the markup stays usable,
      // just unstyled, and the next mount retries.
      stylesPromise = null;
    });
  }
  return stylesPromise;
}
