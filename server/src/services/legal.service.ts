/**
 * legal.service.ts — terms, privacy, refund policy and Explooro partner agreement (migration 104).
 *
 * The one place that decides:
 *   * what text a reader sees (renderBody fills the {{tokens}} from configuration),
 *   * which documents an account still has to agree to (pendingFor),
 *   * how an agreement is recorded (accept, acceptAtSignup),
 *   * how a new version is published and the company details changed (both super admin, audited).
 *
 * A published version is never edited (a trigger refuses it). A change is a new version, and
 * `requires_reacceptance` says whether it asks everyone to agree again. Version 1 always does.
 */

import * as settingRepo from '../repositories/setting.repository.ts';
import { getReturnWindowDays } from './return.service.ts';
import { AppError } from '../plugins/errorHandler.ts';
import { LEGAL_DOCS, LEGAL_DOC_KEYS, docsToAccept } from '../config/legal.ts';

export const COMPANY_SETTING_KEY = 'legal.company';
const COMPANY_GROUP = 'legal';
const COMPANY_META = {
  valueType: 'OBJECT',
  labelEn: 'Company details shown in the legal documents',
  labelBn: 'আইনি নথিতে দেখানো কোম্পানির তথ্য',
};

/** Field bounds. Shapes of what an admin types, not business numbers. */
export const COMPANY_FIELDS = Object.freeze({
  legal_name: { max: 200 },
  trade_license: { max: 60 },
  address_en: { max: 300 },
  address_bn: { max: 300 },
  support_email: { max: 120 },
  support_phone: { max: 30 },
});
export const PUBLISH_LIMITS = Object.freeze({
  title: { min: 3, max: 200 },
  body: { min: 200, max: 60000 },
  changeNote: { min: 5, max: 500 },
  reason: { min: 10, max: 500 },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /\{\{\s*([a-z_]+)\.([a-z_]+)\s*\}\}/g;
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const toBnDigits = (s) => String(s).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
/** What an unset company field reads as. WHY not blank: "Phone: " followed by nothing looks broken. */
const UNSET = '—';

function bad(field, en, bn) {
  return new AppError('VALIDATION_FAILED', en, bn, { field });
}

function readJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function assertKey(key) {
  if (!LEGAL_DOC_KEYS.includes(key)) {
    throw new AppError('NOT_FOUND', 'No such document.', 'এমন কোনো নথি নেই।');
  }
}

// ── Company details ─────────────────────────────────────────────────────────

/** Forgiving read: anything missing or malformed reads as an empty string. */
export function resolveCompany(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(Object.keys(COMPANY_FIELDS).map((f) => [f, typeof value[f] === 'string' ? value[f].trim() : '']));
}

export async function loadCompany(db) {
  const row = await settingRepo.getSettingByKey(db, COMPANY_SETTING_KEY);
  return { company: resolveCompany(readJson(row?.value_json)), updated_at: row?.updated_at ?? null };
}

/** The fields still empty. The admin page warns about each one before launch. */
export function missingCompanyFields(company) {
  // WHY address_bn is not required: the Bangla text falls back to the English address.
  return Object.keys(COMPANY_FIELDS).filter((f) => f !== 'address_bn' && !company[f]);
}

/** Strict write: a wrong type or an over-long value is refused, never trimmed to fit. */
export function validateCompany(input) {
  if (!input || typeof input !== 'object') throw bad('company', 'Send the company details.', 'কোম্পানির তথ্য পাঠান।');
  const out: Record<string, string> = {};
  for (const [field, { max }] of Object.entries(COMPANY_FIELDS)) {
    const v = input[field] ?? '';
    if (typeof v !== 'string') throw bad(field, `${field} must be text.`, `${field} লেখা হতে হবে।`);
    const s = v.trim();
    if (s.length > max) throw bad(field, `${field} can be at most ${max} characters.`, `${field} সর্বোচ্চ ${max} অক্ষর হতে পারে।`);
    out[field] = s;
  }
  if (out.support_email && !EMAIL_RE.test(out.support_email)) {
    throw bad('support_email', 'Enter a valid email address.', 'সঠিক ইমেইল ঠিকানা লিখুন।');
  }
  return out;
}

function assertReason(reason) {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < PUBLISH_LIMITS.reason.min || r.length > PUBLISH_LIMITS.reason.max) {
    throw bad('reason', `Give a reason of ${PUBLISH_LIMITS.reason.min}–${PUBLISH_LIMITS.reason.max} characters.`,
      `${PUBLISH_LIMITS.reason.min}–${PUBLISH_LIMITS.reason.max} অক্ষরের একটি কারণ লিখুন।`);
  }
  return r;
}

export async function updateCompany(db, auditService, { company, reason, userId = null, actorRole = null, reqContext = {} as { ip?: string; userAgent?: string; traceId?: string } }) {
  const next = validateCompany(company);
  const why = assertReason(reason);
  const before = (await loadCompany(db)).company;
  await settingRepo.upsertSetting(db, {
    key: COMPANY_SETTING_KEY,
    valueJson: next,
    groupKey: COMPANY_GROUP,
    updatedBy: userId,
    ...COMPANY_META,
  });
  if (auditService?.record) {
    await auditService.record(db, {
      action: 'platform.legal.company.update',
      targetType: 'platform_settings',
      targetRef: COMPANY_SETTING_KEY,
      beforeJson: before,
      afterJson: next,
      meta: { reason: why },
      riskTier: 'CRITICAL',
      actorId: userId,
      actorRole,
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
  }
  return next;
}

// ── Rendering ───────────────────────────────────────────────────────────────

/**
 * Fills {{company.*}} and {{returns.window_days}}. Unknown tokens are left as written, so a typo in
 * a new version shows up in the admin preview instead of vanishing.
 */
export function renderBody(body, { company = {} as Record<string, string>, returnWindowDays = null as number | null } = {}, lang = 'en') {
  return String(body ?? '').replace(TOKEN_RE, (whole, group, field) => {
    if (group === 'company') {
      if (field === 'legal_name') return company.legal_name || 'Explooro';
      if (field === 'address') {
        const addr = lang === 'bn' ? (company.address_bn || company.address_en) : company.address_en;
        return addr || UNSET;
      }
      if (field in COMPANY_FIELDS) return company[field] || UNSET;
    }
    if (group === 'returns' && field === 'window_days' && returnWindowDays != null) {
      return lang === 'bn' ? toBnDigits(returnWindowDays) : String(returnWindowDays);
    }
    return whole;
  });
}

async function renderContext(db) {
  const [{ company }, returnWindowDays] = await Promise.all([loadCompany(db), getReturnWindowDays(db, null)]);
  return { company, returnWindowDays };
}

// ── Reading ─────────────────────────────────────────────────────────────────

const pathOf = (key) => LEGAL_DOCS.find((d) => d.key === key)?.path ?? null;

/** The newest version of every document, without bodies. Public. */
export async function listCurrent(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (doc_key) id, doc_key, version, title_en, title_bn, published_at
     FROM legal_documents
     ORDER BY doc_key, version DESC`
  );
  const byKey = new Map<string, any>(rows.map((r) => [r.doc_key, r]));
  // WHY in LEGAL_DOCS order: the footer and the index list them in this order.
  return LEGAL_DOCS.filter((d) => byKey.has(d.key)).map((d) => {
    const r = byKey.get(d.key);
    return { key: d.key, path: d.path, version: r.version, title_en: r.title_en, title_bn: r.title_bn, published_at: r.published_at };
  });
}

/** One document as readers see it: the newest version, or `version` when asked. Public. */
export async function getDocument(db, key, { version = null }: { version?: number | null } = {}) {
  assertKey(key);
  const { rows: versions } = await db.query(
    `SELECT id, version, published_at, requires_reacceptance
     FROM legal_documents WHERE doc_key = $1 ORDER BY version DESC`,
    [key]
  );
  if (versions.length === 0) throw new AppError('NOT_FOUND', 'No such document.', 'এমন কোনো নথি নেই।');
  const wanted = version == null ? versions[0] : versions.find((v) => v.version === Number(version));
  if (!wanted) throw new AppError('NOT_FOUND', `Version ${version} does not exist.`, `সংস্করণ ${version} নেই।`);

  const { rows } = await db.query('SELECT * FROM legal_documents WHERE id = $1', [wanted.id]);
  const doc = rows[0];
  const ctx = await renderContext(db);
  return {
    id: doc.id,
    key,
    path: pathOf(key),
    version: doc.version,
    is_current: doc.version === versions[0].version,
    current_version: versions[0].version,
    title_en: doc.title_en,
    title_bn: doc.title_bn,
    body_en: renderBody(doc.body_en, ctx, 'en'),
    body_bn: renderBody(doc.body_bn, ctx, 'bn'),
    change_note_en: doc.change_note_en,
    change_note_bn: doc.change_note_bn,
    published_at: doc.published_at,
    versions: versions.map((v) => ({ version: v.version, published_at: v.published_at })),
  };
}

// ── Agreeing ────────────────────────────────────────────────────────────────

/**
 * The documents this account still has to agree to, newest version of each.
 *
 * WHY "the newest version that requires re-acceptance" and not simply "the newest": a version
 * published as a text-only fix must not ask everyone to agree again, yet a person who never agreed
 * to the last material version still has to.
 */
export async function pendingFor(db, { userId, roles = [] }: { userId: number | string; roles?: string[] }) {
  const needed = docsToAccept(roles);
  if (needed.length === 0) return [];
  const keys = needed.map((d) => d.key);

  const [{ rows: latest }, { rows: accepted }] = await Promise.all([
    db.query(
      `SELECT DISTINCT ON (d.doc_key) d.id, d.doc_key, d.version, d.title_en, d.title_bn,
              d.change_note_en, d.change_note_bn, d.published_at,
              (SELECT MAX(x.version) FROM legal_documents x
                WHERE x.doc_key = d.doc_key AND (x.requires_reacceptance OR x.version = 1)) AS required_version
       FROM legal_documents d
       WHERE d.doc_key = ANY($1::text[])
       ORDER BY d.doc_key, d.version DESC`,
      [keys]
    ),
    db.query(
      `SELECT doc_key, MAX(version) AS version FROM legal_acceptances
       WHERE user_id = $1 GROUP BY doc_key`,
      [userId]
    ),
  ]);
  const agreed = new Map<string, number>(accepted.map((r) => [r.doc_key, Number(r.version)]));

  return needed
    .map((d) => latest.find((r) => r.doc_key === d.key))
    .filter((r) => r && (agreed.get(r.doc_key) ?? 0) < Number(r.required_version ?? r.version))
    .map((r) => ({
      document_id: Number(r.id),
      key: r.doc_key,
      path: pathOf(r.doc_key),
      version: r.version,
      title_en: r.title_en,
      title_bn: r.title_bn,
      // WHY no note for a first agreement: "what changed" means nothing to someone new.
      change_note_en: agreed.has(r.doc_key) ? r.change_note_en : null,
      change_note_bn: agreed.has(r.doc_key) ? r.change_note_bn : null,
      published_at: r.published_at,
    }));
}

async function insertAcceptances(db, userId, docs, meta = {} as { ip?: string | null; userAgent?: string | null }) {
  for (const d of docs) {
    await db.query(
      `INSERT INTO legal_acceptances (user_id, document_id, doc_key, version, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, document_id) DO NOTHING`,
      [userId, d.id, d.doc_key, d.version, meta.ip ?? null, meta.userAgent ? String(meta.userAgent).slice(0, 300) : null]
    );
  }
}

/**
 * Records that this account agreed to these versions. Each must be the newest version of a document
 * the account has to agree to: agreeing to an old text, or to someone else's agreement, is refused.
 * Repeating an agreement is a no-op. Returns what is still pending.
 */
export async function accept(db, { userId, roles = [], documentIds = [], ip = null, userAgent = null }: { userId: number | string; roles?: string[]; documentIds?: (number | string)[]; ip?: string | null; userAgent?: string | null }) {
  const ids = [...new Set((Array.isArray(documentIds) ? documentIds : []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) throw bad('document_ids', 'Say which documents you agree to.', 'কোন নথিতে সম্মতি দিচ্ছেন তা জানান।');

  const { rows } = await db.query(
    `SELECT d.id, d.doc_key, d.version,
            (SELECT MAX(x.version) FROM legal_documents x WHERE x.doc_key = d.doc_key) AS newest
     FROM legal_documents d WHERE d.id = ANY($1::bigint[])`,
    [ids]
  );
  if (rows.length !== ids.length) throw new AppError('NOT_FOUND', 'One of these documents does not exist.', 'এর একটি নথি নেই।');

  const allowed = new Set(docsToAccept(roles).map((d) => d.key));
  for (const r of rows) {
    if (!allowed.has(r.doc_key)) {
      throw bad('document_ids', 'This document is not one you need to agree to.', 'এই নথিতে আপনার সম্মতি দেওয়ার প্রয়োজন নেই।');
    }
    if (Number(r.version) !== Number(r.newest)) {
      throw new AppError('PRECONDITION_CHANGED', 'A newer version was published. Please read it and agree again.',
        'নতুন সংস্করণ প্রকাশিত হয়েছে। অনুগ্রহ করে পড়ে আবার সম্মতি দিন।');
    }
  }

  await insertAcceptances(db, userId, rows, { ip, userAgent });
  return pendingFor(db, { userId, roles });
}

/**
 * Sign-up: the form's "I agree" box covers the newest version of every document the new account must
 * agree to. Best-effort by design — a failure here must never cost someone their account; they are
 * simply asked again on their next visit (pendingFor).
 */
export async function acceptAtSignup(db, { userId, roles = [], ip = null, userAgent = null }: { userId: number | string; roles?: string[]; ip?: string | null; userAgent?: string | null }) {
  const keys = docsToAccept(roles).map((d) => d.key);
  if (keys.length === 0) return;
  const { rows } = await db.query(
    `SELECT DISTINCT ON (doc_key) id, doc_key, version FROM legal_documents
     WHERE doc_key = ANY($1::text[]) ORDER BY doc_key, version DESC`,
    [keys]
  );
  await insertAcceptances(db, userId, rows, { ip, userAgent });
}

// ── Publishing ──────────────────────────────────────────────────────────────

function textField(input, field, { min, max }, label) {
  const v = typeof input?.[field] === 'string' ? input[field].trim() : '';
  if (v.length < min || v.length > max) {
    throw bad(field, `${label} must be ${min}–${max} characters.`, `${label} ${min}–${max} অক্ষরের হতে হবে।`);
  }
  return v;
}

/** Strict: every field present and within bounds; `base_version` must still be the newest. */
export function validatePublish(input, currentVersion) {
  const out = {
    title_en: textField(input, 'title_en', PUBLISH_LIMITS.title, 'English title'),
    title_bn: textField(input, 'title_bn', PUBLISH_LIMITS.title, 'Bangla title'),
    body_en: textField(input, 'body_en', PUBLISH_LIMITS.body, 'English text'),
    body_bn: textField(input, 'body_bn', PUBLISH_LIMITS.body, 'Bangla text'),
    change_note_en: textField(input, 'change_note_en', PUBLISH_LIMITS.changeNote, 'English change note'),
    change_note_bn: textField(input, 'change_note_bn', PUBLISH_LIMITS.changeNote, 'Bangla change note'),
    requires_reacceptance: input?.requires_reacceptance,
  };
  if (typeof out.requires_reacceptance !== 'boolean') {
    throw bad('requires_reacceptance', 'Say whether everyone must agree again.', 'সবাইকে আবার সম্মতি দিতে হবে কিনা জানান।');
  }
  if (Number(input?.base_version) !== Number(currentVersion)) {
    throw new AppError('PRECONDITION_CHANGED', 'Someone published a newer version while you were editing. Reload and start from it.',
      'আপনি লেখার সময় অন্য কেউ নতুন সংস্করণ প্রকাশ করেছেন। রিলোড করে সেখান থেকে শুরু করুন।');
  }
  return out;
}

export async function publishVersion(db, auditService, { key, input, reason, userId = null, actorRole = null, reqContext = {} as { ip?: string; userAgent?: string; traceId?: string } }) {
  assertKey(key);
  const why = assertReason(reason);

  const client = db.connect ? await db.connect() : db;
  const dedicated = Boolean(db.connect);
  let row;
  let before;
  try {
    if (dedicated) await client.query('BEGIN');
    // WHY an advisory lock: two admins publishing at once would both read version N and race for
    // N+1. The UNIQUE key would refuse one with a raw error; the lock makes the second see N+1.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`legal_documents:${key}`]);
    const { rows: cur } = await client.query(
      'SELECT id, version, requires_reacceptance FROM legal_documents WHERE doc_key = $1 ORDER BY version DESC LIMIT 1',
      [key]
    );
    before = cur[0] ?? null;
    const next = validatePublish(input, before?.version ?? 0);
    const { rows } = await client.query(
      `INSERT INTO legal_documents (doc_key, version, title_en, title_bn, body_en, body_bn,
         change_note_en, change_note_bn, requires_reacceptance, published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, doc_key, version, requires_reacceptance, published_at`,
      [key, (before?.version ?? 0) + 1, next.title_en, next.title_bn, next.body_en, next.body_bn,
        next.change_note_en, next.change_note_bn, next.requires_reacceptance, userId]
    );
    row = rows[0];
    if (dedicated) await client.query('COMMIT');
  } catch (err) {
    if (dedicated) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (dedicated && client.release) client.release();
  }

  if (auditService?.record) {
    await auditService.record(db, {
      action: 'platform.legal.publish',
      targetType: 'legal_document',
      targetRef: `${key}@${row.version}`,
      beforeJson: before ? { version: before.version } : null,
      afterJson: { version: row.version, requires_reacceptance: row.requires_reacceptance },
      meta: { reason: why },
      riskTier: 'CRITICAL',
      actorId: userId,
      actorRole,
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
  }
  return row;
}

// ── Admin overview ──────────────────────────────────────────────────────────

/** Every document with its versions (and how many agreed to each), plus the newest text to edit. */
export async function getAdminOverview(db) {
  const [{ rows: versions }, { rows: latest }, companyView, returnWindowDays] = await Promise.all([
    db.query(
      `SELECT d.id, d.doc_key, d.version, d.requires_reacceptance, d.published_at,
              d.change_note_en, d.change_note_bn,
              (SELECT COUNT(*) FROM legal_acceptances a WHERE a.document_id = d.id)::int AS acceptances
       FROM legal_documents d
       ORDER BY d.doc_key, d.version DESC`
    ),
    db.query(
      `SELECT DISTINCT ON (doc_key) id, doc_key, version, title_en, title_bn, body_en, body_bn
       FROM legal_documents ORDER BY doc_key, version DESC`
    ),
    loadCompany(db),
    getReturnWindowDays(db, null),
  ]);

  const documents = LEGAL_DOCS.map((d) => {
    const cur = latest.find((r) => r.doc_key === d.key) ?? null;
    return {
      key: d.key,
      path: d.path,
      accepted_by: d.acceptedBy,
      current: cur
        ? { id: Number(cur.id), version: cur.version, title_en: cur.title_en, title_bn: cur.title_bn, body_en: cur.body_en, body_bn: cur.body_bn }
        : null,
      versions: versions.filter((v) => v.doc_key === d.key).map((v) => ({
        id: Number(v.id),
        version: v.version,
        requires_reacceptance: v.requires_reacceptance,
        published_at: v.published_at,
        change_note_en: v.change_note_en,
        change_note_bn: v.change_note_bn,
        acceptances: v.acceptances,
      })),
    };
  });

  return {
    documents,
    company: companyView.company,
    company_updated_at: companyView.updated_at,
    missing_company_fields: missingCompanyFields(companyView.company),
    return_window_days: returnWindowDays,
    limits: PUBLISH_LIMITS,
    company_fields: COMPANY_FIELDS,
  };
}
