/**
 * pageAccess.test.js — per-page availability governance (/admin/platform/pages).
 *
 * Covers the invariants the feature actually claims:
 *  1. The validation rules: the four states, the lock list, LIMITED needing an audience, and the
 *     mandatory reason — all in the SERVICE, not only in the route schema, so a caller that
 *     bypasses schema validation hits the same wall.
 *  2. A successful write takes the row lock, runs in ONE transaction, and leaves a single audit
 *     row carrying before and after — including the first write for a page, whose `before` must
 *     read LIVE rather than null.
 *  3. A rejected write mutates nothing and audits nothing.
 *  4. The lock list cannot be written to, so the super admin cannot park the screen that unparks.
 *  5. Resolution matches what the admin screen promises, including the super-admin bypass and
 *     LIMITED's role / user-id match.
 *  6. The public endpoint answers signed-out and degrades to "everything LIVE" when the table is
 *     unreadable, rather than blacking out the app.
 *  7. The route guards are the two catalog keys, and the write key is CRITICAL / not delegable.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import pageAccessRoutes from '../src/routes/pageAccess.routes.js';
import * as pageAccessService from '../src/services/pageAccess.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

/** A page_toggles + audit_logs stand-in that records BEGIN/COMMIT and FOR UPDATE locks. */
function createMockDb({ failReads = false, seed = [] } = {}) {
  const rows = new Map(seed.map((r) => [r.route_path, { allowed_roles: [], allowed_user_ids: [], ...r }]));
  const auditLog = [];
  const txnOps = [];
  let lockTaken = 0;

  const db = {
    rows,
    auditLog,
    txnOps,
    get lockTaken() {
      return lockTaken;
    },
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();

      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(q)) {
        txnOps.push(q.toUpperCase());
        return { rows: [] };
      }

      if (q.startsWith('SELECT') && q.includes('FROM page_toggles')) {
        if (failReads) throw new Error('relation "page_toggles" does not exist');
        if (q.includes('FOR UPDATE')) {
          lockTaken += 1;
          const row = rows.get(params[0]);
          return { rows: row ? [row] : [] };
        }
        const all = [...rows.values()];
        const filtered = q.includes("state <> 'LIVE'") ? all.filter((r) => r.state !== 'LIVE') : all;
        return { rows: filtered.sort((a, b) => a.route_path.localeCompare(b.route_path)) };
      }

      if (q.startsWith('INSERT INTO page_toggles')) {
        const [route_path, state, allowed_roles, allowed_user_ids, reason, updated_by] = params;
        const row = {
          route_path,
          state,
          allowed_roles: JSON.parse(allowed_roles),
          allowed_user_ids: JSON.parse(allowed_user_ids),
          reason,
          updated_by,
          updated_at: new Date().toISOString(),
        };
        rows.set(route_path, row);
        return { rows: [row] };
      }

      if (q.includes('INSERT INTO audit_logs')) {
        auditLog.push(params);
        return { rows: [{ id: auditLog.length }] };
      }

      // Anything else (the audit chain's prev-hash lookup, for instance) answers empty.
      return { rows: [] };
    },
  };

  return db;
}

/** Records one audit row, the same shape the real auditService.record leaves behind. */
function createAuditSpy() {
  const calls = [];
  return {
    calls,
    async record(_db, entry) {
      calls.push(entry);
    },
  };
}

const VALID = {
  route_path: '/supplier/warehouses',
  state: 'HIDDEN',
  reason: 'Warehouse routing is not released to suppliers yet',
};

/* ── 1. Validation lives in the service ─────────────────────────────────── */

describe('validateToggle', () => {
  test('accepts the four states and nothing else', () => {
    for (const state of pageAccessService.PAGE_STATES) {
      const toggle = { ...VALID, state };
      if (state === 'LIMITED') toggle.allowed_roles = ['supplier'];
      assert.equal(pageAccessService.validateToggle(toggle).state, state);
    }

    assert.throws(() => pageAccessService.validateToggle({ ...VALID, state: 'OFF' }), /state must be one of/);
  });

  test('rejects a path that is not absolute', () => {
    assert.throws(
      () => pageAccessService.validateToggle({ ...VALID, route_path: 'supplier/warehouses' }),
      /absolute path/
    );
    assert.throws(() => pageAccessService.validateToggle({ ...VALID, route_path: '' }), /absolute path/);
  });

  test('LIMITED without an audience is refused — that is what HIDDEN is for', () => {
    assert.throws(
      () => pageAccessService.validateToggle({ ...VALID, state: 'LIMITED' }),
      /at least one allowed role or user/
    );
    assert.doesNotThrow(() =>
      pageAccessService.validateToggle({ ...VALID, state: 'LIMITED', allowed_user_ids: [1024] })
    );
  });

  test('a reason of at least 10 characters is mandatory in the service, not only the schema', () => {
    assert.throws(() => pageAccessService.validateToggle({ ...VALID, reason: 'too short' }), /at least 10/);
    assert.throws(() => pageAccessService.validateToggle({ ...VALID, reason: undefined }), /at least 10/);
  });

  test('the audience is cleared on every state but LIMITED, so a stale rollout list cannot return', () => {
    const out = pageAccessService.validateToggle({
      ...VALID,
      state: 'HIDDEN',
      allowed_roles: ['supplier'],
      allowed_user_ids: [1024],
    });
    assert.deepEqual(out.allowed_roles, []);
    assert.deepEqual(out.allowed_user_ids, []);
  });

  test('user ids are normalised to strings, so a numeric id and a stored one compare equal', () => {
    const out = pageAccessService.validateToggle({
      ...VALID,
      state: 'LIMITED',
      allowed_user_ids: [1024, '2048'],
    });
    assert.deepEqual(out.allowed_user_ids, ['1024', '2048']);
  });

  test('trailing slashes are normalised, so one page cannot have two rows', () => {
    assert.equal(
      pageAccessService.validateToggle({ ...VALID, route_path: '/supplier/warehouses/' }).route_path,
      '/supplier/warehouses'
    );
  });
});

/* ── 2 & 4. The lock list ───────────────────────────────────────────────── */

describe('the lock list cannot be parked', () => {
  test('every locked path refuses any state but LIVE', () => {
    for (const locked of pageAccessService.LOCKED_PATHS) {
      assert.throws(
        () => pageAccessService.validateToggle({ ...VALID, route_path: locked, state: 'HIDDEN' }),
        /cannot be switched off/,
        `${locked} must be unparkable`
      );
      assert.doesNotThrow(() =>
        pageAccessService.validateToggle({ ...VALID, route_path: locked, state: 'LIVE' })
      );
    }
  });

  test('/admin/platform/pages is in the list, so the screen can always unpark a page', () => {
    assert.ok(pageAccessService.LOCKED_PATHS.includes('/admin/platform/pages'));
  });

  test('a refused write mutates nothing and audits nothing', async () => {
    const db = createMockDb();
    const audit = createAuditSpy();

    await assert.rejects(
      pageAccessService.setPageState(db, null, audit, {
        toggle: { ...VALID, route_path: '/login', state: 'HIDDEN' },
      }),
      /cannot be switched off/
    );

    assert.equal(db.rows.size, 0);
    assert.equal(audit.calls.length, 0);
    assert.deepEqual(db.txnOps, [], 'validation must fail before a transaction is opened');
  });
});

/* ── 3. The write ───────────────────────────────────────────────────────── */

describe('setPageState', () => {
  test('takes the row lock, commits once, and writes one audit row with before/after', async () => {
    const db = createMockDb();
    db.connect = async () => ({ ...db, query: db.query, release() {} });
    const audit = createAuditSpy();

    const { before, after } = await pageAccessService.setPageState(db, null, audit, {
      toggle: VALID,
      userId: 7,
      actorRole: 'super_admin',
    });

    assert.equal(db.lockTaken, 1, 'the row must be locked before it is read for the audit `before`');
    assert.deepEqual(db.txnOps, ['BEGIN', 'COMMIT']);

    assert.equal(
      before.state,
      'LIVE',
      'a page with no row IS LIVE — the first audit row must say so, not "null"'
    );
    assert.equal(after.state, 'HIDDEN');

    assert.equal(audit.calls.length, 1);
    const entry = audit.calls[0];
    assert.equal(entry.action, 'platform.page.toggle');
    assert.equal(entry.targetType, 'page_toggles');
    assert.equal(entry.targetRef, '/supplier/warehouses');
    assert.equal(entry.riskTier, 'CRITICAL');
    assert.equal(entry.actorId, 7);
    assert.equal(entry.beforeJson.state, 'LIVE');
    assert.equal(entry.afterJson.state, 'HIDDEN');
    assert.equal(entry.meta.reason, VALID.reason);
  });

  test('a LIMITED write stores its audience', async () => {
    const db = createMockDb();
    const audit = createAuditSpy();

    const { after } = await pageAccessService.setPageState(db, null, audit, {
      toggle: {
        route_path: '/supplier/warehouses',
        state: 'LIMITED',
        allowed_roles: ['supplier'],
        allowed_user_ids: [1024],
        reason: 'Piloting with two suppliers before the full release',
      },
      userId: 7,
    });

    assert.equal(after.state, 'LIMITED');
    assert.deepEqual(after.allowed_roles, ['supplier']);
    assert.deepEqual(after.allowed_user_ids, ['1024']);
  });

  test('a second write audits the real previous state', async () => {
    const db = createMockDb({
      seed: [{ route_path: '/supplier/warehouses', state: 'COMING_SOON', reason: 'earlier', updated_by: 1 }],
    });
    const audit = createAuditSpy();

    await pageAccessService.setPageState(db, null, audit, { toggle: VALID, userId: 7 });

    assert.equal(audit.calls[0].beforeJson.state, 'COMING_SOON');
    assert.equal(audit.calls[0].afterJson.state, 'HIDDEN');
  });
});

/* ── 5. Resolution ──────────────────────────────────────────────────────── */

describe('resolveState', () => {
  const map = {
    '/supplier/warehouses': { state: 'HIDDEN', allowed_roles: [], allowed_user_ids: [] },
    '/saler/live-studio': { state: 'COMING_SOON', allowed_roles: [], allowed_user_ids: [] },
    '/admin/growth/ads': { state: 'LIMITED', allowed_roles: ['admin'], allowed_user_ids: ['1024'] },
  };

  test('an absent row is LIVE', () => {
    assert.equal(pageAccessService.resolveState(map, '/cart', { roles: ['customer'] }), 'LIVE');
  });

  test('HIDDEN and COMING_SOON resolve to themselves', () => {
    assert.equal(pageAccessService.resolveState(map, '/supplier/warehouses', { roles: ['supplier'] }), 'HIDDEN');
    assert.equal(pageAccessService.resolveState(map, '/saler/live-studio', { roles: ['saler'] }), 'COMING_SOON');
  });

  test('LIMITED matches by role or by user id, and is HIDDEN otherwise', () => {
    assert.equal(pageAccessService.resolveState(map, '/admin/growth/ads', { roles: ['admin'] }), 'LIVE');
    assert.equal(
      pageAccessService.resolveState(map, '/admin/growth/ads', { roles: ['supplier'], userId: 1024 }),
      'LIVE'
    );
    assert.equal(
      pageAccessService.resolveState(map, '/admin/growth/ads', { roles: ['supplier'], userId: 9999 }),
      'HIDDEN'
    );
  });

  test('the super admin is never hidden from a page (they must be able to test it)', () => {
    assert.equal(
      pageAccessService.resolveState(map, '/supplier/warehouses', { roles: ['super_admin'] }),
      'LIVE'
    );
  });

  test('a locked path resolves LIVE even if a row somehow says otherwise', () => {
    assert.equal(
      pageAccessService.resolveState({ '/login': { state: 'HIDDEN' } }, '/login', { roles: ['customer'] }),
      'LIVE'
    );
  });
});

/* ── 6. The public endpoint ─────────────────────────────────────────────── */

describe('GET /page-access', () => {
  async function buildTestApp(db) {
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', null);
    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);
    await app.register(pageAccessRoutes, { prefix: '/api/v1' });
    await app.ready();
    return app;
  }

  test('answers a signed-out visitor with the parked rows only', async () => {
    const db = createMockDb({
      seed: [
        { route_path: '/supplier/warehouses', state: 'HIDDEN' },
        { route_path: '/cart', state: 'LIVE' },
      ],
    });
    const app = await buildTestApp(db);

    const res = await app.inject({ method: 'GET', url: '/api/v1/page-access' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(Object.keys(body.pages), ['/supplier/warehouses']);
    assert.equal(body.pages['/supplier/warehouses'].state, 'HIDDEN');
    assert.deepEqual(body.locked_paths, [...pageAccessService.LOCKED_PATHS]);

    await app.close();
  });

  test('degrades to "everything LIVE" when the table is unreadable, rather than 500ing', async () => {
    const app = await buildTestApp(createMockDb({ failReads: true }));

    const res = await app.inject({ method: 'GET', url: '/api/v1/page-access' });
    assert.equal(res.statusCode, 200, 'a failing page layer must not black out every page load');
    assert.deepEqual(res.json().pages, {});

    await app.close();
  });
});

/* ── 7. The guards ──────────────────────────────────────────────────────── */

describe('route guards and the permission catalog', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '../src/routes/pageAccess.routes.js'), 'utf8');

  test('the admin routes are guarded by the two catalog keys', () => {
    assert.match(routeSrc, /reqPerm\('platform\.page\.view'\)/);
    assert.match(routeSrc, /reqPerm\('platform\.page\.toggle'\)/);
  });

  test('the write key is CRITICAL and therefore not delegable', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'docs/permission-catalog.json'), 'utf8')
    );
    const byKey = new Map(catalog.permissions.map((p) => [p.key, p]));

    const toggle = byKey.get('platform.page.toggle');
    assert.ok(toggle, 'platform.page.toggle is missing from docs/permission-catalog.json');
    assert.equal(toggle.risk_tier, 'CRITICAL');
    assert.equal(toggle.delegable, false, 'CRITICAL implies not delegable — docs/rbac-spec.md §2');
    assert.deepEqual(toggle.default_roles, ['super_admin']);

    const view = byKey.get('platform.page.view');
    assert.ok(view);
    assert.equal(view.risk_tier, 'LOW');
    assert.equal(view.delegable, true);
  });

  test('the route path travels in the body, not the URL (a path is full of slashes)', () => {
    assert.match(routeSrc, /required: \['route_path', 'state', 'reason'\]/);
    assert.doesNotMatch(routeSrc, /\/admin\/pages\/:/);
  });

  test('the migration declares the table with the four-state CHECK', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/054_page_availability.sql'),
      'utf8'
    );
    assert.match(sql, /CREATE TABLE IF NOT EXISTS page_toggles/);
    assert.match(sql, /route_path\s+TEXT PRIMARY KEY/);
    for (const state of pageAccessService.PAGE_STATES) {
      assert.ok(sql.includes(`'${state}'`), `054_page_availability.sql does not allow ${state}`);
    }
  });

  test('the routes are registered on the app', () => {
    const appSrc = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
    assert.match(appSrc, /import pageAccessRoutes from '\.\/routes\/pageAccess\.routes\.js'/);
    assert.match(appSrc, /app\.register\(pageAccessRoutes, \{ prefix: '\/api\/v1' \}\)/);
  });
});
