/**
 * flyerDesigns.api.ts — the Flyer Studio designs a person saved, synced through the server
 * (server/src/routes/flyerDesign.routes.ts). Every call answers with the whole list.
 */

import { api } from '../core/api.ts';

export interface SavedDesigns { keys: string[]; limit: number }

function unwrap(res: any): SavedDesigns {
  const data = res?.data ?? res;
  return { keys: Array.isArray(data?.keys) ? data.keys.map(String) : [], limit: Number(data?.limit) || 0 };
}

export const flyerDesignsApi = {
  async list(): Promise<SavedDesigns> {
    return unwrap(await api.get('/me/flyer-designs'));
  },
  async save(key: string): Promise<SavedDesigns> {
    return unwrap(await api.put(`/me/flyer-designs/${encodeURIComponent(key)}`, {}));
  },
  async remove(key: string): Promise<SavedDesigns> {
    return unwrap(await api.delete(`/me/flyer-designs/${encodeURIComponent(key)}`));
  },
  async merge(keys: string[]): Promise<SavedDesigns> {
    return unwrap(await api.post('/me/flyer-designs/merge', { keys }));
  },
};
