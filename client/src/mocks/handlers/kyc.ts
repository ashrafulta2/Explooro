/**
 * kyc.ts — Mock GET /kyc/status, POST /kyc/submit and POST /kyc/appeal, so the identity check page
 * (/seller/kyc, /account/kyc) works with VITE_API_MODE=mock.
 *
 * Mirrors server/src/services/kyc.service.ts:
 *   1. No record yet → `{ status: 'NOT_SUBMITTED', current_step: 1, documents: [] }`.
 *   2. A submit creates the record as PENDING, or keeps the furthest step reached
 *      (`max(current_step, step)`) and moves a REJECTED record back to PENDING.
 *   3. Only a REJECTED record can be appealed; anything else is a 409.
 * One record per mock user, kept for the tab like the mock session.
 *
 * WHY the `?mock_kyc=` query: an admin review never happens in mock mode, so without it the
 * verified / under review / rejected / appeal banners could never be seen in development.
 */

import { getMockSessionUser } from './auth.ts';
import type { MockRoute } from '../types.ts';

const STORE_KEY = 'explooro.mock.kyc';
const SHOWABLE = ['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'APPEALED'];

type KycRecord = {
  id: number;
  ref: string;
  kyc_type: string;
  status: string;
  current_step: number;
  business_name: string | null;
  business_address: string | null;
  rejection_reason: string | null;
  rejection_reason_bn: string | null;
  verified_at: string | null;
  documents: Array<{ id: number; doc_type: string; mime_type: string; size_bytes: number; view_count: number; created_at: string }>;
  /** Mock-only: the `?mock_kyc=` value already applied. Never sent to the page. */
  forced?: string;
};

function userKey(): string {
  return String(getMockSessionUser()?.id ?? 'guest');
}

function loadAll(): Record<string, KycRecord> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, KycRecord>) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // Private mode or blocked storage: the record lives for this page only.
  }
}

function makeRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return `KYC-${code}`;
}

function blankRecord(kycType = 'SUPPLIER'): KycRecord {
  return {
    id: Math.floor(Math.random() * 90000) + 10000,
    ref: makeRef(),
    kyc_type: kycType,
    status: 'PENDING',
    current_step: 1,
    business_name: null,
    business_address: null,
    rejection_reason: null,
    rejection_reason_bn: null,
    verified_at: null,
    documents: [],
  };
}

function statusOf(rec: KycRecord | undefined) {
  if (!rec) return { status: 'NOT_SUBMITTED', is_verified: false, current_step: 1, documents: [] };
  const { forced: _forced, ...shown } = rec;
  return { ...shown, is_verified: rec.status === 'VERIFIED' };
}

const kycHandlers: MockRoute[] = [
  {
    method: 'GET',
    path: '/kyc/status',
    handler({ query }) {
      const all = loadAll();
      const key = userKey();
      const forced = String(query?.mock_kyc || (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('mock_kyc') : '') || '').toUpperCase();
      // Applied once per value, so a later submit or appeal is not undone by the same URL.
      if (SHOWABLE.includes(forced) && all[key]?.forced !== forced) {
        const rec = all[key] || blankRecord();
        rec.forced = forced;
        rec.status = forced;
        rec.current_step = forced === 'PENDING' ? rec.current_step : 4;
        rec.verified_at = forced === 'VERIFIED' ? new Date().toISOString() : null;
        rec.rejection_reason = forced === 'REJECTED' || forced === 'APPEALED' ? 'The name on the NID does not match the trade licence.' : null;
        rec.rejection_reason_bn = rec.rejection_reason ? 'এনআইডির নাম ট্রেড লাইসেন্সের নামের সাথে মেলেনি।' : null;
        all[key] = rec;
        saveAll(all);
      }
      return { data: statusOf(all[key]) };
    },
  },
  {
    method: 'POST',
    path: '/kyc/submit',
    handler({ body }) {
      const step = Number(body?.step) || 1;
      if (step === 1 && !body?.nid_number && !loadAll()[userKey()]) {
        return { status: 400, body: { error: { code: 'VALIDATION_FAILED', message_en: 'National ID number is required.', message_bn: 'জাতীয় পরিচয়পত্র নম্বর দিতে হবে।' } } };
      }
      const all = loadAll();
      const key = userKey();
      const rec = all[key] || blankRecord(body?.kyc_type);
      rec.current_step = Math.max(rec.current_step, step);
      if (rec.status === 'REJECTED') rec.status = 'PENDING';
      if (body?.business_name) rec.business_name = body.business_name;
      if (body?.business_address) rec.business_address = body.business_address;
      for (const doc of Array.isArray(body?.documents) ? body.documents : []) {
        if (!doc?.doc_type || !doc?.storage_key) continue;
        if (rec.documents.some((d) => d.doc_type === doc.doc_type)) continue;
        rec.documents.push({ id: rec.documents.length + 1, doc_type: doc.doc_type, mime_type: doc.mime_type || 'image/jpeg', size_bytes: doc.size_bytes || 1024, view_count: 0, created_at: new Date().toISOString() });
      }
      all[key] = rec;
      saveAll(all);
      const nid = String(body?.nid_number || '');
      return { data: { kycId: rec.id, ref: rec.ref, status: rec.status, currentStep: rec.current_step, maskedNid: nid.length > 4 ? '*'.repeat(nid.length - 4) + nid.slice(-4) : '****' } };
    },
  },
  {
    method: 'POST',
    path: '/kyc/appeal',
    handler({ body }) {
      const all = loadAll();
      const rec = all[userKey()];
      if (!rec || rec.id !== Number(body?.kyc_id) || rec.status !== 'REJECTED') {
        return { status: 409, body: { error: { code: 'CANNOT_APPEAL', message_en: 'Only a rejected check can be appealed.', message_bn: 'শুধু বাতিল হওয়া যাচাইয়ের বিরুদ্ধে আবেদন করা যায়।' } } };
      }
      rec.status = 'APPEALED';
      saveAll(all);
      return { data: { success: true, status: 'APPEALED', kyc: rec } };
    },
  },
];

export default kycHandlers;
