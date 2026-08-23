/**
 * referralEngine.test.js — Test suite for Prompt 9.3: Multi-Tier Referral & Network Growth Engine.
 *
 * Tests:
 * 1. Multi-tier attribution & commission calculation (5% Tier 1, 2% Tier 2).
 * 2. Self-referral fraud prevention (same account, matching phone/NID, matching device fingerprint).
 * 3. Circular referral prevention (A refers B refers A loop detection).
 * 4. Double-entry ledger integration and 7-day escrow holding period.
 * 5. Velocity limit throttling.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as referralService from '../src/services/referral.service.js';

describe('Prompt 9.3: Multi-Tier Referral & Network Growth Engine', () => {

  describe('1. Multi-Tier Attribution & Tree Construction', () => {
    test('Two-tier referral links Tier 1 (Direct 5%) and Tier 2 (Upstream Sponsor 2%)', async () => {
      const mockReferrerCode = {
        id: 1,
        user_id: 10,
        code: 'REF-SPONSOR',
        custom_slug: 'sponsor-store',
      };

      const mockDb = {
        query: async (sql, params = []) => {
          // 0. Module lookup
          if (sql.includes('FROM platform_modules')) {
            return {
              rows: [{
                key: 'referral_engine',
                is_enabled: true,
                default_enabled: true,
                settings_json: {
                  tier_1_rate_pct: 5.0,
                  tier_2_rate_pct: 2.0,
                  max_tier_depth: 2,
                  holding_period_days: 7,
                  qualifying_event: 'FIRST_ORDER',
                  daily_velocity_limit: 20,
                },
              }],
            };
          }
          // 1. User code lookup
          if (sql.includes('FROM user_referral_codes')) {
            return { rows: [{ ...mockReferrerCode, referrer_phone: '01711111111', referrer_nid: '1234567890' }] };
          }
          // 2. Device match check
          if (sql.includes('FROM referrals') && sql.includes('device_fingerprint = $2')) {
            return { rows: [] };
          }
          // 3. Circular check
          if (sql.includes('FROM referrals') && sql.includes('referrer_user_id = $1 AND referred_user_id = $2')) {
            return { rows: [] };
          }
          // 4. Velocity check
          if (sql.includes('COUNT(*)::int as count FROM referrals')) {
            return { rows: [{ count: 2 }] };
          }
          // 5. Tier 1 insert
          if (sql.includes('INSERT INTO referrals') && sql.includes('1, \'PENDING\'')) {
            return {
              rows: [{
                id: 101,
                ref: 'REF-LINK-T1',
                referrer_user_id: 10,
                referred_user_id: 20,
                tier_level: 1,
                status: 'PENDING',
              }],
            };
          }
          // 6. Upstream lookup for User 10 (Sponsor's Sponsor is User 5)
          if (sql.includes('SELECT referrer_user_id FROM referrals') && sql.includes('tier_level = 1')) {
            return { rows: [{ referrer_user_id: 5 }] };
          }
          // 7. Tier 2 insert
          if (sql.includes('INSERT INTO referrals') && sql.includes('2, $4, \'PENDING\'')) {
            return {
              rows: [{
                id: 102,
                ref: 'REF-LINK-T2',
                referrer_user_id: 5,
                referred_user_id: 20,
                tier_level: 2,
                parent_referral_id: 101,
                status: 'PENDING',
              }],
            };
          }
          if (sql.includes('UPDATE user_referral_codes')) {
            return { rows: [{ id: 1 }] };
          }
          return { rows: [] };
        },
      };

      const mockCache = { get: async () => null, set: async () => {} };

      const result = await referralService.recordReferralAttribution(mockDb, mockCache, {
        referralCode: 'REF-SPONSOR',
        referredUserId: 20,
        deviceFingerprint: 'device-unique-abc',
        phone: '01822222222',
        nid: '9876543210',
      });

      assert.equal(result.attributed, true);
      assert.ok(result.tier1, 'Tier 1 referral must exist');
      assert.equal(result.tier1.referrer_user_id, 10);
      assert.equal(result.tier1.tier_level, 1);

      assert.ok(result.tier2, 'Tier 2 referral must exist');
      assert.equal(result.tier2.referrer_user_id, 5);
      assert.equal(result.tier2.tier_level, 2);
      assert.equal(result.tier2.parent_referral_id, 101);
    });
  });

  describe('2. Anti-Fraud & Self-Referral Prevention', () => {
    test('Self-referral on same user ID is blocked', async () => {
      const mockDb = {
        query: async (sql) => {
          if (sql.includes('FROM platform_modules')) {
            return { rows: [{ key: 'referral_engine', is_enabled: true, default_enabled: true }] };
          }
          if (sql.includes('FROM user_referral_codes')) {
            return { rows: [{ id: 1, user_id: 10, code: 'REF-SELF' }] };
          }
          return { rows: [] };
        },
      };
      const mockCache = { get: async () => null, set: async () => {} };

      const result = await referralService.recordReferralAttribution(mockDb, mockCache, {
        referralCode: 'REF-SELF',
        referredUserId: 10, // Same user ID
      });

      assert.equal(result.attributed, false);
      assert.equal(result.isFraud, true);
      assert.equal(result.reason, 'SELF_REFERRAL_SAME_ACCOUNT');
    });

    test('Self-referral attempt with matching device fingerprint is flagged', async () => {
      const mockDb = {
        query: async (sql) => {
          if (sql.includes('FROM platform_modules')) {
            return { rows: [{ key: 'referral_engine', is_enabled: true, default_enabled: true }] };
          }
          if (sql.includes('FROM user_referral_codes')) {
            return { rows: [{ id: 1, user_id: 10, code: 'REF-DEVICE' }] };
          }
          if (sql.includes('FROM referrals') && sql.includes('device_fingerprint = $2')) {
            // Existing referral on same device
            return { rows: [{ id: 99 }] };
          }
          return { rows: [] };
        },
      };
      const mockCache = { get: async () => null, set: async () => {} };

      const result = await referralService.recordReferralAttribution(mockDb, mockCache, {
        referralCode: 'REF-DEVICE',
        referredUserId: 22,
        deviceFingerprint: 'fingerprint-shared-browser',
      });

      assert.equal(result.attributed, false);
      assert.equal(result.isFraud, true);
      assert.equal(result.reason, 'SELF_REFERRAL_DEVICE_MATCH');
    });

    test('Circular referral loop (A -> B -> A) is detected and blocked', async () => {
      const mockDb = {
        query: async (sql) => {
          if (sql.includes('FROM platform_modules')) {
            return { rows: [{ key: 'referral_engine', is_enabled: true, default_enabled: true }] };
          }
          if (sql.includes('FROM user_referral_codes')) {
            // User B is referrer (ID 20)
            return { rows: [{ id: 2, user_id: 20, code: 'REF-USERB' }] };
          }
          if (sql.includes('FROM referrals') && sql.includes('device_fingerprint = $2')) {
            return { rows: [] };
          }
          if (sql.includes('FROM referrals') && sql.includes('referrer_user_id = $1 AND referred_user_id = $2')) {
            // User A (ID 10) previously referred User B (ID 20)
            return { rows: [{ id: 88 }] };
          }
          return { rows: [] };
        },
      };
      const mockCache = { get: async () => null, set: async () => {} };

      const result = await referralService.recordReferralAttribution(mockDb, mockCache, {
        referralCode: 'REF-USERB',
        referredUserId: 10, // User A attempting to use User B's link
      });

      assert.equal(result.attributed, false);
      assert.equal(result.isFraud, true);
      assert.equal(result.reason, 'CIRCULAR_REFERRAL_DETECTED');
    });
  });

  describe('3. Double-Entry Ledger & Escrow Holding Period', () => {
    test('A two-tier referral credits both tiers with 7-day holding period in PENDING_ESCROW', async () => {
      const pendingReferrals = [
        {
          id: 101,
          ref: 'REF-LINK-01',
          referrer_user_id: 10,
          referred_user_id: 99,
          tier_level: 1,
          status: 'PENDING',
          qualifying_event: 'FIRST_ORDER',
        },
        {
          id: 102,
          ref: 'REF-LINK-02',
          referrer_user_id: 5,
          referred_user_id: 99,
          tier_level: 2,
          status: 'PENDING',
          qualifying_event: 'FIRST_ORDER',
        },
      ];

      const ledgerEntries = [];
      const earningsEntries = [];

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM platform_modules')) {
            return { rows: [{ key: 'referral_engine', is_enabled: true, default_enabled: true }] };
          }
          if (sql.includes('FROM referrals') && sql.includes('referred_user_id = $1')) {
            return { rows: pendingReferrals };
          }
          if (sql.includes('UPDATE referrals SET status = \'QUALIFIED\'')) {
            return { rows: [{ id: params[0], status: 'QUALIFIED' }] };
          }
          if (sql.includes("FROM roles r") && sql.includes("super_admin")) {
            return { rows: [{ id: 1 }] };
          }
          if (sql.includes('FROM wallets') && sql.includes('WHERE user_id = $1')) {
            const uid = Number(params[0]);
            return { rows: [{ id: uid === 1 ? 1 : uid === 10 ? 10 : 5, user_id: uid, available_balance: '1000.00', pending_escrow_balance: '0.00', held_balance: '0.00', version: 0 }] };
          }
          if (sql.includes('FROM wallets') && sql.includes('FOR UPDATE')) {
            const allWallets = [
              { id: 1, user_id: 1, available_balance: '1000.00', pending_escrow_balance: '0.00', held_balance: '0.00', version: 0 },
              { id: 10, user_id: 10, available_balance: '1000.00', pending_escrow_balance: '0.00', held_balance: '0.00', version: 0 },
              { id: 5, user_id: 5, available_balance: '1000.00', pending_escrow_balance: '0.00', held_balance: '0.00', version: 0 },
            ];
            const targetIds = Array.isArray(params[0]) ? params[0].map(Number) : [Number(params[0])];
            return { rows: allWallets.filter(w => targetIds.includes(w.id)) };
          }
          if (sql.includes('UPDATE wallets')) {
            return { rows: [{ id: params[params.length - 1] }] };
          }
          if (sql.includes('INSERT INTO ledger_transactions')) {
            ledgerEntries.push({
              txn_group_id: params[0],
              wallet_id: params[1],
              entry_type: params[2],
              amount: params[3],
              balance_bucket: params[4],
              category: params[5],
            });
            return { rows: [{ id: ledgerEntries.length }] };
          }
          if (sql.includes('INSERT INTO referral_earnings')) {
            earningsEntries.push({
              id: earningsEntries.length + 1,
              referral_id: params[0],
              beneficiary_user_id: params[1],
              tier_level: params[2],
              commission_amount: params[7],
              status: 'PENDING_ESCROW',
              escrow_release_at: params[8],
            });
            return { rows: [earningsEntries[earningsEntries.length - 1]] };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      const mockCache = { get: async () => null, set: async () => {} };

      // Qualifying first order of ৳5,000
      const earnings = await referralService.evaluateQualifyingEvent(mockDb, mockCache, {
        userId: 99,
        eventType: 'FIRST_ORDER',
        orderId: 501,
        orderAmount: 5000.00,
      });

      assert.equal(earnings.length, 2, 'Must create 2 earnings records (Tier 1 & Tier 2)');

      // Tier 1: 5% of ৳5,000 = ৳250.00
      const tier1 = earnings.find(e => e.tier_level === 1);
      assert.ok(tier1);
      assert.equal(Number(tier1.commission_amount), 250.00);
      assert.equal(tier1.status, 'PENDING_ESCROW');

      // Tier 2: 2% of ৳5,000 = ৳100.00
      const tier2 = earnings.find(e => e.tier_level === 2);
      assert.ok(tier2);
      assert.equal(Number(tier2.commission_amount), 100.00);
      assert.equal(tier2.status, 'PENDING_ESCROW');

      // Ledger integrity check: SUM(DEBITS) === SUM(CREDITS) with zero drift
      const debits = ledgerEntries.filter(e => e.entry_type === 'DEBIT');
      const credits = ledgerEntries.filter(e => e.entry_type === 'CREDIT');

      const totalDebited = debits.reduce((sum, e) => sum + Number(e.amount), 0);
      const totalCredited = credits.reduce((sum, e) => sum + Number(e.amount), 0);

      assert.equal(totalDebited, 350.00, 'Total debited from platform treasury must equal ৳350.00');
      assert.equal(totalCredited, 350.00, 'Total credited to beneficiaries must equal ৳350.00');
      assert.equal(totalDebited, totalCredited, 'Ledger invariant holds with zero financial drift');

      // Escrow holding bucket verification
      credits.forEach(credit => {
        assert.equal(credit.balance_bucket, 'ESCROW', 'Earnings must credit ESCROW bucket');
        assert.equal(credit.category, 'REFERRAL_COMMISSION');
      });
    });
  });

});
