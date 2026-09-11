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
    assert.match(
      content,
      /extractGradientColors/,
      'a11y-audit.js must inspect gradient background colors'
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

  await t.test('14. StoreBuilderPage slug input has associated label and aria-label', () => {
    const storeBuilderPath = path.join(clientRoot, 'src', 'pages', 'saler', 'StoreBuilderPage.js');
    const content = fs.readFileSync(storeBuilderPath, 'utf8');

    assert.match(
      content,
      /slugLabel\.htmlFor\s*=\s*slugControlId/,
      'slugLabel must associate with slugControlId via htmlFor'
    );
    assert.match(
      content,
      /slugInput\.id\s*=\s*slugControlId/,
      'slugInput must define id matching slugControlId'
    );
    assert.match(
      content,
      /slugInput\.setAttribute\('aria-label'/,
      'slugInput must specify aria-label attribute'
    );
  });

  await t.test('15. ShopStatusToggle schedule link satisfies WCAG contrast using --text-brand', () => {
    const storeCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'store.css');
    const cssContent = fs.readFileSync(storeCssPath, 'utf8');

    assert.match(
      cssContent,
      /\.shop-status-toggle__schedule-link\s*\{[^}]*color:\s*var\(--text-brand\)/,
      'shop-status-toggle__schedule-link must use var(--text-brand) instead of low-contrast var(--brand-600)'
    );
    assert.doesNotMatch(
      cssContent,
      /\.shop-status-toggle__schedule-link\s*\{[^}]*color:\s*var\(--brand-600\)/,
      'shop-status-toggle__schedule-link must not use low-contrast var(--brand-600)'
    );
  });

  await t.test('16. BecomeSalerPage profit calculator sliders have associated labels and aria-labels', () => {
    const becomeSalerPath = path.join(clientRoot, 'src', 'pages', 'customer', 'BecomeSalerPage.js');
    const content = fs.readFileSync(becomeSalerPath, 'utf8');

    // Labels with htmlFor
    assert.match(
      content,
      /<label[^>]*for="calc-orders-slider"/,
      'calc-orders-slider must have an associated label'
    );
    assert.match(
      content,
      /<label[^>]*for="calc-price-slider"/,
      'calc-price-slider must have an associated label'
    );
    assert.match(
      content,
      /<label[^>]*for="calc-margin-slider"/,
      'calc-margin-slider must have an associated label'
    );

    // Inputs with aria-label
    assert.match(
      content,
      /<input[^>]*id="calc-orders-slider"[^>]*aria-label="/,
      'calc-orders-slider must have aria-label attribute'
    );
    assert.match(
      content,
      /<input[^>]*id="calc-price-slider"[^>]*aria-label="/,
      'calc-price-slider must have aria-label attribute'
    );
    assert.match(
      content,
      /<input[^>]*id="calc-margin-slider"[^>]*aria-label="/,
      'calc-margin-slider must have aria-label attribute'
    );
  });

  await t.test('17. customer-coins.css satisfies WCAG AA contrast across stats, badges, and streak nodes', () => {
    const coinsCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'customer-coins.css');
    const cssContent = fs.readFileSync(coinsCssPath, 'utf8');

    // Values in stat pills must use high-contrast greens and ambers
    assert.match(
      cssContent,
      /\.coins-stat-pill__value--green\s*\{[^}]*color:\s*#166534/,
      'coins-stat-pill__value--green must use high-contrast #166534 (not #16a34a)'
    );
    assert.match(
      cssContent,
      /\.coins-stat-pill__value--amber\s*\{[^}]*color:\s*#92400e/,
      'coins-stat-pill__value--amber must use high-contrast #92400e (not #d97706)'
    );

    // Streak badge must use #92400e
    assert.match(
      cssContent,
      /\.coins-streak-badge\s*\{[^}]*color:\s*#92400e/,
      'coins-streak-badge must use #92400e'
    );

    // Claimed and today streak calendar nodes must satisfy contrast
    assert.match(
      cssContent,
      /\.coins-day-node--claimed\s+\.coins-day-node__day[^}]*color:\s*#166534/,
      'claimed day node text must use #166534'
    );
    assert.match(
      cssContent,
      /\.coins-day-node--today\s+\.coins-day-node__day[^}]*color:\s*#92400e/,
      'today day node text must use #92400e'
    );

    // Daily checkin and quest claim action buttons must use brand tokens with dark high-contrast text
    assert.match(
      cssContent,
      /\.coins-checkin-btn\s*\{[^}]*background:\s*var\(--brand\);[^}]*color:\s*var\(--brand-contrast/,
      'coins-checkin-btn must use var(--brand) background with var(--brand-contrast) text'
    );
    assert.match(
      cssContent,
      /\.quest-btn-claim\s*\{[^}]*background:\s*var\(--brand\);[^}]*color:\s*var\(--brand-contrast/,
      'quest-btn-claim must use var(--brand) background with var(--brand-contrast) text'
    );
  });

  await t.test('18. ReferralHubPage and referrals.css satisfy form label and WCAG AA contrast rules', () => {
    const referralPagePath = path.join(clientRoot, 'src', 'pages', 'saler', 'ReferralHubPage.js');
    const referralPageContent = fs.readFileSync(referralPagePath, 'utf8');

    // Input fields must have proper for-label or aria-label associations
    assert.match(
      referralPageContent,
      /<label[^>]*for="input-referral-link"[^>]*>/,
      'input-referral-link must have associated <label for="input-referral-link">'
    );
    assert.match(
      referralPageContent,
      /<input[^>]*id="input-referral-link"[^>]*aria-label="/,
      'input-referral-link must have aria-label attribute'
    );
    assert.match(
      referralPageContent,
      /<label[^>]*for="input-tree-search"[^>]*>/,
      'input-tree-search must have associated <label for="input-tree-search">'
    );
    assert.match(
      referralPageContent,
      /<input[^>]*id="input-tree-search"[^>]*aria-label="/,
      'input-tree-search must have aria-label attribute'
    );

    // Sliders must have labels
    assert.match(
      referralPageContent,
      /<label[^>]*for="slider-friends"[^>]*>/,
      'slider-friends must have associated <label for="slider-friends">'
    );
    assert.match(
      referralPageContent,
      /<label[^>]*for="slider-spend"[^>]*>/,
      'slider-spend must have associated <label for="slider-spend">'
    );

    // referrals.css contrast rules
    const referralsCssPath = path.join(clientRoot, 'src', 'styles', 'components', 'referrals.css');
    const cssContent = fs.readFileSync(referralsCssPath, 'utf8');

    // Facebook social button must use high-contrast #1558b0 (minimum 4.5:1, achieves 7.1:1 with white)
    assert.match(
      cssContent,
      /\.btn-social--facebook\s*\{[^}]*background:\s*#1558b0/,
      'btn-social--facebook must use #1558b0 to satisfy WCAG AA contrast'
    );

    // KPI cards and tier badge contrast
    assert.match(
      cssContent,
      /\.referral-kpi-card--green\s+\.referral-kpi-card__val\s*\{[^}]*color:\s*#166534/,
      'referral-kpi-card--green must use #166534'
    );
    assert.match(
      cssContent,
      /\.referral-kpi-card--amber\s+\.referral-kpi-card__val\s*\{[^}]*color:\s*#92400e/,
      'referral-kpi-card--amber must use #92400e'
    );
    assert.match(
      cssContent,
      /\.referral-tier-badge\s*\{[^}]*color:\s*#92400e/,
      'referral-tier-badge must use #92400e'
    );
    assert.match(
      cssContent,
      /\.referral-calc-result__amount\s*\{[^}]*color:\s*#166534/,
      'referral-calc-result__amount must use #166534'
    );
  });
});
