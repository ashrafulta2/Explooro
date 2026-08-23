/**
 * coin.service.js — Loyalty Coins Liability Engine & Streak System (Prompt 9.4).
 *
 * Implements DFD Subsystem 13.0:
 * 1. Double-entry loyalty coins ledger where coins represent a financial liability.
 * 2. Daily check-in with progressive streak multipliers and once-per-day idempotency.
 * 3. Checkout redemption bounded by order percentage and rate conversion (100 coins = ৳10).
 * 4. Cancellation refund reversal.
 * 5. Real-time platform coin liability audit reconciliation.
 */

import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { isEnabled } from './module.service.js';

export async function getCoinSettings(db) {
  try {
    const { rows } = await db.query(
      `SELECT settings_json FROM platform_modules WHERE key = 'loyalty_coins'`
    );
    return rows[0]?.settings_json || {
      coins_per_bdt_redemption: 10,
      max_redemption_order_pct: 20,
      check_in_base_coins: 10,
      check_in_streak_step: 5,
      check_in_max_streak_coins: 50,
    };
  } catch {
    return {
      coins_per_bdt_redemption: 10,
      max_redemption_order_pct: 20,
      check_in_base_coins: 10,
      check_in_streak_step: 5,
      check_in_max_streak_coins: 50,
    };
  }
}

/**
 * Gets or creates the coin balance record for a user.
 */
export async function getUserCoinBalance(db, userId) {
  const { rows } = await db.query(
    `SELECT * FROM coin_balances WHERE user_id = $1`,
    [userId]
  );

  if (rows.length > 0) {
    return rows[0];
  }

  const { rows: inserted } = await db.query(
    `INSERT INTO coin_balances (user_id, balance, lifetime_earned, lifetime_spent, current_streak_days)
     VALUES ($1, 0, 0, 0, 0)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [userId]
  );

  return inserted[0];
}

async function runWithClient(db, fn) {
  if (db && typeof db.connect === 'function') {
    return withTransaction(db, fn);
  }
  return fn(db);
}

/**
 * Performs daily check-in with streak progression and anti-replay protection.
 */
export async function recordDailyCheckIn(db, cache, userId) {
  const enabled = await isEnabled(db, cache, 'loyalty_coins');
  if (!enabled) {
    throw new AppError('MODULE_DISABLED', 'Loyalty coins module is currently disabled.');
  }

  const settings = await getCoinSettings(db);
  const baseCoins = Number(settings.check_in_base_coins || 10);
  const streakStep = Number(settings.check_in_streak_step || 5);
  const maxStreakCoins = Number(settings.check_in_max_streak_coins || 50);

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

  return runWithClient(db, async (client) => {
    // 1. Lock user coin balance row
    const { rows: balanceRows } = await client.query(
      `SELECT * FROM coin_balances WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );

    let currentBalance = balanceRows[0];
    if (!currentBalance) {
      const { rows: created } = await client.query(
        `INSERT INTO coin_balances (user_id, balance, lifetime_earned, lifetime_spent, current_streak_days)
         VALUES ($1, 0, 0, 0, 0)
         RETURNING *`,
        [userId]
      );
      currentBalance = created[0];
    }

    const lastCheckIn = currentBalance.last_check_in_date
      ? new Date(currentBalance.last_check_in_date).toISOString().slice(0, 10)
      : null;

    if (lastCheckIn === todayStr) {
      throw new AppError('ALREADY_CHECKED_IN', 'You have already claimed your daily check-in bonus today.');
    }

    let newStreak = 1;
    if (lastCheckIn === yesterdayStr) {
      newStreak = (currentBalance.current_streak_days || 0) + 1;
    }

    // Calculate streak reward: Day 1 = 10, Day 2 = 15, Day 3 = 20 ... up to 50
    const coinsAwarded = Math.min(baseCoins + (newStreak - 1) * streakStep, maxStreakCoins);
    const newBalance = currentBalance.balance + coinsAwarded;
    const newLifetime = currentBalance.lifetime_earned + coinsAwarded;

    // 2. Update coin balance
    await client.query(
      `UPDATE coin_balances
       SET balance = $1,
           lifetime_earned = $2,
           current_streak_days = $3,
           last_check_in_date = $4,
           updated_at = now()
       WHERE user_id = $5`,
      [newBalance, newLifetime, newStreak, todayStr, userId]
    );

    // 3. Record transaction in double-entry audit trail
    await client.query(
      `INSERT INTO coin_transactions (
        user_id, entry_type, amount, balance_after, source_category,
        reference_type, reference_id, memo
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        'CREDIT',
        coinsAwarded,
        newBalance,
        'DAILY_CHECK_IN',
        'check_in',
        null,
        `Day ${newStreak} check-in bonus (+${coinsAwarded} coins)`,
      ]
    );

    return {
      coinsAwarded,
      newBalance,
      streakDays: newStreak,
      checkInDate: todayStr,
    };
  });
}

/**
 * Awards coins to a user for an activity (e.g. quest completion, review, referral).
 */
export async function awardCoins(db, {
  userId,
  amount,
  sourceCategory = 'MANUAL_ADJUSTMENT',
  referenceType = null,
  referenceId = null,
  memo = null,
}) {
  const coinAmount = parseInt(amount, 10);
  if (isNaN(coinAmount) || coinAmount <= 0) {
    throw new AppError('INVALID_COIN_AMOUNT', 'Coin award amount must be a positive integer.');
  }

  return runWithClient(db, async (client) => {
    const { rows: bRows } = await client.query(
      `SELECT * FROM coin_balances WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );

    let bal = bRows[0];
    if (!bal) {
      const { rows: created } = await client.query(
        `INSERT INTO coin_balances (user_id, balance, lifetime_earned, lifetime_spent, current_streak_days)
         VALUES ($1, 0, 0, 0, 0)
         RETURNING *`,
        [userId]
      );
      bal = created[0];
    }

    const newBalance = bal.balance + coinAmount;
    const newLifetime = bal.lifetime_earned + coinAmount;

    await client.query(
      `UPDATE coin_balances
       SET balance = $1, lifetime_earned = $2, updated_at = now()
       WHERE user_id = $3`,
      [newBalance, newLifetime, userId]
    );

    const { rows: txnRows } = await client.query(
      `INSERT INTO coin_transactions (
        user_id, entry_type, amount, balance_after, source_category,
        reference_type, reference_id, memo
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [userId, 'CREDIT', coinAmount, newBalance, sourceCategory, referenceType, referenceId, memo]
    );

    return {
      newBalance,
      transaction: txnRows[0],
    };
  });
}

/**
 * Redeems loyalty coins at checkout against an order total.
 */
export async function redeemCoins(db, {
  userId,
  coinsAmount,
  orderId = null,
  orderTotalPaisa = 0,
}) {
  const coinsToRedeem = parseInt(coinsAmount, 10);
  if (isNaN(coinsToRedeem) || coinsToRedeem <= 0) {
    throw new AppError('INVALID_COIN_AMOUNT', 'Redemption coins must be positive.');
  }

  const settings = await getCoinSettings(db);
  const coinsPerBdt = Number(settings.coins_per_bdt_redemption || 10); // 10 coins = ৳1
  const maxOrderPct = Number(settings.max_redemption_order_pct || 20);

  // Maximum allowed discount in paisa
  const maxDiscountPaisa = Math.floor((orderTotalPaisa * maxOrderPct) / 100);
  const discountPaisa = Math.floor((coinsToRedeem / coinsPerBdt) * 100);

  if (orderTotalPaisa > 0 && discountPaisa > maxDiscountPaisa) {
    throw new AppError(
      'REDEMPTION_LIMIT_EXCEEDED',
      `Coins discount exceeds the maximum allowed ${maxOrderPct}% of order total.`
    );
  }

  return runWithClient(db, async (client) => {
    const { rows: bRows } = await client.query(
      `SELECT * FROM coin_balances WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );

    const bal = bRows[0];
    if (!bal || bal.balance < coinsToRedeem) {
      throw new AppError('INSUFFICIENT_COINS', 'You do not have enough loyalty coins for this redemption.');
    }

    const newBalance = bal.balance - coinsToRedeem;
    const newSpent = bal.lifetime_spent + coinsToRedeem;

    await client.query(
      `UPDATE coin_balances
       SET balance = $1, lifetime_spent = $2, updated_at = now()
       WHERE user_id = $3`,
      [newBalance, newSpent, userId]
    );

    const discountBdt = (discountPaisa / 100).toFixed(2);

    const { rows: txnRows } = await client.query(
      `INSERT INTO coin_transactions (
        user_id, entry_type, amount, balance_after, source_category,
        reference_type, reference_id, memo
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        userId,
        'DEBIT',
        coinsToRedeem,
        newBalance,
        'CHECKOUT_REDEMPTION',
        'orders',
        orderId,
        `Redeemed ${coinsToRedeem} coins for ৳${discountBdt} checkout discount`,
      ]
    );

    return {
      discountBdt,
      discountPaisa,
      coinsRedeemed: coinsToRedeem,
      newBalance,
      transaction: txnRows[0],
    };
  });
}

/**
 * Reverses a coin redemption when an order is cancelled.
 */
export async function refundRedeemedCoins(db, {
  userId,
  coinsAmount,
  orderId = null,
  memo = 'Order cancelled coin refund',
}) {
  const coinsToRefund = parseInt(coinsAmount, 10);
  if (isNaN(coinsToRefund) || coinsToRefund <= 0) return null;

  return runWithClient(db, async (client) => {
    const { rows: bRows } = await client.query(
      `SELECT * FROM coin_balances WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );

    const bal = bRows[0];
    const newBalance = (bal?.balance || 0) + coinsToRefund;
    const newSpent = Math.max(0, (bal?.lifetime_spent || 0) - coinsToRefund);

    await client.query(
      `UPDATE coin_balances
       SET balance = $1, lifetime_spent = $2, updated_at = now()
       WHERE user_id = $3`,
      [newBalance, newSpent, userId]
    );

    const { rows: txnRows } = await client.query(
      `INSERT INTO coin_transactions (
        user_id, entry_type, amount, balance_after, source_category,
        reference_type, reference_id, memo
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [userId, 'CREDIT', coinsToRefund, newBalance, 'ORDER_CANCELLED_REFUND', 'orders', orderId, memo]
    );

    return {
      newBalance,
      transaction: txnRows[0],
    };
  });
}

/**
 * Calculates total platform coin liability by aggregating all balances.
 */
export async function getTotalCoinLiability(db) {
  const { rows } = await db.query(`
    SELECT
      COALESCE(SUM(balance), 0)::bigint as total_coins_outstanding,
      COUNT(DISTINCT user_id)::int as active_holders_count,
      COALESCE(SUM(lifetime_earned), 0)::bigint as total_lifetime_issued,
      COALESCE(SUM(lifetime_spent), 0)::bigint as total_lifetime_redeemed
    FROM coin_balances
  `);

  const stats = rows[0] || {
    total_coins_outstanding: '0',
    active_holders_count: 0,
    total_lifetime_issued: '0',
    total_lifetime_redeemed: '0',
  };

  // 10 coins = ৳1 liability
  const totalLiabilityBdt = (Number(stats.total_coins_outstanding) / 10).toFixed(2);

  return {
    total_coins_outstanding: Number(stats.total_coins_outstanding),
    total_liability_bdt: totalLiabilityBdt,
    active_holders_count: stats.active_holders_count,
    total_lifetime_issued: Number(stats.total_lifetime_issued),
    total_lifetime_redeemed: Number(stats.total_lifetime_redeemed),
  };
}

/**
 * Returns paginated coin transaction history for a user.
 */
export async function getCoinHistory(db, userId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM coin_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}
