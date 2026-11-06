/**
 * legal.test.js — terms, privacy, refund policy and partner agreement (migration 104).
 *
 * 1. One list of documents: server config, client config and the migration agree.
 * 2. Rendering fills the configured tokens and nothing else.
 * 3. Company details are strict on write.
 * 4. Who is asked to agree: by role, and again only after a version that requires it.
 * 5. Agreeing: only the newest version, only a document that applies to the caller.
 * 6. Publishing: never over a newer version, always with a reason, always audited.
 * 7. The admin routes refuse a caller without the permission (through app.inject, never by reading
 *    the source), and the public routes need no sign-in.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import * as legal from '../src/services/legal.service.ts';
import { LEGAL_DOCS, LEGAL_DOC_KEYS, docsToAccept } from '../src/config/legal.ts';
import { LEGAL_DOCS as CLIENT_DOCS } from '../../client/src/config/legal.ts';
import legalRoutes from '../src/routes/legal.routes.ts';
import errorHandlerPlugin from '../src/plugins/errorHandler.ts';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const MIGRATION = read('../src/db/migrations/104_legal_documents.sql');
const norm = (sql) => String(sql).trim().replace(/\s+/g, ' ');

/** A db that answers by SQL text and records every query. */
function fakeDb(answer = () => ({ rows: [] })) {
  const seen = [];
  const db = {
    seen,
    async query(sql, params = []) {
      seen.push({ sql: norm(sql), params });
      return answer(norm(sql), params) ?? { rows: [] };
    },
    release() {},
  };
  return db;
}

describe('1. one list of documents', () => {
  test('server and client configs name the same documents at the same paths', () => {
    assert.deepEqual(CLIENT_DOCS.map((d) => [d.key, d.path]), LEGAL_DOCS.map((d) => [d.key, d.path]));
  });

  test('the migration CHECK allows exactly these keys and seeds version 1 of each', () => {
    const check = MIGRATION.match(/doc_key\s+TEXT NOT NULL CHECK \(doc_key IN \(([^)]+)\)\)/);
    assert.ok(check);
    assert.deepEqual(check[1].split(',').map((s) => s.trim().replace(/'/g, '')), [...LEGAL_DOC_KEYS]);
    for (const key of LEGAL_DOC_KEYS) assert.match(MIGRATION, new RegExp(`\\(\\s*'${key}', 1,`), key);
  });

  test('a published version can never be edited or deleted', () => {
    assert.match(MIGRATION, /BEFORE UPDATE OR DELETE ON legal_documents/);
  });

  test('the seeded text uses no word customers never see (docs/glossary.md)', () => {
    // WHY only the body text: the SQL comments are for developers.
    const bodies = [...MIGRATION.matchAll(/\$(en|bn)\$([\s\S]*?)\$\1\$/g)].map((m) => m[2]).join('\n');
    for (const word of ['escrow', 'payout', 'KYC', 'SKU', 'ledger', 'sub-order', 'এসক্রো', 'পেআউট']) {
      assert.ok(!bodies.toLowerCase().includes(word.toLowerCase()), word);
    }
  });

  test('who agrees to what', () => {
    assert.deepEqual(docsToAccept(['customer']).map((d) => d.key), ['terms', 'privacy']);
    assert.deepEqual(docsToAccept(['saler']).map((d) => d.key), ['terms', 'privacy', 'partner_agreement']);
    assert.ok(!docsToAccept(['admin', 'saler', 'supplier']).some((d) => d.key === 'refund'));
  });
});

describe('2. rendering', () => {
  const company = { legal_name: 'Explooro Limited', trade_license: 'TRAD/DNCC/1', address_en: 'Dhaka', address_bn: '', support_email: 'help@example.test', support_phone: '' };

  test('fills company and return-window tokens, Bangla digits in Bangla', () => {
    const body = '{{company.legal_name}} · {{company.address}} · {{returns.window_days}} · {{company.support_phone}}';
    assert.equal(legal.renderBody(body, { company, returnWindowDays: 7 }, 'en'), 'Explooro Limited · Dhaka · 7 · —');
    assert.equal(legal.renderBody(body, { company, returnWindowDays: 14 }, 'bn'), 'Explooro Limited · Dhaka · ১৪ · —');
  });

  test('an empty name reads Explooro; an unknown token is left as written', () => {
    assert.equal(legal.renderBody('{{company.legal_name}} {{company.ceo}} {{x.y}}', { company: {} }), 'Explooro {{company.ceo}} {{x.y}}');
  });

  test('missing company fields are listed, the Bangla address is optional', () => {
    assert.deepEqual(legal.missingCompanyFields(company), ['support_phone']);
  });
});

describe('3. company details are strict', () => {
  test('wrong type, too long and bad email are refused', () => {
    assert.throws(() => legal.validateCompany({ legal_name: 5 }), (e) => e.code === 'VALIDATION_FAILED');
    assert.throws(() => legal.validateCompany({ legal_name: 'x'.repeat(201) }), (e) => e.code === 'VALIDATION_FAILED');
    assert.throws(() => legal.validateCompany({ support_email: 'not-an-email' }), (e) => e.details?.field === 'support_email');
    assert.deepEqual(legal.validateCompany({ legal_name: '  Explooro Ltd  ' }).legal_name, 'Explooro Ltd');
  });

  test('a save needs a reason and is audited with before and after', async () => {
    const db = fakeDb((sql) => (sql.includes('FROM platform_settings') ? { rows: [{ value_json: { legal_name: 'Old' } }] } : { rows: [] }));
    const audits = [];
    await assert.rejects(legal.updateCompany(db, { record: async (_d, a) => audits.push(a) }, { company: {}, reason: 'short' }), (e) => e.code === 'VALIDATION_FAILED');
    await legal.updateCompany(db, { record: async (_d, a) => audits.push(a) }, { company: { legal_name: 'New' }, reason: 'Registered the company', userId: 1 });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'platform.legal.company.update');
    assert.equal(audits[0].riskTier, 'CRITICAL');
    assert.equal(audits[0].beforeJson.legal_name, 'Old');
    assert.equal(audits[0].afterJson.legal_name, 'New');
  });
});

/** Documents table: key → versions [{ id, version, requires_reacceptance }]. */
function docsDb(docs, accepted = {}) {
  const inserted = [];
  const db = fakeDb((sql, params) => {
    if (sql.startsWith('SELECT DISTINCT ON (d.doc_key)')) {
      return {
        rows: params[0].filter((k) => docs[k]).map((k) => {
          const vs = docs[k];
          const newest = vs[vs.length - 1];
          const required = Math.max(...vs.filter((v) => v.requires_reacceptance || v.version === 1).map((v) => v.version));
          return { id: newest.id, doc_key: k, version: newest.version, title_en: k, title_bn: k, change_note_en: `note ${k}`, change_note_bn: `নোট ${k}`, required_version: required };
        }),
      };
    }
    if (sql.startsWith('SELECT doc_key, MAX(version) AS version FROM legal_acceptances')) {
      return { rows: Object.entries(accepted).map(([doc_key, version]) => ({ doc_key, version })) };
    }
    if (sql.startsWith('SELECT d.id, d.doc_key, d.version')) {
      const all = Object.entries(docs).flatMap(([k, vs]) => vs.map((v) => ({ ...v, doc_key: k, newest: vs[vs.length - 1].version })));
      return { rows: all.filter((r) => params[0].includes(r.id)) };
    }
    if (sql.startsWith('INSERT INTO legal_acceptances')) {
      inserted.push(params);
      accepted[params[2]] = Math.max(accepted[params[2]] ?? 0, params[3]);
    }
    return { rows: [] };
  });
  db.inserted = inserted;
  return db;
}

const V1 = { terms: [{ id: 1, version: 1, requires_reacceptance: true }], privacy: [{ id: 2, version: 1, requires_reacceptance: true }], partner_agreement: [{ id: 3, version: 1, requires_reacceptance: true }] };

describe('4. who is asked to agree', () => {
  test('a new customer is asked for terms and privacy, a partner also for the partner agreement', async () => {
    assert.deepEqual((await legal.pendingFor(docsDb(V1), { userId: 9, roles: ['customer'] })).map((p) => p.key), ['terms', 'privacy']);
    assert.deepEqual((await legal.pendingFor(docsDb(V1), { userId: 9, roles: ['saler'] })).map((p) => p.key), ['terms', 'privacy', 'partner_agreement']);
  });

  test('a first agreement shows no "what changed" note', async () => {
    const [first] = await legal.pendingFor(docsDb(V1), { userId: 9, roles: ['customer'] });
    assert.equal(first.change_note_en, null);
  });

  test('a text-only version 2 asks nobody again; a material version 2 asks with its note', async () => {
    const quiet = { ...V1, terms: [...V1.terms, { id: 4, version: 2, requires_reacceptance: false }] };
    assert.deepEqual(await legal.pendingFor(docsDb(quiet, { terms: 1, privacy: 1 }), { userId: 9, roles: ['customer'] }), []);

    const material = { ...V1, terms: [...V1.terms, { id: 4, version: 2, requires_reacceptance: true }] };
    const pending = await legal.pendingFor(docsDb(material, { terms: 1, privacy: 1 }), { userId: 9, roles: ['customer'] });
    assert.deepEqual(pending.map((p) => [p.key, p.version, p.document_id]), [['terms', 2, 4]]);
    assert.equal(pending[0].change_note_en, 'note terms');
  });

  test('someone who never agreed to a material version is asked, even when the newest is text-only', async () => {
    const docs = { ...V1, terms: [...V1.terms, { id: 4, version: 2, requires_reacceptance: true }, { id: 5, version: 3, requires_reacceptance: false }] };
    const pending = await legal.pendingFor(docsDb(docs, { terms: 1, privacy: 1 }), { userId: 9, roles: ['customer'] });
    assert.deepEqual(pending.map((p) => [p.key, p.version]), [['terms', 3]]);
  });
});

describe('5. agreeing', () => {
  test('records the newest versions and returns what is left', async () => {
    const db = docsDb(V1);
    const left = await legal.accept(db, { userId: 9, roles: ['customer'], documentIds: [1, 2], ip: '1.2.3.4', userAgent: 'test' });
    assert.deepEqual(left, []);
    assert.equal(db.inserted.length, 2);
    assert.ok(db.seen.some((q) => q.sql.includes('ON CONFLICT (user_id, document_id) DO NOTHING')));
  });

  test('an old version is refused with PRECONDITION_CHANGED', async () => {
    const docs = { ...V1, terms: [...V1.terms, { id: 4, version: 2, requires_reacceptance: true }] };
    await assert.rejects(legal.accept(docsDb(docs), { userId: 9, roles: ['customer'], documentIds: [1] }), (e) => e.code === 'PRECONDITION_CHANGED');
  });

  test('a document that does not apply to the caller is refused', async () => {
    await assert.rejects(legal.accept(docsDb(V1), { userId: 9, roles: ['customer'], documentIds: [3] }), (e) => e.code === 'VALIDATION_FAILED');
  });

  test('nothing to agree to is refused', async () => {
    await assert.rejects(legal.accept(docsDb(V1), { userId: 9, roles: ['customer'], documentIds: [] }), (e) => e.code === 'VALIDATION_FAILED');
  });

  test('sign-up records the box only when it was ticked', () => {
    const ctrl = read('../src/controllers/auth.controller.ts');
    assert.match(ctrl, /if \(acceptLegal === true\) \{[\s\S]*?legalService\.acceptAtSignup\(/);
    assert.match(read('../src/routes/auth.routes.ts'), /accept_legal: \{ type: 'boolean', nullable: true \}/);
  });
});

describe('6. publishing', () => {
  const input = {
    base_version: 1,
    title_en: 'Terms of Use', title_bn: 'ব্যবহারের শর্তাবলি',
    body_en: 'x'.repeat(250), body_bn: 'য'.repeat(250),
    change_note_en: 'Clearer cash on delivery rules.', change_note_bn: 'ক্যাশ অন ডেলিভারির নিয়ম আরও স্পষ্ট।',
    requires_reacceptance: true,
  };
  const publishDb = (currentVersion) => {
    const db = fakeDb((sql, params) => {
      if (sql.startsWith('SELECT id, version, requires_reacceptance FROM legal_documents')) return { rows: currentVersion ? [{ id: 1, version: currentVersion, requires_reacceptance: true }] : [] };
      if (sql.startsWith('INSERT INTO legal_documents')) return { rows: [{ id: 9, doc_key: params[0], version: params[1], requires_reacceptance: params[8], published_at: 'now' }] };
      return { rows: [] };
    });
    db.connect = async () => db;
    return db;
  };

  test('publishes version N+1 under a lock and audits it as CRITICAL', async () => {
    const db = publishDb(1);
    const audits = [];
    const row = await legal.publishVersion(db, { record: async (_d, a) => audits.push(a) }, { key: 'terms', input, reason: 'Lawyer review edits', userId: 1 });
    assert.equal(row.version, 2);
    assert.ok(db.seen.some((q) => q.sql.includes('pg_advisory_xact_lock')));
    assert.ok(db.seen.some((q) => q.sql === 'COMMIT'));
    assert.equal(audits[0].action, 'platform.legal.publish');
    assert.equal(audits[0].targetRef, 'terms@2');
    assert.equal(audits[0].riskTier, 'CRITICAL');
  });

  test('a stale base version, a missing reason, short text or an unset re-accept choice is refused', async () => {
    await assert.rejects(legal.publishVersion(publishDb(2), null, { key: 'terms', input, reason: 'Lawyer review edits' }), (e) => e.code === 'PRECONDITION_CHANGED');
    await assert.rejects(legal.publishVersion(publishDb(1), null, { key: 'terms', input, reason: 'no' }), (e) => e.code === 'VALIDATION_FAILED');
    await assert.rejects(legal.publishVersion(publishDb(1), null, { key: 'terms', input: { ...input, body_en: 'short' }, reason: 'Lawyer review edits' }), (e) => e.details?.field === 'body_en');
    const { requires_reacceptance, ...noChoice } = input;
    await assert.rejects(legal.publishVersion(publishDb(1), null, { key: 'terms', input: noChoice, reason: 'Lawyer review edits' }), (e) => e.details?.field === 'requires_reacceptance');
    await assert.rejects(legal.publishVersion(publishDb(1), null, { key: 'nope', input, reason: 'Lawyer review edits' }), (e) => e.code === 'NOT_FOUND');
  });

  test('a stale publish rolls back and writes nothing', async () => {
    const db = publishDb(2);
    await assert.rejects(legal.publishVersion(db, null, { key: 'terms', input, reason: 'Lawyer review edits' }));
    assert.ok(db.seen.some((q) => q.sql === 'ROLLBACK'));
    assert.ok(!db.seen.some((q) => q.sql.startsWith('INSERT INTO legal_documents')));
  });
});

describe('7. route guards (through app.inject)', () => {
  async function app() {
    const a = Fastify();
    const db = fakeDb((sql) => (sql.includes('FROM legal_documents') ? { rows: [] } : { rows: [] }));
    a.decorate('db', db);
    a.decorate('authenticate', async (req, reply) => {
      const id = req.headers['x-user'];
      if (!id) return reply.code(401).send({ error: { code: 'AUTH_REQUIRED' } });
      req.user = { id: Number(id), roles: ['admin'] };
      req.userPermissions = new Set(String(req.headers['x-perms'] || '').split(',').filter(Boolean));
    });
    a.decorate('requirePermission', (perm) => async (req, reply) => {
      if (!req.userPermissions?.has(perm)) return reply.code(403).send({ error: { code: 'PERMISSION_DENIED' } });
    });
    await a.register(errorHandlerPlugin);
    await a.register(legalRoutes, { prefix: '/api/v1' });
    return a;
  }

  test('the admin overview needs platform.legal.view', async () => {
    const a = await app();
    assert.equal((await a.inject({ method: 'GET', url: '/api/v1/admin/platform/legal' })).statusCode, 401);
    assert.equal((await a.inject({ method: 'GET', url: '/api/v1/admin/platform/legal', headers: { 'x-user': '1' } })).statusCode, 403);
  });

  test('publishing and the company details need platform.legal.publish, view is not enough', async () => {
    const a = await app();
    const headers = { 'x-user': '1', 'x-perms': 'platform.legal.view' };
    // WHY a valid body: Fastify validates the body before the preHandler runs, so an empty one is a 400.
    const body = { base_version: 1, title_en: 'Terms', title_bn: 'শর্ত', body_en: 'x', body_bn: 'y', change_note_en: 'n', change_note_bn: 'n', requires_reacceptance: true, reason: 'Lawyer review edits' };
    const publish = await a.inject({ method: 'POST', url: '/api/v1/admin/platform/legal/terms/versions', headers, payload: body });
    assert.equal(publish.statusCode, 403);
    const company = await a.inject({ method: 'PUT', url: '/api/v1/admin/platform/legal/company', headers, payload: { reason: 'Registered the company' } });
    assert.equal(company.statusCode, 403);
  });

  test('the agreement endpoints need a sign-in; the documents do not', async () => {
    const a = await app();
    assert.equal((await a.inject({ method: 'GET', url: '/api/v1/me/legal/pending' })).statusCode, 401);
    assert.equal((await a.inject({ method: 'POST', url: '/api/v1/me/legal/accept', payload: { document_ids: [1] } })).statusCode, 401);
    assert.equal((await a.inject({ method: 'GET', url: '/api/v1/legal/documents' })).statusCode, 200);
    // An unknown key never reaches the service.
    assert.equal((await a.inject({ method: 'GET', url: '/api/v1/legal/documents/cookies' })).statusCode, 400);
  });
});
