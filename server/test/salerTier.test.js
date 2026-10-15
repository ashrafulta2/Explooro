/**
 * salerTier.test.js — tiered shop partner commission.
 *
 * Invariants:
 *   - switch OFF, no tier row, or BRONZE => the split is EXACTLY what it was before;
 *   - a tier moves points platform -> saler, and the two still sum to the same total;
 *   - the tier bonus stacks with the Shop Partner Pro rebate but the pair can never exceed the platform share;
 *   - an admin's per-product override is never altered by a tier;
 *   - the ladder must rise, and a malformed setting falls back instead of promoting anyone;
 *   - the job promotes on volume, demotes when sales stop, and audits only real changes.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSplitPercentages } from '../src/services/pricing.service.ts';
import {
  DEFAULT_RULES, nextTierInfo, parseTierBonuses, pickTierKey, resolveRules, validateRules,
} from '../src/services/salerTierBonus.ts';
import { recomputeAll, getSalerView } from '../src/services/salerTier.service.ts';

const BONUSES = [
  { tier: 'BRONZE', bonus_pct: 0 }, { tier: 'SILVER', bonus_pct: 1 },
  { tier: 'GOLD', bonus_pct: 2 }, { tier: 'PLATINUM', bonus_pct: 5 },
];
const ON = { enabled: true, window_days: 30, thresholds: { SILVER: 50000, GOLD: 150000, PLATINUM: 400000 } };

/** Fake db answering only the queries pricing makes for a shop partner. */
function pricingDb({ rules = ON, tier = null, proRebate = null, productRule = null, bonuses = BONUSES } = {}) {
  return {
    async query(sql) {
      if (sql.includes('FROM commission_rules') && sql.includes("'PRODUCT'")) return { rows: productRule ? [productRule] : [] };
      if (sql.includes('FROM commission_rules')) return { rows: [] };
      if (sql.includes('saler_commission_tiers')) return { rows: [{ rules, bonuses, tier }] };
      if (sql.includes('commission.default_splits')) return { rows: [{ value_json: { saler_split_pct: 40, platform_split_pct: 60 } }] };
      if (sql.includes('FROM platform_modules')) return { rows: [{ key: 'subscription_fees', is_enabled: proRebate !== null, default_enabled: false }] };
      if (sql.includes('FROM module_targeting_rules')) return { rows: [] };
      if (sql.includes('FROM subscriptions')) return { rows: proRebate === null ? [] : [{ commission_rebate_pct: String(proRebate) }] };
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  };
}

describe('pure ladder helpers', () => {
  const t = ON.thresholds;
  test('pickTierKey picks the highest tier reached and never returns null', () => {
    assert.equal(pickTierKey(0, t), 'BRONZE');
    assert.equal(pickTierKey(49999.99, t), 'BRONZE');
    assert.equal(pickTierKey(50000, t), 'SILVER');
    assert.equal(pickTierKey(399999, t), 'GOLD');
    assert.equal(pickTierKey(9e9, t), 'PLATINUM');
    assert.equal(pickTierKey('junk', t), 'BRONZE');
  });

  test('nextTierInfo reports the gap, and null at the top', () => {
    assert.deepEqual(nextTierInfo('BRONZE', 20000, t), { tier: 'SILVER', min_volume: 50000, remaining: 30000 });
    assert.equal(nextTierInfo('PLATINUM', 1e9, t), null);
  });

  test('resolveRules: a ladder that does not rise is discarded as a whole', () => {
    const out = resolveRules({ enabled: true, thresholds: { SILVER: 100, GOLD: 90, PLATINUM: 500 } });
    assert.deepEqual(out.thresholds, DEFAULT_RULES.thresholds);
    assert.equal(out.enabled, true);
  });

  test('resolveRules: junk is off, with default window', () => {
    for (const raw of [null, undefined, 'x', { enabled: 'yes', window_days: 2 }]) {
      const out = resolveRules(raw);
      assert.equal(out.enabled, false);
      assert.equal(out.window_days, 30);
    }
  });

  test('validateRules refuses instead of clamping', () => {
    assert.deepEqual(validateRules(ON), ON);
    assert.throws(() => validateRules({ ...ON, window_days: 3 }), /window_days/);
    assert.throws(() => validateRules({ ...ON, enabled: 'true' }), /enabled/);
    assert.throws(() => validateRules({ ...ON, thresholds: { SILVER: 100, GOLD: 100, PLATINUM: 200 } }), /GOLD/);
  });

  test('parseTierBonuses: missing or malformed tiers pay 0', () => {
    assert.deepEqual(parseTierBonuses(undefined), { BRONZE: 0, SILVER: 0, GOLD: 0, PLATINUM: 0 });
    assert.equal(parseTierBonuses([{ tier: 'GOLD', bonus_pct: -2 }]).GOLD, 0);
    assert.equal(parseTierBonuses(BONUSES).PLATINUM, 5);
  });
});

describe('resolveSplitPercentages with a tier', () => {
  test('GOLD, switch on => 42/58', async () => {
    const out = await resolveSplitPercentages(pricingDb({ tier: 'GOLD' }), { salerId: 7 });
    assert.equal(out.salerSplitPct, 42);
    assert.equal(out.platformSplitPct, 58);
    assert.equal(out.ruleSource, 'PLATFORM_SETTINGS+TIER_BONUS');
  });

  test('the bonus is whatever finance.tier_bonuses stores, not a constant', async () => {
    const bonuses = [{ tier: 'SILVER', bonus_pct: 3.5 }];
    const out = await resolveSplitPercentages(pricingDb({ tier: 'SILVER', bonuses }), { salerId: 7 });
    assert.equal(out.salerSplitPct, 43.5);
  });

  test('switch OFF => identical to a shop partner with no tier at all', async () => {
    const off = await resolveSplitPercentages(pricingDb({ tier: 'PLATINUM', rules: { ...ON, enabled: false } }), { salerId: 7 });
    const none = await resolveSplitPercentages(pricingDb({ tier: null }), { salerId: 7 });
    assert.deepEqual(off, none);
    assert.equal(off.salerSplitPct, 40);
  });

  test('BRONZE, or no row yet => unchanged', async () => {
    for (const tier of ['BRONZE', null]) {
      const out = await resolveSplitPercentages(pricingDb({ tier }), { salerId: 7 });
      assert.equal(out.salerSplitPct, 40);
      assert.equal(out.ruleSource, 'PLATFORM_SETTINGS');
    }
  });

  test('stacks with the Shop Partner Pro rebate and the sum is preserved', async () => {
    const out = await resolveSplitPercentages(pricingDb({ tier: 'GOLD', proRebate: 2 }), { salerId: 7 });
    assert.equal(out.salerSplitPct, 44);
    assert.equal(out.platformSplitPct, 56);
    assert.equal(out.salerSplitPct + out.platformSplitPct, 100);
    assert.equal(out.ruleSource, 'PLATFORM_SETTINGS+PRO_REBATE+TIER_BONUS');
  });

  test('can never push the platform share below zero', async () => {
    const productless = pricingDb({ tier: 'PLATINUM', bonuses: [{ tier: 'PLATINUM', bonus_pct: 90 }] });
    const out = await resolveSplitPercentages(productless, { salerId: 7 });
    assert.equal(out.platformSplitPct, 0);
    assert.equal(out.salerSplitPct, 100);
  });

  test('no salerId => unchanged and the tier table is never queried', async () => {
    const db = pricingDb({ tier: 'GOLD' });
    const seen = [];
    const spy = { query: (sql, p) => { seen.push(sql); return db.query(sql, p); } };
    const out = await resolveSplitPercentages(spy, {});
    assert.equal(out.salerSplitPct, 40);
    assert.equal(seen.some((s) => s.includes('saler_commission_tiers')), false);
  });

  test('a product override is left alone', async () => {
    const productRule = { saler_split_pct: '50', platform_split_pct: '50' };
    const out = await resolveSplitPercentages(pricingDb({ tier: 'GOLD', productRule }), { salerId: 7, productId: 1 });
    assert.equal(out.salerSplitPct, 50);
    assert.equal(out.ruleSource, 'PRODUCT_OVERRIDE');
  });

  test('a failing tier lookup surfaces instead of paying the wrong split', async () => {
    const db = pricingDb({ tier: 'GOLD' });
    const broken = { query: (sql, p) => (sql.includes('saler_commission_tiers') ? Promise.reject(new Error('db down')) : db.query(sql, p)) };
    await assert.rejects(() => resolveSplitPercentages(broken, { salerId: 7 }), /db down/);
  });
});

/** Fake db for the job: holds the tier table and the delivered-volume rows. */
function jobDb({ rules = ON, volumes = [], tiers = [] } = {}) {
  const table = new Map(tiers.map((t) => [String(t.saler_id), t.tier]));
  const audits = [];
  return {
    table,
    audits,
    async query(sql, params) {
      if (sql.includes('FROM platform_settings')) {
        return { rows: [{ key: 'saler.commission_tiers', value_json: rules }, { key: 'finance.tier_bonuses', value_json: BONUSES }] };
      }
      if (sql.includes('FROM sub_orders')) return { rows: volumes };
      if (sql.includes('SELECT saler_id, tier FROM saler_commission_tiers')) {
        return { rows: [...table].map(([saler_id, tier]) => ({ saler_id, tier })) };
      }
      if (sql.includes('INSERT INTO saler_commission_tiers')) {
        table.set(String(params[0]), params[1]);
        return { rows: [] };
      }
      if (sql.includes('FROM saler_commission_tiers WHERE saler_id')) {
        const tier = table.get(String(params[0]));
        return { rows: tier ? [{ tier, volume: '60000.00', computed_at: null }] : [] };
      }
      if (sql.includes('audit_logs')) { audits.push(params); return { rows: [{ id: 1 }] }; }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  };
}

describe('recomputeAll', () => {
  test('does nothing while the switch is off', async () => {
    const db = jobDb({ rules: { ...ON, enabled: false }, volumes: [{ saler_id: 1, volume: '999999' }] });
    const r = await recomputeAll(db);
    assert.deepEqual(r, { evaluated: 0, changed: 0, skipped: true });
    assert.equal(db.table.size, 0);
  });

  test('promotes on volume, demotes shop partners who stopped selling, leaves the steady ones', async () => {
    const db = jobDb({
      volumes: [{ saler_id: 1, volume: '60000' }, { saler_id: 2, volume: '500000' }, { saler_id: 3, volume: '10' }],
      tiers: [{ saler_id: 2, tier: 'PLATINUM' }, { saler_id: 4, tier: 'GOLD' }],
    });
    const r = await recomputeAll(db);
    assert.equal(db.table.get('1'), 'SILVER');
    assert.equal(db.table.get('2'), 'PLATINUM');
    assert.equal(db.table.get('3'), 'BRONZE');
    assert.equal(db.table.get('4'), 'BRONZE'); // no sales in the window
    assert.equal(r.evaluated, 4);
    assert.equal(r.changed, 2); // saler 1 up, saler 4 down; 2 and 3 did not change
  });

  test('a second run changes nothing', async () => {
    const db = jobDb({ volumes: [{ saler_id: 1, volume: '60000' }] });
    await recomputeAll(db);
    assert.equal((await recomputeAll(db)).changed, 0);
  });
});

describe('getSalerView', () => {
  test('shows the tier, what it pays and the way to the next one', async () => {
    const db = jobDb({ tiers: [{ saler_id: 9, tier: 'SILVER' }] });
    const v = await getSalerView(db, 9);
    assert.equal(v.tier, 'SILVER');
    assert.equal(v.bonus_pct, 1);
    assert.equal(v.next.tier, 'GOLD');
    assert.equal(v.next.bonus_pct, 2);
    assert.equal(v.ladder.length, 4);
  });

  test('a shop partner with no row is BRONZE, and has no next step while the switch is off', async () => {
    const off = await getSalerView(jobDb({ rules: { ...ON, enabled: false } }), 5);
    assert.equal(off.tier, 'BRONZE');
    assert.equal(off.next, null);
  });
});
