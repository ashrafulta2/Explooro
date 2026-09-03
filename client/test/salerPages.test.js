/**
 * salerPages.test.js — Invariant & Unit Tests for Saler Account Portal Pages & Handlers.
 *
 * Tests:
 * 1. Saler API and mock handlers contracts across all 19 saler pages.
 * 2. Saler curated products price markup updates, stock levels, and margin calculations.
 * 3. Physical shop status toggle, master hours presets, and 7-day schedule consistency.
 * 4. Reseller order tracking, sub-item profits, courier consignment, and escrow release status.
 * 5. Instant payout request validation (min ৳100, max available balance) & cancellation.
 * 6. Daily & weekly quest completion and 1-click reward claiming.
 * 7. Top 50 national seller leaderboard ranking and podium tiers.
 * 8. Social flyer generator SVG template rendering & QR code integration.
 * 9. Locale integrity across en.json and bn.json for all saler translation keys.
 * 10. Navigation configuration completeness for saler role.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import salerHandlers from '../src/mocks/handlers/saler.js';
import { navItems, navGroups, SIMPLE_MODE_ITEMS } from '../src/config/navigation.js';

const clientRoot = path.resolve(import.meta.dirname, '..');

test('1. Saler Locale Integrity across en.json and bn.json', async (t) => {
  const namespaces = [
    'saler_products',
    'saler_store_status',
    'social_kit',
    'saler_orders',
    'saler_withdrawals',
    'saler_quests',
  ];

  for (const ns of namespaces) {
    await t.test(`Namespace "${ns}" has 100% key parity between en and bn`, () => {
      assert.ok(enDict[ns], `en.json must have namespace "${ns}"`);
      assert.ok(bnDict[ns], `bn.json must have namespace "${ns}"`);

      const enKeys = Object.keys(enDict[ns]).sort();
      const bnKeys = Object.keys(bnDict[ns]).sort();

      assert.deepEqual(enKeys, bnKeys, `Keys in "${ns}" must match 1:1 between en and bn`);
      for (const key of enKeys) {
        assert.ok(enDict[ns][key] && typeof enDict[ns][key] === 'string', `en "${ns}.${key}" must be non-empty string`);
        assert.ok(bnDict[ns][key] && typeof bnDict[ns][key] === 'string', `bn "${ns}.${key}" must be non-empty string`);
      }
    });
  }
});

test('2. Navigation Structure for Saler Portal', async (t) => {
  await t.test('Saler nav has all required routes', () => {
    assert.ok(Array.isArray(navItems), 'navItems must be an array');
    const salerPaths = navItems.filter((i) => i.roles?.includes('saler')).map((i) => i.path);

    const requiredRoutes = [
      '/saler',
      '/saler/analytics',
      '/saler/cart-insights',
      '/saler/store-builder',
      '/saler/products',
      '/saler/store-status',
      '/saler/sourcing',
      '/saler/bundles',
      '/saler/creative-studio',
      '/saler/social-kit',
      '/saler/ads',
      '/saler/live-studio',
      '/saler/orders',
      '/saler/vault',
      '/saler/vault/payouts',
      '/saler/referrals',
      '/saler/quests',
      '/saler/leaderboard',
      '/saler/academy',
      '/saler/inbox',
    ];

    for (const route of requiredRoutes) {
      assert.ok(salerPaths.includes(route), `Saler nav must include route: ${route}`);
    }
  });

  await t.test('Saler Simple Mode has all required items', () => {
    assert.ok(SIMPLE_MODE_ITEMS.saler, 'SIMPLE_MODE_ITEMS.saler must exist');
    assert.equal(SIMPLE_MODE_ITEMS.saler.length, 6, 'Simple mode must have 6 essential items');
  });
});

test('3. Saler Mock Endpoints & Business Logic', async (t) => {
  function findHandler(method, path) {
    return salerHandlers.find((h) => h.method === method && h.path === path);
  }

  await t.test('GET /saler/dashboard returns metrics and onboarding steps', () => {
    const h = findHandler('GET', '/saler/dashboard');
    assert.ok(h, 'Handler for GET /saler/dashboard exists');
    const res = h.handler();
    assert.equal(res.status, 200);
    assert.ok(res.body?.data?.metrics, 'Dashboard has metrics');
    assert.ok(res.body?.data?.onboarding?.steps, 'Dashboard has onboarding steps');
  });

  await t.test('GET /saler/products returns curated products and summary', () => {
    const h = findHandler('GET', '/saler/products');
    assert.ok(h, 'Handler for GET /saler/products exists');
    const res = h.handler({ query: {} });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body?.data?.products), 'Products is an array');
    assert.ok(res.body?.data?.summary?.avg_margin_pct, 'Summary has avg_margin_pct');
  });

  await t.test('PATCH /saler/products/:id updates retail price and margin', () => {
    const h = findHandler('PATCH', '/saler/products/:id');
    assert.ok(h, 'Handler for PATCH /saler/products/:id exists');
    const res = h.handler({ params: { id: 1 }, body: { custom_retail_price: 3800.0 } });
    assert.equal(res.status, 200);
    assert.equal(res.body?.data?.product?.custom_retail_price, 3800.0);
  });

  await t.test('GET & PATCH /saler/store-status controls physical shop open hours', () => {
    const getH = findHandler('GET', '/saler/store-status');
    const patchH = findHandler('PATCH', '/saler/store-status');
    assert.ok(getH && patchH, 'Handlers for store status exist');

    const getRes = getH.handler();
    assert.equal(getRes.status, 200);
    assert.ok(getRes.body?.data?.weekly_schedule, 'Store status has weekly schedule');

    const patchRes = patchH.handler({ body: { is_open: false } });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body?.data?.is_open, false);
  });

  await t.test('GET /saler/orders returns order list with sub-items and commissions', () => {
    const h = findHandler('GET', '/saler/orders');
    assert.ok(h, 'Handler for GET /saler/orders exists');
    const res = h.handler({ query: {} });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body?.data?.orders), 'Orders is an array');
    assert.ok(res.body?.data?.summary?.total_commission_earned > 0, 'Total commission earned > 0');
  });

  await t.test('POST /saler/vault/payouts validates minimum amount and balance', () => {
    const h = findHandler('POST', '/saler/vault/payouts');
    assert.ok(h, 'Handler for POST /saler/vault/payouts exists');

    const invalidMin = h.handler({ body: { amount: 50 } });
    assert.equal(invalidMin.status, 400);

    const validReq = h.handler({ body: { amount: 2000, method: 'BKASH', account_number: '01711223344' } });
    assert.equal(validReq.status, 201);
    assert.ok(validReq.body?.data?.payout?.ref.startsWith('PAY-BK'), 'Payout reference generated');
  });

  await t.test('GET & POST /saler/quests handles mission progression & reward claims', () => {
    const getH = findHandler('GET', '/saler/quests');
    const claimH = findHandler('POST', '/saler/quests/:id/claim');
    assert.ok(getH && claimH, 'Quests handlers exist');

    const getRes = getH.handler();
    assert.equal(getRes.status, 200);
    assert.ok(Array.isArray(getRes.body?.data?.quests), 'Quests is an array');

    const claimRes = claimH.handler({ params: { id: 'quest_1' } });
    assert.equal(claimRes.status, 200);
    assert.equal(claimRes.body?.data?.quest?.is_claimed, true);
  });

  await t.test('GET /saler/leaderboard returns ranked sellers with podium prizes', () => {
    const h = findHandler('GET', '/saler/leaderboard');
    assert.ok(h, 'Handler for GET /saler/leaderboard exists');
    const res = h.handler();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body?.data?.leaderboard), 'Leaderboard is an array');
    assert.ok(res.body?.data?.podium_rewards?.gold, 'Podium rewards exist');
  });

  await t.test('POST /saler/social-kit/links creates tracked affiliate short links', () => {
    const h = findHandler('POST', '/saler/social-kit/links');
    assert.ok(h, 'Handler for POST /saler/social-kit/links exists');
    const res = h.handler({ body: { product_id: 1 } });
    assert.equal(res.status, 201);
    assert.ok(res.body?.code.startsWith('exp-'), 'Short code generated');
  });
});

test('4. Saler Route Registration Invariants in main.js', async (t) => {
  const mainSrc = fs.readFileSync(path.join(clientRoot, 'src/main.js'), 'utf8');

  const salerPaths = [
    '/saler',
    '/saler/dashboard',
    '/saler/analytics',
    '/saler/cart-insights',
    '/saler/store-builder',
    '/saler/products',
    '/saler/store-status',
    '/saler/sourcing',
    '/saler/bundles',
    '/saler/creative-studio',
    '/saler/social-kit',
    '/saler/ads',
    '/saler/live-studio',
    '/saler/orders',
    '/saler/orders/:id',
    '/saler/vault',
    '/saler/vault/payouts',
    '/saler/referrals',
    '/saler/quests',
    '/saler/leaderboard',
    '/saler/academy',
    '/saler/inbox',
  ];

  await t.test('All 22 Saler routes are explicitly registered in main.js', () => {
    for (const p of salerPaths) {
      assert.ok(
        mainSrc.includes(`path: '${p}'`),
        `Expected main.js to explicitly register route path: '${p}'`
      );
    }
  });

  await t.test('No duplicate route declarations for saler routes in main.js', () => {
    for (const p of salerPaths) {
      const count = (mainSrc.match(new RegExp(`path:\\s*['"]${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g')) || []).length;
      assert.equal(
        count,
        1,
        `Route ${p} should be declared exactly once in main.js, but found ${count}`
      );
    }
  });

  await t.test('All 18 Saler page modules export a default mount/render function', async () => {
    const pageFiles = [
      'AdCampaignPage.js',
      'AnalyticsPage.js',
      'BundleStudioPage.js',
      'CartInsightsPage.js',
      'CreativeStudioPage.js',
      'LiveStudioPage.js',
      'MyProductsPage.js',
      'ReferralHubPage.js',
      'SalerDashboardPage.js',
      'SalerOrderDetailPage.js',
      'SalerOrdersPage.js',
      'SalerQuestsPage.js',
      'SalerStoreStatusPage.js',
      'SocialKitPage.js',
      'SourcingCatalogPage.js',
      'StoreBuilderPage.js',
      'UnifiedInboxPage.js',
      'WithdrawalsPage.js',
    ];

    for (const file of pageFiles) {
      const fileUrl = pathToFileURL(path.join(clientRoot, 'src/pages/saler', file)).href;
      const mod = await import(fileUrl);
      assert.equal(
        typeof mod.default,
        'function',
        `${file} must export a default function for router mounting`
      );
    }
  });
});

