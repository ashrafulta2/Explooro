/**
 * referralBonusEvents.test.js — SIGNUP, FIRST_SALE and KYC_VERIFIED pay a fixed bonus, not a percentage.
 *
 * Invariants:
 *  1. FIRST_ORDER stays a % of the order; the other three pay the configured taka amount, 0 = off.
 *  2. Tier 2 is scaled by the tier_2 : tier_1 ratio; a configured 0% rate stays 0 (it used to become 5%).
 *  3. The admin form validates the three bonus fields strictly and round-trips them.
 *  4. Each event is fired from its real trigger and pays only a referral waiting on that event.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as referral from '../src/services/referral.service.js';
import * as admin from '../src/services/referralAdmin.service.js';

const settings = { tier_1_rate_pct: 5, tier_2_rate_pct: 2, signup_bonus_bdt: 50, first_sale_bonus_bdt: 200, kyc_bonus_bdt: 100 };

describe('commissionFor', () => {
  test('FIRST_ORDER is a percentage of the order', () => {
    assert.deepEqual(referral.commissionFor('FIRST_ORDER', 1, { orderAmount: 1000, settings }), { amount: 50, ratePct: 5, baseAmount: 1000 });
    assert.equal(referral.commissionFor('FIRST_ORDER', 2, { orderAmount: 1000, settings }).amount, 20);
  });

  test('the other events pay the configured bonus and have no order base', () => {
    assert.equal(referral.commissionFor('SIGNUP', 1, { settings }).amount, 50);
    assert.equal(referral.commissionFor('FIRST_SALE', 1, { settings }).amount, 200);
    const kyc = referral.commissionFor('KYC_VERIFIED', 1, { settings });
    assert.deepEqual([kyc.amount, kyc.baseAmount], [100, null]);
  });

  test('tier 2 gets the bonus scaled by tier_2 / tier_1', () => {
    assert.equal(referral.commissionFor('FIRST_SALE', 2, { settings }).amount, 80); // 200 * 2/5
  });

  test('an unset or zero bonus pays nothing, and a zero tier-1 rate leaves tier 2 with nothing', () => {
    assert.equal(referral.commissionFor('SIGNUP', 1, { settings: { ...settings, signup_bonus_bdt: 0 } }).amount, 0);
    assert.equal(referral.commissionFor('KYC_VERIFIED', 1, { settings: { tier_1_rate_pct: 5 } }).amount, 0);
    assert.equal(referral.commissionFor('SIGNUP', 2, { settings: { ...settings, tier_1_rate_pct: 0 } }).amount, 0);
  });
});

describe('admin rules form', () => {
  test('the bonus fields round-trip and are validated strictly', () => {
    assert.deepEqual(admin.validateReferralRulesPatch({ signup_bonus_bdt: 75, kyc_bonus_bdt: 0 }), { signup_bonus_bdt: 75, kyc_bonus_bdt: 0 });
    assert.equal(admin.toReferralRules({ first_sale_bonus_bdt: 200 }).first_sale_bonus_bdt, 200);
    assert.equal(admin.toReferralRules({}).signup_bonus_bdt, 0);
    for (const bad of [{ signup_bonus_bdt: -1 }, { kyc_bonus_bdt: 5001 }, { first_sale_bonus_bdt: '10' }]) {
      assert.throws(() => admin.validateReferralRulesPatch(bad), (e) => e.code === 'VALIDATION_ERROR', JSON.stringify(bad));
    }
  });
});

describe('evaluateQualifyingEvent with a fixed bonus', () => {
  function makeDb(eventRows) {
    const log = { ledger: [], earnings: [], referralQueries: [] };
    const query = async (sql, params = []) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('FROM platform_modules')) {
        return { rows: [{ key: 'referral_engine', is_enabled: true, default_enabled: true, settings_json: { ...settings, holding_period_days: 7, max_tier_depth: 2 } }] };
      }
      if (sql.includes('FROM referrals') && sql.includes('qualifying_event = $2')) {
        log.referralQueries.push(params);
        return { rows: eventRows.filter((r) => r.qualifying_event === params[1]) };
      }
      if (sql.includes('UPDATE referrals')) return { rows: [] };
      if (sql.includes('FROM roles r')) return { rows: [{ id: 1 }] };
      if (sql.includes('FROM wallets') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 1, user_id: 1, available_balance: '9999.00', pending_escrow_balance: '0.00', held_balance: '0.00', version: 0 }, { id: 10, user_id: 10, available_balance: '0.00', pending_escrow_balance: '0.00', held_balance: '0.00', version: 0 }] };
      }
      if (sql.includes('FROM wallets')) return { rows: [{ id: Number(params[0]) === 1 ? 1 : 10, user_id: Number(params[0]), available_balance: '9999.00', pending_escrow_balance: '0.00', held_balance: '0.00', version: 0 }] };
      if (sql.includes('INSERT INTO wallets')) return { rows: [{ id: 10, user_id: Number(params[0]) }] };
      if (sql.includes('UPDATE wallets')) return { rows: [{ id: params[params.length - 1] }] };
      if (sql.includes('INSERT INTO ledger_transactions')) { log.ledger.push({ type: params[2], amount: params[3] }); return { rows: [{ id: log.ledger.length }] }; }
      if (sql.includes('INSERT INTO referral_earnings')) {
        log.earnings.push({ commission: params[7], order_amount: params[5], rate: params[6], trigger: params[3] });
        return { rows: [{ id: 1, commission_amount: params[7] }] };
      }
      return { rows: [] };
    };
    return { query, log, connect: async () => ({ query, release: () => {} }) };
  }
  const row = (event) => ({ id: 7, ref: 'REF-LINK-X', referrer_user_id: 10, referred_user_id: 20, tier_level: 1, status: 'PENDING', qualifying_event: event });

  test('a referral waiting on KYC_VERIFIED earns the KYC bonus with no order base', async () => {
    const db = makeDb([row('KYC_VERIFIED')]);
    const out = await referral.evaluateQualifyingEvent(db, null, { userId: 20, eventType: 'KYC_VERIFIED' });
    assert.equal(out.length, 1);
    assert.deepEqual(db.log.earnings[0], { commission: '100.00', order_amount: null, rate: '5.00', trigger: 'KYC_VERIFIED_COMPLETED' });
    assert.equal(db.log.ledger.length, 2);
  });

  test('an event the referral is not waiting on pays nothing', async () => {
    const db = makeDb([row('FIRST_ORDER')]);
    assert.deepEqual(await referral.evaluateQualifyingEvent(db, null, { userId: 20, eventType: 'SIGNUP' }), []);
    assert.equal(db.log.earnings.length, 0);
  });
});
