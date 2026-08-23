/**
 * index.js — Multi-Carrier Logistics Adapter Hub (Prompt 7.1).
 */

import { MockCourierAdapter } from './mock.js';
import { SteadfastCourierAdapter } from './steadfast.js';
import { PathaoCourierAdapter } from './pathao.js';
import { RedxCourierAdapter } from './redx.js';

const adapters = {
  MOCK: new MockCourierAdapter(),
  STEADFAST: new SteadfastCourierAdapter(),
  PATHAO: new PathaoCourierAdapter(),
  REDX: new RedxCourierAdapter(),
};

/**
 * Returns the courier adapter for a given carrier key.
 * Defaults to MOCK if unsupported or environment is local/mock.
 *
 * @param {string} carrierKey
 * @returns {MockCourierAdapter|SteadfastCourierAdapter|PathaoCourierAdapter|RedxCourierAdapter}
 */
export function getCourierAdapter(carrierKey = 'MOCK') {
  const normKey = String(carrierKey || '').trim().toUpperCase();
  return adapters[normKey] || adapters.MOCK;
}

export { MockCourierAdapter, SteadfastCourierAdapter, PathaoCourierAdapter, RedxCourierAdapter };
