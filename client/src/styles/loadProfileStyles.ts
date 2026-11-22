/**
 * loadProfileStyles.ts — dynamically loads profile.css for the My Profile page.
 *
 * Same pattern as loadCartPageStyles.ts: keeps the bytes out of main.css (70KB gzip budget) and
 * avoids a static .css import in a page module, which Node's test runner cannot load
 * (userProfile.test.js imports ProfilePage, and pins its route's load() to a bare page import).
 */

import { trackStyleLoad } from '../core/styleGate.ts';

let stylesPromise: Promise<unknown> | null = null;

export function loadProfileStyles(): Promise<unknown> {
  if (!stylesPromise) {
    stylesPromise = trackStyleLoad(
      import('./components/profile.css').catch(() => {
        stylesPromise = null;
      })
    );
  }
  return stylesPromise;
}
