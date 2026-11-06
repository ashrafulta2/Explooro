/**
 * legal.api.ts — the legal documents and the signed-in account's agreements (server routes/legal.routes.ts).
 */

import { api } from '../core/api.ts';

export interface LegalDocument {
  id: number;
  key: string;
  path: string;
  version: number;
  is_current: boolean;
  current_version: number;
  title_en: string;
  title_bn: string;
  body_en: string;
  body_bn: string;
  change_note_en: string | null;
  change_note_bn: string | null;
  published_at: string;
  versions: { version: number; published_at: string }[];
}

export interface PendingLegalDoc {
  document_id: number;
  key: string;
  path: string;
  version: number;
  title_en: string;
  title_bn: string;
  change_note_en: string | null;
  change_note_bn: string | null;
  published_at: string;
}

const dataOf = (res) => res?.data ?? res;

export async function getLegalDocument(key: string, version: number | null = null): Promise<LegalDocument> {
  return dataOf(await api.get(`/legal/documents/${encodeURIComponent(key)}`, version ? { query: { version } } : undefined));
}

export async function getPendingLegal(): Promise<PendingLegalDoc[]> {
  return dataOf(await api.get('/me/legal/pending'))?.pending ?? [];
}

export async function acceptLegal(documentIds: number[]): Promise<PendingLegalDoc[]> {
  return dataOf(await api.post('/me/legal/accept', { document_ids: documentIds }))?.pending ?? [];
}

export async function getLegalAdmin() {
  return api.get('/admin/platform/legal');
}

export async function publishLegalVersion(key: string, body: Record<string, unknown>) {
  return api.post(`/admin/platform/legal/${encodeURIComponent(key)}/versions`, body);
}

export async function saveLegalCompany(body: Record<string, unknown>) {
  return api.put('/admin/platform/legal/company', body);
}
