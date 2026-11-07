/**
 * flyerDesigns.test.js — saved Flyer Studio designs synced across devices (migration 110,
 * services/flyerDesign.service.ts, routes/flyerDesign.routes.ts).
 *
 * The routes run against an in-memory stand-in for flyer_saved_designs that applies the same rules
 * the SQL does (primary key per user+key, newest first, upsert vs insert-if-missing), so the
 * service's promises are checked end to end through HTTP: one person's list never shows another's,
 * a save past the limit drops the oldest, saving again moves a design to the top, a merge keeps
 * what the server had, and a malformed key is refused before it reaches the database.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.ts';
import errorHandlerPlugin, { AppError } from '../src/plugins/errorHandler.ts';
import flyerDesignRoutes from '../src/routes/flyerDesign.routes.ts';
import { SAVED_LIMIT, DESIGN_KEY_RE } from '../src/services/flyerDesign.service.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/** flyer_saved_designs in memory: rows of { user_id, design_key, created_at (ms) }. */
function createDb() {
  let rows = [];
  const sorted = (userId) => rows
    .filter((r) => r.user_id === userId)
    .sort((a, b) => b.created_at - a.created_at || a.design_key.localeCompare(b.design_key));
  const db = {
    rows: () => rows,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(q)) return { rows: [] };
      if (q.startsWith('SELECT design_key FROM flyer_saved_designs')) {
        return { rows: sorted(params[0]).slice(0, params[1]).map((r) => ({ design_key: r.design_key })) };
      }
      if (q.startsWith('INSERT INTO flyer_saved_designs')) {
        const [userId, keys, times] = params;
        const update = q.includes('DO UPDATE');
        keys.forEach((key, i) => {
          if (!DESIGN_KEY_RE.test(key)) throw new Error('CHECK violation');
          const existing = rows.find((r) => r.user_id === userId && r.design_key === key);
          if (existing) {
            if (update) existing.created_at = new Date(times[i]).getTime();
          } else {
            rows.push({ user_id: userId, design_key: key, created_at: new Date(times[i]).getTime() });
          }
        });
        return { rows: [] };
      }
      if (q.startsWith('DELETE FROM flyer_saved_designs WHERE user_id = $1 AND design_key = $2')) {
        rows = rows.filter((r) => !(r.user_id === params[0] && r.design_key === params[1]));
        return { rows: [] };
      }
      if (q.startsWith('DELETE FROM flyer_saved_designs WHERE user_id = $1 AND design_key NOT IN')) {
        const keep = new Set(sorted(params[0]).slice(0, params[1]).map((r) => r.design_key));
        rows = rows.filter((r) => r.user_id !== params[0] || keep.has(r.design_key));
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${q}`);
    },
    async connect() {
      return { query: (sql, params) => db.query(sql, params), release() {} };
    },
  };
  return db;
}

const key = (n, occasion = 'eid') => `${occasion}.hero_card.midnight.dots.${n % 5}`.replace('midnight', `p${n}`);

describe('saved flyer designs', () => {
  let app;
  let db;
  let moduleOn = true;

  before(async () => {
    db = createDb();
    app = Fastify({ logger: false });
    app.decorate('db', db);
    app.decorate('authenticate', async (req) => {
      const id = Number(req.headers['x-user'] || 0);
      if (!id) throw new AppError('AUTH_REQUIRED', 'Sign in required.');
      req.user = { id, roles: ['saler'] };
    });
    app.decorate('requireModule', (moduleKey) => async (req, reply) => {
      req.requiredModule = moduleKey;
      if (!moduleOn) return reply.status(403).send({ error: { code: 'MODULE_DISABLED' } });
    });
    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    await app.register(flyerDesignRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  const call = (method, url, user, payload) => app.inject({ method, url: `/api/v1${url}`, headers: user ? { 'x-user': String(user) } : {}, payload });

  test('a new person has an empty list and is told the limit', async () => {
    const res = await call('GET', '/me/flyer-designs', 1);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().data, { keys: [], limit: SAVED_LIMIT });
  });

  test('signing in is required', async () => {
    const res = await call('GET', '/me/flyer-designs', 0);
    assert.equal(res.statusCode, 401);
  });

  test('the social kit module gates every endpoint', async () => {
    moduleOn = false;
    try {
      for (const [method, url] of [['GET', '/me/flyer-designs'], ['PUT', `/me/flyer-designs/${key(1)}`], ['DELETE', `/me/flyer-designs/${key(1)}`]]) {
        const res = await call(method, url, 1);
        assert.equal(res.statusCode, 403, `${method} ${url}`);
      }
      const res = await call('POST', '/me/flyer-designs/merge', 1, { keys: [] });
      assert.equal(res.statusCode, 403);
    } finally {
      moduleOn = true;
    }
  });

  test('a save lands at the top; saving again moves it back to the top', async () => {
    await call('PUT', `/me/flyer-designs/${key(1)}`, 2);
    await new Promise((r) => setTimeout(r, 2));
    await call('PUT', `/me/flyer-designs/${key(2)}`, 2);
    await new Promise((r) => setTimeout(r, 2));
    const res = await call('PUT', `/me/flyer-designs/${key(1)}`, 2);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().data.keys, [key(1), key(2)]);
  });

  test('one person never sees another person\'s designs', async () => {
    await call('PUT', `/me/flyer-designs/${key(9)}`, 3);
    const two = (await call('GET', '/me/flyer-designs', 2)).json().data.keys;
    const three = (await call('GET', '/me/flyer-designs', 3)).json().data.keys;
    assert.ok(!two.includes(key(9)));
    assert.deepEqual(three, [key(9)]);
  });

  test('unsaving removes only that design, and unsaving twice is harmless', async () => {
    const first = await call('DELETE', `/me/flyer-designs/${key(2)}`, 2);
    const again = await call('DELETE', `/me/flyer-designs/${key(2)}`, 2);
    assert.equal(first.statusCode, 200);
    assert.equal(again.statusCode, 200);
    assert.deepEqual(again.json().data.keys, [key(1)]);
  });

  test('past the limit the oldest design goes', async () => {
    const user = 4;
    for (let i = 0; i < SAVED_LIMIT + 3; i += 1) {
      // Distinct times without waiting: each save is a new Date(), so step the clock forward.
      await call('PUT', `/me/flyer-designs/${key(i, 'all')}`, user);
      db.rows().filter((r) => r.user_id === user && r.design_key === key(i, 'all')).forEach((r) => { r.created_at = i; });
    }
    const keys = (await call('GET', '/me/flyer-designs', user)).json().data.keys;
    assert.equal(keys.length, SAVED_LIMIT);
    assert.equal(keys[0], key(SAVED_LIMIT + 2, 'all'));
    assert.ok(!keys.includes(key(0, 'all')) && !keys.includes(key(2, 'all')));
    assert.equal(db.rows().filter((r) => r.user_id === user).length, SAVED_LIMIT, 'the extra rows are deleted, not just hidden');
  });

  test('a merge adds the device\'s designs on top, keeps the server\'s, and skips junk', async () => {
    const user = 5;
    await call('PUT', `/me/flyer-designs/${key(1, 'winter')}`, user);
    db.rows().forEach((r) => { if (r.user_id === user) r.created_at = 0; });
    const res = await call('POST', '/me/flyer-designs/merge', user, {
      keys: [key(7, 'puja'), 'not a key', key(1, 'winter'), key(8, 'puja'), key(7, 'puja')],
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().data.keys, [key(7, 'puja'), key(8, 'puja'), key(1, 'winter')]);
  });

  test('a malformed key is refused before it reaches the database', async () => {
    for (const bad of ['eid.hero_card', 'EID.hero.mid.dots.1', 'eid.hero.mid.dots.123', "eid.a.b.c.1'--"]) {
      const res = await call('PUT', `/me/flyer-designs/${encodeURIComponent(bad)}`, 6);
      assert.equal(res.statusCode, 400, bad);
      assert.equal(res.json().error.code, 'VALIDATION_FAILED');
    }
    assert.equal(db.rows().filter((r) => r.user_id === 6).length, 0);
  });

  test('the service\'s key rule and the table\'s CHECK are the same pattern', () => {
    const sql = fs.readFileSync(path.join(here, '../src/db/migrations/110_flyer_saved_designs.sql'), 'utf8');
    const check = sql.match(/design_key ~ '([^']+)'/)[1];
    assert.equal(check, DESIGN_KEY_RE.source);
  });

  test('every key the client library can make fits the server\'s rule', async () => {
    const lib = await import('../../client/src/config/flyerTemplates.ts');
    for (const occ of lib.OCCASIONS) {
      for (let i = 0; i < lib.designCount(occ); i += 97) {
        const k = lib.designKey(lib.designAt(occ, i));
        assert.match(k, DESIGN_KEY_RE, k);
      }
    }
  });
});
