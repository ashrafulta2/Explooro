/**
 * loadSponsoredStyles.js — loads sponsored-slot.css only when an ad is about to be drawn.
 *
 * Same reason as loadAdStoreStyles.js: it must not go in main.css (70KB gzipped budget) and must not
 * be a static import in a module the Node page-import tests load (Node cannot parse `.css`).
 * Idempotent: the promise is cached.
 */

import { trackStyleLoad } from '../core/styleGate.js';

let stylesPromise = null;

export function loadSponsoredStyles() {
  if (!stylesPromise) {
    stylesPromise = trackStyleLoad(
      import('./components/sponsored-slot.css').catch(() => {
        // A failed stylesheet must never take the page down; the next mount retries.
        stylesPromise = null;
      })
    );
  }
  return stylesPromise;
}
