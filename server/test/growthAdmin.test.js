/**
 * growthAdmin.test.js — Phase 9 admin surfaces (ads, quests, coin policy) and the coupon create route.
 *
 * Invariants:
 *  1. The coin policy form's vocabulary maps onto the keys the coin engine actually reads.
 *  2. Policy writes are strict (out of range / non-integer is refused, never clamped).
 *  3. Each admin endpoint demands its own permission AND module (nav guard == route guard).
 *  4. The streak curve is derived from the same settings the check-in uses.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import * as svc from '../src/services/growthAdmin.service.js';
import growthAdminRoutes from '../src/routes/growthAdmin.routes.js';
import promotionRoutes from '../src/routes/promotion.routes.js';

describe('Phase 9 admin: coin policy', () => {
  test('maps engine settings to the admin form and fills defaults', () => {
    const policy = svc.toCoinPolicy({ coins_per_bdt_redemption: 25, max_redemption_order_pct: 30 });
    assert.equal(policy.coins_per_bdt, 25);
    assert.equal(policy.max_redeem_pct_of_order, 30);
    assert.equal(policy.expiry_days, 365);
  });

  test('refuses out-of-range and non-integer values instead of clamping', () => {
    assert.throws(() => svc.validateCoinPolicyPatch({ max_redeem_pct_of_order: 150 }), /between 1 and 100/);
    assert.throws(() => svc.validateCoinPolicyPatch({ coins_per_bdt: 2.5 }), /whole number/);
    assert.throws(() => svc.validateCoinPolicyPatch({ expiry_days: '30' }), /whole number/);
    assert.throws(() => svc.validateCoinPolicyPatch({}), /No coin policy field/);
  });

  test('translates form keys to engine keys', () => {
    const patch = svc.validateCoinPolicyPatch({ coins_per_bdt: 20, max_redeem_pct_of_order: 15 });
    assert.deepEqual(patch, { coins_per_bdt_redemption: 20, max_redemption_order_pct: 15 });
  });
});

describe('Phase 9 admin: streak curve', () => {
  test('is derived from the check-in settings and capped', () => {
    const curve = svc.buildStreakCurve({ check_in_base_coins: 10, check_in_streak_step: 5, check_in_max_streak_coins: 20 });
    assert.equal(curve[0].multiplier, 1);
    assert.equal(curve[1].reward_coins, 15);
    assert.equal(curve[6].reward_coins, 20);
    assert.equal(curve[6].multiplier, 2);
  });
});

describe('Phase 9 admin: quests overview', () => {
  test('returns the shape AdminQuestsPage reads', async () => {
    const db = {
      query: async (sql) => {
        if (/FROM platform_modules/i.test(sql)) return { rows: [{ settings_json: { coins_per_bdt_redemption: 10 } }] };
        if (/FROM quests q/i.test(sql)) {
          return { rows: [{ id: 1, key: 'daily_login', title_en: 'Daily', title_bn: 'দৈনিক', cadence: 'DAILY', reward_coins: 10, target_count: 1, is_active: true, completions_today: 4 }] };
        }
        if (/FROM coin_balances/i.test(sql)) return { rows: [{ in_circulation: '1000', streakers: 3 }] };
        if (/entry_type = 'DEBIT'/i.test(sql)) return { rows: [{ redeemed: '200' }] };
        if (/entry_type = 'CREDIT'/i.test(sql)) return { rows: [{ name: 'A', district: 'Dhaka', coins_earned_30d: 90, streak_days: 2 }] };
        return { rows: [] };
      },
    };
    const out = await svc.getQuestsOverview(db);
    assert.equal(out.quests[0].frequency, 'DAILY');
    assert.equal(out.quests[0].completions_today, 4);
    assert.equal(out.economy.total_liability_bdt, 100);
    assert.equal(out.economy.active_daily_streakers, 3);
    assert.equal(out.leaderboard[0].rank, 1);
    assert.equal(out.streak_curve.length, 7);
  });

  test('quest edits are validated and audited', async () => {
    const audits = [];
    const db = {
      query: async (sql) => {
        if (/^SELECT id, key/i.test(sql.trim())) return { rows: [{ id: 1, key: 'k', is_active: true, reward_coins: 10 }] };
        if (/^UPDATE quests/i.test(sql.trim())) return { rows: [{ id: 1, key: 'k', is_active: false, reward_coins: 10 }] };
        return { rows: [] };
      },
    };
    const auditService = { record: async (_db, row) => audits.push(row) };
    await assert.rejects(() => svc.updateQuest(db, { id: 1 }, 1, { reward_coins: -5 }, auditService), /reward_coins/);
    await assert.rejects(() => svc.updateQuest(db, { id: 1 }, 1, { is_active: 'no' }, auditService), /boolean/);
    const out = await svc.updateQuest(db, { id: 1, role: 'admin' }, 1, { is_active: false }, auditService);
    assert.equal(out.is_active, false);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].before.is_active, true);
    assert.equal(audits[0].after.is_active, false);
  });
});

describe('Phase 9 admin: ads overview', () => {
  test('aggregates campaigns and platform totals', async () => {
    const db = {
      query: async (sql) => {
        if (/FROM ad_campaigns c/i.test(sql)) {
          return { rows: [
            { id: 1, ref: 'ADC-1', title: 'A', placement: 'FEED', status: 'ACTIVE', targeting_json: {}, bid_amount: '3', daily_budget: '100', total_budget: '500', spent_amount: '50', today_spent_amount: '0', last_spent_date: new Date(), start_date: new Date(), end_date: null, impressions_count: '1000', clicks_count: '25', merchant_name: 'Shop', merchant_role: 'saler' },
          ] };
        }
        if (/FROM ad_clicks/i.test(sql)) return { rows: [{ n: 7 }] };
        return { rows: [] };
      },
    };
    const out = await svc.getAdsOverview(db);
    assert.equal(out.campaigns[0].merchant_role, 'SALER');
    assert.equal(out.campaigns[0].cpc_bdt, 2);
    assert.equal(out.stats.total_spend_bdt, 50);
    assert.equal(out.stats.fraud_blocked_clicks, 7);
    assert.equal(out.stats.active_campaigns, 1);
  });
});

describe('Phase 9 admin: campaign pause / resume', () => {
  function adDb(campaign) {
    const log = { updates: [], audits: [] };
    const db = {
      log,
      query: async (sql, params) => {
        if (/^SELECT id, ref, status/i.test(sql.trim())) return { rows: campaign && params[0] === campaign.id ? [campaign] : [] };
        if (/^UPDATE ad_campaigns/i.test(sql.trim())) {
          log.updates.push({ sql, params });
          const paused = /status = 'PAUSED'/.test(sql);
          return { rows: [{ id: campaign.id, ref: campaign.ref, status: paused ? 'PAUSED' : (campaign.start_date > new Date() ? 'SCHEDULED' : 'ACTIVE'), admin_paused_at: paused ? new Date() : null }] };
        }
        return { rows: [] };
      },
    };
    return db;
  }
  const auditSvc = (db) => ({ record: async (_d, row) => db.log.audits.push(row) });
  const actor = { id: 2, role: 'super_admin' };

  test('pause stamps the admin marker and writes a HIGH audit row', async () => {
    const db = adDb({ id: 5, ref: 'ADC-5', status: 'ACTIVE', start_date: new Date(0), admin_paused_at: null });
    const out = await svc.setCampaignState(db, actor, 5, 'pause', 'Misleading creative', auditSvc(db));
    assert.deepEqual([out.status, out.admin_paused], ['PAUSED', true]);
    assert.match(db.log.updates[0].sql, /admin_paused_at = now\(\)/);
    assert.equal(db.log.audits[0].action, 'growth.ad.admin_pause');
    assert.equal(db.log.audits[0].risk_tier, 'HIGH');
  });

  test('resume clears the marker and sends a not-yet-started campaign back to SCHEDULED', async () => {
    const future = new Date(Date.now() + 86400000);
    const db = adDb({ id: 5, ref: 'ADC-5', status: 'PAUSED', start_date: future, admin_paused_at: new Date() });
    const out = await svc.setCampaignState(db, actor, 5, 'resume', 'Creative fixed', auditSvc(db));
    assert.deepEqual([out.status, out.admin_paused], ['SCHEDULED', false]);
    assert.match(db.log.updates[0].sql, /start_date > now\(\)/);
    assert.deepEqual(db.log.updates[0].params, [5]);
  });

  test('refuses a missing reason, an unknown campaign, a non-running pause and a merchant-paused resume', async () => {
    const running = adDb({ id: 5, ref: 'ADC-5', status: 'ACTIVE', start_date: new Date(0), admin_paused_at: null });
    await assert.rejects(() => svc.setCampaignState(running, actor, 5, 'pause', ' ', auditSvc(running)), /reason/);
    await assert.rejects(() => svc.setCampaignState(running, actor, 99, 'pause', 'reason here', auditSvc(running)), (e) => e.code === 'CAMPAIGN_NOT_FOUND');
    await assert.rejects(() => svc.setCampaignState(running, actor, 5, 'resume', 'reason here', auditSvc(running)), (e) => e.code === 'CAMPAIGN_NOT_ADMIN_PAUSED');
    const done = adDb({ id: 6, ref: 'ADC-6', status: 'COMPLETED', start_date: new Date(0), admin_paused_at: null });
    await assert.rejects(() => svc.setCampaignState(done, actor, 6, 'pause', 'reason here', auditSvc(done)), (e) => e.code === 'CAMPAIGN_NOT_RUNNING');
    assert.equal(running.log.updates.length + done.log.updates.length, 0);
  });

  test('the merchant cannot resume a campaign the platform paused', async () => {
    const { toggleCampaignStatus } = await import('../src/services/ads.service.js');
    const db = { query: async () => ({ rows: [{ id: 5, status: 'PAUSED', admin_paused_at: new Date() }] }) };
    await assert.rejects(() => toggleCampaignStatus(db, null, 9, 5, 'ACTIVE'), (e) => e.code === 'CAMPAIGN_ADMIN_PAUSED');
  });

  test('pause and resume routes carry the ads module and permission', async () => {
    const app = Fastify();
    const found = [];
    app.decorate('authenticate', async () => {});
    app.decorate('requireModule', (key) => { const fn = async () => {}; fn.moduleKey = key; return fn; });
    app.decorate('requirePermission', (key) => { const fn = async () => {}; fn.permissionKey = key; return fn; });
    app.addHook('onRoute', (r) => found.push({ m: [].concat(r.method).join(','), u: r.url, chain: [].concat(r.preHandler || []) }));
    await app.register(growthAdminRoutes);
    for (const verb of ['pause', 'resume']) {
      const r = found.find((x) => x.m === 'POST' && x.u === `/admin/growth/ads/:id/${verb}`);
      assert.ok(r, `${verb} route must exist`);
      assert.deepEqual(r.chain.map((f) => f.permissionKey).filter(Boolean), ['growth.ad.govern']);
      assert.deepEqual(r.chain.map((f) => f.moduleKey).filter(Boolean), ['sponsored_ads']);
    }
  });
});

describe('Phase 9 admin: route guards', () => {
  async function build(plugin) {
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
    await app.register(plugin);
    return guards;
  }

  test('each endpoint carries its own module and permission', async () => {
    const guards = await build(growthAdminRoutes);
    const find = (m, u) => guards.find((g) => g.method === m && g.url === u);
    assert.deepEqual(find('GET', '/admin/growth/ads').permissions, ['growth.ad.govern']);
    assert.deepEqual(find('GET', '/admin/growth/ads').modules, ['sponsored_ads']);
    assert.deepEqual(find('GET', '/admin/growth/quests').permissions, ['growth.quest.govern']);
    assert.deepEqual(find('GET', '/admin/growth/coins').permissions, ['growth.coins.govern']);
    assert.deepEqual(find('PATCH', '/admin/growth/coins/policy').permissions, ['growth.coins.govern']);
    assert.deepEqual(find('PATCH', '/admin/growth/coins/policy').modules, ['loyalty_coins']);
    assert.deepEqual(find('PATCH', '/admin/growth/quests/:id').modules, ['daily_quests']);
  });

  test('admin coupon creation route exists and is permission-guarded', async () => {
    const guards = await build(promotionRoutes);
    const create = guards.find((g) => g.method === 'POST' && g.url === '/admin/growth/coupons');
    assert.ok(create, 'POST /admin/growth/coupons must be registered');
    assert.ok(create.permissions.length >= 1);
    assert.ok(create.modules.length >= 1);
  });
});
