/**
 * pageAvailability.test.js — locks the invariants of the per-page availability layer.
 *
 * WHY each one exists:
 *
 *  1. Nav guard == route guard (docs/super-admin-audit.md §5 invariant 1). Sidebar.js,
 *     CommandPalette.js and core/router.js (through main.js) must all decide visibility with
 *     resolvePageAccess(), not with a copy of the rules. A second copy is how a page ends up
 *     hidden from the sidebar but still reachable by typing its name into the palette — the layer
 *     then looks like it works and does not.
 *
 *  2. The lock list is identical on both sides. A path the API accepts but the client refuses (or
 *     the reverse) is how an admin parks /admin/platform/pages and loses the only screen that can
 *     un-park it.
 *
 *  3. The four states resolve the way the screen promises, including the super-admin bypass and
 *     the LIMITED audience match. These are pure functions, so they are asserted directly rather
 *     than through the DOM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const {
  PAGE_STATES,
  LOCKED_PATHS,
  resolvePageAccess,
  isPageVisibleInNav,
  isLockedPath,
  normalizePath,
  setPageToggles,
} = await import('../src/services/pageAccess.js');

describe('page availability — the shared resolver is the only implementation', () => {
  it('Sidebar.js filters with resolvePageAccess, not its own rules', () => {
    const src = read('src/components/shell/Sidebar.js');
    assert.match(src, /import \{ resolvePageAccess \} from '\.\.\/\.\.\/services\/pageAccess\.js'/);
    assert.match(src, /resolvePageAccess\(item\.path, ctx\)/);
    // A literal state name anywhere else in the file means the rules were re-implemented.
    assert.equal(
      (src.match(/'LIMITED'/g) ?? []).length,
      0,
      'Sidebar.js must not reason about LIMITED itself — resolvePageAccess collapses it to LIVE/HIDDEN.'
    );
  });

  it('CommandPalette.js filters with the same resolver', () => {
    const src = read('src/components/shell/CommandPalette.js');
    assert.match(src, /import \{ isPageVisibleInNav \} from '\.\.\/\.\.\/services\/pageAccess\.js'/);
    assert.match(src, /isPageVisibleInNav\(item\.path, ctx\)/);
  });

  it('main.js hands the router that same resolver and a COMING_SOON page', () => {
    const src = read('src/main.js');
    assert.match(src, /resolvePageState: \(route, ctx\) => resolvePageAccess\(route\.path, ctx\)/);
    assert.match(src, /comingSoonRoute: \{ load: \(\) => import\('\.\/pages\/ComingSoonPage\.js'\) \}/);
    assert.match(src, /await initPageAccess\(\)/);
    assert.match(src, /registerPages\(allRoutes\)/);
  });

  it('the router checks page availability AFTER the permission and module guards', () => {
    const src = read('src/core/router.js');
    const guardAt = src.indexOf('const reason = guardFailure(');
    const pageAt = src.indexOf('pageState = resolvePageState(');
    assert.ok(guardAt > -1 && pageAt > -1);
    assert.ok(
      guardAt < pageAt,
      'a route the viewer could never reach must not be reported as "coming soon" — check the guards first'
    );
  });
});

describe('page availability — the lock list cannot drift between client and server', () => {
  it('client and server LOCKED_PATHS are identical', () => {
    const serverSrc = readFileSync(
      join(root, '..', 'server/src/services/pageAccess.service.js'),
      'utf8'
    );
    const block = serverSrc.match(/export const LOCKED_PATHS = Object\.freeze\(\[([^\]]*)\]\)/);
    assert.ok(block, 'LOCKED_PATHS not found in server/src/services/pageAccess.service.js');
    const serverPaths = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(
      serverPaths,
      [...LOCKED_PATHS],
      'A path one side refuses and the other accepts is a lockout waiting to happen.'
    );
  });

  it('client and server PAGE_STATES are identical', () => {
    const serverSrc = readFileSync(
      join(root, '..', 'server/src/services/pageAccess.service.js'),
      'utf8'
    );
    const block = serverSrc.match(/export const PAGE_STATES = Object\.freeze\(\[([^\]]*)\]\)/);
    assert.ok(block);
    const serverStates = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(serverStates, [...PAGE_STATES]);
  });

  it('the migration CHECK constraint allows exactly those four states', () => {
    const sql = readFileSync(
      join(root, '..', 'server/src/db/migrations/054_page_availability.sql'),
      'utf8'
    );
    for (const state of PAGE_STATES) {
      assert.ok(sql.includes(`'${state}'`), `054_page_availability.sql does not mention ${state}`);
    }
  });

  it('/admin/platform/pages locks itself, so a parked page can always be un-parked', () => {
    assert.ok(LOCKED_PATHS.includes('/admin/platform/pages'));
    assert.ok(LOCKED_PATHS.includes('/login'));
    assert.ok(LOCKED_PATHS.includes('/'));
  });

  it('a locked path resolves LIVE even when a toggle says otherwise', () => {
    setPageToggles({ '/admin/platform/pages': { state: 'HIDDEN' }, '/login': { state: 'HIDDEN' } });
    const ctx = { role: 'customer', roles: ['customer'], permissions: [] };
    assert.equal(resolvePageAccess('/admin/platform/pages', ctx), 'LIVE');
    assert.equal(resolvePageAccess('/login', ctx), 'LIVE');
    assert.ok(isLockedPath('/login/'));
    setPageToggles({});
  });
});

describe('page availability — the four states resolve as the screen promises', () => {
  const customer = { role: 'customer', roles: ['customer'], permissions: [] };
  const supplier = { role: 'supplier', roles: ['supplier'], permissions: [], user: { id: 1024 } };
  const superAdmin = { role: 'super_admin', roles: ['super_admin'], permissions: ['platform.page.toggle'] };

  it('a page with no stored row is LIVE', () => {
    setPageToggles({});
    assert.equal(resolvePageAccess('/supplier/warehouses', customer), 'LIVE');
    assert.ok(isPageVisibleInNav('/supplier/warehouses', customer));
  });

  it('HIDDEN is hidden from the nav; COMING_SOON stays in it', () => {
    setPageToggles({
      '/supplier/warehouses': { state: 'HIDDEN' },
      '/saler/live-studio': { state: 'COMING_SOON' },
    });
    assert.equal(resolvePageAccess('/supplier/warehouses', customer), 'HIDDEN');
    assert.equal(isPageVisibleInNav('/supplier/warehouses', customer), false);

    assert.equal(resolvePageAccess('/saler/live-studio', customer), 'COMING_SOON');
    assert.equal(
      isPageVisibleInNav('/saler/live-studio', customer),
      true,
      'COMING_SOON must stay in the nav — telling the user it is coming is the whole difference from HIDDEN'
    );
  });

  it('LIMITED is LIVE for a listed role and HIDDEN for everyone else', () => {
    setPageToggles({
      '/supplier/warehouses': { state: 'LIMITED', allowed_roles: ['supplier'], allowed_user_ids: [] },
    });
    assert.equal(resolvePageAccess('/supplier/warehouses', supplier), 'LIVE');
    assert.equal(resolvePageAccess('/supplier/warehouses', customer), 'HIDDEN');
  });

  it('LIMITED is LIVE for a listed user id even when their role is not listed', () => {
    setPageToggles({
      '/supplier/warehouses': { state: 'LIMITED', allowed_roles: [], allowed_user_ids: ['1024'] },
    });
    assert.equal(
      resolvePageAccess('/supplier/warehouses', supplier),
      'LIVE',
      '"later I may activate this feature for the related user" is the case this state exists for'
    );
    assert.equal(resolvePageAccess('/supplier/warehouses', { role: 'supplier', roles: ['supplier'], user: { id: 9999 } }), 'HIDDEN');
  });

  it('a numeric user id matches a stored string id', () => {
    setPageToggles({ '/x': { state: 'LIMITED', allowed_roles: [], allowed_user_ids: ['42'] } });
    assert.equal(resolvePageAccess('/x', { role: 'customer', user: { id: 42 } }), 'LIVE');
  });

  it('the super admin is never hidden from a page (they have to be able to test it)', () => {
    setPageToggles({ '/supplier/warehouses': { state: 'HIDDEN' } });
    assert.equal(resolvePageAccess('/supplier/warehouses', superAdmin), 'LIVE');
  });

  it('an unknown stored state degrades to LIVE rather than blacking the page out', () => {
    setPageToggles({ '/supplier/warehouses': { state: 'NONSENSE' } });
    assert.equal(resolvePageAccess('/supplier/warehouses', customer), 'LIVE');
  });

  it('trailing slashes do not create a second, unparked copy of a page', () => {
    setPageToggles({ '/supplier/warehouses': { state: 'HIDDEN' } });
    assert.equal(resolvePageAccess('/supplier/warehouses/', customer), 'HIDDEN');
    assert.equal(normalizePath('/supplier/warehouses/'), '/supplier/warehouses');
    assert.equal(normalizePath('/'), '/');
  });
});

describe('page availability — the admin surface is registered and guarded', () => {
  it('the nav item and the route agree on both guards', () => {
    const navSrc = read('src/config/navigation.js');
    const mainSrc = read('src/main.js');

    const navItem = navSrc.match(/\{ key: 'admin\.platform\.pages'[^}]*\}/);
    assert.ok(navItem, '/admin/platform/pages has no navigation.js entry');
    assert.match(navItem[0], /permission: 'platform\.page\.view'/);
    assert.match(navItem[0], /module: 'core'/);

    const routeBlock = mainSrc.match(/path: '\/admin\/platform\/pages',[\s\S]{0,400}?\},/);
    assert.ok(routeBlock, '/admin/platform/pages has no main.js route');
    assert.match(routeBlock[0], /permission: 'platform\.page\.view'/);
    assert.match(routeBlock[0], /module: 'core'/);
  });

  it('both new permission keys are declared in the catalog, not invented in code', async () => {
    const catalog = JSON.parse(readFileSync(join(root, '..', 'docs/permission-catalog.json'), 'utf8'));
    const byKey = new Map(catalog.permissions.map((p) => [p.key, p]));

    const view = byKey.get('platform.page.view');
    assert.ok(view, 'platform.page.view missing from docs/permission-catalog.json');
    assert.equal(view.risk_tier, 'LOW');
    assert.equal(view.delegable, true);

    const toggle = byKey.get('platform.page.toggle');
    assert.ok(toggle, 'platform.page.toggle missing from docs/permission-catalog.json');
    assert.equal(toggle.risk_tier, 'CRITICAL');
    assert.equal(
      toggle.delegable,
      false,
      'CRITICAL implies not delegable (docs/rbac-spec.md §2) — parking a page is a super-admin act'
    );
    assert.deepEqual(toggle.default_roles, ['super_admin']);
  });

  it('every new user-facing string is in BOTH locales', () => {
    const en = JSON.parse(read('src/locales/en.json'));
    const bn = JSON.parse(read('src/locales/bn.json'));
    assert.ok(en.page_availability, 'page_availability block missing from en.json');
    assert.ok(bn.page_availability, 'page_availability block missing from bn.json');
    assert.deepEqual(
      Object.keys(en.page_availability).sort(),
      Object.keys(bn.page_availability).sort()
    );
    assert.ok(en.nav.admin.pages && bn.nav.admin.pages);
    for (const state of PAGE_STATES) {
      const key = `state_${state.toLowerCase()}`;
      assert.ok(en.page_availability[key], `en.json is missing page_availability.${key}`);
      assert.ok(bn.page_availability[key], `bn.json is missing page_availability.${key}`);
    }
  });

  it('the page CSS is lazy-loaded, never imported into the entry bundle', () => {
    const pageSrc = read('src/pages/admin/PageAvailabilityPage.js');
    assert.match(pageSrc, /import\('\.\.\/\.\.\/styles\/components\/page-availability\.css'\)/);
    assert.doesNotMatch(
      pageSrc,
      /^import '.*page-availability\.css';$/m,
      'a static import would land this in the entry bundle, whose gzip budget is near its ceiling'
    );
    const mainCss = read('src/styles/main.css');
    assert.doesNotMatch(
      mainCss,
      /page-availability\.css/,
      'main.css must not import it — a stylesheet imported from both places ships twice'
    );
  });

  it('the component is registered in the dev gallery', () => {
    const registry = read('src/pages/dev/gallery-registry.js');
    assert.match(registry, /id: 'page-availability-row'/);
    assert.match(registry, /function renderPageAvailabilityRowSpecimen\(\)/);
  });
});

describe('mock mode serves the public endpoints the client boots from', () => {
  it('GET /modules has a handler (its absence reset every module toggle on reload)', () => {
    const handler = read('src/mocks/handlers/modules.js');
    assert.match(handler, /path: '\/modules'/);
    const index = read('src/mocks/index.js');
    assert.match(index, /moduleHandlers/);
    assert.match(index, /pageAccessHandlers/);
  });

  it('the mock module state is persisted, so a toggle survives a reload', () => {
    const state = read('src/mocks/moduleState.js');
    assert.match(state, /localStorage\.setItem/);
    assert.match(state, /export function persistModuleState/);
    const admin = read('src/mocks/handlers/admin.js');
    assert.match(admin, /persistModuleState\(\)/);
  });

  it('the mock page-access handlers exist and persist too', () => {
    const handler = read('src/mocks/handlers/pageAccess.js');
    assert.match(handler, /path: '\/page-access'/);
    assert.match(handler, /method: 'PUT',\s*path: '\/admin\/pages'/);
    assert.match(handler, /localStorage\.setItem/);
  });
});
