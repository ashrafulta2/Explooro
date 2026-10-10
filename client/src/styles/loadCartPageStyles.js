/**
 * loadCartPageStyles.js — dynamically loads cart-page.css for the /cart page.
 *
 * Same pattern as loadSystemHealthStyles.js: keeps the bytes out of main.css (70KB gzip budget)
 * and avoids a static .css import in a page module, which Node's test runner cannot load.
 */

import { trackStyleLoad } from '../core/styleGate.js';

let stylesPromise = null;

export function loadCartPageStyles() {
  if (!stylesPromise) {
    stylesPromise = trackStyleLoad(
      import('./components/cart-page.css').catch(() => {
        stylesPromise = null;
      })
    );
  }
  return stylesPromise;
}
