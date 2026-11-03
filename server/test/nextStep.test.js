/**
 * nextStep.test.js — the Next-Step engine (Prompt 13.2).
 *
 * Invariants: the server's journey copy equals the client's, with each step's permission and module
 * taken from the page that completes it; every fact has a query; each role starts on its first step
 * and ends on its last; a step blocked on someone else shows the reason and no button; a step the
 * user's permissions refuse is never offered; an opted-out user gets nothing; a write clears the
 * cache.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import { JOURNEYS as SERVER_JOURNEYS, journeyFor } from '../src/config/journeys.ts';
import { FACT_QUERIES } from '../src/repositories/nextStep.repository.ts';
import {
  computeNextStep,
  getNextStep,
  invalidateOnWrite,
  nextStepCacheKey,
} from '../src/services/nextStep.service.ts';
import nextStepRoutes from '../src/routes/nextStep.routes.ts';
import errorHandlerPlugin from '../src/plugins/errorHandler.ts';
import { JOURNEYS as CLIENT_JOURNEYS, JOURNEY_FACTS, JOURNEY_ROLES, BLOCK_REASONS } from '../../client/src/config/journeys.ts';
import { navItems } from '../../client/src/config/navigation.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainTs = readFileSync(join(repo, 'client', 'src', 'main.ts'), 'utf8');

/** A route's module and permission as the client router registers it (for non-sidebar pages). */
function routerEntry(path) {
  const at = mainTs.indexOf(`path: '${path}'`);
  assert.ok(at >= 0, `router has no ${path}`);
  const chunk = mainTs.slice(at, at + 600);
  const permission = chunk.match(/permission:\s*(null|'([^']+)')/);
  const module = chunk.match(/module:\s*'([^']+)'/);
  return { permission: permission[1] === 'null' ? null : permission[2], module: module[1] };
}

const userFacts = Object.entries(FACT_QUERIES).filter(([, q]) => q.scope === 'user');
const sqlToFact = new Map(Object.entries(FACT_QUERIES).map(([fact, q]) => [q.sql, fact]));

/**
 * A database that answers the engine's own statements. `done` is the set of true facts; `state` sets
 * the block lookups and the opt-out.
 */
function fakeDb({ done = new Set(), state = {} } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      const fact = sqlToFact.get(sql);
      if (fact) return { rows: [{ done: done.has(fact) }] };
      if (sql.includes('show_next_steps FROM user_profiles')) {
        return { rows: state.optedOut ? [{ show_next_steps: false }] : [] };
      }
      if (sql.includes("status = 'VERIFIED'")) return { rows: [{ done: Boolean(state.kycVerified) }] };
      if (sql.includes("status = 'PENDING_APPROVAL'")) return { rows: [{ done: Boolean(state.productPending) }] };
      if (sql.includes('available_balance > 0')) return { rows: [{ done: Boolean(state.balance) }] };
      if (sql.includes('INSERT INTO user_profiles')) return { rows: [] };
      if (sql.includes('platform_modules')) return { rows: state.moduleRow ? [state.moduleRow] : [] };
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    },
  };
}

/** Grants every permission a role's journey needs unless `missing` names it. */
function deps({ role, missing = [], modulesOff = [] } = {}) {
  const permissions = new Set(journeyFor(role).map((s) => s.permission).filter((p) => p && !missing.includes(p)));
  return {
    resolvePermissions: async () => ({ permissions }),
    isEnabled: async (_db, _cache, key) => !modulesOff.includes(key),
  };
}

const user = (role, id = 42) => ({ id, roles: [role] });

describe('next step — journey copies', () => {
  test('the server copy equals the client copy step for step', () => {
    const strip = (s) => [s.role, s.id, s.order, s.route];
    assert.deepEqual(SERVER_JOURNEYS.map(strip), CLIENT_JOURNEYS.map(strip));
    for (const [i, srv] of SERVER_JOURNEYS.entries()) {
      const cli = CLIENT_JOURNEYS[i];
      assert.equal(srv.fact, cli.doneWhen, `${srv.role}.${srv.id} fact`);
      assert.deepEqual(srv.blockedBy, cli.blockedBy || [], `${srv.role}.${srv.id} blockedBy`);
      assert.deepEqual(srv.skipWhen, cli.skipWhen || [], `${srv.role}.${srv.id} skipWhen`);
    }
  });

  test("each step's permission and module are those of the page that completes it", () => {
    const bad = [];
    for (const s of SERVER_JOURNEYS) {
      const item = navItems.find((n) => n.path === s.route && (n.roles || [n.role]).includes(s.role));
      const expected = item ? { permission: item.permission, module: item.module } : routerEntry(s.route);
      if (s.permission !== expected.permission || s.module !== expected.module) {
        bad.push(`${s.role}.${s.id}: ${s.permission}/${s.module} != ${expected.permission}/${expected.module}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('every fact has exactly one query, scoped the way the client says', () => {
    assert.deepEqual(Object.keys(FACT_QUERIES).sort(), Object.keys(JOURNEY_FACTS).sort());
    for (const [fact, q] of Object.entries(FACT_QUERIES)) {
      assert.equal(q.scope, JOURNEY_FACTS[fact].scope, fact);
      // A platform fact must not bind the user id: pg refuses a parameter the statement never uses.
      assert.equal(q.sql.includes('$1'), q.scope === 'user', `${fact} parameter`);
    }
    assert.ok(userFacts.length > 0);
    // Two facts asking the same question would be two names for one thing; share the fact instead.
    assert.equal(sqlToFact.size, Object.keys(FACT_QUERIES).length, 'two facts share one query');
  });

  test('every block reason the engine can report is defined for the client', () => {
    for (const reason of ['kyc_review', 'product_review', 'waiting_for_buyer', 'waiting_for_delivery', 'balance_empty', 'no_permission']) {
      assert.ok(reason in BLOCK_REASONS, reason);
    }
  });
});

describe('next step — each role from first step to last', () => {
  for (const role of JOURNEY_ROLES) {
    test(`${role}: nothing done → step 1; all but the last done → the last; all done → none`, async () => {
      const steps = journeyFor(role);
      const fresh = await computeNextStep(fakeDb(), null, user(role), deps({ role }));
      assert.equal(fresh.journey, role);
      assert.equal(fresh.current.id, steps[0].id);
      assert.deepEqual(fresh.progress, { done: 0, total: steps.length });
      assert.equal(fresh.upcoming.length, steps.length - 1);

      const allButLast = new Set(steps.slice(0, -1).map((s) => s.fact));
      const last = steps[steps.length - 1];
      // The last step may share its fact with an earlier one only if it is a different fact.
      allButLast.delete(last.fact);
      const nearly = await computeNextStep(
        fakeDb({ done: allButLast, state: { kycVerified: true, balance: true } }),
        null,
        user(role),
        deps({ role })
      );
      assert.equal(nearly.current.id, last.id);
      assert.deepEqual(nearly.upcoming, []);

      const finished = await computeNextStep(fakeDb({ done: new Set(steps.map((s) => s.fact)) }), null, user(role), deps({ role }));
      assert.equal(finished.current, null);
      assert.deepEqual(finished.progress, { done: steps.length, total: steps.length });
    });
  }
});

describe('next step — the answer follows the data', () => {
  test('a fresh shop partner is told to verify KYC; once a KYC row exists, to name the store', async () => {
    const before = await computeNextStep(fakeDb({ done: new Set(['user.phone_verified']) }), null, user('saler'), deps({ role: 'saler' }));
    assert.equal(before.current.id, 'submit_kyc');
    assert.equal(before.current.route, '/seller/kyc');
    assert.equal(before.current.title_key, 'journey.saler.submit_kyc.title');

    const after = await computeNextStep(
      fakeDb({ done: new Set(['user.phone_verified', 'kyc.submitted']) }),
      null,
      user('saler'),
      deps({ role: 'saler' })
    );
    assert.equal(after.current.id, 'name_store');
    assert.equal(after.progress.done, 2);
  });

  test('a supplier waiting on KYC approval sees the reason and no button', async () => {
    const out = await computeNextStep(
      fakeDb({ done: new Set(['user.phone_verified', 'kyc.submitted']), state: { kycVerified: false } }),
      null,
      user('supplier'),
      deps({ role: 'supplier' })
    );
    assert.equal(out.current.id, 'add_product');
    assert.equal(out.current.status, 'blocked');
    assert.deepEqual(out.current.blocked_by, { reason: 'kyc_review', message_key: 'journey.block.kyc_review' });
    assert.equal(out.current.route, null);

    const approved = await computeNextStep(
      fakeDb({ done: new Set(['user.phone_verified', 'kyc.submitted']), state: { kycVerified: true } }),
      null,
      user('supplier'),
      deps({ role: 'supplier' })
    );
    assert.equal(approved.current.status, 'todo');
    assert.equal(approved.current.route, '/supplier/products');
  });

  test('with KYC switched off, the KYC step is gone and listing is not blocked', async () => {
    const out = await computeNextStep(
      fakeDb({ done: new Set(['user.phone_verified']) }),
      null,
      user('supplier'),
      deps({ role: 'supplier', modulesOff: ['supplier_verification'] })
    );
    assert.equal(out.current.id, 'add_product');
    assert.equal(out.current.status, 'todo');
    assert.equal(out.progress.total, journeyFor('supplier').length - 1);
  });

  test('waiting for a shopper keeps the page on offer; an empty vault does not', async () => {
    const salerDone = ['user.phone_verified', 'kyc.submitted', 'saler.store_named', 'saler.three_products', 'saler.link_created'];
    const waiting = await computeNextStep(fakeDb({ done: new Set(salerDone) }), null, user('saler'), deps({ role: 'saler' }));
    assert.equal(waiting.current.id, 'first_order');
    assert.equal(waiting.current.blocked_by.reason, 'waiting_for_buyer');
    assert.equal(waiting.current.route, '/saler/orders');

    const empty = await computeNextStep(
      fakeDb({ done: new Set([...salerDone, 'saler.order_received']), state: { balance: false } }),
      null,
      user('saler'),
      deps({ role: 'saler' })
    );
    assert.equal(empty.current.blocked_by.reason, 'balance_empty');
    assert.equal(empty.current.route, null);
  });

  test('a step the permissions refuse is never offered: blocked for a shopper-side role, left out for staff', async () => {
    const saler = await computeNextStep(
      fakeDb({ done: new Set(['user.phone_verified', 'kyc.submitted']) }),
      null,
      user('saler'),
      deps({ role: 'saler', missing: ['saler.store.manage'] })
    );
    assert.equal(saler.current.id, 'name_store');
    assert.equal(saler.current.blocked_by.reason, 'no_permission');
    assert.equal(saler.current.route, null);

    const moderator = await computeNextStep(
      fakeDb({ done: new Set(['staff.two_factor_enrolled']) }),
      null,
      user('moderator'),
      deps({ role: 'moderator', missing: ['moderation.product.approve'] })
    );
    assert.equal(moderator.current.id, 'decide_dispute');
    assert.equal(moderator.progress.total, 3);
    const offered = [moderator.current, ...moderator.upcoming];
    assert.ok(offered.every((s) => s.route === null || s.status === 'todo'));
  });

  test('an opted-out user gets nothing and no fact is queried', async () => {
    const db = fakeDb({ state: { optedOut: true } });
    const out = await computeNextStep(db, null, user('customer'), deps({ role: 'customer' }));
    assert.equal(out.enabled, false);
    assert.equal(out.reason, 'opted_out');
    assert.equal(out.current, null);
    assert.equal(db.calls.filter((c) => sqlToFact.has(c.sql)).length, 0);
  });

  test('a role without a journey gets journey null and no queries', async () => {
    const db = fakeDb();
    const out = await computeNextStep(db, null, user('finance'), deps({ role: 'finance' }));
    assert.equal(out.journey, null);
    assert.equal(db.calls.length, 0);
  });
});

function memoryCache() {
  const store = new Map();
  const sets = [];
  return {
    store,
    sets,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value, ttl) {
      sets.push({ key, ttl });
      store.set(key, value);
    },
    async del(key) {
      store.delete(key);
    },
  };
}

describe('next step — cache', () => {
  test('a second read is served from the cache for cache_seconds', async () => {
    const cache = memoryCache();
    const db = fakeDb({ state: { moduleRow: { key: 'guided_experience', settings_json: { cache_seconds: 45 } } } });
    const first = await getNextStep(db, cache, user('customer'), deps({ role: 'customer' }));
    const queries = db.calls.length;
    const second = await getNextStep(db, cache, user('customer'), deps({ role: 'customer' }));
    assert.deepEqual(second, first);
    assert.equal(db.calls.length, queries);
    assert.deepEqual(cache.sets, [{ key: nextStepCacheKey(42), ttl: 45 }]);
  });

  test('cache_seconds 0 turns caching off', async () => {
    const cache = memoryCache();
    const db = fakeDb({ state: { moduleRow: { settings_json: { cache_seconds: 0 } } } });
    await getNextStep(db, cache, user('customer'), deps({ role: 'customer' }));
    assert.equal(cache.sets.length, 0);
  });

  test('a successful write by the user clears their entry; reads and failures do not', async () => {
    const cache = memoryCache();
    const key = nextStepCacheKey(7);
    const req = (method) => ({ method, user: { id: 7 }, server: { cache } });
    const cases = [
      ['GET', 200, true],
      ['POST', 422, true],
      ['POST', 201, false],
      ['PUT', 200, false],
      ['DELETE', 204, false],
    ];
    for (const [method, statusCode, kept] of cases) {
      cache.store.set(key, '{}');
      // An onSend hook must hand the payload back unchanged, or the response body is lost.
      assert.equal(await invalidateOnWrite(req(method), { statusCode }, 'body'), 'body');
      assert.equal(cache.store.has(key), kept, `${method} ${statusCode}`);
    }
    // A guest write has no user id and must not throw.
    await invalidateOnWrite({ method: 'POST', server: { cache } }, { statusCode: 200 });
  });
});

describe('next step — HTTP', () => {
  async function appWith(db, { moduleOn = true } = {}) {
    const app = Fastify();
    app.decorate('db', db);
    app.decorate('cache', null);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 42, roles: ['customer'] };
    });
    app.decorate('requireModule', () => async (_req, reply) => {
      if (!moduleOn) return reply.status(403).send({ error: { code: 'MODULE_DISABLED' } });
    });
    app.register(errorHandlerPlugin);
    await app.register(nextStepRoutes, { prefix: '/api/v1/me' });
    await app.ready();
    return app;
  }

  test('the preference endpoints read and write the opt-out; a bad body is refused', async () => {
    const db = fakeDb();
    const app = await appWith(db);
    const read = await app.inject({ method: 'GET', url: '/api/v1/me/next-step/preference' });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json().data, { show_next_steps: true });

    const write = await app.inject({ method: 'PUT', url: '/api/v1/me/next-step/preference', payload: { show_next_steps: false } });
    assert.equal(write.statusCode, 200);
    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO user_profiles'));
    assert.deepEqual(insert.params, [42, false]);

    const bad = await app.inject({ method: 'PUT', url: '/api/v1/me/next-step/preference', payload: { show_next_steps: 'no' } });
    assert.equal(bad.statusCode, 400);
    await app.close();
  });

  test('with the module off the endpoint answers MODULE_DISABLED', async () => {
    const app = await appWith(fakeDb(), { moduleOn: false });
    const res = await app.inject({ method: 'GET', url: '/api/v1/me/next-step' });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'MODULE_DISABLED');
    await app.close();
  });
});
