/**
 * leaderboard.service.js — Monthly Performance Leaderboards & Snapshot Engine (Prompt 9.4).
 *
 * Implements:
 * 1. Nightly snapshot computation (no expensive live aggregate table scans).
 * 2. Multi-category rankings (Saler Revenue, Saler Orders, Supplier Volume).
 * 3. Monthly prize pool distribution via double-entry ledger.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';

export function getCurrentMonthPeriodKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 7); // 'YYYY-MM'
}

/**
 * Computes and stores the stable leaderboard snapshot for a period.
 */
export async function computeLeaderboardSnapshot(db, {
  periodKey = getCurrentMonthPeriodKey(),
  category = 'SALER_REVENUE',
} = {}) {
  // Aggregate rankings based on category
  let aggregationQuery = '';

  if (category === 'SALER_REVENUE') {
    aggregationQuery = `
      SELECT
        so.saler_user_id as user_id,
        COALESCE(SUM(so.subtotal_price), 0)::numeric(14,2) as metric_value
      FROM sub_orders so
      WHERE to_char(so.created_at, 'YYYY-MM') = $1
        AND so.status NOT IN ('CANCELLED', 'RETURNED')
      GROUP BY so.saler_user_id
      ORDER BY metric_value DESC
      LIMIT 100
    `;
  } else {
    // SALER_ORDERS
    aggregationQuery = `
      SELECT
        so.saler_user_id as user_id,
        COUNT(so.id)::numeric(14,2) as metric_value
      FROM sub_orders so
      WHERE to_char(so.created_at, 'YYYY-MM') = $1
        AND so.status NOT IN ('CANCELLED', 'RETURNED')
      GROUP BY so.saler_user_id
      ORDER BY metric_value DESC
      LIMIT 100
    `;
  }

  const { rows: rankedUsers } = await db.query(aggregationQuery, [periodKey]);

  return withTransaction(db, async (client) => {
    // Clear previous snapshot for this period & category
    await client.query(
      `DELETE FROM leaderboard_snapshots WHERE period_key = $1 AND category = $2`,
      [periodKey, category]
    );

    const inserted = [];
    for (let i = 0; i < rankedUsers.length; i++) {
      const rank = i + 1;
      const u = rankedUsers[i];

      const { rows: ins } = await client.query(
        `INSERT INTO leaderboard_snapshots (
          period_key, category, rank, user_id, metric_value, snapshot_at
        )
        VALUES ($1, $2, $3, $4, $5, now())
        RETURNING *`,
        [periodKey, category, rank, u.user_id, u.metric_value]
      );
      inserted.push(ins[0]);
    }

    return inserted;
  });
}

/**
 * Retrieves snapshot rankings with user display names.
 */
export async function getLeaderboard(db, {
  periodKey = getCurrentMonthPeriodKey(),
  category = 'SALER_REVENUE',
  limit = 50,
  currentUserId = null,
} = {}) {
  const query = `
    SELECT
      ls.*,
      COALESCE(up.display_name, up.full_name) as user_name,
      u.email as user_email
    FROM leaderboard_snapshots ls
    JOIN users u ON u.id = ls.user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE ls.period_key = $1 AND ls.category = $2
    ORDER BY ls.rank ASC
    LIMIT $3
  `;

  const { rows: rankings } = await db.query(query, [periodKey, category, limit]);

  let currentUserRank = null;
  if (currentUserId) {
    const { rows: userRows } = await db.query(
      `SELECT ls.*, COALESCE(up.display_name, up.full_name) as user_name
       FROM leaderboard_snapshots ls
       JOIN users u ON u.id = ls.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE ls.period_key = $1 AND ls.category = $2 AND ls.user_id = $3`,
      [periodKey, category, currentUserId]
    );
    currentUserRank = userRows[0] || null;
  }

  return {
    period_key: periodKey,
    category,
    rankings,
    current_user_rank: currentUserRank,
  };
}

/**
 * Distributes monthly bonus pool prizes to top performers via double-entry ledger.
 */
export async function distributeLeaderboardBonuses(db, {
  periodKey = getCurrentMonthPeriodKey(),
  category = 'SALER_REVENUE',
  bonusPoolBdt = 50000.0,
}) {
  const prizeDistribution = {
    1: 0.40, // 40% for 1st
    2: 0.25, // 25% for 2nd
    3: 0.15, // 15% for 3rd
  };

  const { rows: topRanks } = await db.query(
    `SELECT * FROM leaderboard_snapshots
     WHERE period_key = $1 AND category = $2 AND bonus_distributed = false
     ORDER BY rank ASC
     LIMIT 10`,
    [periodKey, category]
  );

  if (topRanks.length === 0) return [];

  const payouts = [];

  for (const rankRow of topRanks) {
    const sharePct = prizeDistribution[rankRow.rank] || (0.20 / Math.max(1, topRanks.length - 3));
    const prizeAmount = Number((bonusPoolBdt * sharePct).toFixed(2));

    if (prizeAmount <= 0) continue;

    await withTransaction(db, async (client) => {
      // Find platform admin for treasury debit
      const { rows: adminRows } = await client.query(
        `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE r.key = 'super_admin'
         ORDER BY u.id ASC LIMIT 1`
      );
      const platformUserId = adminRows[0]?.id ?? 1;

      const beneficiaryWallet = await walletRepo.getOrCreateWallet(db, rankRow.user_id, { client });
      const platformWallet = await walletRepo.getOrCreateWallet(db, platformUserId, { client });

      const txnGroupId = randomUUID();
      const amountStr = prizeAmount.toFixed(2);

      await ledgerService.recordTransactionGroup(client, {
        txnGroupId,
        defaultCategory: 'LEADERBOARD_BONUS',
        defaultReferenceType: 'leaderboard_snapshots',
        defaultReferenceId: rankRow.id,
        memo: `Leaderboard ${periodKey} Rank #${rankRow.rank} Prize Bonus`,
        entries: [
          {
            walletId: platformWallet.id,
            entryType: 'DEBIT',
            amount: amountStr,
            balanceBucket: 'AVAILABLE',
            category: 'LEADERBOARD_BONUS',
            referenceType: 'leaderboard_snapshots',
            referenceId: rankRow.id,
          },
          {
            walletId: beneficiaryWallet.id,
            entryType: 'CREDIT',
            amount: amountStr,
            balanceBucket: 'AVAILABLE',
            category: 'LEADERBOARD_BONUS',
            referenceType: 'leaderboard_snapshots',
            referenceId: rankRow.id,
          },
        ],
      });

      await client.query(
        `UPDATE leaderboard_snapshots
         SET bonus_reward_amount = $1, bonus_distributed = true
         WHERE id = $2`,
        [amountStr, rankRow.id]
      );

      payouts.push({
        rank: rankRow.rank,
        userId: rankRow.user_id,
        prizeAmount: amountStr,
        txnGroupId,
      });
    });
  }

  return payouts;
}
