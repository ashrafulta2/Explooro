/**
 * languageSettings.test.js — Language & Default Locale governance, client side.
 *
 * Covers:
 *  1. The locale precedence rule (resolveInitialLocale) — which of the three layers wins.
 *  2. Nav guard == route guard for /admin/platform/language, both permission AND module
 *     (docs/super-admin-audit.md §5 invariant 2), and the permission exists in the catalog
 *     (invariant 4).
 *  3. en/bn parity for every key the page renders (invariant 8: a missing key does not fail
 *     loudly, it renders a humanized slug that looks like real copy).
 *  4. The mock handlers honour the same rules as the server, so a mock-mode demo cannot pass
 *     where the real API would reject.
 *  5. LocaleChoiceCard gives every control a real label and namespaces its ids (invariants 6, 7).
 *  6. The page's own stylesheet is NOT also imported by main.css — a double import ships the
 *     same CSS in the entry bundle and a route chunk, against the budget, with no warning.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import catalog from '../../docs/permission-catalog.json' with { type: 'json' };
import { navItems } from '../src/config/navigation.js';
import { resolveInitialLocale } from '../src/services/i18n.js';
import { localizationHandlers } from '../src/mocks/handlers/localization.js';

const clientRoot = path.resolve(import.meta.dirname, '..');
const ROUTE = '/admin/platform/language';

test('Language & Default Locale — client invariants', async (t) => {
  await t.test('1. Locale precedence: policy default beats the build-time env default', () => {
    assert.equal(
      resolveInitialLocale({
        policy: { default_locale: 'bn', enabled_locales: ['en', 'bn'], allow_user_override: true },
        savedLocale: null,
        envDefault: 'en',
      }),
      'bn',
      'the admin-set default is the system default, not VITE_DEFAULT_LOCALE'
    );
  });

  await t.test('1b. A visitor with a saved pick keeps it while the policy allows choice', () => {
    assert.equal(
      resolveInitialLocale({
        policy: { default_locale: 'en', enabled_locales: ['en', 'bn'], allow_user_override: true },
        savedLocale: 'bn',
        envDefault: 'en',
      }),
      'bn'
    );
  });

  await t.test('1c. allow_user_override: false overrides a pick made earlier', () => {
    assert.equal(
      resolveInitialLocale({
        policy: { default_locale: 'en', enabled_locales: ['en', 'bn'], allow_user_override: false },
        savedLocale: 'bn',
        envDefault: 'bn',
      }),
      'en',
      'otherwise turning visitor choice off would never reach an existing session'
    );
  });

  await t.test('1d. A saved pick the policy no longer enables is dropped', () => {
    assert.equal(
      resolveInitialLocale({
        policy: { default_locale: 'en', enabled_locales: ['en'], allow_user_override: true },
        savedLocale: 'bn',
        envDefault: 'en',
      }),
      'en'
    );
  });

  await t.test('1e. With no policy at all, the env default stands', () => {
    assert.equal(resolveInitialLocale({ policy: {}, savedLocale: null, envDefault: 'bn' }), 'bn');
    assert.equal(resolveInitialLocale({ policy: {}, savedLocale: null, envDefault: 'en' }), 'en');
  });

  await t.test('1f. An unsupported locale is never returned, whatever the inputs say', () => {
    assert.equal(
      resolveInitialLocale({
        policy: { default_locale: 'fr', enabled_locales: ['fr'], allow_user_override: true },
        savedLocale: 'de',
        envDefault: 'xx',
      }),
      'en',
      'falls through to the first supported locale rather than a locale with no dictionary'
    );
  });

  await t.test('2. Nav guard equals route guard, on both permission and module', () => {
    const navItem = navItems.find((i) => i.path === ROUTE);
    assert.ok(navItem, `navigation.js registers ${ROUTE}`);
    assert.equal(navItem.permission, 'platform.localization.view');
    assert.equal(navItem.module, 'core');
    assert.ok(navItem.roles.includes('super_admin'));
    assert.ok(navItem.roles.includes('admin'));

    const mainSrc = fs.readFileSync(path.join(clientRoot, 'src', 'main.js'), 'utf8');
    const routeBlock = mainSrc.slice(mainSrc.indexOf(`path: '${ROUTE}'`));
    const block = routeBlock.slice(0, routeBlock.indexOf('},') + 2);
    assert.match(
      block,
      /permission: 'platform\.localization\.view'/,
      'the route guard must be the same key the nav guard uses'
    );
    assert.match(block, /module: 'core'/, 'the route module must be the same as the nav module');
    assert.match(block, /LanguageSettingsPage\.js/);
  });

  await t.test('3. Both permission keys exist in the catalog and the update key is delegable', () => {
    const byKey = new Map(catalog.permissions.map((p) => [p.key, p]));
    const view = byKey.get('platform.localization.view');
    const update = byKey.get('platform.localization.update');
    assert.ok(view, 'platform.localization.view is in docs/permission-catalog.json');
    assert.ok(update, 'platform.localization.update is in docs/permission-catalog.json');
    assert.equal(update.delegable, true, 'a Super Admin must be able to assign this');
    assert.notEqual(update.risk_tier, 'CRITICAL', 'CRITICAL cannot be granted by any path');
  });

  await t.test('4. Locale key parity for the admin_language namespace', () => {
    assert.ok(enDict.admin_language, 'en.json has an admin_language namespace');
    assert.ok(bnDict.admin_language, 'bn.json has an admin_language namespace');

    const walk = (en, bn, prefix) => {
      for (const key of Object.keys(en)) {
        assert.ok(key in bn, `Missing key "${prefix}${key}" in bn.json`);
        if (en[key] && typeof en[key] === 'object') walk(en[key], bn[key], `${prefix}${key}.`);
        else assert.ok(String(bn[key]).length > 0, `Empty translation for "${prefix}${key}"`);
      }
    };
    walk(enDict.admin_language, bnDict.admin_language, 'admin_language.');
    walk(bnDict.admin_language, enDict.admin_language, 'admin_language.');

    for (const key of ['yes', 'no', 'discard']) {
      assert.ok(enDict.common[key], `en.json common.${key}`);
      assert.ok(bnDict.common[key], `bn.json common.${key}`);
    }
    assert.ok(enDict.nav.admin.language, 'en.json nav.admin.language backs the sidebar label');
    assert.ok(bnDict.nav.admin.language, 'bn.json nav.admin.language backs the sidebar label');
    assert.ok(enDict.profile.hint_language_locked);
    assert.ok(bnDict.profile.hint_language_locked);
  });

  await t.test('5. Every i18n key the page references resolves in both dictionaries', () => {
    const pageSrc = fs.readFileSync(
      path.join(clientRoot, 'src', 'pages', 'admin', 'LanguageSettingsPage.js'),
      'utf8'
    );
    const keys = [...pageSrc.matchAll(/t\(\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/g)].map((m) => m[1]);
    assert.ok(keys.length > 10, 'the page translates its copy rather than hardcoding English');

    const lookup = (dict, dotted) => dotted.split('.').reduce((acc, part) => acc?.[part], dict);
    for (const key of [...new Set(keys)]) {
      assert.equal(typeof lookup(enDict, key), 'string', `en.json is missing ${key}`);
      assert.equal(typeof lookup(bnDict, key), 'string', `bn.json is missing ${key}`);
    }
  });

  await t.test('6. Mock handlers cover all three endpoints', () => {
    const routes = localizationHandlers.map((h) => `${h.method} ${h.path}`);
    assert.ok(routes.includes('GET /localization/policy'));
    assert.ok(routes.includes('GET /admin/platform/localization'));
    assert.ok(routes.includes('PUT /admin/platform/localization'));
  });

  await t.test('7. The mock rejects a default that is not enabled, like the real API', () => {
    const put = localizationHandlers.find((h) => h.method === 'PUT');
    const res = put.handler({
      body: {
        default_locale: 'bn',
        enabled_locales: ['en'],
        allow_user_override: true,
        reason: 'A reason long enough to satisfy the length rule.',
      },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.message_bn, 'the mock returns both languages, like the API contract');
  });

  await t.test('8. The mock rejects a short reason', () => {
    const put = localizationHandlers.find((h) => h.method === 'PUT');
    const res = put.handler({
      body: {
        default_locale: 'bn',
        enabled_locales: ['en', 'bn'],
        allow_user_override: true,
        reason: 'nope',
      },
    });
    assert.equal(res.status, 400);
  });

  await t.test('9. A valid mock PUT is reflected by the public policy endpoint', () => {
    const put = localizationHandlers.find((h) => h.method === 'PUT');
    const publicGet = localizationHandlers.find((h) => h.path === '/localization/policy');

    const ok = put.handler({
      body: {
        default_locale: 'bn',
        enabled_locales: ['en', 'bn'],
        allow_user_override: false,
        reason: 'Bangla-first for the campaign window, approved.',
      },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.policy.default_locale, 'bn');

    const after = publicGet.handler();
    assert.equal(after.body.policy.default_locale, 'bn', 'the public endpoint serves the new default');
    assert.equal(after.body.policy.allow_user_override, false);

    // Leave the mock as the suite found it, so test order cannot matter.
    put.handler({
      body: {
        default_locale: 'en',
        enabled_locales: ['en', 'bn'],
        allow_user_override: true,
        reason: 'Restoring the shipped default after the test.',
      },
    });
  });

  await t.test('10. LocaleChoiceCard labels every control and namespaces its ids', () => {
    const src = fs.readFileSync(
      path.join(clientRoot, 'src', 'components', 'admin', 'LocaleChoiceCard.js'),
      'utf8'
    );
    // Invariant 6: a <label for> association, not a heading sitting above the input.
    assert.match(src, /<label for="\$\{defaultId\}"/, 'the default radio has an associated label');
    assert.match(src, /<label for="\$\{enabledId\}"/, 'the enabled checkbox has an associated label');
    // Invariant 7: one element per record means ids must be namespaced, or labels cross-wire.
    assert.match(src, /const defaultId = `\$\{idPrefix\}-default-\$\{locale\}`/);
    assert.match(src, /const enabledId = `\$\{idPrefix\}-enabled-\$\{locale\}`/);
    // Invariant 5: semantic role tokens only, no literal hex that would ignore the master seed.
    const cssSrc = fs.readFileSync(
      path.join(clientRoot, 'src', 'styles', 'components', 'language-settings.css'),
      'utf8'
    );
    assert.equal(
      /#[0-9a-fA-F]{3,8}\b/.test(cssSrc),
      false,
      'a literal hex in component CSS will not follow the master seed or dark mode'
    );
  });

  await t.test('11. The page stylesheet is imported by the page only, never by main.css', () => {
    const mainCss = fs.readFileSync(path.join(clientRoot, 'src', 'styles', 'main.css'), 'utf8');
    assert.equal(
      mainCss.includes('language-settings.css'),
      false,
      'importing it here as well would ship the same CSS twice against the budget'
    );
    const pageSrc = fs.readFileSync(
      path.join(clientRoot, 'src', 'pages', 'admin', 'LanguageSettingsPage.js'),
      'utf8'
    );
    assert.match(pageSrc, /styles\/components\/language-settings\.css/);
  });

  await t.test('12. The TopBar switcher is gated on the policy, not rendered unconditionally', () => {
    const src = fs.readFileSync(
      path.join(clientRoot, 'src', 'components', 'shell', 'TopBar.js'),
      'utf8'
    );
    assert.match(src, /if \(isLanguageSwitchAllowed\(\)\)/, 'the switcher is conditional');
    assert.match(src, /getEnabledLanguages\(\)/, 'it offers only enabled locales');
  });

  await t.test('13. The page and its component import cleanly and export functions', async () => {
    for (const modPath of [
      '../src/components/admin/LocaleChoiceCard.js',
      '../src/components/admin/PlatformSubnav.js',
    ]) {
      const mod = await import(modPath);
      assert.equal(typeof mod.default, 'function', `${modPath} default export is a function`);
    }
  });

  await t.test('14. LocaleChoiceCard is registered in the dev gallery', () => {
    const registry = fs.readFileSync(
      path.join(clientRoot, 'src', 'pages', 'dev', 'gallery-registry.js'),
      'utf8'
    );
    assert.match(registry, /id: 'locale-choice-card'/);
    assert.match(registry, /function renderLocaleChoiceCardSpecimen\(\)/);
  });

  await t.test('15. The Platform subnav links the new surface', () => {
    const src = fs.readFileSync(
      path.join(clientRoot, 'src', 'components', 'admin', 'PlatformSubnav.js'),
      'utf8'
    );
    assert.match(src, /key: 'language'/);
    assert.match(src, /\/admin\/platform\/language/);
  });
});
