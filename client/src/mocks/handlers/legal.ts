/**
 * legal.ts — Mock API handlers for the legal documents (server routes/legal.routes.ts, migration 104).
 *
 * Same shapes as the API. WHY short stand-in text: the real documents live in migration 104 and are
 * served by the API; the mock only has to exercise the pages, the sign-up box and the agree dialog.
 * Agreements and new versions persist to localStorage, so a mock session is asked once, like a real
 * account, and an admin can publish a version and watch the dialog ask again.
 */

import type { MockRoute } from '../types.ts';

const STORAGE_KEY = 'explooro:mock:legal';
const KEYS = ['terms', 'privacy', 'refund', 'partner_agreement'];
const PATHS = { terms: '/legal/terms', privacy: '/legal/privacy', refund: '/legal/refund', partner_agreement: '/legal/partner-agreement' };
const ACCEPTED_BY = { terms: 'all', privacy: 'all', refund: null, partner_agreement: ['saler'] };
const TITLES = {
  terms: ['Terms of Use', 'ব্যবহারের শর্তাবলি'],
  privacy: ['Privacy Policy', 'গোপনীয়তা নীতি'],
  refund: ['Refund & Return Policy', 'রিফান্ড ও রিটার্ন নীতি'],
  partner_agreement: ['Explooro Partner Agreement', 'Explooro শপ পার্টনার চুক্তি'],
};

const bodyEn = (title) => `This is the mock-mode stand-in for the ${title}. The real text is served by the API (migration 104).

## 1. What this covers
- How Explooro works for you.
- What you can expect from us, and what we expect from you.

## 2. Contact
Explooro Limited, Dhaka
Email: support@example.test`;
const bodyBn = (title) => `এটি মক মোডে ${title}-এর বদলি লেখা। আসল লেখা API থেকে আসে (মাইগ্রেশন ১০৪)।

## ১. এতে কী আছে
- Explooro আপনার জন্য কীভাবে কাজ করে।
- আমাদের কাছে আপনি কী আশা করতে পারেন, আর আমরা আপনার কাছে কী আশা করি।

## ২. যোগাযোগ
Explooro Limited, ঢাকা
ইমেইল: support@example.test`;

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
    company: { legal_name: '', trade_license: '', address_en: '', address_bn: '', support_email: '', support_phone: '' },
    history: [],
  };
}

function load() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.documents)) return parsed;
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
          title_en: doc.title_en, title_bn: doc.title_bn, body_en: doc.body_en, body_bn: doc.body_bn,
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
        missing_company_fields: Object.keys(company).filter((f) => f !== 'address_bn' && !company[f]),
        return_window_days: 7,
        limits: { title: { min: 3, max: 200 }, body: { min: 200, max: 60000 }, changeNote: { min: 5, max: 500 }, reason: { min: 10, max: 500 } },
        company_fields: { legal_name: { max: 200 }, trade_license: { max: 60 }, address_en: { max: 300 }, address_bn: { max: 300 }, support_email: { max: 120 }, support_phone: { max: 30 } },
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
      state.company = { ...state.company, ...company };
      state.history.unshift({ action: 'platform.legal.company.update', target_ref: 'legal.company', actor_ref: 'USR-MOCK', created_at: iso(), meta_json: { reason } });
      save();
      return { data: state.company, message_en: 'Company details saved.', message_bn: 'কোম্পানির তথ্য সেভ হয়েছে।' };
    },
  },
];

export default routes;
