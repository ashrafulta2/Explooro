/**
 * b2bEscrow.api.js — Client API for B2B Wholesale Escrow & Milestone Settlement (Prompt 10.6).
 */

import { api } from '../core/api.js';

export async function createB2bDeal(payload) {
  return api.post('/b2b-escrow/deals', payload);
}

export async function listB2bDeals(params = {}) {
  return api.get('/b2b-escrow/deals', { query: params });
}

export async function getB2bDeal(idOrRef) {
  return api.get(`/b2b-escrow/deals/${idOrRef}`);
}

export async function acceptB2bDeal(dealId) {
  return api.post(`/b2b-escrow/deals/${dealId}/accept`, {});
}

export async function submitMilestoneEvidence(milestoneId, payload) {
  return api.post(`/b2b-escrow/milestones/${milestoneId}/evidence`, payload);
}

export async function releaseMilestone(milestoneId, payload = {}) {
  return api.post(`/b2b-escrow/milestones/${milestoneId}/release`, payload);
}

export async function raiseB2bDispute(dealId, payload) {
  return api.post(`/b2b-escrow/deals/${dealId}/dispute`, payload);
}

export async function refundMilestone(milestoneId, payload = {}) {
  return api.post(`/b2b-escrow/milestones/${milestoneId}/refund`, payload);
}

export async function cancelB2bDeal(dealId, payload = {}) {
  return api.post(`/b2b-escrow/deals/${dealId}/cancel`, payload);
}

export function getContractPdfUrl(dealId) {
  return `/b2b-escrow/deals/${dealId}/contract.pdf`;
}
