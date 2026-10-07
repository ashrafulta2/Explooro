/**
 * requirePage.test.js — server-side enforcement of page availability (traceability row 92).
 *
 * The page toggle layer began as visibility only: the client hid a parked page, and its API kept
 * answering. These tests cover the guard that closes that gap for endpoints a single page owns.
 *
 *  1. The declarative convention has a READER and it runs. This repo already had a case of
 *     `config: { requireModule, requirePermission }` sitting on four routes with nothing anywhere
 *     reading it, so the guards silently did nothing for as long as nobody looked. A test that
 *     only asserted the key was present would have passed on those routes too — so every test
 *     here goes through app.inject() and checks the status code.
 *  2. The four states resolve for the caller, not globally: LIMITED must let its audience through
 *     and refuse everyone else, which is only possible if the guard runs AFTER authenticate.
 *  3. It fails OPEN. A page layer that failed closed would turn one database blip into a
 *     platform-wide 403.
 *  4. Declared page paths cannot drift away from the client's route table, and are never a locked
 *     path — a guard on a locked path is permanently dead code.
 *  5. The 56 real wired endpoints carry the guard, and carry it LAST in their preHandler chain.
 *     The suites before this one run against a synthetic route, which proves the mechanism and
 *     not the wiring; a `config: { page }` typed into the wrong object literal would pass every
 *     source-text check and still guard nothing.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import requirePagePlugin from '../src/middlewares/requirePage.js';
import { LOCKED_PATHS } from '../src/services/pageAccess.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

/** A page_toggles stand-in: only listParkedPages is on the guard's read path. */
function createMockDb({ failReads = false, seed = [] } = {}) {
  return {
    async query(sql) {
      if (failReads) throw new Error('relation "page_toggles" does not exist');
      if (sql.includes('FROM page_toggles')) {
        return { rows: seed.map((r) => ({ allowed_roles: [], allowed_user_ids: [], ...r })) };
      }
      return { rows: [] };
    },
  };
}

/**
 * An app shaped like the real one: the plugin is registered before the routes, so its onRoute hook
 * is the only thing attaching the guard — exactly as in src/app.js. `user` is applied by a route
 * preHandler, which is what makes the ordering assertion meaningful.
 */
async function buildApp({ db, user = null } = {}) {
  const app = Fastify();
  app.decorate('db', db ?? createMockDb());
  app.decorate('cache', null);
  await app.register(requirePagePlugin);

  const attachUser = async (req) => {
    if (user) req.user = user;
  };

  app.get('/guarded', { config: { page: '/supplier/inventory' }, preHandler: [attachUser] }, async () => ({ ok: true }));

  // preHandler as a bare function rather than an array: appending must not drop it.
  app.get('/guarded-single', { config: { page: '/supplier/inventory' }, preHandler: attachUser }, async (req) => ({
    sawUser: Boolean(req.user),
  }));

  // No config.page at all: the hook must leave this route exactly as it was.
  app.get('/open', async () => ({ ok: true }));

  await app.ready();
  return app;
}

const parked = (state, extra = {}) => [{ route_path: '/supplier/inventory', state, ...extra }];

/* ── 1. The reader exists and runs ──────────────────────────────────────── */

describe('the config.page reader', () => {
  test('refuses a HIDDEN page with 403 PAGE_UNAVAILABLE', async () => {
    const app = await buildApp({ db: createMockDb({ seed: parked('HIDDEN') }) });

    const res = await app.inject({ method: 'GET', url: '/guarded' });
    assert.equal(res.statusCode, 403, 'a declared config.page that does nothing is the defect this test exists for');
    const body = res.json();
    assert.equal(body.error.code, 'PAGE_UNAVAILABLE');
    assert.equal(body.error.page, '/supplier/inventory');
    assert.equal(body.error.page_state, 'HIDDEN');
    assert.ok(body.error.message_bn, 'the error envelope carries both languages');

    await app.close();
  });

  test('lets a LIVE page through', async () => {
    const app = await buildApp({ db: createMockDb({ seed: [] }) });

    const res = await app.inject({ method: 'GET', url: '/guarded' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });

    await app.close();
  });

  test('reports COMING_SOON separately from HIDDEN', async () => {
    const app = await buildApp({ db: createMockDb({ seed: parked('COMING_SOON') }) });

    const res = await app.inject({ method: 'GET', url: '/guarded' });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.page_state, 'COMING_SOON');
    assert.match(res.json().error.message_en, /not released/);

    await app.close();
  });

  test('leaves a route without config.page alone, even while that page is parked', async () => {
    const app = await buildApp({ db: createMockDb({ seed: parked('HIDDEN') }) });

    const res = await app.inject({ method: 'GET', url: '/open' });
    assert.equal(res.statusCode, 200, 'the hook must only touch routes that opted in');

    await app.close();
  });

  test('keeps a preHandler that was a bare function rather than an array', async () => {
    const app = await buildApp({
      db: createMockDb({ seed: [] }),
      user: { id: 7, roles: ['supplier'] },
    });

    const res = await app.inject({ method: 'GET', url: '/guarded-single' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { sawUser: true }, 'appending the guard must not clobber the route’s own guard');

    await app.close();
  });
});

/* ── 2. Resolution is per caller, which needs the guard to run after auth ── */

describe('per-viewer resolution', () => {
  test('LIMITED admits a listed role and refuses everyone else', async () => {
    const seed = parked('LIMITED', { allowed_roles: ['supplier'] });

    const allowed = await buildApp({ db: createMockDb({ seed }), user: { id: 1, roles: ['supplier'] } });
    const res1 = await allowed.inject({ method: 'GET', url: '/guarded' });
    assert.equal(res1.statusCode, 200, 'the guard runs after the route preHandler, so req.user is set');
    await allowed.close();

    const refused = await buildApp({ db: createMockDb({ seed }), user: { id: 2, roles: ['customer'] } });
    const res2 = await refused.inject({ method: 'GET', url: '/guarded' });
    assert.equal(res2.statusCode, 403);
    assert.equal(res2.json().error.page_state, 'HIDDEN', 'LIMITED collapses to HIDDEN for a viewer outside the audience');
    await refused.close();
  });

  test('LIMITED admits a listed user id, whichever type JSON gave it as', async () => {
    const seed = parked('LIMITED', { allowed_user_ids: ['42'] });
    const app = await buildApp({ db: createMockDb({ seed }), user: { id: 42, roles: ['customer'] } });

    assert.equal((await app.inject({ method: 'GET', url: '/guarded' })).statusCode, 200);

    await app.close();
  });

  test('a super admin is never refused, so they can test what they parked', async () => {
    const app = await buildApp({
      db: createMockDb({ seed: parked('HIDDEN') }),
      user: { id: 1, roles: ['super_admin'] },
    });

    assert.equal((await app.inject({ method: 'GET', url: '/guarded' })).statusCode, 200);

    await app.close();
  });

  test('a signed-out caller is refused a HIDDEN page', async () => {
    const app = await buildApp({ db: createMockDb({ seed: parked('HIDDEN') }) });

    assert.equal((await app.inject({ method: 'GET', url: '/guarded' })).statusCode, 403);

    await app.close();
  });
});

/* ── 3. Fails open ──────────────────────────────────────────────────────── */

describe('degradation', () => {
  test('an unreadable page_toggles table leaves every endpoint open', async () => {
    const app = await buildApp({ db: createMockDb({ failReads: true }) });

    const res = await app.inject({ method: 'GET', url: '/guarded' });
    assert.equal(res.statusCode, 200, 'failing closed would turn one database blip into a platform-wide 403');

    await app.close();
  });
});

/* ── 4. The declarations cannot drift ───────────────────────────────────── */

describe('declared pages', () => {
  const routesDir = path.join(repoRoot, 'server/src/routes');

  /** Every `config: { page: '...' }` in the route layer, with the file it came from. */
  function declaredPages() {
    const found = [];
    for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(routesDir, file), 'utf8');
      for (const m of src.matchAll(/config:\s*\{[^}]*\bpage:\s*'([^']+)'/g)) {
        found.push({ file, page: m[1] });
      }
    }
    return found;
  }

  test('there is at least one, or this whole file is testing nothing', () => {
    assert.ok(declaredPages().length > 0);
  });

  test('every declared page is a real route in the client', () => {
    const mainSrc = read('client/src/main.js');
    const clientPaths = new Set([...mainSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]));

    for (const { file, page } of declaredPages()) {
      assert.ok(
        clientPaths.has(page),
        `${file} guards "${page}", which is not a route in client/src/main.js. A page path that no ` +
          'longer exists is a guard that can never fire and a page that can never be parked.'
      );
    }
  });

  test('no declared page is on the lock list', () => {
    for (const { file, page } of declaredPages()) {
      assert.ok(
        !LOCKED_PATHS.includes(page),
        `${file} guards "${page}", which is locked permanently LIVE — the guard can never fire.`
      );
    }
  });

  test('every declared page is an absolute path', () => {
    for (const { file, page } of declaredPages()) {
      assert.ok(page.startsWith('/'), `${file} declares a relative page path "${page}"`);
    }
  });
});

/* ── 5. The real route files actually carry the guard ───────────────────── */

/**
 * The suites above prove the mechanism on a synthetic route. This one proves it reached the real
 * ones: each wired route plugin is registered on an instance that has requirePagePlugin, and a
 * second onRoute hook — added after it, so it observes the mutation — reads back the preHandler
 * chain Fastify will actually run.
 *
 * Without this, a `config: { page }` typed into the wrong object literal would still satisfy the
 * source-text checks above and still guard nothing.
 */
describe('the wired route files', () => {
  const WIRED = [
    'adminAnalytics.routes.js',
    'ads.routes.js',
    'cartRecovery.routes.js',
    'delegation.routes.js',
    'finance.routes.js',
    'genie.routes.js',
    'localization.routes.js',
    'notification.routes.js',
    'publicApi.routes.js',
    'return.routes.js',
    'saler.routes.js',
    'subscription.routes.js',
    'supplier.routes.js',
  ];

  async function inspect(file) {
    const app = Fastify();
    app.decorate('db', createMockDb());
    app.decorate('cache', null);
    app.decorate('config', { core: {}, auth: {} });
    // The route files only need these to exist; what they do is irrelevant to the chain's shape.
    app.decorate('authenticate', async () => {});
    app.decorate('requirePermission', () => async () => {});
    app.decorate('requireModule', () => async () => {});
    app.decorate('requireRestriction', () => async () => {});

    await app.register(requirePagePlugin);

    const routes = [];
    app.addHook('onRoute', (ro) => {
      const chain = Array.isArray(ro.preHandler) ? ro.preHandler : ro.preHandler ? [ro.preHandler] : [];
      routes.push({
        method: ro.method,
        url: ro.url,
        page: ro.config?.page ?? null,
        guarded: chain.some((fn) => fn?.name === 'requirePagePreHandler'),
        guardIsLast: chain.length > 0 && chain[chain.length - 1]?.name === 'requirePagePreHandler',
      });
    });

    const mod = await import(`../src/routes/${file}`);
    await app.register(mod.default, { prefix: '/api/v1' });
    await app.ready();
    await app.close();
    return routes;
  }

  test('every route that declares a page gets the guard, last in the chain', async () => {
    let declared = 0;
    for (const file of WIRED) {
      const routes = await inspect(file);
      for (const r of routes) {
        if (!r.page) {
          assert.equal(r.guarded, false, `${file}: ${r.method} ${r.url} was guarded without declaring a page`);
          continue;
        }
        declared += 1;
        assert.ok(r.guarded, `${file}: ${r.method} ${r.url} declares page "${r.page}" but the guard was not attached`);
        assert.ok(
          r.guardIsLast,
          `${file}: ${r.method} ${r.url} runs the page guard before its own auth, so req.user would be empty`
        );
      }
    }
    assert.ok(declared >= 50, `expected the wired endpoints to be present, found ${declared}`);
  });
});

/* ── 6. Wired into the real app, in the only order that works ───────────── */

describe('registration', () => {
  test('the plugin is registered in app.js', () => {
    const appSrc = read('server/src/app.js');
    assert.match(appSrc, /import requirePagePlugin from '\.\/middlewares\/requirePage\.js'/);
    assert.match(appSrc, /app\.register\(requirePagePlugin\)/);
  });

  test('it is registered before any route plugin', () => {
    const appSrc = read('server/src/app.js');
    const pluginAt = appSrc.indexOf('app.register(requirePagePlugin)');
    const firstRouteAt = appSrc.indexOf('await app.register(authRoutes');

    assert.ok(pluginAt > -1 && firstRouteAt > -1);
    assert.ok(
      pluginAt < firstRouteAt,
      'onRoute only sees routes registered after the hook is added, so a plugin registered later ' +
        'would silently guard nothing'
    );
  });
});
