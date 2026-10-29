/**
 * loadSystemHealthStyles.ts — dynamically loads system-health.css for SystemHealthPage and the
 * admin governance pages that borrow its `.system-table` / `.system-panel` / `.system-infra-card`.
 *
 * Same pattern as loadCategoriesStyles.ts: keeps the bytes out of main.css (70KB gzip budget) and
 * avoids a static .css import in a page module, which Node's test runner cannot load
 * (adminGovernancePages.test.js imports most of these pages directly).
 */

import { trackStyleLoad } from '../core/styleGate.ts';

let stylesPromise: Promise<unknown> | null = null;

export function loadSystemHealthStyles(): Promise<unknown> {
  if (!stylesPromise) {
    stylesPromise = trackStyleLoad(
      import('./components/system-health.css').catch(() => {
        stylesPromise = null;
      })
    );
  }
  return stylesPromise;
}
