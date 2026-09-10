/**
 * userProfile.test.js — Invariants for "My Profile" (/account/profile).
 *
 * Pins the things that make the page reachable and correct, each of which has a silent failure
 * mode elsewhere in this codebase:
 *   1. Locale integrity — en/bn parity, no emoji baked into values, namespace declared once.
 *   2. Reachability — the route is registered, the avatar menu links to it, the nav item exists.
 *      A page nobody can navigate to is the exact bug this whole change set out to fix.
 *   3. Stylesheet aggregation — main.css imports profile.css, or the page renders unstyled.
 *   4. Mock parity — the mock PUT honours the same three rules profile.service.js enforces, so
 *      dev behaviour does not diverge from the live API.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import { navItems } from '../src/config/navigation.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const mainSrc = read('src/main.js');
const topBarSrc = read('src/components/shell/TopBar.js');
const mainCss = read('src/styles/main.css');
const profileCss = read('src/styles/components/profile.css');
const pageSrc = read('src/pages/settings/ProfilePage.js');
const mockSrc = read('src/mocks/handlers/me.js');
const mocksIndexSrc = read('src/mocks/index.js');

/**
 * Every /account/* surface, and the three names each one is known by: the BEM prefix its markup
 * used before the migration, the class its root element still carries, and its stylesheet.
 */
const ACCOUNT_PAGES = [
  { prefix: 'profile-page', rootClass: 'profile-page', css: 'profile', js: 'src/pages/settings/ProfilePage.js' },
  { prefix: 'notif-prefs-page', rootClass: 'notif-prefs-page', css: 'notification-prefs', js: 'src/pages/settings/NotificationPreferencesPage.js' },
  { prefix: 'addresses-page', rootClass: 'addresses-page', css: 'customer-addresses', js: 'src/pages/customer/AddressesPage.js' },
  { prefix: 'coins-page', rootClass: 'coins-page', css: 'customer-coins', js: 'src/pages/customer/CoinsPage.js' },
  { prefix: 'coupons-page', rootClass: 'coupons-page', css: 'customer-coupons', js: 'src/pages/customer/CouponsPage.js' },
  { prefix: 'wishlist-page', rootClass: 'wishlist-page', css: 'wishlist', js: 'src/pages/customer/WishlistPage.js' },
  { prefix: 'team-page', rootClass: 'team-purchases-page', css: 'team-purchases', js: 'src/pages/TeamPurchasePage.js' },
  { prefix: 'following-page', rootClass: 'following-page', css: 'customer-following', js: 'src/pages/customer/FollowingFeedPage.js' },
  { prefix: 'reviews-page', rootClass: 'reviews-page', css: 'customer-reviews', js: 'src/pages/customer/ReviewsPage.js' },
  { prefix: 'orders-page', rootClass: 'orders-page', css: 'customer-orders', js: 'src/pages/customer/OrdersPage.js' },
  // The tracking detail page renders the same shell and the same order cards, so it carries
  // its own import of customer-orders.css — that sheet is deliberately absent from main.css.
  { prefix: 'orders-page', rootClass: 'orders-page', css: 'customer-orders', js: 'src/pages/customer/OrderDetailPage.js' },
  { prefix: 'warranties-page', rootClass: 'warranties-page', css: 'customer-warranties', js: 'src/pages/customer/WarrantyCardsPage.js' },
  { prefix: 'become-saler-page', rootClass: 'become-saler-page', css: 'customer-become-saler', js: 'src/pages/customer/BecomeSalerPage.js' },
];

test('1. Locale integrity for the profile namespace', async (t) => {
  await t.test('en/bn key parity', () => {
    const en = Object.keys(enDict.profile || {}).sort();
    const bn = Object.keys(bnDict.profile || {}).sort();
    assert.deepEqual(en, bn, 'every profile key must exist in both locales');
    assert.ok(en.length > 60, `the page renders far more strings than a handful of keys (${en.length})`);
  });

  await t.test('no value is an empty string in either locale', () => {
    for (const [lang, dict] of [['en', enDict], ['bn', bnDict]]) {
      for (const [k, v] of Object.entries(dict.profile || {})) {
        assert.ok(String(v).trim(), `${lang}.profile.${k} must not be blank`);
      }
    }
  });

  await t.test('no emoji baked into dictionary values (the page prefixes its own icons)', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [lang, dict] of [['en', enDict], ['bn', bnDict]]) {
      for (const [k, v] of Object.entries(dict.profile || {})) {
        assert.ok(!emoji.test(v), `${lang}.profile.${k} must not contain an emoji: ${v}`);
      }
    }
  });

  await t.test('profile declared exactly once per locale file', () => {
    for (const lang of ['en', 'bn']) {
      const raw = read(`src/locales/${lang}.json`);
      assert.equal(raw.split('\n  "profile":').length - 1, 1, `${lang}.json top-level "profile"`);
    }
  });

  await t.test('the menu label and the nav label exist in both locales', () => {
    for (const [lang, dict] of [['en', enDict], ['bn', bnDict]]) {
      assert.ok(dict.shell?.my_profile, `${lang}.shell.my_profile`);
      assert.ok(dict.nav?.customer?.profile, `${lang}.nav.customer.profile`);
      // The language select shows endonyms, not the topbar's "switch to X" strings.
      assert.ok(dict.language?.name_en, `${lang}.language.name_en`);
      assert.ok(dict.language?.name_bn, `${lang}.language.name_bn`);
    }
  });

  await t.test('every t() key the page uses resolves in both locales', () => {
    const keys = [...pageSrc.matchAll(/\bt\(\s*'(profile\.[a-z0-9_]+)'/g)].map((m) => m[1]);
    assert.ok(keys.length > 40, `expected the page to reference many profile keys, got ${keys.length}`);
    for (const key of new Set(keys)) {
      const leaf = key.slice('profile.'.length);
      assert.ok(enDict.profile[leaf] !== undefined, `missing en.${key}`);
      assert.ok(bnDict.profile[leaf] !== undefined, `missing bn.${key}`);
    }
  });
});

test('2. The page is actually reachable', async (t) => {
  await t.test('/account/profile and /profile are both registered routes', () => {
    for (const routePath of ['/account/profile', '/profile']) {
      const block = mainSrc.match(
        new RegExp(`path: '${routePath}',[\\s\\S]{0,320}?load: \\(\\) => import\\('([^']+)'\\)`)
      );
      assert.ok(block, `${routePath} is not registered in main.js`);
      assert.equal(block[1], './pages/settings/ProfilePage.js', `${routePath} loads the profile page`);
      assert.match(block[0], /requiresAuth: true/, `${routePath} must require a session`);
      assert.match(block[0], /permission: null/, `${routePath} needs no permission — every role has a profile`);
      assert.match(block[0], /module: 'core'/, `${routePath} must not be gated on a toggleable module`);
    }
  });

  await t.test('the TopBar avatar menu links to it', () => {
    assert.match(
      topBarSrc,
      /profileLink\.href = '\/account\/profile'/,
      'the account menu must contain a My Profile link'
    );
    assert.match(topBarSrc, /t\('shell\.my_profile'/, 'the link label comes from the dictionary');
    assert.match(
      topBarSrc,
      /onNavigate\('\/account\/profile'\)/,
      'clicking it must route in-app, not do a full page load'
    );
  });

  await t.test('the customer nav item points at the registered route', () => {
    const item = navItems.find((i) => i.key === 'customer.profile');
    assert.ok(item, 'navigation.js must carry a customer.profile item');
    assert.equal(item.path, '/account/profile');
    assert.equal(item.permission, null);
    assert.equal(item.module, 'core');
    assert.equal(item.label_i18n_key, 'nav.customer.profile');
    assert.equal(item.group, 'customer.me');
  });

  await t.test('it sorts above the rest of the customer.me group', () => {
    const group = navItems.filter((i) => i.group === 'customer.me');
    const first = [...group].sort((a, b) => a.order - b.order)[0];
    assert.equal(first.key, 'customer.profile');
  });
});

test('3. Styling is wired up', async (t) => {
  await t.test('main.css imports profile.css and the shared account shell', () => {
    assert.match(mainCss, /@import '\.\/components\/profile\.css';/);
    assert.match(mainCss, /@import '\.\/components\/account-shell\.css';/);
  });

  await t.test('account-shell.css defines the whole shared shell', () => {
    const shell = read('src/styles/components/account-shell.css');
    for (const cls of [
      '.account-page',
      '.account-page__header',
      '.account-page__back',
      '.account-page__back--boxed',
      '.account-page__title-wrap',
      '.account-page__title',
      '.account-page__subtitle',
      '.account-page__badge',
      '.account-page__error',
      '.account-page__card-loading',
    ]) {
      assert.ok(shell.includes(cls + ' {') || shell.includes(cls + ':'), `account-shell.css must define ${cls}`);
    }
  });

  await t.test('it is imported before every page stylesheet that overrides it', () => {
    // `.addresses-page { max-width }` and `.account-page { max-width }` have EQUAL specificity, so
    // the later import wins. account-shell.css was originally imported last and silently ate five
    // pages' max-width overrides — the page rendered at the shared 1040px instead of its own.
    const shellAt = mainCss.indexOf("@import './components/account-shell.css';");
    assert.ok(shellAt > -1, 'main.css must import account-shell.css');

    for (const page of ACCOUNT_PAGES) {
      const at = mainCss.indexOf(`@import './components/${page.css}.css';`);
      if (at > -1) {
        assert.ok(at > shellAt, `${page.css}.css must be imported AFTER account-shell.css to override it`);
        continue;
      }
      // customer-coins.css takes the other route: CoinsPage.js imports it itself, so Vite
      // code-splits it out of the entry bundle entirely and it loads after main.css anyway.
      // That is the pattern worth copying when the CSS budget gets tight again — see the note in
      // client/vite.config.js.
      assert.match(
        read(page.js),
        new RegExp(`import '[^']*styles/components/${page.css}\\.css'`),
        `${page.css}.css is in neither main.css nor its own page module`
      );
    }
  });

  await t.test('every account page renders from the shell and re-declares none of it', () => {
    for (const page of ACCOUNT_PAGES) {
      const js = read(page.js);
      assert.ok(
        new RegExp(`account-page ${page.rootClass}\\b`).test(js),
        `${page.js} root element must carry 'account-page ${page.rootClass}'`
      );

      const css = read(`src/styles/components/${page.css}.css`);
      // WHY a regex and not includes(): customer-warranties.css is minified, so its rules read
      // `.warranties-page__header{` with no space. The old substring check never matched those
      // and would have passed a page that had not been migrated at all.
      for (const part of ['header', 'back', 'back-link', 'title-wrap', 'title', 'subtitle']) {
        const dead = new RegExp(`\.${page.prefix}__${part}\s*\{`);
        assert.ok(!dead.test(css), `${page.css}.css still re-declares .${page.prefix}__${part}`);
        assert.ok(!js.includes(`${page.prefix}__${part}"`), `${page.js} still uses ${page.prefix}__${part}`);
      }
    }
  });

  await t.test('profile.css defines the classes the page renders', () => {
    for (const cls of [
      '.profile-page',
      '.profile-hero',
      '.profile-avatar',
      '.profile-grid',
      '.profile-links',
      '.profile-actions',
    ]) {
      assert.ok(profileCss.includes(cls), `profile.css must define ${cls}`);
    }
  });

  await t.test('no raw hex colours — component CSS uses tokens only', () => {
    const hexes = profileCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepEqual(hexes, [], `profile.css must reference tokens, not literals: ${hexes.join(', ')}`);
  });
});

test('4. The mock driver matches the live API contract', async (t) => {
  await t.test('mocks/index.js registers the /me and /media handlers', () => {
    assert.match(mocksIndexSrc, /import meHandlers from '\.\/handlers\/me\.js';/);
    assert.match(mocksIndexSrc, /\.\.\.meHandlers,/);
    assert.match(mocksIndexSrc, /import mediaHandlers from '\.\/handlers\/media\.js';/);
    assert.match(mocksIndexSrc, /\.\.\.mediaHandlers,/);
  });

  await t.test('it serves both halves of the profile endpoint', () => {
    assert.match(mockSrc, /method: 'GET',\s*path: '\/me\/profile'/);
    assert.match(mockSrc, /method: 'PUT',\s*path: '\/me\/profile'/);
  });

  await t.test('an omitted field means "unchanged" on both the mock and live paths', () => {
    // Regression: collectPayload() used to send `avatar_media_id: undefined` for an untouched
    // photo. Live mode JSON.stringify's the body and drops the key, but core/api.js hands the mock
    // handler the object itself — where `'avatar_media_id' in payload` is still true — so saving
    // any unrelated field silently deleted the user's profile picture in dev only.
    assert.ok(
      !/avatar_media_id: pendingAvatar === undefined \? undefined/.test(pageSrc),
      'the page must omit the avatar key entirely rather than send it as undefined'
    );
    assert.match(
      pageSrc,
      /if \(pendingAvatar !== undefined\) payload\.avatar_media_id = currentAvatarId\(\);/,
      'the avatar key is added only when the avatar actually changed'
    );
    assert.match(
      mockSrc,
      /if \(payload\[field\] !== undefined\) next\[field\] = payload\[field\];/,
      'the mock must treat an undefined value as absent, not as a clear'
    );
  });

  await t.test('phone is never writable and an email change clears verification', () => {
    // Rule 1 and rule 2 from profile.service.js's header. A mock that let either slip would let a
    // developer "verify" an address by typing it, and the live API would then disagree.
    assert.match(mockSrc, /next\.phone = current\.phone;/, 'PUT must restore the session phone');
    assert.match(mockSrc, /next\.is_email_verified = false;/, 'a changed email must drop verification');
    assert.ok(
      !/PROFILE_FIELDS[\s\S]{0,400}'phone'/.test(mockSrc),
      'phone must not be in the writable field list'
    );
  });
});

test('5. The page never trusts user text as markup', () => {
  // The profile is the one page whose content is entirely user-authored, so an innerHTML
  // assignment carrying a field value would be a stored-XSS vector on every render.
  const innerHtmlAssignments = [...pageSrc.matchAll(/\.innerHTML\s*=\s*`([\s\S]*?)`/g)].map((m) => m[1]);
  for (const template of innerHtmlAssignments) {
    assert.ok(
      !/\$\{[^}]*\bsaved\b[^}]*\}/.test(template),
      `profile data must be set with textContent, not interpolated into innerHTML: ${template.slice(0, 120)}`
    );
  }
});
