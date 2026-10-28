/**
 * homeSummary.api.ts — the numbers behind the home page's top band (GET /home/summary).
 * Resolves to `{ role, stats }`; `stats` is null for a role with nothing to count.
 */

import { api } from '../core/api.ts';
import type { ApiResponse } from '../core/api.ts';

/** GET /home/summary. `stats` is null for a role with nothing to count. */
export interface HomeSummary {
  role: string;
  stats: Record<string, number | string | null> | null;
  insights?: Record<string, unknown[]> | null;
}

export async function getHomeSummary(): Promise<HomeSummary> {
  const res: ApiResponse<HomeSummary> = await api.get('/home/summary');
  return res?.data !== undefined ? res.data : (res as unknown as HomeSummary);
}
