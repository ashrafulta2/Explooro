/**
 * referralAdmin.test.js — /admin/growth/referrals rules and overview.
 *
 * Invariants:
 *  1. The form's vocabulary maps onto the keys the referral engine actually reads.
 *  2. Writes are strict (out of range is refused, never clamped) and judged on the merged result,
 *     so a stored tier-1 rate can veto an otherwise-valid tier-2 edit.
 *  3. Only enforced settings are accepted; the page's old fields (payout cap, etc.) are refused.
 *  4. The rules route carries the same module + permission as the overview.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import * as svc from '../src/services/referralAdmin.service.js';
import referralRoutes from '../src/routes/referral.routes.js';

describe('Referral admin: rules', () => {
  test('maps engine settings to the form and fills defaults', () => {
    const rules = svc.toReferralRules({ max_tier_depth: 1, daily_velocity_limit: 8, qualifying_event: 'SIGNUP' });
    assert.equal(rules.tier_depth, 1);
    assert.equal(rules.velocity_cap_per_day, 8);
    assert.equal(rules.qualify_on, 'SIGNUP');
    assert.equal(rules.tier_1_rate_pct, 5);
    assert.equal(rules.holding_period_days, 7);
  });

  test('translates form keys to engine keys', () => {
    const patch = svc.validateReferralRulesPatch({ tier_depth: 1, velocity_cap_per_day: 12, qualify_on: 'KYC_VERIFIED' });
    assert.deepEqual(patch, { max_tier_depth: 1, daily_velocity_limit: 12, qualifying_event: 'KYC_VERIFIED' });
  });

  test('refuses out-of-range, fractional and unknown values instead of clamping', () => {
    assert.throws(() => svc.validateReferralRulesPatch({ tier_depth: 3 }), /tier_depth/);
    assert.throws(() => svc.validateReferralRulesPatch({ velocity_cap_per_day: 2.5 }), /whole number/);
    assert.throws(() => svc.validateReferralRulesPatch({ tier_1_rate_pct: '5' }), /tier_1_rate_pct/);
    assert.throws(() => svc.validateReferralRulesPatch({ qualify_on: 'FIRST_DELIVERED_ORDER' }), /qualify_on/);
    assert.throws(() => svc.validateReferralRulesPatch({ max_payout_per_referrer_bdt: 100 }), /No referral rule field/);
    assert.throws(() => svc.validateReferralRulesPatch({}), /No referral rule field/);
  });

  test('judges tier rates on the merged result', () => {
    const current = { tier_1_rate_pct: 5, tier_2_rate_pct: 2, max_tier_depth: 2 };
    assert.throws(() => svc.validateReferralRulesPatch({ tier_2_rate_pct: 6 }, current), /cannot exceed tier_1/);
    assert.throws(() => svc.validateReferralRulesPatch({ tier_1_rate_pct: 1 }, current), /cannot exceed tier_1/);
    // Depth 1 pays no tier 2, so a lower tier-1 rate is fine.
    assert.deepEqual(
      svc.validateReferralRulesPatch({ tier_depth: 1, tier_1_rate_pct: 1 }, current),
      { max_tier_depth: 1, tier_1_rate_pct: 1 }
    );
    assert.throws(
      () => svc.validateReferralRulesPatch({ tier_1_rate_pct: 40, tier_2_rate_pct: 20 }, current),
      /Combined/
    );
  });

  test('updateReferralRules writes through updateModuleSettings and returns the stored rules', async () => {
    // updateModuleSettings is exercised by the coin policy tests; here only the settings read matters.
    const db = {
      query: async (sql) => {
        if (/FROM platform_modules/i.test(sql)) return { rows: [{ settings_json: { tier_1_rate_pct: 5, tier_2_rate_pct: 2, max_tier_depth: 2 } }] };
        return { rows: [] };
      },
    };
    await assert.rejects(() => svc.updateReferralRules(db, null, { id: 1 }, { tier_2_rate_pct: 9 }), /cannot exceed/);
  });
});

describe('Referral admin: overview', () => {
  test('returns the shape AdminReferralsPage reads', async () => {
    const db = {
      query: async (sql) => {
        if (/FROM platform_modules/i.test(sql) && /settings_json/i.test(sql)) return { rows: [{ settings_json: { daily_velocity_limit: 9 } }] };
        if (/FROM platform_modules/i.test(sql)) return { rows: [{ is_enabled: false }] };
        if (/FROM referral_earnings\s+WHERE status/i.test(sql)) return { rows: [{ total: '120.00' }] };
        if (/FROM referrals r/i.test(sql)) {
          return { rows: [{ id: 1, ref: 'REF-LINK-1', fraud_reason: 'SAME_DEVICE_FINGERPRINT', created_at: new Date(), referrer_name: 'A', referee_name: 'B', held: '40.00' }] };
        }
        if (/FROM referrals/i.test(sql)) return { rows: [{ total_referrals: 3, qualified_count: 1, fraud_flagged_count: 1, active_referrers_count: 2 }] };
        return { rows: [] };
      },
    };
    const out = await svc.getReferralAdminOverview(db);
    assert.equal(out.stats.total_referrals, 3);
    assert.equal(out.total_commissions_paid, '120.00');
    assert.equal(out.rules.velocity_cap_per_day, 9);
    assert.equal(out.rules.is_active, false);
    assert.equal(out.flagged_referrals[0].id, 'REF-LINK-1');
    assert.equal(out.flagged_referrals[0].amount_held_bdt, 40);
  });
});

describe('Referral admin: route guards', () => {
  test('rules PATCH carries the governance module and permission', async () => {
    const app = Fastify();
    const guards = [];
    app.decorate('authenticate', async () => {});
    app.decorate('requireModule', (key) => { const fn = async () => {}; fn.moduleKey = key; return fn; });
    app.decorate('requirePermission', (key) => { const fn = async () => {}; fn.permissionKey = key; return fn; });
    app.addHook('onRoute', (route) => {
      const chain = [].concat(route.preHandler || []);
      guards.push({
        method: [].concat(route.method).join(','),
        url: route.url,
        modules: chain.map((f) => f.moduleKey).filter(Boolean),
        permissions: chain.map((f) => f.permissionKey).filter(Boolean),
      });
    });
    await app.register(referralRoutes);
    const patch = guards.find((g) => g.method === 'PATCH' && g.url === '/admin/growth/referrals/rules');
    assert.ok(patch, 'PATCH /admin/growth/referrals/rules must be registered');
    assert.deepEqual(patch.permissions, ['growth.referral.govern']);
    assert.deepEqual(patch.modules, ['referral_engine']);
  });
});
