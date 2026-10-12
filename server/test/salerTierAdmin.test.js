/**
 * salerTierAdmin.test.js — the Finance splits screen's side of tiered commission: it reads the ladder from
 * `saler.commission_tiers`, saves bonuses and ladder in one request, and refuses a bad ladder whole.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getProfitSplits, updateTierBonuses } from '../src/controllers/finance.controller.js';

const BONUSES = [
  { tier: 'BRONZE', bonus_pct: 0 }, { tier: 'SILVER', bonus_pct: 1 },
  { tier: 'GOLD', bonus_pct: 2 }, { tier: 'PLATINUM', bonus_pct: 5 },
];
const RULES = { enabled: true, window_days: 60, thresholds: { SILVER: 20000, GOLD: 80000, PLATINUM: 300000 } };

function createDb({ rules } = {}) {
  const settings = new Map([['finance.tier_bonuses', BONUSES]]);
  if (rules) settings.set('saler.commission_tiers', rules);
  const audits = [];
  let recomputes = 0;
  return {
    settings,
    audits,
    get recomputes() { return recomputes; },
    async query(sql, params = []) {
      if (/key IN \(\$1, 'finance.tier_bonuses'\)/.test(sql)) {
        return { rows: [...settings].filter(([k]) => k === params[0] || k === 'finance.tier_bonuses').map(([key, value_json]) => ({ key, value_json })) };
      }
      const get = /FROM platform_settings WHERE key = '([^']+)'/.exec(sql);
      if (get) return { rows: settings.has(get[1]) ? [{ value_json: settings.get(get[1]) }] : [] };
      const put = /INSERT INTO platform_settings/.test(sql);
      if (put) {
        const key = sql.includes("'finance.tier_bonuses'") ? 'finance.tier_bonuses' : params[0];
        settings.set(key, JSON.parse(key === 'finance.tier_bonuses' ? params[0] : params[1]));
        return { rows: [] };
      }
      if (/INSERT INTO audit_logs/.test(sql)) { audits.push(params); return { rows: [] }; }
      if (/FROM sub_orders/.test(sql)) { recomputes += 1; return { rows: [] }; }
      return { rows: [] };
    },
  };
}

function call(fn, db, { body = {} } = {}) {
  const out = { status: 200, payload: null };
  const reply = { status(c) { out.status = c; return reply; }, send(p) { out.payload = p; return reply; } };
  return fn({ server: { db }, params: {}, body, user: { id: 1 }, ip: '127.0.0.1' }, reply).then(() => out);
}

describe('Finance splits: saler commission tier rules', () => {
  test('GET shows the stored ladder, and the criteria text is built from it', async () => {
    const { payload } = await call(getProfitSplits, createDb({ rules: RULES }));
    assert.deepEqual(payload.data.tier_rules, RULES);
    const gold = payload.data.tiers.find((t) => t.tier === 'GOLD');
    assert.equal(gold.min_volume, 80000);
    assert.match(gold.criteria_en, /80,000/);
    assert.match(gold.criteria_en, /60 days/);
    assert.equal(payload.data.metrics.max_tier_bonus, 5);
  });

  test('GET with nothing stored shows the shipped ladder, switched off', async () => {
    const { payload } = await call(getProfitSplits, createDb());
    assert.equal(payload.data.tier_rules.enabled, false);
    assert.equal(payload.data.tiers.find((t) => t.tier === 'SILVER').min_volume, 50000);
  });

  test('saving rules alone leaves the bonuses untouched, writes one audit row and re-tiers salers', async () => {
    const db = createDb();
    const res = await call(updateTierBonuses, db, { body: { rules: RULES, reason: 'Eid push' } });
    assert.equal(res.status, 200);
    assert.deepEqual(db.settings.get('saler.commission_tiers'), RULES);
    assert.deepEqual(db.settings.get('finance.tier_bonuses'), BONUSES);
    assert.equal(db.audits.length, 1);
    assert.equal(db.recomputes, 1);
  });

  test('saving bonuses and rules together applies both', async () => {
    const db = createDb();
    const tiers = BONUSES.map((t) => ({ ...t, bonus_pct: t.bonus_pct + 1 }));
    const res = await call(updateTierBonuses, db, { body: { tiers, rules: RULES } });
    assert.equal(res.status, 200);
    assert.equal(db.settings.get('finance.tier_bonuses')[3].bonus_pct, 6);
    assert.equal(db.settings.get('saler.commission_tiers').window_days, 60);
    assert.equal(db.audits.length, 1);
  });

  test('a ladder that does not rise is refused and nothing is written, bonuses included', async () => {
    const db = createDb();
    const tiers = BONUSES.map((t) => ({ ...t, bonus_pct: 9 }));
    const bad = { ...RULES, thresholds: { SILVER: 80000, GOLD: 80000, PLATINUM: 300000 } };
    const res = await call(updateTierBonuses, db, { body: { tiers, rules: bad } });
    assert.equal(res.status, 400);
    assert.equal(res.payload.error.code, 'TIER_RULES_INVALID');
    assert.deepEqual(db.settings.get('finance.tier_bonuses'), BONUSES);
    assert.equal(db.settings.has('saler.commission_tiers'), false);
    assert.equal(db.audits.length, 0);
  });

  test('out-of-range window or a non-boolean switch is refused, not clamped', async () => {
    for (const rules of [{ ...RULES, window_days: 3 }, { ...RULES, window_days: 400 }, { ...RULES, enabled: 'yes' }, null]) {
      const db = createDb();
      const res = await call(updateTierBonuses, db, { body: { rules } });
      assert.equal(res.status, 400, JSON.stringify(rules));
      assert.equal(db.settings.has('saler.commission_tiers'), false);
    }
  });

  test('a save that sends neither bonuses nor rules is still the old 400', async () => {
    const res = await call(updateTierBonuses, createDb(), { body: {} });
    assert.equal(res.payload.error.code, 'TIER_BONUS_INVALID');
  });
});
