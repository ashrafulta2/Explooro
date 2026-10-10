/**
 * loadCategoriesStyles.js — dynamically loads categories-page.css for CategoriesPage.
 *
 * Prevents adding bytes to main.css (preserving the 70KB gzip budget) while avoiding static
 * .css imports in page modules which would fail Node's test runner (ERR_UNKNOWN_FILE_EXTENSION).
 */

import { trackStyleLoad } from '../core/styleGate.js';

let stylesPromise = null;

export function loadCategoriesStyles() {
  if (!stylesPromise) {
    stylesPromise = trackStyleLoad(
      import('./components/categories-page.css').catch(() => {
        stylesPromise = null;
      })
    );
  }
  return stylesPromise;
}
