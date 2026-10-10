/**
 * coinPolicyEnforcement.test.js — the coin policy the admin edits is actually enforced.
 *
 * Invariants:
 *  1. daily_earn_cap limits new earnings per day (0 = no cap) and never limits refunds/adjustments.
 *  2. min_redeem_balance blocks redemption below the floor.
 *  3. expiry_days expires only coins older than the window, and keeps earned - spent = balance.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as coin from '../src/services/coin.service.js';

function makeDb({ settings = {}, balance = 100, earnedToday = 0, fresh = 0, candidates = [1] } = {}) {
  const log = { updates: [], txns: [] };
  const bal = { user_id: 1, balance, lifetime_earned: balance, lifetime_spent: 0 };
  const query = async (sql, params = []) => {
    if (sql.includes('FROM platform_modules')) return { rows: [{ settings_json: settings }] };
    if (sql.includes('FROM coin_balances cb')) return { rows: candidates.map((user_id) => ({ user_id })) };
    if (sql.includes('FROM coin_balances') && sql.includes('FOR UPDATE')) return { rows: [bal] };
    if (sql.includes('AS earned')) return { rows: [{ earned: earnedToday }] };
    if (sql.includes('AS fresh')) return { rows: [{ fresh }] };
    if (sql.startsWith('UPDATE coin_balances') || sql.includes('UPDATE coin_balances')) log.updates.push(params);
    if (sql.includes('INSERT INTO coin_transactions')) {
      log.txns.push(params);
      return { rows: [{ id: 1 }] };
    }
    return { rows: [] };
  };
  return { query, log };
}

describe('applyEarnCap', () => {
  test('cap 0 means no cap', () => assert.equal(coin.applyEarnCap(50, 0, 9999), 50));
  test('clamps to what is left of the cap', () => assert.equal(coin.applyEarnCap(50, 100, 80), 20));
  test('pays 0 once the cap is spent', () => assert.equal(coin.applyEarnCap(50, 100, 130), 0));
  test('pays in full while under the cap', () => assert.equal(coin.applyEarnCap(50, 100, 10), 50));
});

describe('daily_earn_cap in awardCoins', () => {
  test('a quest reward is cut to the remaining allowance', async () => {
    const db = makeDb({ settings: { daily_earn_cap: 100 }, earnedToday: 80 });
    const out = await coin.awardCoins(db, { userId: 1, amount: 50, sourceCategory: 'QUEST_REWARD' });
    assert.equal(out.awarded, 20);
    assert.equal(out.capped, true);
    assert.equal(out.newBalance, 120);
    assert.equal(db.log.txns[0][2], 20);
  });

  test('nothing is written once the cap is reached', async () => {
    const db = makeDb({ settings: { daily_earn_cap: 100 }, earnedToday: 100 });
    const out = await coin.awardCoins(db, { userId: 1, amount: 50, sourceCategory: 'QUEST_REWARD' });
    assert.equal(out.awarded, 0);
    assert.equal(out.transaction, null);
    assert.equal(db.log.txns.length, 0);
    assert.equal(db.log.updates.length, 0);
  });

  test('a manual adjustment ignores the cap', async () => {
    const db = makeDb({ settings: { daily_earn_cap: 100 }, earnedToday: 500 });
    const out = await coin.awardCoins(db, { userId: 1, amount: 50, sourceCategory: 'MANUAL_ADJUSTMENT' });
    assert.equal(out.awarded, 50);
  });
});

describe('min_redeem_balance', () => {
  test('redemption below the floor is refused', async () => {
    const db = makeDb({ settings: { min_redeem_balance: 200 }, balance: 150 });
    await assert.rejects(
      coin.redeemCoins(db, { userId: 1, coinsAmount: 50 }),
      (e) => e.code === 'BELOW_MIN_REDEEM_BALANCE' || /at least 200/.test(e.message)
    );
    assert.equal(db.log.txns.length, 0);
  });

  test('redemption at or above the floor goes through', async () => {
    const db = makeDb({ settings: { min_redeem_balance: 100 }, balance: 150 });
    const out = await coin.redeemCoins(db, { userId: 1, coinsAmount: 50 });
    assert.equal(out.newBalance, 100);
  });
});

describe('expiry_days', () => {
  test('expires only the part of the balance older than the window', async () => {
    const db = makeDb({ settings: { expiry_days: 30 }, balance: 100, fresh: 30 });
    const out = await coin.expireStaleCoins(db);
    assert.equal(out.coinsExpired, 70);
    assert.equal(out.usersExpired, 1);
    // balance, lifetime_spent bump, user
    assert.deepEqual(db.log.updates[0], [30, 70, 1]);
    assert.equal(db.log.txns[0][1], 70);
    assert.equal(db.log.txns[0][2], 30);
  });

  test('expiry_days 0 never expires anything', async () => {
    const db = makeDb({ settings: { expiry_days: 0 } });
    const out = await coin.expireStaleCoins(db);
    assert.equal(out.coinsExpired, 0);
    assert.equal(db.log.txns.length, 0);
  });

  test('a balance entirely inside the window is left alone', async () => {
    const db = makeDb({ settings: { expiry_days: 30 }, balance: 100, fresh: 100 });
    const out = await coin.expireStaleCoins(db);
    assert.equal(out.coinsExpired, 0);
    assert.equal(db.log.txns.length, 0);
  });
});
