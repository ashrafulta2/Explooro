/**
 * a11yAuditRules.test.js — Invariant Tests for In-Page A11y Auditor and Form Accessibility.
 *
 * Tests:
 * 1. Vault namespace search and filter aria-label keys exist in en.json and bn.json.
 * 2. LedgerTable renders input and select controls with valid aria-label attributes.
 * 3. formatExplooroBrandText renders decorative accent spans with aria-hidden="true".
 * 4. WCAG 1.4.3 Logotypes exemption is applied in runA11yAudit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import { formatExplooroBrandText } from '../src/components/ui/icons.js';

const clientRoot = path.resolve(import.meta.dirname, '..');

test('A11y Auditor & Form Controls Accessibility Invariants', async (t) => {
  await t.test('1. Vault search and filter locale keys exist in both en and bn', () => {
    assert.ok(enDict.vault.search_ledger, 'en.json must contain vault.search_ledger');
    assert.ok(bnDict.vault.search_ledger, 'bn.json must contain vault.search_ledger');
    assert.ok(enDict.vault.filter_category, 'en.json must contain vault.filter_category');
    assert.ok(bnDict.vault.filter_category, 'bn.json must contain vault.filter_category');
  });

  await t.test('2. LedgerTable source code has aria-label on input and select', () => {
    const ledgerTablePath = path.join(clientRoot, 'src', 'components', 'vault', 'LedgerTable.js');
    const content = fs.readFileSync(ledgerTablePath, 'utf8');

    assert.match(
      content,
      /<input[^>]*class="[^"]*ledger-table__search[^"]*"[^>]*aria-label="/,
      'ledger-table__search input must have aria-label'
    );

    assert.match(
      content,
      /<select[^>]*class="[^"]*ledger-table__category-filter[^"]*"[^>]*aria-label="/,
      'ledger-table__category-filter select must have aria-label'
    );
  });

  await t.test('3. formatExplooroBrandText marks accent span with aria-hidden="true"', () => {
    const brandHtml = formatExplooroBrandText('EXPLOORO');
    assert.match(
      brandHtml,
      /<span class="brand-text__accent" aria-hidden="true">O<\/span>/,
      'Brand accent letter O must have aria-hidden="true"'
    );
  });

  await t.test('4. a11y-audit.js source code includes WCAG 1.4.3 logotype exemption', () => {
    const auditPath = path.join(clientRoot, 'src', 'dev', 'a11y-audit.js');
    const content = fs.readFileSync(auditPath, 'utf8');

    assert.match(
      content,
      /WCAG 1\.4\.3/,
      'a11y-audit.js must cite WCAG 1.4.3 logotype exemption'
    );
    assert.match(
      content,
      /\.topbar__brand/,
      'a11y-audit.js must exempt .topbar__brand from text contrast check'
    );
  });

  await t.test('5. product.css discount badge and feed switcher maintain WCAG AA contrast', () => {
    const productCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'product.css');
    const content = fs.readFileSync(productCssPath, 'utf8');

    // .product-card__discount-badge must use danger-700 (> 5.8:1 contrast on white) instead of danger-500 (< 4.0:1)
    assert.match(
      content,
      /\.product-card__discount-badge\s*\{[^}]*background:\s*var\(--danger-700\)/,
      'product-card__discount-badge must use var(--danger-700) for compliant contrast with white text'
    );

    // .feed-switcher__tab[aria-selected='true'] must use brand-950 (> 6.9:1 contrast on brand-100) instead of brand-800 (< 3.5:1)
    assert.match(
      content,
      /\.feed-switcher__tab\[aria-selected=['"]true['"]\]\s*\{[^}]*color:\s*var\(--brand-950\)/,
      'feed-switcher__tab[aria-selected="true"] must use var(--brand-950) on var(--brand-100)'
    );
  });

  await t.test('6. sidebar and filter-panel collapse toggles share consistent gold brand styling', () => {
    const shellCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'shell.css');
    const shellCss = fs.readFileSync(shellCssPath, 'utf8');
    const productCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'product.css');
    const productCss = fs.readFileSync(productCssPath, 'utf8');

    // Both buttons should use var(--brand) border and var(--brand) icon color
    assert.match(
      shellCss,
      /\.sidebar__collapse-toggle\s*\{[^}]*border:[^;]*var\(--brand\)/,
      'sidebar__collapse-toggle must have gold var(--brand) border'
    );
    assert.match(
      shellCss,
      /\.sidebar__collapse-toggle\s*\{[^}]*color:\s*var\(--brand\)/,
      'sidebar__collapse-toggle must have gold var(--brand) color'
    );

    assert.match(
      productCss,
      /\.filter-panel__collapse-toggle\s*\{[^}]*border:[^;]*var\(--brand\)/,
      'filter-panel__collapse-toggle must have gold var(--brand) border'
    );
    assert.match(
      productCss,
      /\.filter-panel__collapse-toggle\s*\{[^}]*color:\s*var\(--brand\)/,
      'filter-panel__collapse-toggle must have gold var(--brand) color'
    );
  });

  await t.test('7. CouponsPage coupon claim input has accessible label and aria-label', () => {
    assert.ok(enDict.customer_coupons.claim_input_label, 'en.json must contain customer_coupons.claim_input_label');
    assert.ok(bnDict.customer_coupons.claim_input_label, 'bn.json must contain customer_coupons.claim_input_label');

    const couponsPagePath = path.join(clientRoot, 'src', 'pages', 'customer', 'CouponsPage.js');
    const content = fs.readFileSync(couponsPagePath, 'utf8');

    assert.match(
      content,
      /<label[^>]*for="coupon-claim-input"[^>]*class="sr-only"/,
      'CouponsPage must include a label for coupon-claim-input'
    );
    assert.match(
      content,
      /<input[^>]*id="coupon-claim-input"[^>]*aria-label="/,
      'coupon-claim-input must have aria-label attribute'
    );
  });

  await t.test('8. customer-coupons.css badges maintain WCAG AA contrast with text-secondary', () => {
    const couponsCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'customer-coupons.css');
    const content = fs.readFileSync(couponsCssPath, 'utf8');

    assert.match(
      content,
      /\.coupon-badge--used\s*\{[^}]*color:\s*var\(--text-secondary\)/,
      'coupon-badge--used must use var(--text-secondary) for compliant contrast'
    );
    assert.match(
      content,
      /\.coupon-badge--expired\s*\{[^}]*color:\s*var\(--text-secondary\)/,
      'coupon-badge--expired must use var(--text-secondary) for compliant contrast'
    );
    assert.match(
      content,
      /\.coupon-badge--neutral\s*\{[^}]*color:\s*var\(--text-secondary\)/,
      'coupon-badge--neutral must use var(--text-secondary) for compliant contrast'
    );
  });

  await t.test('9. WhatsApp share buttons maintain WCAG AA contrast with dark accessible text', () => {
    const teamCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'team-purchases.css');
    const teamCss = fs.readFileSync(teamCssPath, 'utf8');

    // .team-btn-share-wa must use #052e16 (> 7.4:1 contrast on #25d366) instead of #ffffff (1.98:1 contrast fail)
    assert.match(
      teamCss,
      /\.team-btn-share-wa\s*\{[^}]*color:\s*#052e16/,
      'team-btn-share-wa must use #052e16 for WCAG AA/AAA compliant contrast on #25d366'
    );

    const teamPagePath = path.join(clientRoot, 'src', 'pages', 'TeamPurchasePage.js');
    const teamPage = fs.readFileSync(teamPagePath, 'utf8');

    assert.match(
      teamPage,
      /<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*<\/svg>\s*<span>\$\{isBn \? 'হোয়াটসঅ্যাপ শেয়ার' : 'WhatsApp Share'\}<\/span>/,
      'TeamPurchasePage must render WhatsApp SVG with aria-hidden="true" and accessible text label'
    );
  });

  await t.test('10. Order tracker live map and standard badge variants maintain WCAG AA contrast', () => {
    const actionsCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'actions.css');
    const actionsCss = fs.readFileSync(actionsCssPath, 'utf8');

    // actions.css must declare standard badge color variants for universal token-based styling
    assert.match(actionsCss, /\.badge--primary,\s*\.badge--brand\s*\{[^}]*background:\s*var\(--brand-100\)/);
    assert.match(actionsCss, /\.badge--warning\s*\{[^}]*color:\s*var\(--warning\)/);
    assert.match(actionsCss, /\.badge--success\s*\{[^}]*color:\s*var\(--success\)/);

    const checkoutCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'checkout.css');
    const checkoutCss = fs.readFileSync(checkoutCssPath, 'utf8');

    // .order-tracker__map must declare light container text color on dark canvas
    assert.match(checkoutCss, /\.order-tracker__map\s*\{[^}]*background:\s*#1e293b[^}]*color:\s*#f1f5f9/);
    assert.match(checkoutCss, /\.order-tracker__map-overlay\s*\{[^}]*background:\s*rgba\(15,\s*23,\s*42/);
    assert.match(checkoutCss, /\.order-tracker__map-desc\s*\{[^}]*color:\s*#e2e8f0/);

    const orderTrackerPath = path.join(clientRoot, 'src', 'components', 'order', 'OrderTracker.js');
    const orderTracker = fs.readFileSync(orderTrackerPath, 'utf8');

    assert.match(orderTracker, /order-tracker__map-badge/);
    assert.match(orderTracker, /order-tracker__map-desc/);
  });

  await t.test('11. Live indicator chip maintains WCAG AA contrast with design tokens', () => {
    const liveCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'live.css');
    const liveCss = fs.readFileSync(liveCssPath, 'utf8');

    // .live-indicator-chip must use var(--danger-800) (> 8.5:1 contrast on var(--danger-bg)) instead of raw #dc2626 (4.41:1 fail)
    assert.match(
      liveCss,
      /\.live-indicator-chip\{[^}]*background:var\(--danger-bg\);color:var\(--danger-800\)/,
      'live-indicator-chip must use tokenized var(--danger-800) on var(--danger-bg)'
    );

    const livePagePath = path.join(clientRoot, 'src', 'pages', 'LiveStreamPage.js');
    const livePage = fs.readFileSync(livePagePath, 'utf8');

    assert.match(
      livePage,
      /<span class="pulse-dot" aria-hidden="true"><\/span>/,
      'LiveStreamPage must mark decorative pulse-dot with aria-hidden="true"'
    );
  });

  await t.test('12. LiveStreamPage stream chat input has accessible label and aria-label', () => {
    assert.ok(enDict.live.chat_input_label, 'en.json must contain live.chat_input_label');
    assert.ok(bnDict.live.chat_input_label, 'bn.json must contain live.chat_input_label');
    assert.ok(enDict.live.send_message, 'en.json must contain live.send_message');
    assert.ok(bnDict.live.send_message, 'bn.json must contain live.send_message');

    const livePagePath = path.join(clientRoot, 'src', 'pages', 'LiveStreamPage.js');
    const content = fs.readFileSync(livePagePath, 'utf8');

    assert.match(
      content,
      /<label[^>]*for="stream-chat-input"[^>]*class="sr-only"/,
      'LiveStreamPage must include a label for stream-chat-input'
    );
    assert.match(
      content,
      /<input[^>]*id="stream-chat-input"[^>]*aria-label="/,
      'stream-chat-input must have aria-label attribute'
    );
    assert.match(
      content,
      /<button[^>]*id="send-chat-btn"[^>]*aria-label="/,
      'send-chat-btn must have aria-label attribute'
    );
  });

  await t.test('13. LiveStreamPage provides role-aware host CTA without unauthorized navigation', () => {
    assert.ok(enDict.live.become_seller_to_host, 'en.json must contain live.become_seller_to_host');
    assert.ok(bnDict.live.become_seller_to_host, 'bn.json must contain live.become_seller_to_host');

    const livePagePath = path.join(clientRoot, 'src', 'pages', 'LiveStreamPage.js');
    const content = fs.readFileSync(livePagePath, 'utf8');

    assert.match(
      content,
      /navigate\('\/become-saler'\)/,
      'LiveStreamPage must route non-sellers to /become-saler instead of restricted studio'
    );
    assert.match(
      content,
      /t\('live\.become_seller_to_host'\)/,
      'LiveStreamPage must use become_seller_to_host label for customer role'
    );
  });
});




