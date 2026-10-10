/**
 * referralSimulate.test.js — the dry run pays with the engine's own arithmetic and writes nothing.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as referral from '../src/services/referral.service.js';

function makeDb(settings) {
  const statements = [];
  return {
    statements,
    query: async (sql) => {
      statements.push(sql);
      if (sql.includes('FROM platform_modules')) return { rows: [{ settings_json: settings }] };
      return { rows: [] };
    },
  };
}

const rules = { tier_1_rate_pct: 5, tier_2_rate_pct: 2, max_tier_depth: 2, holding_period_days: 7, qualifying_event: 'FIRST_ORDER', signup_bonus_bdt: 50, kyc_bonus_bdt: 100 };

describe('simulateEarnings', () => {
  test('a first order pays each tier its percentage of the order', async () => {
    const out = await referral.simulateEarnings(makeDb(rules), { eventType: 'FIRST_ORDER', orderAmount: 2500 });
    assert.equal(out.dry_run, true);
    assert.deepEqual(out.tiers, [
      { tier: 1, rate_pct: 5, amount: '125.00' },
      { tier: 2, rate_pct: 2, amount: '50.00' },
    ]);
    assert.equal(out.order_amount, '2500.00');
    assert.equal(out.pays_on_this_event, true);
    assert.equal(out.holding_period_days, 7);
  });

  test('a fixed-bonus event ignores the order and scales tier 2 by the rate ratio', async () => {
    const out = await referral.simulateEarnings(makeDb(rules), { eventType: 'SIGNUP', orderAmount: 99999 });
    assert.deepEqual(out.tiers, [
      { tier: 1, rate_pct: null, amount: '50.00' },
      { tier: 2, rate_pct: null, amount: '20.00' },
    ]);
    assert.equal(out.order_amount, null);
    assert.equal(out.pays_on_this_event, false);
  });

  test('max_tier_depth 1 shows only tier 1, and a bonus left unset pays 0', async () => {
    const out = await referral.simulateEarnings(makeDb({ ...rules, max_tier_depth: 1 }), { eventType: 'FIRST_SALE' });
    assert.deepEqual(out.tiers, [{ tier: 1, rate_pct: null, amount: '0.00' }]);
  });

  test('it only ever reads', async () => {
    const db = makeDb(rules);
    await referral.simulateEarnings(db, { eventType: 'FIRST_ORDER', orderAmount: 100 });
    assert.ok(db.statements.every((s) => /^\s*SELECT/i.test(s)), db.statements.join('\n'));
  });

  test('refuses an unknown event and an out-of-range amount', async () => {
    await assert.rejects(referral.simulateEarnings(makeDb(rules), { eventType: 'MINT' }), /event_type/);
    for (const bad of [-1, 'abc', referral.SIMULATION_MAX_ORDER_BDT + 1]) {
      await assert.rejects(referral.simulateEarnings(makeDb(rules), { orderAmount: bad }), /amount/);
    }
  });
});

describe('publicProgramRules', () => {
  test('exposes the earning rules and nothing else from settings_json', () => {
    const out = referral.publicProgramRules({ ...rules, daily_velocity_limit: 20, secret_note: 'x' });
    assert.equal(out.tier_1_rate_pct, 5);
    assert.equal('daily_velocity_limit' in out, false);
    assert.equal('secret_note' in out, false);
  });

  test('a configured 0 is kept, not replaced by the default', () => {
    assert.equal(referral.publicProgramRules({ tier_1_rate_pct: 0 }).tier_1_rate_pct, 0);
    assert.equal(referral.publicProgramRules({}).tier_1_rate_pct, 5);
  });
});
