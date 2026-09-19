/**
 * staffManagement.test.js — Staff Management API (Prompt 3.3): /api/v1/admin/staff*.
 *
 * Two layers:
 *  1. Pure unit tests (always run): phone/reason/provision validation and the idempotency helper.
 *  2. Integration tests against REAL PostgreSQL through the REAL app — real JWTs, real sessions,
 *     real requirePermission and maker-checker routing. These exist because the rules that matter
 *     here (the last-Super-Admin lock, atomic change + audit + session revoke, the roster CTE) live
 *     in SQL, and a string-matching fake database would happily pass a query Postgres rejects.
 *
 * The integration layer needs a migrated + seeded database and is skipped without one:
 *
 *   STAFF_TEST_DATABASE_URL=postgresql://…/a_scratch_db npm test -w server -- test/staffManagement.test.js
 *
 * Point it at a THROWAWAY database. It creates users, changes roles and suspends accounts, and it
 * temporarily suspends other Super Admins to construct the "only one left" situation.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/config/loadEnvFile.js';
import { normalisePhone, validateProvision, cleanReason } from '../src/services/staff.service.js';
import { runIdempotent, fingerprintOf } from '../src/lib/idempotency.js';
import { createMemoryCache } from '../src/config/cache-drivers/memory.js';

// ── 1. Pure unit tests ───────────────────────────────────────────────────────────────────────

describe('staff.service — pure helpers', () => {
  test('normalisePhone accepts the three Bangladeshi spellings and rejects the rest', () => {
    assert.equal(normalisePhone('01711000001'), '+8801711000001');
    assert.equal(normalisePhone('8801711000001'), '+8801711000001');
    assert.equal(normalisePhone('+880 1711-000001'), '+8801711000001');
    assert.equal(normalisePhone('(017) 11000001'), '+8801711000001');
    for (const bad of ['', null, '12345', '01099999999', '017110000012', '+8801711', '+919876543210']) {
      assert.equal(normalisePhone(bad), null, String(bad));
    }
  });

  test('cleanReason trims and enforces 3–300 characters, with a field-level error', () => {
    assert.equal(cleanReason('  ok!  '), 'ok!');
    for (const bad of [undefined, '', '  ', 'ab', 'x'.repeat(301)]) {
      assert.throws(() => cleanReason(bad), (e) => e.code === 'VALIDATION_FAILED' && e.details.field === 'reason' && Boolean(e.messageBn));
    }
  });

  test('validateProvision reports the first bad field and normalises the rest', () => {
    const ok = validateProvision({ full_name: '  Mahfuz   Rahman ', email: ' Mahfuz@Explooro.COM ', phone: '01799000111', role_key: 'moderator', department: ' Trust  &  Safety ' });
    assert.deepEqual(ok, { fullName: 'Mahfuz Rahman', email: 'mahfuz@explooro.com', phone: '+8801799000111', roleKey: 'moderator', department: 'Trust & Safety' });
    assert.equal(validateProvision({ ...base(), department: '' }).department, null);

    for (const [over, field] of [
      [{ full_name: ' ' }, 'full_name'],
      [{ full_name: 'x' }, 'full_name'],
      [{ email: 'nope' }, 'email'],
      [{ phone: '12345' }, 'phone'],
      [{ role_key: '' }, 'role_key'],
      [{ department: 'd'.repeat(121) }, 'department'],
    ]) {
      assert.throws(() => validateProvision({ ...base(), ...over }), (e) => e.code === 'VALIDATION_FAILED' && e.details.field === field, field);
    }
  });
});

function base() {
  return { full_name: 'Some Person', email: 'some@explooro.com', phone: '01799000111', role_key: 'editor' };
}

describe('idempotency helper', () => {
  test('no key: runs every time, never replays', async () => {
    const cache = createMemoryCache();
    let runs = 0;
    const exec = async () => ({ status: 201, body: { n: ++runs } });
    assert.equal((await runIdempotent(cache, { scope: 's', payload: 1 }, exec)).body.n, 1);
    assert.equal((await runIdempotent(cache, { scope: 's', payload: 1 }, exec)).body.n, 2);
  });

  test('same key + same payload replays the stored response without re-running', async () => {
    const cache = createMemoryCache();
    let runs = 0;
    const exec = async () => ({ status: 201, body: { n: ++runs } });
    const first = await runIdempotent(cache, { scope: 's', key: 'key-12345678', payload: { a: 1 } }, exec);
    const second = await runIdempotent(cache, { scope: 's', key: 'key-12345678', payload: { a: 1 } }, exec);
    assert.equal(runs, 1);
    assert.equal(first.replayed, false);
    assert.deepEqual([second.replayed, second.status, second.body], [true, 201, { n: 1 }]);
  });

  test('same key + different payload is refused, and scopes do not collide', async () => {
    const cache = createMemoryCache();
    const exec = async () => ({ status: 200, body: {} });
    await runIdempotent(cache, { scope: 'a', key: 'key-12345678', payload: 1 }, exec);
    await assert.rejects(runIdempotent(cache, { scope: 'a', key: 'key-12345678', payload: 2 }, exec), { code: 'IDEMPOTENCY_MISMATCH' });
    await runIdempotent(cache, { scope: 'b', key: 'key-12345678', payload: 2 }, exec); // other scope: fine
  });

  test('a failed request releases the key so it can be retried', async () => {
    const cache = createMemoryCache();
    let attempt = 0;
    const exec = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('boom');
      return { status: 200, body: { attempt } };
    };
    await assert.rejects(runIdempotent(cache, { scope: 's', key: 'key-12345678', payload: 1 }, exec), /boom/);
    assert.equal((await runIdempotent(cache, { scope: 's', key: 'key-12345678', payload: 1 }, exec)).body.attempt, 2);
  });

  test('a request still in flight is a conflict, and malformed keys are rejected', async () => {
    const cache = createMemoryCache();
    await cache.set('idem:s:key-12345678', JSON.stringify({ state: 'PENDING', fingerprint: fingerprintOf(1) }), 60);
    await assert.rejects(runIdempotent(cache, { scope: 's', key: 'key-12345678', payload: 1 }, async () => ({ status: 200, body: {} })), { code: 'CONFLICT' });
    for (const key of ['short', 'has space in it', 'x'.repeat(129)]) {
      await assert.rejects(runIdempotent(cache, { scope: 's', key, payload: 1 }, async () => ({ status: 200, body: {} })), { code: 'VALIDATION_FAILED' }, key);
    }
  });
});

// ── 2. Integration tests (real Postgres, real app) ───────────────────────────────────────────

const DB_URL = process.env.STAFF_TEST_DATABASE_URL;

describe('Staff Management API — integration', { skip: DB_URL ? false : 'set STAFF_TEST_DATABASE_URL to a migrated + seeded scratch database' }, () => {
  let app, pool, cfg, mockEmail;
  let generateRef, signAccessToken, createSession, randomUUID;

  const PREFIX = '/api/v1/admin/staff';
  const randomDigits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

  before(async () => {
    const { loadEnv } = await import('../src/config/env.js');
    const { buildApp } = await import('../src/app.js');
    const { createDbPool } = await import('../src/config/db.js');
    ({ generateRef } = await import('../src/lib/ref.js'));
    ({ signAccessToken } = await import('../src/lib/jwt.js'));
    ({ createSession } = await import('../src/repositories/user.repository.js'));
    ({ randomUUID } = await import('node:crypto'));
    ({ mockDriver: mockEmail } = await import('../src/integrations/email/index.js'));

    const base = loadEnv();
    cfg = { ...base, database: { ...base.database, url: DB_URL } };
    pool = createDbPool(cfg);
    app = await buildApp({ config: cfg, pool });
    await app.ready();
  });

  after(async () => {
    await app?.close(); // stops the schedulers and ends the pool
  });

  // ── fixtures ───────────────────────────────────────────────────────────────────────────────

  async function makeUser({ role = 'moderator', name, lastLogin = true, twoFactor = false, status = 'ACTIVE', extraRoles = [], department = null } = {}) {
    const n = randomDigits(8);
    const phone = `+88017${n}`;
    const email = `qa.${n}@staff-test.local`;
    const { rows } = await pool.query(
      `INSERT INTO users (ref, phone, email, status, last_login_at, is_phone_verified)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id, ref`,
      [generateRef('USR'), phone, email, status, lastLogin ? new Date() : null]
    );
    const id = Number(rows[0].id);
    await pool.query('INSERT INTO user_profiles (user_id, full_name, department) VALUES ($1, $2, $3)', [id, name ?? `QA ${role} ${n}`, department]);
    for (const key of [role, ...extraRoles]) {
      await pool.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = $2', [id, key]);
    }
    if (twoFactor) {
      await pool.query(`INSERT INTO staff_2fa (user_id, secret_encrypted, enrolled_at) VALUES ($1, 'x', now())`, [id]);
    }
    return { id, ref: rows[0].ref, phone, email, role };
  }

  async function login(user, roles) {
    const session = await createSession(pool, {
      userId: user.id, familyId: randomUUID(), ip: '127.0.0.1', userAgent: 'test',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const { token } = await signAccessToken({ userId: user.id, roles: roles ?? [user.role], sessionId: session.id }, cfg.auth.jwtSecret);
    return { token, sessionId: Number(session.id) };
  }

  const call = (method, path, { token, body, headers } = {}) =>
    app.inject({
      method,
      url: `${PREFIX}${path}`,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body !== undefined ? { payload: body } : {}),
    });

  const json = (res) => res.json();

  /** Suspends every other ACTIVE super admin for the duration of `fn`, so "only one left" is constructible. */
  async function withOnlyActiveSupers(keepIds, fn) {
    const { rows } = await pool.query(
      `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.key = 'super_admin'
        WHERE u.status = 'ACTIVE' AND u.last_login_at IS NOT NULL AND NOT (u.id = ANY($1::bigint[]))`,
      [keepIds]
    );
    const others = rows.map((r) => Number(r.id));
    await pool.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = ANY($1::bigint[])`, [others]);
    try {
      return await fn();
    } finally {
      await pool.query(`UPDATE users SET status = 'ACTIVE' WHERE id = ANY($1::bigint[])`, [others]);
    }
  }

  const auditRows = async (ref, action) =>
    (await pool.query(`SELECT * FROM audit_logs WHERE target_type = 'staff' AND target_ref = $1 ${action ? 'AND action = $2' : ''} ORDER BY id`, action ? [ref, action] : [ref])).rows;

  // ── access control ─────────────────────────────────────────────────────────────────────────

  test('requires a session, and the right permission for each verb', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const admin = await makeUser({ role: 'admin' });
    const mod = await makeUser({ role: 'moderator' });
    const target = await makeUser({ role: 'editor' });
    const [s, a, m] = [await login(superA), await login(admin), await login(mod)];

    assert.equal((await call('GET', '')).statusCode, 401, 'no token');
    assert.equal((await call('GET', '', { token: m.token })).statusCode, 403, 'a moderator holds no staff.account.view');
    assert.equal((await call('GET', '', { token: a.token })).statusCode, 200, 'an admin can read the roster');

    // The three CRITICAL verbs are Super-Admin-only; an Admin is refused outright, not deferred.
    const attempts = [
      ['POST', '', valid()],
      ['PATCH', `/${target.id}/role`, { role_key: 'admin', reason: 'because' }],
      ['PATCH', `/${target.id}/status`, { status: 'SUSPENDED', reason: 'because' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, { token: a.token, body });
      assert.equal(res.statusCode, 403, `${method} ${path}`);
    }
    assert.equal((await call('GET', `/${target.id}`, { token: s.token })).statusCode, 200);
  });

  function valid(over = {}) {
    // Random, not sequential: the scratch database outlives a run, and contact details are unique.
    return { full_name: 'Mahfuzur Rahman', email: `new.${randomDigits(10)}@staff-test.local`, phone: `018${randomDigits(8)}`, role_key: 'moderator', department: 'Compliance', ...over };
  }

  // ── roster ─────────────────────────────────────────────────────────────────────────────────

  test('roster: shape, staff-only membership, roles with permission counts, and vitals', async () => {
    const tag = `Rs${randomDigits(6)}`;
    const superA = await makeUser({ role: 'super_admin', twoFactor: true, name: `${tag} Owner` });
    const customerOnly = await makeUser({ role: 'customer', name: `${tag} Shopper` });
    const supplierAsMod = await makeUser({ role: 'moderator', extraRoles: ['supplier'], twoFactor: true, name: `${tag} Dual` });
    const { token } = await login(superA);

    // Scoped to this run's people: the scratch database accumulates staff across runs.
    const res = await call('GET', `?limit=50&q=${tag}`, { token });
    assert.equal(res.statusCode, 200);
    const body = json(res);
    const ids = new Set(body.staff.map((s) => s.id));

    assert.ok(ids.has(superA.id));
    assert.ok(!ids.has(customerOnly.id), 'a customer is not staff');
    assert.ok(ids.has(supplierAsMod.id), 'a moderator who is also a supplier is staff');
    assert.equal(body.staff.find((s) => s.id === supplierAsMod.id).role_key, 'moderator', 'shows the staff role, not the supplier one');

    const roleKeys = body.roles.map((r) => r.key);
    assert.deepEqual(roleKeys, ['super_admin', 'admin', 'editor', 'moderator'], 'highest level first, then by key');
    assert.ok(!roleKeys.includes('customer') && !roleKeys.includes('supplier'));
    const superRole = body.roles.find((r) => r.key === 'super_admin');
    const totalPerms = Number((await pool.query('SELECT COUNT(*) FROM permissions')).rows[0].count);
    assert.equal(superRole.permissions_count, totalPerms, 'super_admin holds every permission');
    assert.equal(superRole.privileged, true);
    assert.equal(body.roles.find((r) => r.key === 'moderator').privileged, false);
    assert.ok(body.roles.every((r) => r.permissions_count >= 0));

    const row = body.staff.find((s) => s.id === superA.id);
    assert.deepEqual(Object.keys(row).sort(), ['created_at', 'department', 'email', 'full_name', 'id', 'last_active_at', 'permissions_count', 'phone', 'ref', 'role_key', 'role_label_bn', 'role_label_en', 'status', 'two_factor_enabled'].sort());
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.two_factor_enabled, true);

    const everyone = json(await call('GET', '?limit=1', { token }));
    const v = everyone.vitals;
    assert.equal(v.total_staff, everyone.total, 'no filter: vitals total equals list total');
    assert.equal(body.vitals.total_staff, v.total_staff, 'a search does not change the vitals');
    // Independent recount straight from the tables, so the CTE is checked against something else.
    const { rows: [t] } = await pool.query(
      `SELECT COUNT(DISTINCT u.id)::int AS usable,
              COUNT(DISTINCT u.id) FILTER (WHERE s.enrolled_at IS NOT NULL)::int AS with_2fa
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.level >= 50
         LEFT JOIN staff_2fa s ON s.user_id = u.id
        WHERE u.status NOT IN ('SUSPENDED', 'BANNED') AND u.deleted_at IS NULL`
    );
    assert.equal(v.two_factor_pending, t.usable - t.with_2fa);
    assert.equal(v.two_factor_rate_pct, Math.round((t.with_2fa / t.usable) * 1000) / 10);
  });

  test('roster: filters, LIKE-escaped search, digit-only phone search, pagination and page clamping', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const tag = `Zq${Date.now() % 100000}`;
    const a = await makeUser({ role: 'editor', name: `${tag} Alpha`, department: `Ops ${tag}% Team`, twoFactor: true });
    const b = await makeUser({ role: 'moderator', name: `${tag} Beta`, lastLogin: false });
    const c = await makeUser({ role: 'moderator', name: `${tag} Gamma`, status: 'SUSPENDED' });
    const { token } = await login(superA);
    const list = async (qs) => json(await call('GET', `?limit=50&${qs}`, { token }));
    const names = (r) => r.staff.map((s) => s.full_name).sort();

    assert.deepEqual(names(await list(`q=${tag}`)), [`${tag} Alpha`, `${tag} Beta`, `${tag} Gamma`]);
    assert.deepEqual(names(await list(`q=${tag}&role=editor`)), [`${tag} Alpha`]);
    assert.deepEqual(names(await list(`q=${tag}&status=INVITED`)), [`${tag} Beta`], 'never signed in = INVITED');
    assert.deepEqual(names(await list(`q=${tag}&status=SUSPENDED`)), [`${tag} Gamma`]);
    assert.deepEqual(names(await list(`q=${tag}&two_factor=ENABLED`)), [`${tag} Alpha`]);
    assert.deepEqual(names(await list(`q=${tag}&two_factor=PENDING`)), [`${tag} Beta`, `${tag} Gamma`]);
    assert.equal(names(await list(`q=${tag}&status=ALL&role=ALL`)).length, 3, 'ALL means no filter');

        // If '%' were a wildcard, "<tag>%" would match all three people; escaped, only the one whose department holds a literal '%'.
    assert.deepEqual(names(await list(`q=${tag}%25`)), [`${tag} Alpha`], 'the percent sign is literal');
    assert.equal((await list('q=%25')).staff.every((s) => /%/.test(`${s.full_name}${s.email}${s.ref}${s.department ?? ''}`)), true, 'a bare "%" matches only literal percent signs');

    // Phone: "017…" and "+88017…" and bare digits all find the same person.
    const national = b.phone.replace('+880', '');
    for (const q of [b.phone, `0${national}`, national, national.slice(2, 9)]) {
      assert.ok((await list(`q=${encodeURIComponent(q)}`)).staff.some((s) => s.id === b.id), `phone query ${q}`);
    }

    // Pagination + clamping past the end.
    const p1 = json(await call('GET', `?q=${tag}&limit=2&page=1`, { token }));
    const p2 = json(await call('GET', `?q=${tag}&limit=2&page=2`, { token }));
    assert.deepEqual([p1.staff.length, p2.staff.length, p1.total, p1.total_pages], [2, 1, 3, 2]);
    const far = json(await call('GET', `?q=${tag}&limit=2&page=99`, { token }));
    assert.deepEqual([far.page, far.staff.length], [2, 1], 'a page past the end lands on the last real page');
    const none = json(await call('GET', '?q=no-such-person-xyz', { token }));
    assert.deepEqual([none.total, none.staff.length, none.total_pages, none.page], [0, 0, 1, 1]);
    assert.equal((await call('GET', '?limit=51', { token })).statusCode, 400, 'limit is capped by the schema');
    assert.equal((await call('GET', '?status=BOGUS', { token })).statusCode, 400);

    // Vitals ignore filters.
    assert.equal(p1.vitals.total_staff, (await list('')).vitals.total_staff);
    assert.ok(a && c);
  });

  // ── provisioning ───────────────────────────────────────────────────────────────────────────

  test('provision: creates an INVITED, un-enrolled staff member with role, department, audit row and invitation email', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const { token } = await login(superA);
    const before = json(await call('GET', '', { token })).vitals;
    mockEmail.clearSentEmails();

    const input = valid({ role_key: 'editor', department: '  Content   Team ' });
    const res = await call('POST', '', { token, body: input });
    assert.equal(res.statusCode, 201, res.body);
    const out = json(res);
    const s = out.staff;

    assert.equal(s.status, 'INVITED');
    assert.equal(s.two_factor_enabled, false);
    assert.equal(s.last_active_at, null);
    assert.equal(s.role_key, 'editor');
    assert.equal(s.phone, `+880${input.phone.slice(1)}`, 'stored as E.164');
    assert.equal(s.department, 'Content Team');
    assert.equal(s.email, input.email.toLowerCase());
    assert.match(s.ref, /^USR-[0-9A-Z]{8}$/);
    assert.equal(out.invite_sent, true);
    assert.ok(out.message_en && out.message_bn);

    const { rows: [u] } = await pool.query(`SELECT status, password_hash, last_login_at FROM users WHERE id = $1`, [s.id]);
    assert.deepEqual([u.status, u.password_hash, u.last_login_at], ['ACTIVE', null, null], 'no password, OTP sign-in, never signed in');
    const { rows: [ur] } = await pool.query(`SELECT assigned_by FROM user_roles WHERE user_id = $1`, [s.id]);
    assert.equal(Number(ur.assigned_by), superA.id, 'records who assigned the role');

    const [audit] = await auditRows(s.ref, 'staff.account.create');
    assert.equal(Number(audit.actor_id), superA.id);
    assert.equal(audit.risk_tier, 'CRITICAL');
    assert.deepEqual(audit.after_json, { role_key: 'editor', status: 'INVITED' });
    assert.ok(!JSON.stringify(audit).includes(input.email), 'no PII in the audit row');

    const mails = mockEmail.getSentEmails();
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, s.email);
    assert.match(mails[0].text, /OTP Sign In/);

    const after = json(await call('GET', '', { token })).vitals;
    assert.equal(after.total_staff, before.total_staff + 1);
    assert.equal(after.invited_staff, before.invited_staff + 1);
    assert.equal(after.active_staff, before.active_staff, 'an invitee is not "active"');
  });

  test('provision: field-level validation, duplicates on email and phone, and non-staff roles refused', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const existing = await makeUser({ role: 'editor' });
    const { token } = await login(superA);

    for (const [over, field] of [
      [{ full_name: ' ' }, 'full_name'],
      [{ email: 'nope' }, 'email'],
      [{ phone: '12345' }, 'phone'],
      [{ role_key: 'customer' }, 'role_key'],
      [{ role_key: 'no_such_role' }, 'role_key'],
    ]) {
      const res = await call('POST', '', { token, body: valid(over) });
      assert.equal(res.statusCode, 400, field);
      const e = json(res).error;
      assert.equal(e.code, 'VALIDATION_FAILED');
      assert.equal(e.details.field, field);
      assert.ok(e.message_bn);
    }

    const dupEmail = await call('POST', '', { token, body: valid({ email: existing.email.toUpperCase() }) });
    assert.equal(dupEmail.statusCode, 409);
    assert.equal(json(dupEmail).error.details.field, 'email');

    const dupPhone = await call('POST', '', { token, body: valid({ phone: `0${existing.phone.replace('+880', '')}` }) });
    assert.equal(dupPhone.statusCode, 409);
    assert.equal(json(dupPhone).error.details.field, 'phone');

    // Fastify's AJV strips keys the schema does not declare, so a smuggled field never reaches the
    // service: asking for `role_key: editor` plus a made-up privilege flag yields exactly an editor.
    const smuggled = await call('POST', '', { token, body: { ...valid({ role_key: 'editor' }), role: 'super_admin', is_super_admin: true } });
    assert.equal(smuggled.statusCode, 201);
    assert.equal(json(smuggled).staff.role_key, 'editor');
  });

  test('provision: a failing invitation email does not undo the committed, audited account', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const { token } = await login(superA);
    const original = app.emailSender;
    app.emailSender = async () => { throw new Error('smtp down'); };
    try {
      const res = await call('POST', '', { token, body: valid() });
      assert.equal(res.statusCode, 201);
      const out = json(res);
      assert.equal(out.invite_sent, false);
      assert.match(out.message_en, /could not be sent/);
      assert.equal(Number((await pool.query('SELECT COUNT(*) FROM users WHERE id = $1', [out.staff.id])).rows[0].count), 1);
      assert.equal((await auditRows(out.staff.ref, 'staff.account.create')).length, 1);
    } finally {
      app.emailSender = original;
    }
  });

  test('provision: Idempotency-Key replays instead of creating twice, and refuses a different payload', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const { token } = await login(superA);
    const key = `idem-${Date.now()}-abcdef`;
    const input = valid();

    const first = await call('POST', '', { token, body: input, headers: { 'idempotency-key': key } });
    const second = await call('POST', '', { token, body: input, headers: { 'idempotency-key': key } });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal(second.headers['idempotency-replayed'], 'true');
    assert.equal(first.headers['idempotency-replayed'], undefined);
    assert.equal(json(second).staff.id, json(first).staff.id);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM users WHERE email = $1', [input.email])).rows[0].count), 1);

    const different = await call('POST', '', { token, body: valid({ full_name: 'Someone Else' }), headers: { 'idempotency-key': key } });
    assert.equal(different.statusCode, 409);
    assert.equal(json(different).error.code, 'IDEMPOTENCY_MISMATCH');

    // A failed request frees the key.
    const badKey = `idem-bad-${Date.now()}-abc`;
    assert.equal((await call('POST', '', { token, body: valid({ email: 'nope' }), headers: { 'idempotency-key': badKey } })).statusCode, 400);
    assert.equal((await call('POST', '', { token, body: valid(), headers: { 'idempotency-key': badKey } })).statusCode, 201);

    assert.equal((await call('POST', '', { token, body: valid(), headers: { 'idempotency-key': 'short' } })).statusCode, 400, 'malformed key');
  });

  test('an invited member can really sign in through the existing OTP flow, becoming ACTIVE; a suspended one cannot', async (t) => {
    // The "Invited = active account that has never signed in" design only works if auth lets that
    // account through. Asserted against the real /auth endpoints instead of read off the code.
    const superA = await makeUser({ role: 'super_admin' });
    const { token } = await login(superA);
    const provision = async (role_key) => json(await call('POST', '', { token, body: valid({ role_key }) })).staff;
    const statusOf = async (id) => json(await call('GET', `/${id}`, { token })).staff;

    const otpFor = async (phone) => {
      const sent = await app.inject({ method: 'POST', url: '/api/v1/auth/send-otp', payload: { phone, purpose: 'LOGIN' } });
      assert.equal(sent.statusCode, 200, sent.body);
      return sent.json().meta?.otp_debug;
    };
    const verify = (phone, code) => app.inject({ method: 'POST', url: '/api/v1/auth/verify-otp', payload: { phone, purpose: 'LOGIN', code } });

    // An Admin holds MEDIUM+ permissions, so (with staff 2FA on) the first sign-in is a 2FA enrolment, not a session.
    const admin = await provision('admin');
    const adminCode = await otpFor(admin.phone);
    if (!adminCode) return t.skip('OTP is not echoed outside NODE_ENV=development');
    const adminSignIn = await verify(admin.phone, adminCode);
    if (cfg.auth.require2faForStaff) {
      assert.equal(adminSignIn.statusCode, 401, adminSignIn.body);
      const err = json(adminSignIn).error;
      assert.equal(err.code, 'TWO_FACTOR_REQUIRED');
      assert.equal(err.details.enrolled, false, 'told to enrol, not to enter a code it never had');
      assert.equal((await statusOf(admin.id)).status, 'INVITED', 'no session yet, so still invited');
    } else {
      assert.equal(adminSignIn.statusCode, 200);
    }

    // A Moderator holds only LOW permissions in the seed, so no 2FA gate: straight in — and the roster
    // sees it, because "invited" is derived from last_login_at rather than stored and left to go stale.
    const mod = await provision('moderator');
    assert.equal(mod.status, 'INVITED');
    const modSignIn = await verify(mod.phone, await otpFor(mod.phone));
    assert.equal(modSignIn.statusCode, 200, modSignIn.body);
    const after = await statusOf(mod.id);
    assert.equal(after.status, 'ACTIVE');
    assert.ok(after.last_active_at);
    assert.equal(json(await call('POST', `/${mod.id}/resend-invite`, { token })).error.details.reason, 'NOT_INVITED', 'no longer invitable');

    // Suspended: the same door is closed.
    await call('PATCH', `/${mod.id}/status`, { token, body: { status: 'SUSPENDED', reason: 'closing the door' } });
    const blocked = await verify(mod.phone, await otpFor(mod.phone));
    assert.equal(blocked.statusCode, 403);
    assert.equal(json(blocked).error.code, 'ACCOUNT_SUSPENDED');
  });

  // ── role changes ───────────────────────────────────────────────────────────────────────────

  test('role: swaps the staff role, keeps other roles, signs the member out, drops their cache, and audits before/after + reason', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const target = await makeUser({ role: 'moderator', extraRoles: ['supplier'] });
    const targetSession = await login(target);
    const { token } = await login(superA);

    const res = await call('PATCH', `/${target.id}/role`, { token, body: { role_key: 'editor', reason: '  Moving to catalog  ' } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(json(res).staff.role_key, 'editor');
    assert.equal(json(res).staff.permissions_count, json(await call('GET', '?limit=50', { token })).roles.find((r) => r.key === 'editor').permissions_count);

    const { rows: roles } = await pool.query(`SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.key`, [target.id]);
    assert.deepEqual(roles.map((r) => r.key), ['editor', 'supplier'], 'moderator replaced; supplier untouched');

    const { rows: [sess] } = await pool.query('SELECT revoked_at, revoked_reason FROM sessions WHERE id = $1', [targetSession.sessionId]);
    assert.ok(sess.revoked_at);
    assert.equal(sess.revoked_reason, 'role_changed');
    assert.equal((await call('GET', '', { token: targetSession.token })).statusCode, 401, 'the old token stops working immediately');

    const [audit] = await auditRows(target.ref, 'staff.role.assign');
    assert.deepEqual([audit.before_json, audit.risk_tier], [{ role_key: 'moderator' }, 'CRITICAL']);
    assert.deepEqual(audit.after_json, { role_key: 'editor', meta: { reason: 'Moving to catalog' } });
    assert.deepEqual(audit.undo_payload, { role_key: 'moderator' });
  });

  test('role: rejects no-ops, unknown/non-staff roles, unknown members, non-staff members, self, and missing reasons', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const target = await makeUser({ role: 'editor' });
    const customer = await makeUser({ role: 'customer' });
    const { token } = await login(superA);
    const patch = (id, body) => call('PATCH', `/${id}/role`, { token, body });

    const same = await patch(target.id, { role_key: 'editor', reason: 'no change' });
    assert.deepEqual([same.statusCode, json(same).error.details.field], [400, 'role_key']);
    for (const role_key of ['customer', 'nope']) {
      assert.equal((await patch(target.id, { role_key, reason: 'valid reason' })).statusCode, 400, role_key);
    }
    assert.equal((await patch(99999999, { role_key: 'admin', reason: 'valid reason' })).statusCode, 404);
    assert.equal((await patch(customer.id, { role_key: 'admin', reason: 'valid reason' })).statusCode, 404, 'a customer is not a staff member');

    const self = await patch(superA.id, { role_key: 'admin', reason: 'valid reason' });
    assert.equal(self.statusCode, 403);
    assert.equal(json(self).error.details.reason, 'SELF_ACTION');

    for (const body of [{ role_key: 'admin' }, { role_key: 'admin', reason: 'ab' }]) {
      const res = await patch(target.id, body);
      assert.deepEqual([res.statusCode, json(res).error.details.field], [400, 'reason']);
    }
    assert.equal((await call('PATCH', '/abc/role', { token, body: { role_key: 'admin', reason: 'valid reason' } })).statusCode, 400, 'non-numeric id');
    assert.equal((await pool.query(`SELECT r.key FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1`, [target.id])).rows[0].key, 'editor', 'nothing changed');
  });

  // ── the last-Super-Admin rule ──────────────────────────────────────────────────────────────

  test('the only active Super Admin can be neither demoted nor suspended — by anyone', async () => {
    const owner = await makeUser({ role: 'super_admin' });
    // An invited (never signed in) Super Admin can act but does not count as a working owner.
    const newcomer = await makeUser({ role: 'super_admin', lastLogin: false });
    const { token } = await login(newcomer);

    await withOnlyActiveSupers([owner.id], async () => {
      const demote = await call('PATCH', `/${owner.id}/role`, { token, body: { role_key: 'admin', reason: 'take over' } });
      assert.equal(demote.statusCode, 409);
      assert.equal(json(demote).error.details.reason, 'LAST_SUPER_ADMIN');
      assert.ok(json(demote).error.message_bn);

      const suspend = await call('PATCH', `/${owner.id}/status`, { token, body: { status: 'SUSPENDED', reason: 'take over' } });
      assert.equal(suspend.statusCode, 409);
      assert.equal(json(suspend).error.details.reason, 'LAST_SUPER_ADMIN');

      const vitals = json(await call('GET', '', { token })).vitals;
      assert.equal(vitals.privileged_roles_count, 1);
      const { rows: [u] } = await pool.query(`SELECT status FROM users WHERE id = $1`, [owner.id]);
      assert.equal(u.status, 'ACTIVE');
      assert.equal((await auditRows(owner.ref)).filter((r) => /assign|disable/.test(r.action)).length, 0, 'refusals are not audited as changes');
    });
  });

  test('two concurrent requests cannot both remove an admin: exactly one of {demote A, suspend B} wins — every round, either order', async () => {
    // A single run can pass by timing luck; this race was found the hard way. Alternate which request
    // is sent first, and repeat, so a lock that only usually works is caught.
    for (let round = 0; round < 8; round += 1) {
      const a = await makeUser({ role: 'super_admin' });
      const b = await makeUser({ role: 'super_admin' });
      const actor = await makeUser({ role: 'super_admin', lastLogin: false });
      const { token } = await login(actor);

      await withOnlyActiveSupers([a.id, b.id], async () => {
        const demoteA = () => call('PATCH', `/${a.id}/role`, { token, body: { role_key: 'admin', reason: `race ${round} a` } });
        const suspendB = () => call('PATCH', `/${b.id}/status`, { token, body: { status: 'SUSPENDED', reason: `race ${round} b` } });
        const results = await Promise.all(round % 2 ? [suspendB(), demoteA()] : [demoteA(), suspendB()]);

        assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409], `round ${round}`);
        const { rows } = await pool.query(
          `SELECT count(*)::int n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.key = 'super_admin'
            WHERE u.id = ANY($1::bigint[]) AND u.status = 'ACTIVE'`,
          [[a.id, b.id]]
        );
        assert.equal(rows[0].n, 1, `round ${round}: one Super Admin survives`);
      });
    }
  });

  // ── status ─────────────────────────────────────────────────────────────────────────────────

  test('status: suspend signs the member out; reactivate restores ACTIVE, or INVITED if they never signed in; illegal moves are 409', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const veteran = await makeUser({ role: 'moderator' });
    const newbie = await makeUser({ role: 'editor', lastLogin: false });
    const veteranSession = await login(veteran);
    const { token } = await login(superA);
    const setStatus = (id, status, reason = 'a good reason') => call('PATCH', `/${id}/status`, { token, body: { status, reason } });

    const sus = await setStatus(veteran.id, 'SUSPENDED');
    assert.equal(sus.statusCode, 200, sus.body);
    assert.equal(json(sus).staff.status, 'SUSPENDED');
    assert.equal((await pool.query('SELECT status FROM users WHERE id = $1', [veteran.id])).rows[0].status, 'SUSPENDED');
    assert.equal((await call('GET', '', { token: veteranSession.token })).statusCode, 401, 'signed out everywhere');
    assert.equal((await setStatus(veteran.id, 'SUSPENDED')).statusCode, 409, 'already suspended');

    assert.equal(json(await setStatus(veteran.id, 'ACTIVE')).staff.status, 'ACTIVE');
    assert.equal((await setStatus(veteran.id, 'ACTIVE')).statusCode, 409, 'only a suspended account can be reactivated');

    await setStatus(newbie.id, 'SUSPENDED');
    assert.equal(json(await setStatus(newbie.id, 'ACTIVE')).staff.status, 'INVITED', 'never signed in: back to invited');

    const audits = await auditRows(veteran.ref);
    assert.deepEqual(audits.map((r) => r.action), ['staff.account.disable', 'staff.account.enable']);
    assert.deepEqual([audits[0].before_json, audits[0].after_json.status], [{ status: 'ACTIVE' }, 'SUSPENDED']);

    const banned = await makeUser({ role: 'moderator', status: 'BANNED' });
    const ban = await setStatus(banned.id, 'ACTIVE');
    assert.equal(ban.statusCode, 409);
    assert.equal(json(ban).error.details.reason, 'ACCOUNT_BANNED', 'a Trust & Safety ban is not lifted from the staff page');

    const self = await setStatus(superA.id, 'SUSPENDED');
    assert.equal(self.statusCode, 403);
    assert.equal((await call('PATCH', `/${veteran.id}/status`, { token, body: { status: 'BANNED', reason: 'a good reason' } })).statusCode, 400);
    assert.equal((await setStatus(veteran.id, 'SUSPENDED', '')).statusCode, 400, 'reason required');
  });

  // ── 2FA reset ──────────────────────────────────────────────────────────────────────────────

  test('reset 2FA: a Super Admin resets directly — authenticator removed, sessions ended, audited as HIGH; a second reset is a 409', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const target = await makeUser({ role: 'moderator', twoFactor: true });
    const notEnrolled = await makeUser({ role: 'editor' });
    const targetSession = await login(target);
    const { token } = await login(superA);

    const res = await call('POST', `/${target.id}/reset-2fa`, { token, body: { reason: 'Lost phone' } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(json(res).staff.two_factor_enabled, false);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM staff_2fa WHERE user_id = $1', [target.id])).rows[0].count), 0);
    assert.equal((await call('GET', '', { token: targetSession.token })).statusCode, 401);

    const [audit] = await auditRows(target.ref, 'security.2fa.reset');
    assert.deepEqual([audit.risk_tier, audit.before_json, audit.after_json], ['HIGH', { two_factor_enabled: true }, { two_factor_enabled: false, meta: { reason: 'Lost phone' } }]);

    const again = await call('POST', `/${target.id}/reset-2fa`, { token, body: { reason: 'Again' } });
    assert.equal(again.statusCode, 409);
    assert.equal(json(again).error.details.reason, 'NOTHING_TO_RESET');
    assert.equal((await call('POST', `/${notEnrolled.id}/reset-2fa`, { token, body: { reason: 'nothing' } })).statusCode, 409);

    assert.equal((await call('POST', `/${target.id}/reset-2fa`, { token, body: {} })).statusCode, 400, 'reason required');
    assert.equal((await call('POST', `/${superA.id}/reset-2fa`, { token, body: { reason: 'my own' } })).statusCode, 403, 'not your own');
  });

  test('reset 2FA: a delegated Admin is deferred (202, nothing mutated) and a Super Admin approving executes it, crediting both', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const admin = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'moderator', twoFactor: true });
    const [s, a] = [await login(superA), await login(admin)];

    const deferred = await call('POST', `/${target.id}/reset-2fa`, { token: a.token, body: { reason: 'Locked out at the airport' } });
    assert.equal(deferred.statusCode, 202, deferred.body);
    const pending = json(deferred).deferred;
    assert.equal(pending.code, 'PERMISSION_PENDING_APPROVAL');
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM staff_2fa WHERE user_id = $1', [target.id])).rows[0].count), 1, 'nothing mutated yet');

    const decide = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/pending-actions/${pending.pending_action_id}`,
      headers: { authorization: `Bearer ${s.token}` },
      payload: { decision: 'APPROVE', note: 'verified by phone' },
    });
    assert.equal(decide.statusCode, 200, decide.body);

    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM staff_2fa WHERE user_id = $1', [target.id])).rows[0].count), 0, 'the approved reset ran');
    const [audit] = await auditRows(target.ref, 'security.2fa.reset');
    assert.equal(Number(audit.actor_id), admin.id, 'the requester is the actor');
    assert.equal(audit.after_json.meta.approved_by, superA.id, 'the approver is recorded');
    assert.equal(audit.after_json.meta.reason, 'Locked out at the airport');
    const { rows: [pa] } = await pool.query('SELECT status FROM pending_admin_actions WHERE id = $1', [pending.pending_action_id]);
    assert.equal(pa.status, 'APPLIED');
  });

  // ── re-invitation ──────────────────────────────────────────────────────────────────────────

  test('resend invite: only for members who have not signed in, audited, and capped at 3 per hour', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const invited = await makeUser({ role: 'editor', lastLogin: false });
    const active = await makeUser({ role: 'editor' });
    const { token } = await login(superA);
    mockEmail.clearSentEmails();

    const notInvited = await call('POST', `/${active.id}/resend-invite`, { token });
    assert.equal(notInvited.statusCode, 409);
    assert.equal(json(notInvited).error.details.reason, 'NOT_INVITED');

    for (let i = 0; i < 3; i += 1) {
      const ok = await call('POST', `/${invited.id}/resend-invite`, { token });
      assert.equal(ok.statusCode, 200, ok.body);
    }
    assert.equal(mockEmail.getSentEmails().filter((m) => m.to === invited.email).length, 3);
    const limited = await call('POST', `/${invited.id}/resend-invite`, { token });
    assert.equal(limited.statusCode, 429);
    assert.ok(json(limited).error.details.retry_after_s > 0);
    assert.equal(mockEmail.getSentEmails().filter((m) => m.to === invited.email).length, 3, 'the capped request sent nothing');
    assert.equal((await auditRows(invited.ref, 'staff.account.reinvite')).length, 3);
  });

  // ── detail + history ───────────────────────────────────────────────────────────────────────

  test('detail: returns the member with a newest-first change history carrying actor, reason and diff', async () => {
    const superA = await makeUser({ role: 'super_admin', name: 'Auditor One' });
    const target = await makeUser({ role: 'moderator', twoFactor: true });
    const { token } = await login(superA);

    await call('PATCH', `/${target.id}/role`, { token, body: { role_key: 'editor', reason: 'first change' } });
    await call('PATCH', `/${target.id}/status`, { token, body: { status: 'SUSPENDED', reason: 'second change' } });

    const res = await call('GET', `/${target.id}`, { token });
    assert.equal(res.statusCode, 200);
    const { staff, activity } = json(res);
    assert.equal(staff.id, target.id);
    assert.deepEqual(activity.map((a) => a.action), ['staff.account.disable', 'staff.role.assign']);
    assert.deepEqual(
      [activity[1].actor_name, activity[1].reason, activity[1].before, activity[1].after],
      ['Auditor One', 'first change', { role_key: 'moderator' }, { role_key: 'editor' }],
      'meta.reason is lifted out of `after`'
    );

    const customer = await makeUser({ role: 'customer' });
    assert.equal((await call('GET', `/${customer.id}`, { token })).statusCode, 404);
    assert.equal((await call('GET', '/99999999', { token })).statusCode, 404);
    assert.equal((await call('GET', '/abc', { token })).statusCode, 400);
  });

  // ── atomicity ──────────────────────────────────────────────────────────────────────────────

  test('atomicity: if the audit row cannot be written, the change is not made and nobody is signed out', async () => {
    const superA = await makeUser({ role: 'super_admin' });
    const target = await makeUser({ role: 'moderator' });
    const targetSession = await login(target);
    const { token } = await login(superA);

    // A test-only trigger that refuses the audit row for this one action.
    await pool.query(`
      CREATE OR REPLACE FUNCTION trg_test_block_role_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit unavailable (test)'; END; $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER trg_test_block_role_audit BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action = 'staff.role.assign') EXECUTE FUNCTION trg_test_block_role_audit()`);
    try {
      const res = await call('PATCH', `/${target.id}/role`, { token, body: { role_key: 'editor', reason: 'should roll back' } });
      assert.equal(res.statusCode, 500);
      assert.ok(!res.body.includes('audit unavailable'), 'no internal detail leaks to the client');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_block_role_audit ON audit_logs');
      await pool.query('DROP FUNCTION IF EXISTS trg_test_block_role_audit()');
    }

    assert.equal((await pool.query(`SELECT r.key FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1`, [target.id])).rows[0].key, 'moderator', 'role unchanged');
    assert.equal((await pool.query('SELECT revoked_at FROM sessions WHERE id = $1', [targetSession.sessionId])).rows[0].revoked_at, null, 'session intact');
    assert.equal((await auditRows(target.ref, 'staff.role.assign')).length, 0);
  });
});
