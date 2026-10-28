/**
 * b2bEscrow.api.ts — Client API for B2B Wholesale Escrow & Milestone Settlement (Prompt 10.6).
 */

import { api } from '../core/api.ts';

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, unknown>;

export async function createB2bDeal(payload: Params) {
  return api.post('/b2b-escrow/deals', payload);
}

export async function listB2bDeals(params: Params = {}) {
  return api.get('/b2b-escrow/deals', { query: params });
}

export async function getB2bDeal(idOrRef: number | string) {
  return api.get(`/b2b-escrow/deals/${idOrRef}`);
}

export async function acceptB2bDeal(dealId: number | string) {
  return api.post(`/b2b-escrow/deals/${dealId}/accept`, {});
}

export async function submitMilestoneEvidence(milestoneId: number | string, payload: Params) {
  return api.post(`/b2b-escrow/milestones/${milestoneId}/evidence`, payload);
}

export async function releaseMilestone(milestoneId: number | string, payload: Params = {}) {
  return api.post(`/b2b-escrow/milestones/${milestoneId}/release`, payload);
}

export async function raiseB2bDispute(dealId: number | string, payload: Params) {
  return api.post(`/b2b-escrow/deals/${dealId}/dispute`, payload);
}

export async function refundMilestone(milestoneId: number | string, payload: Params = {}) {
  return api.post(`/b2b-escrow/milestones/${milestoneId}/refund`, payload);
}

export async function cancelB2bDeal(dealId: number | string, payload: Params = {}) {
  return api.post(`/b2b-escrow/deals/${dealId}/cancel`, payload);
}

export function getContractPdfUrl(dealId: number | string): string {
  return `/b2b-escrow/deals/${dealId}/contract.pdf`;
}
