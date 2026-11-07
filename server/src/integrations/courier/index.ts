/**
 * index.ts — Multi-Carrier Logistics Adapter Hub (Prompt 7.1).
 */

import { MockCourierAdapter } from './mock.ts';
import { SteadfastCourierAdapter } from './steadfast.ts';
import { PathaoCourierAdapter } from './pathao.ts';
import { RedxCourierAdapter } from './redx.ts';

// WHY factories and not instances made at import: an adapter reads its credentials when it is built
// (credentialStore.ts), and at import nothing saved at /admin/platform/integrations is loaded yet. A
// new adapter per call picks up a saved or rotated key at once. The adapters hold no state.
const adapters = {
  MOCK: () => new MockCourierAdapter(),
  STEADFAST: () => new SteadfastCourierAdapter(),
  PATHAO: () => new PathaoCourierAdapter(),
  REDX: () => new RedxCourierAdapter(),
};

/**
 * Returns the courier adapter for a given carrier key.
 * Defaults to MOCK if unsupported or environment is local/mock.
 *
 * @param {string} carrierKey
 * @returns {MockCourierAdapter|SteadfastCourierAdapter|PathaoCourierAdapter|RedxCourierAdapter}
 */
export function getCourierAdapter(carrierKey: string = 'MOCK'): MockCourierAdapter|SteadfastCourierAdapter|PathaoCourierAdapter|RedxCourierAdapter {
  const normKey = String(carrierKey || '').trim().toUpperCase();
  return (adapters[normKey] || adapters.MOCK)();
}

export { MockCourierAdapter, SteadfastCourierAdapter, PathaoCourierAdapter, RedxCourierAdapter };
