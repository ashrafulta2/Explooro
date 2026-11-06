/**
 * legal.test.js — the client half of the legal documents (migration 104, Prompt 12.6 req 7).
 *
 * 1. The text renderer can never run markup an admin typed, and builds headings, lists and bold.
 * 2. The footer shows on shopper pages and stays out of the workspaces.
 * 3. Agreement is the person's own act: never pre-ticked, the button gated by the box, the dialog
 *    not dismissible, the sign-up box checked before submit.
 * 4. Wiring: the route, the locked page state, the nav guard equal to the route guard, both locales.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderLegalText, headingId } from '../src/services/legalText.ts';
import { LEGAL_DOCS, legalDocBySlug } from '../src/config/legal.ts';
import { navItems } from '../src/config/navigation.ts';
import { LOCKED_PATHS } from '../src/services/pageAccess.ts';
import en from '../src/locales/en.json' with { type: 'json' };
import bn from '../src/locales/bn.json' with { type: 'json' };

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('1. renderLegalText', () => {
  test('escapes every tag in the text', () => {
    const { html } = renderLegalText('## <img src=x onerror=alert(1)>\n<script>alert(1)</script>\n- <b>x</b>');
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<b>'));
    assert.match(html, /&lt;script&gt;/);
  });

  test('headings, lists, paragraphs and bold', () => {
    const { html, headings } = renderLegalText('Intro line one\nline two\n\n## 1. Who\n- **One** item\n- Two\n\nAfter');
    assert.equal(html, [
      '<p>Intro line one<br>line two</p>',
      `<h2 id="${headings[0].id}">1. Who</h2>`,
      '<ul><li><strong>One</strong> item</li><li>Two</li></ul>',
      '<p>After</p>',
    ].join('\n'));
    assert.deepEqual(headings.map((h) => h.text), ['1. Who']);
  });

  test('heading ids are unique and keep Bangla letters', () => {
    assert.equal(headingId('১. কারা', 0), 's1-১-কারা');
    assert.notEqual(headingId('Same', 0), headingId('Same', 1));
  });
});

describe('2. the footer', () => {
  test('shows on shopper pages, not in workspaces or full-screen pages', async () => {
    const { showSiteFooter } = await import('../src/components/shell/SiteFooter.ts');
    for (const p of ['/', '/search', '/products/abc', '/cart', '/checkout', '/account/orders', '/legal/terms', '/login', '/register']) {
      assert.equal(showSiteFooter(p), true, p);
    }
    for (const p of ['/admin', '/admin/platform/legal', '/saler/dashboard', '/supplier/products', '/chat', '/reels', '/live/5']) {
      assert.equal(showSiteFooter(p), false, p);
    }
    // A prefix match is a whole segment: /salesforce is not /saler.
    assert.equal(showSiteFooter('/administrator-guide'), true);
  });

  test('the footer lives beside the page outlet, never inside it', () => {
    const shell = read('components/shell/AppShell.ts');
    assert.match(shell, /shellEl\.append\(sidebarSlot, topbarSlot, pageOutlet, footerSlot, mobileNavSlot\)/);
    assert.match(read('styles/components/shell.css'), /'sidebar content' 'sidebar footer'/);
  });
});

describe('3. agreement is the person\'s own act', () => {
  test('the dialog cannot be dismissed and its button waits for the box', () => {
    const modal = read('components/legal/LegalAcceptModal.ts');
    assert.match(modal, /showClose: false/);
    assert.match(modal, /closeOnScrim: false/);
    assert.match(modal, /if \(!done && !leaving\) setTimeout\(\(\) => modal\.openModal\(\), 0\)/);
    assert.match(modal, /Button\(\{ label: t\('legal\.accept\.agree'\)[^)]*disabled: true \}\)/);
    assert.match(modal, /checked: false/);
    assert.match(modal, /onChange: \(checked\) => \{ agree\.disabled = !checked; \}/);
  });

  test('sign-up checks the box before it sends anything', () => {
    const page = read('pages/auth/RegisterPage.ts');
    assert.ok(!/legalBox\.checked = true/.test(page));
    const submit = page.slice(page.indexOf("form.addEventListener('submit'"));
    assert.ok(submit.indexOf('if (!legalBox.checked)') < submit.indexOf('await register('));
    assert.match(page, /acceptLegal: true/);
    assert.match(read('services/session.ts'), /accept_legal: acceptLegal === true \? true : undefined/);
  });

  test('the admin re-acceptance box is never pre-ticked', () => {
    assert.match(read('pages/admin/LegalDocumentsPage.ts'), /reaccept_label'\), hint: t\('admin\.legal\.reaccept_hint'\), checked: false/);
  });
});

describe('4. wiring', () => {
  test('every document has a page route, and those pages can never be hidden', () => {
    const main = read('main.ts');
    assert.match(main, /path: '\/legal\/:doc', title: 'Legal — Explooro', permission: null, module: 'core'/);
    assert.ok(LOCKED_PATHS.includes('/legal/:doc'));
    for (const d of LEGAL_DOCS) {
      assert.equal(d.path, `/legal/${d.slug}`);
      assert.equal(legalDocBySlug(d.slug)?.key, d.key);
    }
    assert.equal(legalDocBySlug('cookies'), null);
  });

  test('the admin nav guard equals the route guard', () => {
    const item = navItems.find((n) => n.path === '/admin/platform/legal');
    assert.ok(item);
    assert.equal(item.permission, 'platform.legal.view');
    assert.equal(item.module, 'core');
    assert.match(read('main.ts'), /path: '\/admin\/platform\/legal',[\s\S]{0,120}permission: 'platform\.legal\.view',\s*module: 'core'/);
  });

  test('every legal string exists in both locales', () => {
    const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    assert.deepEqual(keys(en.legal), keys(bn.legal));
    assert.deepEqual(keys(en.admin.legal), keys(bn.admin.legal));
    for (const k of ['accept_legal', 'accept_legal_partner', 'accept_legal_required']) {
      assert.ok(en.auth.register[k] && bn.auth.register[k], k);
    }
    for (const d of LEGAL_DOCS) {
      const [ns, , name] = d.labelKey.split('.');
      assert.ok(en[ns].link[name] && bn[ns].link[name], d.labelKey);
    }
  });

  test('the sign-up sentence keeps its link slots in both locales', () => {
    for (const dict of [en, bn]) {
      assert.match(dict.auth.register.accept_legal, /\{\{terms\}\}[\s\S]*\{\{privacy\}\}/);
      assert.match(dict.auth.register.accept_legal_partner, /\{\{terms\}\}[\s\S]*\{\{privacy\}\}[\s\S]*\{\{partner\}\}/);
    }
  });
});
