/**
 * tierBonuses.test.js — trust-tier Saler split bonuses come from the `finance.tier_bonuses`
 * setting: the Finance list, the simulator and the save endpoint must all agree on it.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getProfitSplits,
  updateTierBonuses,
  simulateSplit,
} from '../src/controllers/finance.controller.js';
import { resolveTierBonuses } from '../src/services/pricing.service.js';

// In-memory platform_settings that understands only the statements these paths issue.
function createDb(initial) {
  const settings = new Map();
  if (initial) settings.set('finance.tier_bonuses', initial);
  const audits = [];
  return {
    settings,
    audits,
    async query(sql, params = []) {
      if (/FROM platform_settings WHERE key = 'finance.tier_bonuses'/.test(sql)) {
        return { rows: settings.has('finance.tier_bonuses') ? [{ value_json: settings.get('finance.tier_bonuses') }] : [] };
      }
      if (/INSERT INTO platform_settings[\s\S]*'finance.tier_bonuses'/.test(sql)) {
        settings.set('finance.tier_bonuses', JSON.parse(params[0]));
        return { rows: [] };
      }
      if (/INSERT INTO audit_logs/.test(sql)) {
        audits.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function call(fn, db, { body = {}, params = {} } = {}) {
  const out = { status: 200, payload: null };
  const reply = {
    status(c) { out.status = c; return reply; },
    send(p) { out.payload = p; return reply; },
  };
  return fn({ server: { db }, params, body, user: { id: 1 }, ip: '127.0.0.1' }, reply).then(() => out);
}

const SAVED = [
  { tier: 'BRONZE', bonus_pct: 0 },
  { tier: 'SILVER', bonus_pct: 1.5 },
  { tier: 'GOLD', bonus_pct: 3 },
  { tier: 'PLATINUM', bonus_pct: 6 },
];

describe('Trust tier bonuses setting', () => {
  test('an unset setting means no bonus for any tier', async () => {
    const bonuses = await resolveTierBonuses(createDb());
    assert.deepEqual(bonuses, { BRONZE: 0, SILVER: 0, GOLD: 0, PLATINUM: 0 });
  });

  test('the Finance list and the simulator both use the stored bonus', async () => {
    const db = createDb(SAVED);

    const { payload } = await call(getProfitSplits, db);
    assert.equal(payload.data.tiers.find((t) => t.tier === 'GOLD').bonus_pct, 3);
    assert.equal(payload.data.tiers.find((t) => t.tier === 'PLATINUM').bonus_pct, 6);

    const sim = await call(simulateSplit, db, { body: { retail_price: 1000, supplier_cost: 700, tier: 'GOLD' } });
    assert.equal(sim.payload.data.tier_bonus_pct, 3);
    assert.equal(sim.payload.data.effective_saler_pct, sim.payload.data.base_saler_pct + 3);
  });

  test('saving stores only tier and bonus, and writes one audit row', async () => {
    const db = createDb([{ tier: 'GOLD', bonus_pct: 2 }]);
    const res = await call(updateTierBonuses, db, {
      body: { tiers: SAVED.map((t) => ({ ...t, name_en: 'display text' })), reason: 'Q4' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(db.settings.get('finance.tier_bonuses'), SAVED);
    assert.equal((await resolveTierBonuses(db)).SILVER, 1.5);
    assert.equal(db.audits.length, 1);
  });

  test('an unknown tier, duplicate, negative or oversized bonus is rejected and nothing is written', async () => {
    const bad = [
      [{ tier: 'DIAMOND', bonus_pct: 1 }],
      [{ tier: 'GOLD', bonus_pct: 1 }, { tier: 'GOLD', bonus_pct: 2 }],
      [{ tier: 'GOLD', bonus_pct: -1 }],
      [{ tier: 'GOLD', bonus_pct: 51 }],
      [{ tier: 'GOLD', bonus_pct: 'abc' }],
      [],
    ];
    for (const tiers of bad) {
      const db = createDb();
      const res = await call(updateTierBonuses, db, { body: { tiers } });
      assert.equal(res.status, 400, JSON.stringify(tiers));
      assert.equal(res.payload.error.code, 'TIER_BONUS_INVALID');
      assert.equal(db.settings.size, 0);
      assert.equal(db.audits.length, 0);
    }
  });
});
