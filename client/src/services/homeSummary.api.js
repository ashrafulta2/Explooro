/**
 * homeSummary.api.js — the numbers behind the home page's top band (GET /home/summary).
 * Resolves to `{ role, stats }`; `stats` is null for a role with nothing to count.
 */

import { api } from '../core/api.js';

export async function getHomeSummary() {
  const res = await api.get('/home/summary');
  return res?.data !== undefined ? res.data : res;
}
