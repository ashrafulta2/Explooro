/**
 * routeGuards.test.js — Guards against declarative route guards that nothing enforces.
 *
 * WHY this test exists: four routes in store.routes.js declared their gating as
 *   { config: { requireModule: 'virtual_storefront', requirePermission: 'saler.store.manage' } }
 * which reads like a guard and enforces nothing. Fastify stores `config` on `routeOptions.config`
 * for the handler to read; this server has no `onRoute` hook and no code that reads it, so those
 * four routes ran behind `authenticate` alone — any signed-in customer could read and write their
 * own saler storefront, with both modules switched off.
 *
 * The failure is silent by construction: the keys are spelled correctly, the route works, and only
 * a negative test (a user WITHOUT the permission getting a 200) would ever reveal it. So the check
 * here is structural — scan the route files and reject the shape itself.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROUTES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes');

const GUARD_KEYS = ['requireModule', 'requirePermission', 'requireRestriction'];

const FIX_HINT = [
  'Route guards must be real preHandler functions — nothing in this server reads',
  'routeOptions.config, so a guard declared inside a `config:` object is dead code and the route',
  'ends up open. Use the working pattern instead:',
  '',
  "    preHandler: [authenticate, app.requireModule('module_key'), app.requirePermission('domain.resource.action')]",
  '',
  'See server/src/routes/supplier.routes.js for an example, and',
  'server/src/middlewares/requireModule.js / requirePermission.js for the factories.',
].join('\n');

function routeFiles() {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, source: readFileSync(path.join(ROUTES_DIR, name), 'utf8') }));
}

/**
 * Strips line comments, block comments and string/template literals so a guard key mentioned in a
 * `// WHY:` note or a doc header is not mistaken for a declaration. Replaces each with spaces so
 * every surviving character keeps its original offset.
 */
function blankNonCode(source) {
  const out = source.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let j = from; j < to && j < out.length; j += 1) {
      if (out[j] !== '\n') out[j] = ' ';
    }
  };

  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      blank(i, end);
      i = end;
    } else if (two === '/*') {
      let end = source.indexOf('*/', i + 2);
      end = end === -1 ? source.length : end + 2;
      blank(i, end);
      i = end;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') j += 2;
        else if (source[j] === quote) break;
        else j += 1;
      }
      blank(i + 1, j);
      i = Math.min(j + 1, source.length);
    } else {
      i += 1;
    }
  }

  return out.join('');
}

/** Returns the `{...}` slice following each `config:` key, brace-matched. */
function configBlocks(code) {
  const blocks = [];
  const re = /\bconfig\s*:/g;
  let match;

  while ((match = re.exec(code)) !== null) {
    const open = code.indexOf('{', match.index + match[0].length);
    if (open === -1) continue;

    let depth = 0;
    let close = -1;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1;
      else if (code[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) continue;

    blocks.push({
      line: code.slice(0, match.index).split('\n').length,
      body: code.slice(open, close + 1),
    });
  }

  return blocks;
}

describe('Route guard enforcement (structural)', () => {
  test('no route declares a guard inside a `config:` object — nothing reads routeOptions.config', () => {
    const offenders = [];

    for (const { name, source } of routeFiles()) {
      const code = blankNonCode(source);
      for (const block of configBlocks(code)) {
        for (const key of GUARD_KEYS) {
          if (new RegExp(`\\b${key}\\s*:`).test(block.body)) {
            offenders.push(`server/src/routes/${name}:${block.line} — config: { ${key}: … }`);
          }
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `${offenders.length} dead route guard(s) found:\n  ${offenders.join('\n  ')}\n\n${FIX_HINT}`
    );
  });

  test('no route file uses a guard name as an object key anywhere — guards are called, not declared', () => {
    const offenders = [];

    for (const { name, source } of routeFiles()) {
      const code = blankNonCode(source);
      for (const key of GUARD_KEYS) {
        // `requireModule('key')` and `app.requireModule` are the real forms. `requireModule:` is
        // only ever a property declaration, and no property of that name is read anywhere.
        const re = new RegExp(`(^|[^.\\w])${key}\\s*:(?!:)`, 'gm');
        let match;
        while ((match = re.exec(code)) !== null) {
          offenders.push(
            `server/src/routes/${name}:${code.slice(0, match.index).split('\n').length} — ${key}:`
          );
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `${offenders.length} guard name(s) used as an object key:\n  ${offenders.join('\n  ')}\n\n${FIX_HINT}`
    );
  });

  test('every /saler/store route is gated by its module AND saler.store.manage via preHandler', async () => {
    const { default: storeRoutes } = await import('../src/routes/store.routes.js');

    const routes = [];
    const hooks = [];

    const makeInstance = () => {
      const instance = {
        authenticate: Object.assign(async () => {}, { guard: 'authenticate' }),
        requireModule: (key) => Object.assign(async () => {}, { guard: 'module', key }),
        requirePermission: (key) => Object.assign(async () => {}, { guard: 'permission', key }),
        addHook: (name, fn) => hooks.push({ name, fn }),
        register: async (plugin) => plugin(makeInstance()),
      };

      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        instance[method] = (url, optsOrHandler, maybeHandler) => {
          const opts = typeof optsOrHandler === 'function' ? {} : optsOrHandler || {};
          routes.push({
            method: method.toUpperCase(),
            url,
            preHandler: [].concat(opts.preHandler || []),
            config: opts.config,
            handler: maybeHandler || optsOrHandler,
          });
        };
      }

      return instance;
    };

    await storeRoutes(makeInstance());

    const expected = [
      { method: 'GET', url: '/saler/store', module: 'virtual_storefront' },
      { method: 'PUT', url: '/saler/store', module: 'virtual_storefront' },
      { method: 'PATCH', url: '/saler/store/status', module: 'physical_shop_status' },
      { method: 'PUT', url: '/saler/store/shelves', module: 'virtual_storefront' },
    ];

    // Every saler route the plugin registers must be one we expect to be gated — a new one added
    // without guards should fail here rather than slip through unnoticed.
    const salerRoutes = routes.filter((r) => r.url.startsWith('/saler/'));
    assert.equal(
      salerRoutes.length,
      expected.length,
      `Expected ${expected.length} /saler/* routes, found ${salerRoutes.length}: ` +
        `${salerRoutes.map((r) => `${r.method} ${r.url}`).join(', ')}. ` +
        'A new saler route needs its own expectation here, with real preHandler guards.'
    );

    for (const want of expected) {
      const route = salerRoutes.find((r) => r.method === want.method && r.url === want.url);
      assert.ok(route, `${want.method} ${want.url} is not registered`);

      const guards = route.preHandler.map((fn) => `${fn.guard}:${fn.key ?? ''}`);
      assert.ok(
        guards.includes(`module:${want.module}`),
        `${want.method} ${want.url} must be gated by requireModule('${want.module}') in its ` +
          `preHandler. Found [${guards.join(', ')}].\n\n${FIX_HINT}`
      );
      assert.ok(
        guards.includes('permission:saler.store.manage'),
        `${want.method} ${want.url} must be gated by requirePermission('saler.store.manage') in ` +
          `its preHandler. Found [${guards.join(', ')}].\n\n${FIX_HINT}`
      );
      assert.equal(route.config, undefined, `${want.method} ${want.url} still carries a dead config: block`);
    }

    // authenticate must still run for the whole saler scope.
    assert.ok(
      hooks.some((h) => h.name === 'onRequest' && h.fn.guard === 'authenticate'),
      'The saler store scope must still authenticate every request.'
    );
  });
});
