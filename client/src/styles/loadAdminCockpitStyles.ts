/**
 * loadAdminCockpitStyles.ts — dynamically loads admin-cockpit.css for AdminDashboardPage.
 *
 * Same pattern as loadCategoriesStyles.ts: keeps the bytes out of main.css (70KB gzip budget) and
 * avoids a static .css import in a page module, which Node's test runner cannot load.
 */

import { trackStyleLoad } from '../core/styleGate.ts';

let stylesPromise: Promise<unknown> | null = null;

export function loadAdminCockpitStyles(): Promise<unknown> {
  if (!stylesPromise) {
    stylesPromise = trackStyleLoad(
      import('./components/admin-cockpit.css').catch(() => {
        stylesPromise = null;
      })
    );
  }
  return stylesPromise;
}
