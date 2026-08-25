/**
 * salerDashboardAnalytics.test.js — Automated test suite for Prompt 11.2 (Saler Dashboard, Inline SVG Analytics & Growth Assistant).
 *
 * Verifies all ACCEPTANCE criteria from docs/prompt.md Prompt 11.2:
 * 1. Every saler feature is reachable within two clicks from the dashboard.
 * 2. Analytics figures reconcile exactly with the ledger and order data.
 * 3. A brand-new saler sees the onboarding checklist rather than an empty dashboard.
 * 4. Simple Mode shows at most 6 primary actions.
 * 5. Growth Assistant provides grounded prescriptive advice with 1-click actions.
 * 6. Fastify HTTP REST API endpoints return 200 OK.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import salerRoutes from '../src/routes/saler.routes.js';
import * as salerService from '../src/services/salerDashboard.service.js';
import { SIMPLE_MODE_ITEMS, navItems } from '../../client/src/config/navigation.js';

function createMockDb({ queryHandler = null } = {}) {
  return {
    async query(sql, params = []) {
      if (queryHandler) {
        return queryHandler(sql, params);
      }
      return { rows: [] };
    },
  };
}

describe('Prompt 11.2 — Saler Dashboard, Pure Inline SVG Analytics & AI Growth Assistant', () => {

  // ---------------------------------------------------------------------------
  // 1. Dashboard Aggregation & 2-Click Reachability (Acceptance 1)
  // ---------------------------------------------------------------------------
  test('Acceptance 1: Every saler feature across Phases 4–10 is reachable within two clicks', () => {
    // 15 core Phase 4-10 Saler tools
    const expectedTools = [
      'virtual_storefront', // Storefront Builder
      'sourcing',           // Sourcing Catalog
      'ai_creative_studio', // Creative Studio
      'product_bundling',   // Combo Bundling & Surge
      'whatsapp_bridge',    // Unified Multi-Channel Inbox
      'daily_quests',       // Daily Quests & Coins
      'social_seller_kit',  // Social Kit & Flyers
      'live_commerce',      // Live Stream Studio
      'referral_engine',    // Referral Network Hub
      'core',               // Analytics (/saler/analytics) & Vault (/saler/vault)
      'sponsored_ads',      // Sponsored Ads Manager
      'gamification',       // Seller Leaderboard
      'seller_academy',     // Seller Academy
      'cart_recovery',      // Abandoned Cart Recovery
    ];

    const salerNavItems = navItems.filter((i) => i.roles.includes('saler'));
    assert.ok(salerNavItems.length >= 15, `Expected at least 15 saler nav items, found ${salerNavItems.length}`);

    expectedTools.forEach((toolModule) => {
      const match = salerNavItems.find((i) => i.module === toolModule);
      assert.ok(match, `Saler tool module ${toolModule} must have an accessible route`);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Analytics Figures Reconcile with Orders & Ledger (Acceptance 2)
  // ---------------------------------------------------------------------------
  test('Acceptance 2: Analytics figures reconcile exactly with the ledger and order data', async () => {
    const mockTrends = [
      { date_str: '2026-08-01', label: 'Aug 01', gross_sales: '2400.00', net_profit: '480.00', orders_count: 2 },
      { date_str: '2026-08-02', label: 'Aug 02', gross_sales: '3600.00', net_profit: '720.00', orders_count: 3 },
      { date_str: '2026-08-03', label: 'Aug 03', gross_sales: '1800.00', net_profit: '360.00', orders_count: 1 },
    ];

    const mockTopProducts = [
      {
        product_id: 1,
        title_en: 'Tangail Handloom Saree',
        title_bn: 'তাঁতের শাড়ি',
        slug: 'tangail-saree',
        custom_retail_price: '2200.00',
        default_retail_price: '2000.00',
        units_sold: 4,
        total_margin_earned: '880.00',
        stock_qty: 45,
      },
    ];

    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM generate_series')) {
          return { rows: mockTrends };
        }
        if (sql.includes('FROM saler_store_items ssi') && sql.includes('ORDER BY units_sold DESC')) {
          return { rows: mockTopProducts };
        }
        if (sql.includes('FROM short_links') && sql.includes('source_channel')) {
          return {
            rows: [
              {
                total_clicks: 120,
                whatsapp_clicks: 60,
                facebook_clicks: 40,
                flyer_clicks: 15,
                direct_clicks: 5,
              },
            ],
          };
        }
        if (sql.includes('FROM sub_orders so') && sql.includes('JOIN orders o')) {
          return {
            rows: [
              { district: 'Dhaka', order_count: 4, gmv: '5200.00' },
              { district: 'Chittagong', order_count: 2, gmv: '2600.00' },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const analytics = await salerService.getSalerAnalytics(mockDb, 5, { range: '30d' });

    // Mathematical reconciliation checks
    assert.equal(analytics.summary.total_gross_sales, '7800.00', 'Sum of gross sales must equal 2400 + 3600 + 1800 = 7800.00');
    assert.equal(analytics.summary.total_net_profit, '1560.00', 'Sum of net profits must equal 480 + 720 + 360 = 1560.00');
    assert.equal(analytics.summary.total_orders, 6, 'Total orders must equal 2 + 3 + 1 = 6');

    // Conversion rate check: (6 orders / 120 visitors) * 100 = 5.00%
    assert.equal(analytics.summary.conversion_rate_pct, 5.0, 'Conversion rate must be (6/120)*100 = 5%');
    assert.equal(analytics.top_products.length, 1);
    assert.equal(analytics.traffic_sources.length, 4);
    assert.equal(analytics.district_distribution.length, 2);
  });

  // ---------------------------------------------------------------------------
  // 3. Brand-New Saler Onboarding Checklist (Acceptance 3)
  // ---------------------------------------------------------------------------
  test('Acceptance 3: A brand-new saler sees the onboarding checklist rather than an empty dashboard', async () => {
    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM virtual_stores vs')) {
          return {
            rows: [
              {
                id: 10,
                slug: 'new-seller-store',
                shop_name: 'New Store',
                curated_products_count: 0, // No products yet
                shelves_count: 0,
              },
            ],
          };
        }
        if (sql.includes('FROM sub_orders so')) {
          return {
            rows: [
              {
                total_orders: 0, // 0 orders
                today_orders_count: 0,
                today_gross_sales: '0.00',
                today_net_profit: '0.00',
                profit_30d: '0.00',
                pending_fulfillment_count: 0,
                delivered_orders_count: 0,
                returned_orders_count: 0,
              },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const overview = await salerService.getSalerOverview(mockDb, 99);

    assert.ok(overview.onboarding, 'Onboarding object must be present');
    assert.equal(overview.onboarding.is_brand_new, true, 'Saler with 0 orders and 0 products must be marked is_brand_new = true');
    assert.equal(overview.onboarding.steps.length, 4, 'Onboarding must have 4 clear steps');

    // Verify 15-second walkthrough presence on every step
    overview.onboarding.steps.forEach((step) => {
      assert.equal(step.video_duration, '15s', 'Every onboarding step must provide a 15-second video guide');
      assert.ok(step.video_title_en.includes('15s'), 'Video title must state 15s');
      assert.ok(step.action_url.startsWith('/saler'), 'Action URL must be direct saler route');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Simple Mode Constraints (Acceptance 4)
  // ---------------------------------------------------------------------------
  test('Acceptance 4: Simple Mode shows at most 6 primary actions (Add Product, Share Store, Check Earnings, Messages, Orders, Help)', () => {
    const salerSimpleItems = SIMPLE_MODE_ITEMS.saler;

    assert.ok(Array.isArray(salerSimpleItems), 'SIMPLE_MODE_ITEMS.saler must be an array');
    assert.ok(salerSimpleItems.length <= 6, `Simple Mode must show at most 6 primary actions, found ${salerSimpleItems.length}`);
    assert.equal(salerSimpleItems.length, 6, 'Saler Simple Mode must have exactly 6 actions per ia-sitemap §4');

    const paths = salerSimpleItems.map((item) => item.path);
    assert.ok(paths.includes('/saler/products'), 'Must include Add Product');
    assert.ok(paths.includes('/saler/store-builder'), 'Must include Share Store');
    assert.ok(paths.includes('/saler/orders'), 'Must include Customer Orders');
    assert.ok(paths.includes('/saler/vault'), 'Must include Check Earnings');
    assert.ok(paths.includes('/saler/inbox'), 'Must include Customer Messages');
    assert.ok(paths.includes('/saler/academy'), 'Must include Help & Academy');
  });

  // ---------------------------------------------------------------------------
  // 5. Prescriptive AI Growth Assistant with 1-Click Actions (Acceptance 5)
  // ---------------------------------------------------------------------------
  test('Acceptance 5: Prescriptive Growth Assistant returns grounded advice with 1-click executable actions', async () => {
    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM saler_store_items ssi') && sql.includes('WHERE ssi.saler_id = $1')) {
          return {
            rows: [
              {
                product_id: 101,
                title_en: 'Organic Mustard Oil 500ml',
                title_bn: 'অর্গানিক সরিষার তেল',
                custom_retail_price: '450.00',
                default_retail_price: '400.00',
                units_sold: 2,
                best_peer_price: '420.00',
                best_peer_units_sold: 18,
              },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const growth = await salerService.getSalerGrowthRecommendations(mockDb, 5, 'en', {
      generateCompletion: async () => '1. Matching the top-seller price of ৳420 is projected to increase volume.',
    });

    assert.ok(Array.isArray(growth.recommendations), 'Recommendations must be an array');
    assert.ok(growth.recommendations.length >= 1, 'Should return at least 1 grounded recommendation');

    const firstRec = growth.recommendations[0];
    assert.ok(firstRec.action, 'Recommendation must contain 1-click actionable payload');
    assert.ok(firstRec.action.label_en, 'Action must have user-friendly label');
    assert.ok(firstRec.action.url, 'Action must specify direct execution/navigation URL');
  });

  // ---------------------------------------------------------------------------
  // 6. Fastify HTTP Endpoints (Acceptance 6)
  // ---------------------------------------------------------------------------
  test('Fastify HTTP API: Saler dashboard, analytics, onboarding, and growth assistant endpoints return 200', async () => {
    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM virtual_stores vs')) {
          return {
            rows: [
              {
                id: 1,
                slug: 'dhaka-trends',
                shop_name: 'Dhaka Trends',
                curated_products_count: 8,
                shelves_count: 2,
                is_active: true,
              },
            ],
          };
        }
        if (sql.includes('FROM sub_orders so')) {
          return {
            rows: [
              {
                total_orders: 14,
                today_orders_count: 3,
                today_gross_sales: '4200.00',
                today_net_profit: '840.00',
                profit_30d: '18500.00',
                pending_fulfillment_count: 2,
                delivered_orders_count: 12,
                returned_orders_count: 0,
              },
            ],
          };
        }
        if (sql.includes('FROM wallets')) {
          return {
            rows: [
              {
                available_balance: '14200.00',
                pending_escrow_balance: '3500.00',
              },
            ],
          };
        }
        if (sql.includes('FROM generate_series')) {
          return {
            rows: [
              { date_str: '2026-08-24', label: 'Aug 24', gross_sales: '4200.00', net_profit: '840.00', orders_count: 3 },
            ],
          };
        }
        if (sql.includes('ai_usage_logs') || sql.includes('ai_spend') || sql.includes('cost_usd')) {
          return { rows: [{ total: '0.00' }] };
        }
        return { rows: [] };
      },
    });

    const app = Fastify();
    app.decorate('db', mockDb);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 5, role: 'saler' };
    });
    app.decorate('requirePermission', () => async () => {});

    app.register(errorHandlerPlugin);
    await app.register(salerRoutes, { prefix: '/api/v1' });
    await app.ready();

    // 1. GET /api/v1/saler/dashboard
    const resDash = await app.inject({ method: 'GET', url: '/api/v1/saler/dashboard' });
    assert.equal(resDash.statusCode, 200);
    assert.equal(resDash.json().success, true);
    assert.equal(resDash.json().data.store.slug, 'dhaka-trends');
    assert.equal(resDash.json().data.metrics.total_orders, 14);

    // 2. GET /api/v1/saler/analytics
    const resAnalytics = await app.inject({ method: 'GET', url: '/api/v1/saler/analytics?range=7d' });
    assert.equal(resAnalytics.statusCode, 200);
    assert.equal(resAnalytics.json().success, true);
    assert.equal(resAnalytics.json().data.range, '7d');

    // 3. GET /api/v1/saler/onboarding
    const resOnboarding = await app.inject({ method: 'GET', url: '/api/v1/saler/onboarding' });
    assert.equal(resOnboarding.statusCode, 200);
    assert.equal(resOnboarding.json().success, true);
    assert.equal(resOnboarding.json().data.total_steps, 4);

    // 4. GET /api/v1/saler/growth-assistant
    const resGrowth = await app.inject({ method: 'GET', url: '/api/v1/saler/growth-assistant' });
    assert.equal(resGrowth.statusCode, 200);
    assert.equal(resGrowth.json().success, true);
    assert.ok(Array.isArray(resGrowth.json().data.recommendations));

    await app.close();
  });

});
