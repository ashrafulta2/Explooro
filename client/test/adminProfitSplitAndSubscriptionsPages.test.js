/**
 * adminProfitSplitAndSubscriptionsPages.test.js
 *
 * Comprehensive client invariant tests for:
 * 1. Profit Splits Page (/admin/finance/splits)
 * 2. Subscriptions Management Page (/admin/finance/subscriptions)
 * 3. FinanceSubnav Component & Navigation Interconnections
 * 4. Bilingual Localization Parity (EN ↔ BN)
 * 5. Mock Handlers & Business Logic Integrity
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import adminHandlers from '../src/mocks/handlers/admin.js';
import { adminApi } from '../src/services/admin.api.js';
import { FinanceSubnav } from '../src/components/admin/FinanceSubnav.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function call(handlers, method, path, ctx = {}) {
  const entry = handlers.find((h) => h.method === method && h.path === path);
  assert.ok(entry, `no mock handler for ${method} ${path}`);
  const res = entry.handler({ params: {}, query: {}, body: {}, ...ctx });
  return res && res.status !== undefined ? res : { status: 200, body: res };
}

describe('Super Admin Profit Splits & Subscriptions Governance', () => {
  describe('1. Component Module & Export Integrity', () => {
    it('ProfitSplitsPage imports cleanly and exports a default mount function', async () => {
      const mod = await import('../src/pages/admin/ProfitSplitsPage.js');
      assert.ok(mod.default, 'ProfitSplitsPage has default export');
      assert.equal(typeof mod.default, 'function', 'ProfitSplitsPage export is a function');
    });

    it('SubscriptionsPage imports cleanly and exports a default mount function', async () => {
      const mod = await import('../src/pages/admin/SubscriptionsPage.js');
      assert.ok(mod.default, 'SubscriptionsPage has default export');
      assert.equal(typeof mod.default, 'function', 'SubscriptionsPage export is a function');
    });

    it('adminApi exposes full method suites for Profit Splits and Subscriptions', () => {
      const splitMethods = [
        'getProfitSplits',
        'updateGlobalSplit',
        'updateCategorySplit',
        'deleteCategorySplit',
        'updateTierBonuses',
        'simulateProfitSplit',
      ];
      for (const m of splitMethods) {
        assert.equal(typeof adminApi[m], 'function', `adminApi.${m} must be a function`);
      }

      const subMethods = [
        'getSubscriptions',
        'updateSubscriptionSettings',
        'createSubscriptionPlan',
        'updateSubscriptionPlan',
        'updateSubscriberStatus',
      ];
      for (const m of subMethods) {
        assert.equal(typeof adminApi[m], 'function', `adminApi.${m} must be a function`);
      }
    });

    it('FinanceSubnav component renders all 7 financial subpages with active indicator', () => {
      const originalDoc = globalThis.document;
      try {
        globalThis.document = {
          createElement(tag) {
            return {
              tagName: tag.toUpperCase(),
              className: '',
              setAttribute(k, v) { this[k] = String(v); },
              getAttribute(k) { return this[k]; },
              innerHTML: '',
            };
          },
        };

        const activeKey = 'splits';
        const navEl = FinanceSubnav({ activeKey });
        assert.ok(navEl, 'FinanceSubnav creates an element');
        assert.equal(navEl.tagName, 'NAV');
        assert.equal(navEl.className, 'finance-subnav');

        const expectedHrefs = [
          '/admin/finance',
          '/admin/finance/ledger',
          '/admin/finance/escrow',
          '/admin/finance/payouts',
          '/admin/finance/splits',
          '/admin/finance/b2b-escrow',
          '/admin/finance/subscriptions',
        ];

        for (const href of expectedHrefs) {
          assert.ok(navEl.innerHTML.includes(`href="${href}"`), `Subnav links ${href}`);
        }

        assert.ok(navEl.innerHTML.includes('finance-subnav__tab--active'), 'Active class rendered');
        assert.ok(navEl.innerHTML.includes('aria-current="page"'), 'aria-current page set');
      } finally {
        globalThis.document = originalDoc;
      }
    });
  });

  describe('2. Bilingual Localization Parity (EN ↔ BN)', () => {
    const en = JSON.parse(readFileSync(join(root, 'src/locales/en.json'), 'utf8'));
    const bn = JSON.parse(readFileSync(join(root, 'src/locales/bn.json'), 'utf8'));

    it('admin_splits dictionary has 100% key parity between en and bn', () => {
      assert.ok(en.admin_splits, 'en.json has admin_splits namespace');
      assert.ok(bn.admin_splits, 'bn.json has admin_splits namespace');

      const enKeys = Object.keys(en.admin_splits).sort();
      const bnKeys = Object.keys(bn.admin_splits).sort();

      assert.deepEqual(enKeys, bnKeys, 'admin_splits keys must match exactly between EN and BN');

      for (const k of enKeys) {
        assert.ok(typeof en.admin_splits[k] === 'string' && en.admin_splits[k].trim().length > 0, `en.admin_splits.${k} is non-empty`);
        assert.ok(typeof bn.admin_splits[k] === 'string' && bn.admin_splits[k].trim().length > 0, `bn.admin_splits.${k} is non-empty`);
      }
    });

    it('admin_subscriptions dictionary has 100% key parity between en and bn', () => {
      assert.ok(en.admin_subscriptions, 'en.json has admin_subscriptions namespace');
      assert.ok(bn.admin_subscriptions, 'bn.json has admin_subscriptions namespace');

      const enKeys = Object.keys(en.admin_subscriptions).sort();
      const bnKeys = Object.keys(bn.admin_subscriptions).sort();

      assert.deepEqual(enKeys, bnKeys, 'admin_subscriptions keys must match exactly between EN and BN');

      for (const k of enKeys) {
        assert.ok(typeof en.admin_subscriptions[k] === 'string' && en.admin_subscriptions[k].trim().length > 0, `en.admin_subscriptions.${k} is non-empty`);
        assert.ok(typeof bn.admin_subscriptions[k] === 'string' && bn.admin_subscriptions[k].trim().length > 0, `bn.admin_subscriptions.${k} is non-empty`);
      }
    });
  });

  describe('3. Profit Splits Mock Handlers & Calculations', () => {
    it('GET /admin/finance/splits returns policy, tiers, category splits and audit history', () => {
      const res = call(adminHandlers, 'GET', '/admin/finance/splits');
      assert.equal(res.status, 200);
      assert.ok(res.body.global, 'global policy present');
      assert.ok(typeof res.body.global.platform_split_pct === 'number');
      assert.ok(typeof res.body.global.saler_split_pct === 'number');
      assert.ok(Array.isArray(res.body.categories), 'categories is an array');
      assert.ok(Array.isArray(res.body.tiers), 'tiers is an array');
      assert.ok(Array.isArray(res.body.audit_log), 'audit_log is an array');
      assert.ok(res.body.metrics, 'metrics present');
    });

    it('PUT /admin/finance/splits/default updates global profit split policy', () => {
      const validRes = call(adminHandlers, 'PUT', '/admin/finance/splits/default', {
        body: { saler_split_pct: 42, platform_split_pct: 58, min_margin_pct: 6, reason: 'Q3 Policy Adjustment' },
      });
      assert.equal(validRes.status, 200);
      assert.equal(validRes.body.global.saler_split_pct, 42);
      assert.equal(validRes.body.global.platform_split_pct, 58);
      assert.equal(validRes.body.global.min_margin_pct, 6);
    });

    it('POST /admin/finance/splits/simulate computes exact integer-paisa split calculations', () => {
      const res = call(adminHandlers, 'POST', '/admin/finance/splits/simulate', {
        body: {
          retail_price: 1500,
          supplier_cost: 1000,
          category_id: 1, // Fashion
          tier: 'GOLD',
        },
      });

      assert.equal(res.status, 200);
      const data = res.body;
      assert.equal(data.gross_retail_margin, 500);
      assert.equal(data.supplier_payout, 1000);
      assert.ok(typeof data.saler_commission === 'number');
      assert.ok(typeof data.platform_share === 'number');

      // Exact integer paisa conservation: saler commission + platform share === gross margin
      const totalShare = Math.round((data.saler_commission + data.platform_share) * 100) / 100;
      assert.equal(totalShare, data.gross_retail_margin, 'Zero drift across split shares');
    });

    it('PUT and DELETE /admin/finance/splits/categories/:id manages category overrides', () => {
      // Set override
      const putRes = call(adminHandlers, 'PUT', '/admin/finance/splits/categories/:id', {
        params: { id: '4' },
        body: { saler_split_pct: 48, platform_split_pct: 52, reason: 'Home promo' },
      });
      assert.equal(putRes.status, 200);
      assert.equal(putRes.body.category.saler_split_pct, 48);
      assert.equal(putRes.body.category.is_override, true);

      // Reset override
      const delRes = call(adminHandlers, 'DELETE', '/admin/finance/splits/categories/:id', {
        params: { id: '4' },
      });
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.category.is_override, false);
    });

    it('PUT /admin/finance/splits/tiers updates reseller trust tier bonuses', () => {
      const newTiers = [
        { tier: 'BRONZE', name_en: 'Bronze', name_bn: 'ব্রোঞ্জ', bonus_pct: 0.0 },
        { tier: 'SILVER', name_en: 'Silver', name_bn: 'সিলভার', bonus_pct: 1.5 },
        { tier: 'GOLD', name_en: 'Gold', name_bn: 'গোল্ড', bonus_pct: 3.0 },
        { tier: 'PLATINUM', name_en: 'Platinum', name_bn: 'প্লাটিনাম', bonus_pct: 6.0 },
      ];
      const res = call(adminHandlers, 'PUT', '/admin/finance/splits/tiers', {
        body: { tiers: newTiers, reason: 'Updated Q3 tiers' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.tiers[3].bonus_pct, 6.0);
    });
  });

  describe('4. Subscriptions Mock Handlers & Plan Governance', () => {
    it('GET /admin/finance/subscriptions returns plans, metrics, subscribers and settings', () => {
      const res = call(adminHandlers, 'GET', '/admin/finance/subscriptions');
      assert.equal(res.status, 200);
      assert.ok(res.body.metrics, 'metrics present');
      assert.ok(typeof res.body.metrics.mrr_bdt === 'number');
      assert.ok(Array.isArray(res.body.plans), 'plans array present');
      assert.ok(Array.isArray(res.body.subscribers), 'subscribers array present');
      assert.ok(res.body.module, 'module settings present');
      assert.ok(typeof res.body.module.is_enabled === 'boolean');
    });

    it('PUT /admin/finance/subscriptions/settings toggles module and quota thresholds', () => {
      const res = call(adminHandlers, 'PUT', '/admin/finance/subscriptions/settings', {
        body: {
          is_enabled: true,
          grace_period_days: 7,
          free_listing_quota: 150,
        },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.settings.grace_period_days, 7);
      assert.equal(res.body.settings.free_listing_quota, 150);
      assert.equal(res.body.settings.is_enabled, true);
    });

    it('POST & PUT /admin/finance/subscriptions/plans manages recurring plans', () => {
      // Create new plan
      const createRes = call(adminHandlers, 'POST', '/admin/finance/subscriptions/plans', {
        body: {
          name_en: 'Enterprise Pilot',
          name_bn: 'এন্টারপ্রাইজ পাইলট',
          role: 'supplier',
          monthly_fee: 9999,
          free_listings: 50000,
          features_en: ['Dedicated Account Mgr', 'Zero Escrow Hold'],
          features_bn: ['ডেডিকেটেড অ্যাকাউন্ট ম্যানেজার'],
        },
      });
      assert.equal(createRes.status, 201);
      const newPlan = createRes.body.plan;
      assert.ok(newPlan.id);

      // Update plan price
      const updateRes = call(adminHandlers, 'PUT', '/admin/finance/subscriptions/plans/:id', {
        params: { id: newPlan.id },
        body: {
          monthly_fee: 8999,
          name_en: 'Enterprise Pilot (Discounted)',
        },
      });
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.body.plan.monthly_fee, 8999);
      assert.equal(updateRes.body.plan.name_en, 'Enterprise Pilot (Discounted)');
    });

    it('PATCH /admin/finance/subscriptions/subscribers/:id updates status or waives fees', () => {
      // Fee waiver action
      const waiveRes = call(adminHandlers, 'PATCH', '/admin/finance/subscriptions/subscribers/:id', {
        params: { id: '1' },
        body: {
          waived: true,
          waiver_reason: 'Platform promotion partner grant',
        },
      });
      assert.equal(waiveRes.status, 200);
      assert.equal(waiveRes.body.subscriber.status, 'WAIVED');
      assert.equal(waiveRes.body.subscriber.waived, true);

      // Status change to SUSPENDED
      const suspendRes = call(adminHandlers, 'PATCH', '/admin/finance/subscriptions/subscribers/:id', {
        params: { id: '1' },
        body: {
          status: 'SUSPENDED',
        },
      });
      assert.equal(suspendRes.status, 200);
      assert.equal(suspendRes.body.subscriber.status, 'SUSPENDED');
    });
  });

  describe('5. Router and Interconnection Invariants', () => {
    const mainJs = readFileSync(join(root, 'src/main.js'), 'utf8');

    it('main.js registers all Profit Splits and Subscriptions routes', () => {
      assert.ok(mainJs.includes("path: '/admin/finance/splits'"), 'splits route registered');
      assert.ok(mainJs.includes("path: '/admin/splits'"), 'splits alias registered');
      assert.ok(mainJs.includes("path: '/admin/finance/subscriptions'"), 'subscriptions route registered');
      assert.ok(mainJs.includes("path: '/admin/subscriptions'"), 'subscriptions alias registered');
    });

    // WHY rewritten: this used to assert on the literal `item.path !== '/admin/finance/splits'`
    // comparisons in main.js's hand-maintained stub-exclusion chain. That chain is gone — the stub
    // set is now DERIVED from the routes that actually exist, which is what made the drift it was
    // guarding against impossible in the first place. The invariant worth protecting is the
    // outcome: a nav path that a real page implements must never also get a RoleStubPage.
    it('real pages are never shadowed by a stub route', () => {
      assert.ok(
        mainJs.includes('const implementedPaths = new Set(featureRoutes.map((r) => r.path))'),
        'stub set is derived from the implemented routes'
      );
      assert.ok(
        mainJs.includes('.filter((item) => !implementedPaths.has(item.path))'),
        'navItems already covered by a real route are filtered out of stubRoutes'
      );
      // Comment lines are stripped first: the WHY note above the derivation quotes the old
      // comparison, and matching that would fail the very refactor it documents.
      const codeOnly = mainJs
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
      assert.ok(
        !codeOnly.includes("item.path !== '/"),
        'no hand-maintained path-exclusion chain remains for a new page to be forgotten from'
      );
    });

    it('ModuleRow deep-links subscription_fees to /admin/finance/subscriptions', () => {
      const moduleRowJs = readFileSync(join(root, 'src/components/admin/ModuleRow.js'), 'utf8');
      assert.ok(moduleRowJs.includes("'/admin/finance/subscriptions'"), 'ModuleRow has subscription_fees route');
    });

    it('gallery-registry.js registers specimens for Profit Splits and Subscriptions', () => {
      const galleryJs = readFileSync(join(root, 'src/pages/dev/gallery-registry.js'), 'utf8');
      assert.ok(galleryJs.includes("id: 'profit-splits-page'"), 'splits gallery specimen registered');
      assert.ok(galleryJs.includes("id: 'subscriptions-page'"), 'subscriptions gallery specimen registered');
    });
  });
});
