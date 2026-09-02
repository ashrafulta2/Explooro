/**
 * moderatorPages.test.js — Invariants for the Moderator role's surfaces.
 *
 * Each suite pins a defect that shipped to the Moderator shell, so a regression fails the build
 * rather than reaching a moderator mid-shift:
 *   1. Permission keys — an invented key silently locks a workspace forever.
 *   2. Role resolution — /me/permissions returns `roles`, never a singular `role`.
 *   3. Workspace routing — cards must deep-link to routes the queue page can honour.
 *   4. Mock route uniqueness — a duplicate registration shadows the correct handler.
 *   5. Locale integrity — a duplicate top-level block silently discards the first one.
 *   6. Queue tabs — the Products tab must cover product EDITS, not just new listings.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { navItems } from '../src/config/navigation.js';
import adminHandlers from '../src/mocks/handlers/admin.js';
import returnHandlers from '../src/mocks/handlers/returns.js';
import moderatorHandlers from '../src/mocks/handlers/moderator.js';
import disputeHandlers from '../src/mocks/handlers/disputes.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const readText = (rel) => fs.readFileSync(path.resolve(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));

const catalog = readJson('docs/permission-catalog.json');
const catalogKeys = new Set(catalog.permissions.map((p) => p.key));
const dashboardSrc = readText('client/src/pages/moderator/ModeratorDashboardPage.js');
const queueSrc = readText('client/src/pages/moderator/ModerationQueuePage.js');
const locales = ['en', 'bn'].map((lang) => [lang, readJson(`client/src/locales/${lang}.json`)]);

test('Moderator — permission keys are real catalog keys', async (t) => {
  await t.test('1. Every permissionKey on a dashboard workspace card exists in the catalog', () => {
    // `orders.return.handle` and `disputes.arbitrate` were invented in this file. Neither is a
    // catalog key, so /me/permissions could never return them and both workspaces rendered
    // "Requires Grant" forever — to a moderator who genuinely held the real permission.
    const used = [...dashboardSrc.matchAll(/permissionKey: '([^']+)'/g)].map((m) => m[1]);
    assert.ok(used.length >= 6, 'expected a permissionKey on every workspace card');
    for (const key of used) {
      assert.ok(catalogKeys.has(key), `ModeratorDashboardPage references unknown permission "${key}"`);
    }
  });

  await t.test('2. Every moderator nav item names a real permission', () => {
    const items = navItems.filter((i) => i.roles.includes('moderator') && i.permission);
    assert.ok(items.length >= 8, 'the moderator sidebar declares permissions on its items');
    for (const item of items) {
      assert.ok(
        catalogKeys.has(item.permission),
        `nav item ${item.key} names unknown permission "${item.permission}"`
      );
    }
  });

  await t.test('3. A moderator holds the return and dispute permissions the cards gate on', () => {
    const held = new Set(
      catalog.permissions.filter((p) => p.default_roles?.includes('moderator')).map((p) => p.key)
    );
    for (const key of ['orders.return.review', 'orders.dispute.arbitrate', 'moderation.product.approve']) {
      assert.ok(held.has(key), `a moderator must hold "${key}" by default`);
    }
  });
});

test('Moderator — the dashboard reads the API shape that actually exists', async (t) => {
  await t.test('1. The dashboard does not read a singular `data.role`', () => {
    // Both the mock and the server return `{ permissions, roles: [...] }`. Reading the singular
    // form left the role pinned to its seed, so hasPermission()'s admin bypass never fired.
    // Comments are stripped first so the note explaining the bug does not trip its own guard.
    const code = dashboardSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/data\??\.role\b/.test(code), 'ModeratorDashboardPage must not read data.role');
    assert.ok(/data\.roles\b/.test(code), 'ModeratorDashboardPage should read data.roles');
  });
});

test('Moderator — workspace cards deep-link to routes that exist and are honoured', async (t) => {
  const routes = [...dashboardSrc.matchAll(/route: '([^']+)'/g)].map((m) => m[1]);
  const navPaths = new Set(navItems.map((i) => i.path));

  await t.test('1. Cards send moderators to moderator-scoped paths, not admin ones', () => {
    assert.ok(routes.length >= 6, 'expected a route on every workspace card');
    for (const route of routes) {
      assert.ok(route.startsWith('/moderator/'), `workspace route "${route}" should stay inside /moderator`);
    }
  });

  await t.test('2. Each card route resolves to a real moderator destination', () => {
    for (const route of routes) {
      const [pathname] = route.split('?');
      const known = navPaths.has(pathname) || pathname === '/moderator/kyc';
      assert.ok(known, `workspace route "${pathname}" has no matching destination`);
    }
  });

  await t.test('3. The queue page honours the item_type query the cards pass', () => {
    // The cards passed ?filter=reports / ?item_type=REVIEW to a page that never read the URL, so
    // every one of them silently landed on the default "All Items / Pending" view.
    assert.ok(/ctx\.query/.test(queueSrc), 'ModerationQueuePage must read the router query');
    const declared = /const TYPE_TAB_KEYS = \[([^\]]+)\]/.exec(queueSrc);
    assert.ok(declared, 'ModerationQueuePage should declare TYPE_TAB_KEYS');
    const keys = [...declared[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    for (const route of routes) {
      const itemType = new URLSearchParams(route.split('?')[1] ?? '').get('item_type');
      if (itemType) {
        assert.ok(keys.includes(itemType), `a card passes item_type="${itemType}", which is not a queue tab`);
      }
    }
  });
});

test('Moderator — the Products tab covers product edits', async (t) => {
  await t.test('1. TYPE_TAB_KEYS pairs PRODUCT_NEW with PRODUCT_EDIT', () => {
    // The tab sent item_type=PRODUCT_NEW and the server matched it exactly, so an edit to a live
    // listing never appeared under "Products" — the one tab a moderator would look in for it.
    assert.ok(
      /'PRODUCT_NEW,PRODUCT_EDIT'/.test(queueSrc),
      'the Products tab must request both PRODUCT_NEW and PRODUCT_EDIT'
    );
  });

  await t.test('2. The queue mock filters a comma-separated item_type list', () => {
    const mockSrc = readText('client/src/mocks/handlers/moderator.js');
    assert.ok(/split\(',' *\)/.test(mockSrc), 'the mock must split item_type on commas, like the server');
  });

  await t.test('3. The server matches item_type against a list, not a single value', () => {
    const serviceSrc = readText('server/src/services/moderation.service.js');
    assert.ok(/item_type = ANY\(/.test(serviceSrc), 'the queue query must use = ANY(...) for item_type');
  });

  await t.test('4. A PRODUCT_EDIT item is reachable through the Products tab', () => {
    const handler = moderatorHandlers.find((h) => h.method === 'GET' && h.path === '/moderation/queue');
    assert.ok(handler, '/moderation/queue must be mocked');
    const items = handler.handler({ query: { item_type: 'PRODUCT_NEW,PRODUCT_EDIT', status: 'ALL' } })
      .body.data.items;
    const types = items.map((i) => i.item_type);
    assert.ok(types.includes('PRODUCT_EDIT'), 'the Products tab must return PRODUCT_EDIT submissions');
    assert.ok(types.includes('PRODUCT_NEW'), 'the Products tab must still return PRODUCT_NEW submissions');
  });
});

test('Moderator — mock routes are registered exactly once', async (t) => {
  await t.test('1. No two handler modules claim the same route', () => {
    // admin.js carried a stale copy of the whole /admin/returns/* block whose rows used
    // return_ref / order_id / reason. It was spread first, so it shadowed returns.js and the
    // Returns queue rendered "undefined" for the ref, the order number and the reason code.
    const modules = {
      'admin.js': adminHandlers,
      'returns.js': returnHandlers,
      'moderator.js': moderatorHandlers,
      'disputes.js': disputeHandlers,
    };
    const seen = new Map();
    const clashes = [];
    for (const [name, list] of Object.entries(modules)) {
      for (const h of list) {
        const route = `${h.method ?? 'GET'} ${h.path}`;
        if (seen.has(route)) clashes.push(`${route} — in both ${seen.get(route)} and ${name}`);
        else seen.set(route, name);
      }
    }
    assert.deepEqual(clashes, [], 'a shadowed route silently serves the wrong shape');
  });

  await t.test('2. The returns queue mock returns the field names the page renders', () => {
    const handler = returnHandlers.find((h) => h.method === 'GET' && h.path === '/admin/returns/queue');
    assert.ok(handler, '/admin/returns/queue must be mocked');
    const rows = handler.handler({ query: {} }).body.data.returns;
    assert.ok(rows.length > 0, 'the queue fixture should not be empty');
    for (const row of rows) {
      for (const field of ['ref', 'sub_order_ref', 'reason_code', 'evidence_urls_json']) {
        assert.notEqual(row[field], undefined, `return ${row.id} is missing "${field}"`);
      }
    }
  });
});

test('Moderator — locale integrity', async (t) => {
  await t.test('1. No top-level section is declared twice', () => {
    // "live" and "palette" were each declared twice. JSON.parse keeps only the last, so 43 live
    // strings and 4 palette strings were dead in both languages — the Live page fell back to
    // humanized key slugs ("Cat Fashion") and Bangla never rendered there at all.
    for (const lang of ['en', 'bn']) {
      const raw = readText(`client/src/locales/${lang}.json`);
      const counts = new Map();
      for (const [, key] of raw.matchAll(/^ {2}"([^"]+)": \{/gm)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const dupes = [...counts].filter(([, n]) => n > 1).map(([k]) => k);
      assert.deepEqual(dupes, [], `${lang}.json declares these sections more than once`);
    }
  });

  await t.test('2. en/bn parity across the moderation and live sections', () => {
    const [[, en], [, bn]] = locales;
    for (const section of ['moderation', 'live']) {
      assert.deepEqual(
        Object.keys(en[section]).sort(),
        Object.keys(bn[section]).sort(),
        `every ${section} key needs a Bangla counterpart`
      );
    }
  });

  await t.test('3. The queue count is a plural key, not a hardcoded English string', () => {
    // The toolbar printed `${queueItems.length} items in queue` — untranslated, and wrong at 1.
    assert.ok(!/items in queue/.test(queueSrc), 'the queue count must not be hardcoded English');
    for (const [lang, dict] of locales) {
      assert.equal(typeof dict.moderation.queue_count?.one, 'string', `${lang} needs queue_count.one`);
      assert.equal(typeof dict.moderation.queue_count?.other, 'string', `${lang} needs queue_count.other`);
    }
  });

  await t.test('4. Approve/Reject labels are item-type neutral', () => {
    // The unified queue covers reviews, UGC and chat reports, so "Approve Listing" was wrong on
    // every tab but Products.
    for (const [lang, dict] of locales) {
      for (const key of ['btn_approve', 'btn_reject']) {
        assert.ok(
          !/listing|পণ্য/i.test(dict.moderation[key]),
          `${lang}.moderation.${key} must not name a product: "${dict.moderation[key]}"`
        );
      }
    }
  });

  await t.test('5. A denied route explains itself instead of bouncing silently', () => {
    const mainSrc = readText('client/src/main.js');
    assert.ok(/onGuardFail/.test(mainSrc), 'the router needs a guard-failure handler');
    for (const [lang, dict] of locales) {
      assert.equal(typeof dict.access.route_denied, 'string', `${lang} needs access.route_denied`);
      assert.equal(typeof dict.access.route_module_off, 'string', `${lang} needs access.route_module_off`);
    }
  });
});
