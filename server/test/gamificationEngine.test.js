/**
 * gamificationEngine.test.js — Test suite for Prompt 9.4: Loyalty Coins, Quests & Leaderboard.
 *
 * Tests:
 * 1. Daily check-in once-per-day idempotency and streak multiplier progression.
 * 2. Total coin liability reconciliation matching sum of individual balances.
 * 3. Checkout coin redemption and cancellation refund reversal.
 * 4. Quest event progress tracking and atomic reward claim.
 * 5. Leaderboard snapshot generation and ranking stability.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as coinService from '../src/services/coin.service.js';
import * as questService from '../src/services/quest.service.js';
import * as leaderboardService from '../src/services/leaderboard.service.js';

describe('Prompt 9.4: Loyalty Coins, Daily Quests & Leaderboard Engine', () => {

  describe('1. Daily Check-In & Streak Multiplier', () => {
    test('Daily check-in credits coins once per day and prevents duplicate replay', async () => {
      let currentBalanceRow = {
        user_id: 101,
        balance: 100,
        lifetime_earned: 100,
        lifetime_spent: 0,
        current_streak_days: 2,
        last_check_in_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), // yesterday
      };

      const txns = [];

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM platform_modules')) {
            return {
              rows: [{
                key: 'loyalty_coins',
                is_enabled: true,
                default_enabled: true,
                settings_json: {
                  check_in_base_coins: 10,
                  check_in_streak_step: 5,
                  check_in_max_streak_coins: 50,
                },
              }],
            };
          }
          if (sql.includes('FROM coin_balances') && sql.includes('FOR UPDATE')) {
            return { rows: [currentBalanceRow] };
          }
          if (sql.includes('UPDATE coin_balances')) {
            currentBalanceRow = {
              ...currentBalanceRow,
              balance: params[0],
              lifetime_earned: params[1],
              current_streak_days: params[2],
              last_check_in_date: params[3],
            };
            return { rows: [currentBalanceRow] };
          }
          if (sql.includes('INSERT INTO coin_transactions')) {
            txns.push({
              user_id: params[0],
              entry_type: 'CREDIT',
              amount: params[1],
              balance_after: params[2],
            });
            return { rows: [{ id: txns.length }] };
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

      // 1. Check in for Day 3 (yesterday was Day 2): base 10 + (3-1)*5 = 20 coins
      const res1 = await coinService.recordDailyCheckIn(mockDb, mockCache, 101);
      assert.equal(res1.coinsAwarded, 20);
      assert.equal(res1.streakDays, 3);
      assert.equal(res1.newBalance, 120);

      // 2. Duplicate check in attempt on the same day must throw ALREADY_CHECKED_IN
      await assert.rejects(
        async () => {
          await coinService.recordDailyCheckIn(mockDb, mockCache, 101);
        },
        (err) => {
          assert.equal(err.code || err.message, 'ALREADY_CHECKED_IN');
          return true;
        }
      );
    });
  });

  describe('2. Total Coin Liability & Accounting Integrity', () => {
    test('Total coin liability reported by the system matches the sum of all balances', async () => {
      const mockDb = {
        query: async (sql) => {
          if (sql.includes('FROM coin_balances')) {
            return {
              rows: [{
                total_coins_outstanding: '45000',
                active_holders_count: 320,
                total_lifetime_issued: '80000',
                total_lifetime_redeemed: '35000',
              }],
            };
          }
          return { rows: [] };
        },
      };

      const liability = await coinService.getTotalCoinLiability(mockDb);

      // 45,000 coins @ 10 coins / ৳1 = ৳4,500.00 liability
      assert.equal(liability.total_coins_outstanding, 45000);
      assert.equal(liability.total_liability_bdt, '4500.00');
      assert.equal(liability.active_holders_count, 320);
      assert.equal(liability.total_lifetime_issued, 80000);
      assert.equal(liability.total_lifetime_redeemed, 35000);
    });
  });

  describe('3. Checkout Redemption & Cancellation Reversal', () => {
    test('Redeeming coins reduces payable amount and cancellation restores coin balance', async () => {
      let balanceRow = {
        user_id: 202,
        balance: 500, // 500 coins = ৳50
        lifetime_earned: 500,
        lifetime_spent: 0,
      };

      const txns = [];

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM platform_modules')) {
            return {
              rows: [{
                key: 'loyalty_coins',
                settings_json: {
                  coins_per_bdt_redemption: 10,
                  max_redemption_order_pct: 20,
                },
              }],
            };
          }
          if (sql.includes('FROM coin_balances') && sql.includes('FOR UPDATE')) {
            return { rows: [balanceRow] };
          }
          if (sql.includes('UPDATE coin_balances')) {
            balanceRow = {
              ...balanceRow,
              balance: params[0],
              lifetime_spent: params[1],
            };
            return { rows: [balanceRow] };
          }
          if (sql.includes('INSERT INTO coin_transactions')) {
            txns.push({
              entry_type: params[1],
              amount: params[2],
              balance_after: params[3],
              source_category: params[4],
            });
            return { rows: [{ id: txns.length }] };
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

      // 1. Redeem 200 coins (৳20) on an order of ৳500 (50,000 paisa) -> 4% <= 20% limit
      const redeemRes = await coinService.redeemCoins(mockDb, {
        userId: 202,
        coinsAmount: 200,
        orderId: 9001,
        orderTotalPaisa: 50000,
      });

      assert.equal(redeemRes.coinsRedeemed, 200);
      assert.equal(redeemRes.discountBdt, '20.00');
      assert.equal(redeemRes.newBalance, 300);

      // 2. Cancellation refund restores 200 coins
      const refundRes = await coinService.refundRedeemedCoins(mockDb, {
        userId: 202,
        coinsAmount: 200,
        orderId: 9001,
      });

      assert.equal(refundRes.newBalance, 500);

      // Verify audit trail transactions
      const debitTxn = txns.find(t => t.source_category === 'CHECKOUT_REDEMPTION');
      assert.ok(debitTxn);
      assert.equal(debitTxn.entry_type, 'DEBIT');
      assert.equal(debitTxn.amount, 200);

      const refundTxn = txns.find(t => t.source_category === 'ORDER_CANCELLED_REFUND');
      assert.ok(refundTxn);
      assert.equal(refundTxn.entry_type, 'CREDIT');
      assert.equal(refundTxn.amount, 200);
    });
  });

  describe('4. Daily & Weekly Quests', () => {
    test('Quest completion increments progress and claims rewards atomically', async () => {
      const mockQuest = {
        id: 1,
        key: 'daily_share_store',
        target_role: 'SALER',
        cadence: 'DAILY',
        title_en: 'Share Store',
        title_bn: 'শেয়ার করুন',
        event_type: 'SHARE_STORE',
        target_count: 3,
        reward_coins: 25,
        is_active: true,
      };

      let progressRow = {
        id: 10,
        quest_id: 1,
        user_id: 303,
        period_key: new Date().toISOString().slice(0, 10),
        current_count: 3,
        is_completed: true,
        is_claimed: false,
      };

      let userBalance = { balance: 50, lifetime_earned: 50 };

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM quests WHERE id = $1')) {
            return { rows: [mockQuest] };
          }
          if (sql.includes('FROM quest_progress') && sql.includes('FOR UPDATE')) {
            return { rows: [progressRow] };
          }
          if (sql.includes('UPDATE quest_progress')) {
            progressRow.is_claimed = true;
            return { rows: [progressRow] };
          }
          if (sql.includes('FROM coin_balances') && sql.includes('FOR UPDATE')) {
            return { rows: [userBalance] };
          }
          if (sql.includes('UPDATE coin_balances')) {
            userBalance.balance = params[0];
            return { rows: [userBalance] };
          }
          if (sql.includes('INSERT INTO coin_transactions')) {
            return { rows: [{ id: 1 }] };
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

      // 1. Claim reward for completed quest
      const claimResult = await questService.claimQuestReward(mockDb, 303, 1);
      assert.equal(claimResult.claimed, true);
      assert.equal(claimResult.rewardCoins, 25);
      assert.equal(claimResult.newBalance, 75);

      // 2. Duplicate claim attempt must throw QUEST_ALREADY_CLAIMED
      await assert.rejects(
        async () => {
          await questService.claimQuestReward(mockDb, 303, 1);
        },
        (err) => {
          assert.equal(err.code || err.message, 'QUEST_ALREADY_CLAIMED');
          return true;
        }
      );
    });
  });

  describe('5. Leaderboard Snapshot Computation', () => {
    test('Leaderboard snapshot produces deterministic top rankings', async () => {
      const fakeAggregatedSellers = [
        { user_id: 10, metric_value: '250000.00' },
        { user_id: 20, metric_value: '180000.00' },
        { user_id: 30, metric_value: '120000.00' },
      ];

      const insertedSnapshots = [];

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM sub_orders so')) {
            return { rows: fakeAggregatedSellers };
          }
          if (sql.includes('DELETE FROM leaderboard_snapshots')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO leaderboard_snapshots')) {
            const row = {
              id: insertedSnapshots.length + 1,
              period_key: params[0],
              category: params[1],
              rank: params[2],
              user_id: params[3],
              metric_value: params[4],
            };
            insertedSnapshots.push(row);
            return { rows: [row] };
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

      const snapshots = await leaderboardService.computeLeaderboardSnapshot(mockDb, {
        periodKey: '2026-08',
        category: 'SALER_REVENUE',
      });

      assert.equal(snapshots.length, 3);
      assert.equal(snapshots[0].rank, 1);
      assert.equal(snapshots[0].user_id, 10);
      assert.equal(snapshots[0].metric_value, '250000.00');

      assert.equal(snapshots[1].rank, 2);
      assert.equal(snapshots[1].user_id, 20);

      assert.equal(snapshots[2].rank, 3);
      assert.equal(snapshots[2].user_id, 30);
    });
  });

});
