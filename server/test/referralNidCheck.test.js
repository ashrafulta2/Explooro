/**
 * referralNidCheck.test.js — two accounts on one verified National ID are one person.
 *
 * The check used to look for KYC status 'APPROVED' (real value: 'VERIFIED') and compared against the
 * encrypted nid_number column, so it could never match. It now compares the keyed nid_hash.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as referral from '../src/services/referral.service.js';
import { hashNid } from '../src/services/kyc.service.js';

const settings = { tier_1_rate_pct: 5, tier_2_rate_pct: 2, signup_bonus_bdt: 0, kyc_bonus_bdt: 100, holding_period_days: 7, max_tier_depth: 2 };
const cache = { get: async () => null, set: async () => {} };

function makeDb({ referrerNidHash = null, nidMatch = false } = {}) {
  const log = { inserts: [], updates: [], codeSql: '' };
  const query = async (sql, params = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FROM platform_modules')) {
      return { rows: [{ key: 'referral_engine', is_enabled: true, default_enabled: true, settings_json: settings }] };
    }
    if (sql.includes('FROM user_referral_codes')) {
      log.codeSql = sql;
      return { rows: [{ id: 1, user_id: 10, code: 'REF-X', referrer_phone: '01700000000', referrer_nid_hash: referrerNidHash }] };
    }
    if (sql.includes('FROM kyc_verifications a')) return { rows: nidMatch ? [{ '?column?': 1 }] : [] };
    if (sql.includes('FROM referrals') && sql.includes('qualifying_event = $2')) {
      return { rows: [{ id: 7, ref: 'REF-LINK-X', referrer_user_id: 10, referred_user_id: 20, tier_level: 1, status: 'PENDING', qualifying_event: 'KYC_VERIFIED' }] };
    }
    if (sql.includes('UPDATE referrals')) { log.updates.push({ sql, params }); return { rows: [] }; }
    if (sql.includes('INSERT INTO referrals')) { log.inserts.push(params); return { rows: [{ id: 1 }] }; }
    if (sql.includes('INSERT INTO referral_earnings')) { log.earned = true; return { rows: [{ id: 1 }] }; }
    return { rows: [] };
  };
  return { query, log, connect: async () => ({ query, release: () => {} }) };
}

describe('NID match at attribution', () => {
  test('looks up VERIFIED KYC and the nid_hash, not APPROVED / nid_number', async () => {
    const db = makeDb();
    await referral.recordReferralAttribution(db, cache, { referralCode: 'REF-X', referredUserId: 20 });
    assert.match(db.log.codeSql, /status = 'VERIFIED'/);
    assert.match(db.log.codeSql, /nid_hash/);
    assert.doesNotMatch(db.log.codeSql, /APPROVED|nid_number/);
  });

  test('the same NID as the sponsor is refused as FRAUD_FLAGGED', async () => {
    const db = makeDb({ referrerNidHash: hashNid('1234567890') });
    const out = await referral.recordReferralAttribution(db, cache, { referralCode: 'REF-X', referredUserId: 20, nid: ' 1234567890 ' });
    assert.equal(out.attributed, false);
    assert.equal(out.reason, 'SELF_REFERRAL_NID_MATCH');
  });

  test('a different NID passes the check', async () => {
    const db = makeDb({ referrerNidHash: hashNid('1234567890') });
    const out = await referral.recordReferralAttribution(db, cache, { referralCode: 'REF-X', referredUserId: 20, nid: '9999999999' });
    assert.notEqual(out.reason, 'SELF_REFERRAL_NID_MATCH');
  });
});

describe('NID match at the qualifying event', () => {
  test('a shared verified NID flags the referral instead of paying the bonus', async () => {
    const db = makeDb({ nidMatch: true });
    const out = await referral.evaluateQualifyingEvent(db, null, { userId: 20, eventType: 'KYC_VERIFIED' });
    assert.deepEqual(out, []);
    assert.equal(db.log.earned, undefined);
    assert.equal(db.log.updates.length, 1);
    assert.match(db.log.updates[0].sql, /FRAUD_FLAGGED/);
    assert.match(db.log.updates[0].sql, /SELF_REFERRAL_NID_MATCH/);
  });
});
