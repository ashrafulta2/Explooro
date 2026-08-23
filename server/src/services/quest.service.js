/**
 * quest.service.js — Daily & Weekly Quest Engine (Prompt 9.4).
 *
 * Implements:
 * 1. Data-driven quest definitions (daily, weekly, one-time).
 * 2. Role-specific quest routing (Customer, Saler, Supplier).
 * 3. Dynamic progress tracking on platform actions.
 * 4. Atomic reward claiming with double-entry coin crediting.
 */

import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import * as coinService from './coin.service.js';

export function computePeriodKey(cadence, date = new Date()) {
  const d = new Date(date);
  if (cadence === 'DAILY') {
    return d.toISOString().slice(0, 10);
  }
  if (cadence === 'WEEKLY') {
    // ISO week number calculation
    const tempDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = tempDate.getUTCDay() || 7;
    tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7);
    return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
  return 'LIFETIME';
}

/**
 * Returns all active quests for a user's role with current period progress.
 */
export async function getUserQuests(db, userId, role = 'CUSTOMER') {
  const upperRole = String(role || 'CUSTOMER').toUpperCase();

  const { rows: questRows } = await db.query(
    `SELECT * FROM quests
     WHERE is_active = true
       AND (target_role = 'ALL' OR target_role = $1)
     ORDER BY cadence ASC, id ASC`,
    [upperRole]
  );

  const results = [];
  for (const q of questRows) {
    const periodKey = computePeriodKey(q.cadence);
    const { rows: pRows } = await db.query(
      `SELECT * FROM quest_progress
       WHERE quest_id = $1 AND user_id = $2 AND period_key = $3`,
      [q.id, userId, periodKey]
    );

    const progress = pRows[0] || {
      current_count: 0,
      is_completed: false,
      is_claimed: false,
    };

    const currentCount = progress.current_count || 0;
    const progressPct = Math.min(100, Math.floor((currentCount / q.target_count) * 100));

    results.push({
      id: q.id,
      key: q.key,
      target_role: q.target_role,
      cadence: q.cadence,
      title_en: q.title_en,
      title_bn: q.title_bn,
      description_en: q.description_en,
      description_bn: q.description_bn,
      event_type: q.event_type,
      target_count: q.target_count,
      reward_coins: q.reward_coins,
      period_key: periodKey,
      current_count: currentCount,
      progress_pct: progressPct,
      is_completed: progress.is_completed || currentCount >= q.target_count,
      is_claimed: Boolean(progress.is_claimed),
    });
  }

  return results;
}

/**
 * Records progress towards quests when an event occurs.
 */
export async function recordQuestEvent(db, { userId, eventType, count = 1 }) {
  const { rows: matchingQuests } = await db.query(
    `SELECT * FROM quests WHERE is_active = true AND event_type = $1`,
    [eventType]
  );

  if (matchingQuests.length === 0) return [];

  const updatedProgress = [];

  for (const q of matchingQuests) {
    const periodKey = computePeriodKey(q.cadence);

    const { rows: pRows } = await db.query(
      `INSERT INTO quest_progress (quest_id, user_id, period_key, current_count, is_completed)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (quest_id, user_id, period_key)
       DO UPDATE SET
         current_count = quest_progress.current_count + EXCLUDED.current_count,
         is_completed = CASE WHEN (quest_progress.current_count + EXCLUDED.current_count) >= $6 THEN true ELSE quest_progress.is_completed END,
         updated_at = now()
       RETURNING *`,
      [q.id, userId, periodKey, count, count >= q.target_count, q.target_count]
    );

    updatedProgress.push(pRows[0]);
  }

  return updatedProgress;
}

/**
 * Claims the loyalty coin reward for a completed quest.
 */
export async function claimQuestReward(db, userId, questId) {
  return withTransaction(db, async (client) => {
    const { rows: qRows } = await client.query(
      `SELECT * FROM quests WHERE id = $1 AND is_active = true`,
      [questId]
    );

    const quest = qRows[0];
    if (!quest) {
      throw new AppError('QUEST_NOT_FOUND', 'Active quest not found.');
    }

    const periodKey = computePeriodKey(quest.cadence);

    const { rows: pRows } = await client.query(
      `SELECT * FROM quest_progress
       WHERE quest_id = $1 AND user_id = $2 AND period_key = $3
       FOR UPDATE`,
      [questId, userId, periodKey]
    );

    const progress = pRows[0];
    if (!progress || (!progress.is_completed && progress.current_count < quest.target_count)) {
      throw new AppError('QUEST_NOT_COMPLETED', 'You have not completed this quest yet.');
    }

    if (progress.is_claimed) {
      throw new AppError('QUEST_ALREADY_CLAIMED', 'Quest reward has already been claimed for this period.');
    }

    // Mark as claimed
    await client.query(
      `UPDATE quest_progress
       SET is_claimed = true, is_completed = true, claimed_at = now(), updated_at = now()
       WHERE id = $1`,
      [progress.id]
    );

    // Award loyalty coins
    const awardRes = await coinService.awardCoins(client, {
      userId,
      amount: quest.reward_coins,
      sourceCategory: 'QUEST_REWARD',
      referenceType: 'quests',
      referenceId: quest.id,
      memo: `Completed quest: ${quest.title_en} (+${quest.reward_coins} coins)`,
    });

    return {
      claimed: true,
      rewardCoins: quest.reward_coins,
      newBalance: awardRes.newBalance,
    };
  });
}
