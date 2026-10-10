/**
 * loadModuleControlStyles.js — loads module-control.css for the Module Toggles page.
 *
 * WHY this indirection exists, rather than `import './components/module-control.css'` at the top
 * of ModuleControlPage.js (same reasoning as loadAdStoreStyles.js):
 *
 *   1. It must not go into main.css. The stylesheet is ~7.5KB raw (~1KB gzipped) and serves one
 *      super-admin-only page, so the entry CSS budget should not carry it. Kept here, Vite emits
 *      it as its own chunk that only downloads when someone opens /admin/platform/modules.
 *
 *   2. It must not be a STATIC import in the page module either. client/test/adminPlatformSuite.test.js
 *      imports ModuleControlPage.js into plain Node to check its default export, and Node cannot
 *      parse a `.css` import (ERR_UNKNOWN_FILE_EXTENSION). A dynamic import inside a function is
 *      never evaluated by that check, but is still statically analysed and bundled by Vite.
 *
 * Idempotent: the promise is cached, so mounting the page twice does not re-request the chunk.
 */

import { trackStyleLoad } from '../core/styleGate.js';

let stylesPromise = null;

export function loadModuleControlStyles() {
  if (!stylesPromise) {
    stylesPromise = trackStyleLoad(
      import('./components/module-control.css').catch(() => {
        // A failed stylesheet must never take the page down with it — the markup stays usable,
        // just unstyled, and the next mount retries.
        stylesPromise = null;
      })
    );
  }
  return stylesPromise;
}
