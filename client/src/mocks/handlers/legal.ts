/**
 * legal.ts — Mock API handlers for the legal documents (server routes/legal.routes.ts, migration 104).
 *
 * Same shapes as the API. WHY short stand-in text: the real documents live in migration 104 and are
 * served by the API; the mock only has to exercise the pages, the sign-up box and the agree dialog.
 * Agreements and new versions persist to localStorage, so a mock session is asked once, like a real
 * account, and an admin can publish a version and watch the dialog ask again.
 */

import type { MockRoute } from '../types.ts';
import { companyTokenState } from '../../services/legalText.ts';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
/** The mock's return window, as GET /admin/platform/legal reports it. */
const MOCK_RETURN_WINDOW_DAYS = 7;

/**
 * Fills the {{tokens}} the way legal.service.ts renderBody does, for the public page.
 * WHY: without it a mock reader sees raw {{company.dbid}}; only the admin preview marks tokens.
 */
function fillTokens(body: string, lang: 'en' | 'bn'): string {
  const digits = (v: string) => (lang === 'bn' ? v.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]) : v);
  return String(body ?? '').replace(/\{\{\s*([a-z_]+)\.([a-z_]+)\s*\}\}/g, (whole, group, field) => {
    if (group === 'returns' && field === 'window_days') return digits(String(MOCK_RETURN_WINDOW_DAYS));
    if (group !== 'company') return whole;
    // WHY `state` is read at call time: this runs per request, after the module's `state` exists.
    const token = companyTokenState(field, { company: state.company, fields: COMPANY_FIELDS, lang, labelOf: (f) => f });
    if (token.state === 'unknown') return whole;
    if (token.state === 'empty') return '—';
    const kind = COMPANY_FIELDS[field]?.kind;
    return kind === 'days' || kind === 'years' ? digits(token.value) : token.value;
  });
}

const STORAGE_KEY = 'explooro:mock:legal';
const KEYS = ['terms', 'privacy', 'refund', 'partner_agreement', 'supplier_agreement'];
const PATHS = { terms: '/legal/terms', privacy: '/legal/privacy', refund: '/legal/refund', partner_agreement: '/legal/partner-agreement', supplier_agreement: '/legal/supplier-agreement' };
const ACCEPTED_BY = { terms: 'all', privacy: 'all', refund: null, partner_agreement: ['saler'], supplier_agreement: ['supplier'] };
const TITLES = {
  terms: ['Terms of Use', 'ব্যবহারের শর্তাবলি'],
  privacy: ['Privacy Policy', 'গোপনীয়তা নীতি'],
  refund: ['Refund & Return Policy', 'রিফান্ড ও রিটার্ন নীতি'],
  partner_agreement: ['Explooro Partner Agreement', 'Explooro শপ পার্টনার চুক্তি'],
  supplier_agreement: ['Explooro Supplier Agreement', 'Explooro সরবরাহকারী চুক্তি'],
};

// WHY tokens in the stand-in text: the admin page marks each one filled / default / empty, and the
// mock must exercise that. The real text is migration 113's.
const bodyEn = (title) => `This is the mock-mode stand-in for the ${title}. The real text is served by the API (migrations 104 and 113).

## 1. Who we are
- Registered name: {{company.legal_name}}, a {{company.business_type}}
- Digital Business Identity (DBID): {{company.dbid}}
- We reply to complaints within {{company.complaint_reply_days}} working days, and returns are open for {{returns.window_days}} days.

## 2. Law and disputes
Any dispute is decided by the courts of {{company.court_city}}. Records are kept for {{company.records_years}} years.

## 3. Contact
{{company.legal_name}}, {{company.address}}
Email: {{company.support_email}} · Phone: {{company.support_phone}}
Support hours: {{company.support_hours}}`;
const bodyBn = (title) => `এটি মক মোডে ${title}-এর বদলি লেখা। আসল লেখা API থেকে আসে (মাইগ্রেশন ১০৪ ও ১১৩)।

## ১. আমরা কারা
- নিবন্ধিত নাম: {{company.legal_name}}, একটি {{company.business_type}}
- ডিজিটাল বিজনেস আইডেন্টিটি (DBID): {{company.dbid}}
- আমরা {{company.complaint_reply_days}} কর্মদিবসের মধ্যে অভিযোগের উত্তর দিই, এবং {{returns.window_days}} দিন রিটার্ন করা যায়।

## ২. আইন ও বিরোধ
যেকোনো বিরোধ {{company.court_city}}-র আদালত নিষ্পত্তি করবে। রেকর্ড {{company.records_years}} বছর রাখা হয়।

## ৩. যোগাযোগ
{{company.legal_name}}, {{company.address}}
ইমেইল: {{company.support_email}} · ফোন: {{company.support_phone}}
সাপোর্টের সময়: {{company.support_hours}}`;

/**
 * Copy of COMPANY_FIELDS in server/src/services/legal.service.ts (keys, order, group, kind,
 * required, max). server/test/legal.test.js fails if the two differ.
 */
export const COMPANY_FIELDS = Object.freeze({
  legal_name: { max: 200, group: 'identity', kind: 'text', required: true },
  business_type_en: { max: 120, group: 'identity', kind: 'text', required: true },
  business_type_bn: { max: 120, group: 'identity', kind: 'text', required: false },
  trade_license: { max: 60, group: 'identity', kind: 'text', required: true },
  dbid: { max: 60, group: 'identity', kind: 'text', required: true },
  tax_ids: { max: 120, group: 'identity', kind: 'text', required: true },
  address_en: { max: 300, group: 'identity', kind: 'text', required: true },
  address_bn: { max: 300, group: 'identity', kind: 'text', required: false },
  support_email: { max: 120, group: 'contact', kind: 'email', required: true },
  support_phone: { max: 30, group: 'contact', kind: 'tel', required: true },
  support_hours_en: { max: 120, group: 'contact', kind: 'text', required: true },
  support_hours_bn: { max: 120, group: 'contact', kind: 'text', required: false },
  privacy_email: { max: 120, group: 'contact', kind: 'email', required: false },
  partner_support: { max: 120, group: 'contact', kind: 'text', required: false },
  supplier_support: { max: 120, group: 'contact', kind: 'text', required: false },
  service_providers_en: { max: 500, group: 'operations', kind: 'text', required: true },
  service_providers_bn: { max: 500, group: 'operations', kind: 'text', required: false },
  data_location_en: { max: 200, group: 'operations', kind: 'text', required: true },
  data_location_bn: { max: 200, group: 'operations', kind: 'text', required: false },
  supplier_documents_en: { max: 500, group: 'operations', kind: 'text', required: true },
  supplier_documents_bn: { max: 500, group: 'operations', kind: 'text', required: false },
  court_city_en: { max: 60, group: 'operations', kind: 'text', required: false },
  court_city_bn: { max: 60, group: 'operations', kind: 'text', required: false },
  complaint_reply_days: { max: 3, group: 'time', kind: 'days', required: true },
  complaint_resolve_days: { max: 3, group: 'time', kind: 'days', required: true },
  return_review_days: { max: 3, group: 'time', kind: 'days', required: true },
  return_check_days: { max: 3, group: 'time', kind: 'days', required: true },
  return_appeal_days: { max: 3, group: 'time', kind: 'days', required: true },
  refund_days: { max: 3, group: 'time', kind: 'days', required: true },
  not_received_days: { max: 3, group: 'time', kind: 'days', required: true },
  privacy_reply_days: { max: 3, group: 'time', kind: 'days', required: true },
  records_years: { max: 2, group: 'time', kind: 'years', required: true },
  id_docs_years: { max: 2, group: 'time', kind: 'years', required: true },
  partner_explain_days: { max: 3, group: 'time', kind: 'days', required: true },
  reward_claim_days: { max: 3, group: 'time', kind: 'days', required: true },
  notice_days: { max: 3, group: 'time', kind: 'days', required: true },
  supplier_dispatch_days: { max: 3, group: 'time', kind: 'days', required: true },
  supplier_details_days: { max: 3, group: 'time', kind: 'days', required: true },
  supplier_return_check_days: { max: 3, group: 'time', kind: 'days', required: true },
});

/** The starting values migration 113 writes: time limits set, everything only the owner knows empty. */
const COMPANY_START = Object.freeze({
  ...Object.fromEntries(Object.keys(COMPANY_FIELDS).map((f) => [f, ''])),
  complaint_reply_days: '2', complaint_resolve_days: '7', return_review_days: '2', return_check_days: '3',
  return_appeal_days: '3', refund_days: '7', not_received_days: '2', privacy_reply_days: '30',
  partner_explain_days: '7', reward_claim_days: '30', notice_days: '15', supplier_dispatch_days: '2',
  supplier_details_days: '7', supplier_return_check_days: '3',
});

const iso = (days = 0) => new Date(Date.now() + days * 86400000).toISOString();

function seed() {
  let id = 1;
  return {
    documents: KEYS.map((key) => ({
      id: id++, doc_key: key, version: 1, title_en: TITLES[key][0], title_bn: TITLES[key][1],
      body_en: bodyEn(TITLES[key][0]), body_bn: bodyBn(TITLES[key][1]),
      change_note_en: 'First version.', change_note_bn: 'প্রথম সংস্করণ।',
      requires_reacceptance: key !== 'refund', published_at: iso(-30), acceptances: 0,
    })),
    accepted: {},
    company: { ...COMPANY_START },
    history: [],
  };
}

function load() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.documents)) {
        // WHY: a browser that saved state before a document existed (the supplier agreement,
        // migration 112) would have no version of it, and every list here would crash on it.
        const fresh = seed().documents;
        for (const key of KEYS) {
          if (!parsed.documents.some((d) => d.doc_key === key)) {
            const maxId = Math.max(0, ...parsed.documents.map((d) => d.id));
            parsed.documents.push({ ...fresh.find((d) => d.doc_key === key), id: maxId + 1 });
          }
        }
        // Same for a field added after the browser saved its company details (migration 113).
        parsed.company = { ...COMPANY_START, ...(parsed.company || {}) };
        return parsed;
      }
    }
  } catch {
    // Private browsing: start from the seed.
  }
  return seed();
}

const state = load();
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Not persisted; fine for a mock.
  }
}

const versionsOf = (key) => state.documents.filter((d) => d.doc_key === key).sort((a, b) => b.version - a.version);
const latestOf = (key) => versionsOf(key)[0];
const requiredOf = (key) => Math.max(...versionsOf(key).filter((d) => d.requires_reacceptance || d.version === 1).map((d) => d.version));
const err = (status, code, message_en, message_bn = message_en) => ({ status, body: { error: { code, message_en, message_bn } } });

function pending() {
  // WHY terms and privacy only: the mock has no reliable role here; a mock partner is asked for the
  // partner agreement through the real API path.
  return ['terms', 'privacy']
    .map(latestOf)
    .filter((d) => (state.accepted[d.doc_key] ?? 0) < requiredOf(d.doc_key))
    .map((d) => ({
      document_id: d.id, key: d.doc_key, path: PATHS[d.doc_key], version: d.version,
      title_en: d.title_en, title_bn: d.title_bn,
      change_note_en: state.accepted[d.doc_key] ? d.change_note_en : null,
      change_note_bn: state.accepted[d.doc_key] ? d.change_note_bn : null,
      published_at: d.published_at,
    }));
}

const routes: MockRoute[] = [
  {
    method: 'GET',
    path: '/legal/documents',
    handler: () => ({ data: KEYS.map(latestOf).map((d) => ({ key: d.doc_key, path: PATHS[d.doc_key], version: d.version, title_en: d.title_en, title_bn: d.title_bn, published_at: d.published_at })) }),
  },
  {
    method: 'GET',
    path: '/legal/documents/:key',
    handler: ({ params = {}, query = {} }) => {
      if (!KEYS.includes(params.key)) return err(404, 'NOT_FOUND', 'No such document.', 'এমন কোনো নথি নেই।');
      const all = versionsOf(params.key);
      const doc = query.version ? all.find((d) => d.version === Number(query.version)) : all[0];
      if (!doc) return err(404, 'NOT_FOUND', 'That version does not exist.', 'এই সংস্করণ নেই।');
      return {
        data: {
          id: doc.id, key: doc.doc_key, path: PATHS[doc.doc_key], version: doc.version,
          is_current: doc.version === all[0].version, current_version: all[0].version,
          title_en: doc.title_en, title_bn: doc.title_bn, body_en: fillTokens(doc.body_en, 'en'), body_bn: fillTokens(doc.body_bn, 'bn'),
          change_note_en: doc.change_note_en, change_note_bn: doc.change_note_bn, published_at: doc.published_at,
          versions: all.map((d) => ({ version: d.version, published_at: d.published_at })),
        },
      };
    },
  },
  { method: 'GET', path: '/me/legal/pending', handler: () => ({ data: { pending: pending() } }) },
  {
    method: 'POST',
    path: '/me/legal/accept',
    handler: ({ body = {} }) => {
      const ids = Array.isArray(body.document_ids) ? body.document_ids.map(Number) : [];
      if (!ids.length) return err(400, 'VALIDATION_FAILED', 'Say which documents you agree to.');
      for (const id of ids) {
        const doc = state.documents.find((d) => d.id === id);
        if (!doc) return err(404, 'NOT_FOUND', 'One of these documents does not exist.');
        if (doc.version !== latestOf(doc.doc_key).version) {
          return err(409, 'PRECONDITION_CHANGED', 'A newer version was published. Please read it and agree again.', 'নতুন সংস্করণ প্রকাশিত হয়েছে। অনুগ্রহ করে পড়ে আবার সম্মতি দিন।');
        }
        if ((state.accepted[doc.doc_key] ?? 0) < doc.version) doc.acceptances += 1;
        state.accepted[doc.doc_key] = Math.max(state.accepted[doc.doc_key] ?? 0, doc.version);
      }
      save();
      return { data: { pending: pending() } };
    },
  },
  {
    method: 'GET',
    path: '/admin/platform/legal',
    handler: () => {
      const company = state.company;
      return {
        documents: KEYS.map((key) => {
          const cur = latestOf(key);
          return {
            key, path: PATHS[key], accepted_by: ACCEPTED_BY[key],
            current: { id: cur.id, version: cur.version, title_en: cur.title_en, title_bn: cur.title_bn, body_en: cur.body_en, body_bn: cur.body_bn },
            versions: versionsOf(key).map((d) => ({ id: d.id, version: d.version, requires_reacceptance: d.requires_reacceptance, published_at: d.published_at, change_note_en: d.change_note_en, change_note_bn: d.change_note_bn, acceptances: d.acceptances })),
          };
        }),
        company,
        company_updated_at: null,
        missing_company_fields: Object.entries(COMPANY_FIELDS).filter(([f, spec]) => spec.required && !company[f]).map(([f]) => f),
        return_window_days: 7,
        limits: { title: { min: 3, max: 200 }, body: { min: 200, max: 60000 }, changeNote: { min: 5, max: 500 }, reason: { min: 10, max: 500 } },
        company_fields: COMPANY_FIELDS,
        history: state.history,
        can_publish: true,
      };
    },
  },
  {
    method: 'POST',
    path: '/admin/platform/legal/:key/versions',
    handler: ({ params = {}, body = {} }) => {
      if (!KEYS.includes(params.key)) return err(404, 'NOT_FOUND', 'No such document.');
      const cur = latestOf(params.key);
      if (Number(body.base_version) !== cur.version) return err(409, 'PRECONDITION_CHANGED', 'Someone published a newer version. Reload.');
      if (String(body.reason || '').trim().length < 10) return err(400, 'VALIDATION_FAILED', 'Give a reason of at least 10 characters.');
      if (String(body.body_en || '').trim().length < 200 || String(body.body_bn || '').trim().length < 200) {
        return err(400, 'VALIDATION_FAILED', 'The text must be at least 200 characters.');
      }
      if (/\[\[(FILL|CHOOSE|LAWYER)\b/.test(`${body.body_en} ${body.body_bn}`)) {
        return err(422, 'LEGAL_MARKING_LEFT', 'The text still has a [[FILL]], [[CHOOSE]] or [[LAWYER]] marking. Complete it before publishing.',
          'লেখায় এখনো [[FILL]], [[CHOOSE]] বা [[LAWYER]] চিহ্ন আছে। প্রকাশের আগে তা পূরণ করুন।');
      }
      const row = {
        id: Math.max(...state.documents.map((d) => d.id)) + 1, doc_key: params.key, version: cur.version + 1,
        title_en: body.title_en, title_bn: body.title_bn, body_en: body.body_en, body_bn: body.body_bn,
        change_note_en: body.change_note_en, change_note_bn: body.change_note_bn,
        requires_reacceptance: body.requires_reacceptance === true, published_at: iso(), acceptances: 0,
      };
      state.documents.push(row);
      state.history.unshift({ action: 'platform.legal.publish', target_ref: `${params.key}@${row.version}`, actor_ref: 'USR-MOCK', created_at: iso(), meta_json: { reason: body.reason } });
      save();
      return { status: 201, body: { data: row, message_en: `Version ${row.version} is published.`, message_bn: `সংস্করণ ${row.version} প্রকাশিত হয়েছে।` } };
    },
  },
  {
    method: 'PUT',
    path: '/admin/platform/legal/company',
    handler: ({ body = {} }) => {
      if (String(body.reason || '').trim().length < 10) return err(400, 'VALIDATION_FAILED', 'Give a reason of at least 10 characters.');
      const { reason, ...company } = body;
      for (const [f, spec] of Object.entries(COMPANY_FIELDS)) {
        const v = String(company[f] ?? '').trim();
        if ((spec.kind === 'days' || spec.kind === 'years') && v && !/^\d+$/.test(v)) {
          return err(400, 'VALIDATION_FAILED', `${f} must be a whole number.`, `${f} একটি পূর্ণ সংখ্যা হতে হবে।`);
        }
      }
      state.company = { ...state.company, ...Object.fromEntries(Object.keys(COMPANY_FIELDS).map((f) => [f, String(company[f] ?? state.company[f] ?? '').trim()])) };
      state.history.unshift({ action: 'platform.legal.company.update', target_ref: 'legal.company', actor_ref: 'USR-MOCK', created_at: iso(), meta_json: { reason } });
      save();
      return { data: state.company, message_en: 'Company details saved.', message_bn: 'কোম্পানির তথ্য সেভ হয়েছে।' };
    },
  },
];

export default routes;
