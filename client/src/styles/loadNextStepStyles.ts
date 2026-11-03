/**
 * loadNextStepStyles.ts — dynamically loads next-step-card.css for NextStepCard (Prompt 13.2).
 *
 * Same pattern as loadSystemHealthStyles.ts: keeps the bytes out of main.css (70KB gzip budget) and
 * avoids a static .css import in a component that six dashboard pages import, which Node's test
 * runner cannot load (several tests import those pages directly).
 */

import { trackStyleLoad } from '../core/styleGate.ts';

let stylesPromise: Promise<unknown> | null = null;

export function loadNextStepStyles(): Promise<unknown> {
  if (!stylesPromise) {
    stylesPromise = trackStyleLoad(
      import('./components/next-step-card.css').catch(() => {
        stylesPromise = null;
      })
    );
  }
  return stylesPromise;
}
