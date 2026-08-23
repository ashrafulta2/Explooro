/**
 * gamification.controller.js — Route handlers for Loyalty Coins, Quests & Leaderboards (Prompt 9.4).
 */

import * as coinService from '../services/coin.service.js';
import * as questService from '../services/quest.service.js';
import * as leaderboardService from '../services/leaderboard.service.js';

export async function getCoinBalance(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;

  const balance = await coinService.getUserCoinBalance(db, user.id);
  return reply.send({
    coin_balance: balance,
  });
}

export async function checkIn(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.server?.redis || req.redis || null;
  const user = req.user;

  const result = await coinService.recordDailyCheckIn(db, cache, user.id);
  return reply.send({
    check_in: result,
  });
}

export async function getCoinHistory(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;
  const { limit, offset } = req.query || {};

  const history = await coinService.getCoinHistory(db, user.id, {
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({
    history,
  });
}

export async function getTotalLiability(req, reply) {
  const db = req.db || req.server?.db;

  const liability = await coinService.getTotalCoinLiability(db);
  return reply.send({
    liability,
  });
}

export async function getQuests(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;
  const role = req.user?.roles?.[0] || 'CUSTOMER';

  const quests = await questService.getUserQuests(db, user.id, role);
  return reply.send({
    quests,
  });
}

export async function claimQuest(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;
  const { id } = req.params;

  const result = await questService.claimQuestReward(db, user.id, parseInt(id, 10));
  return reply.send({
    claim: result,
  });
}

export async function getLeaderboard(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;
  const { period_key, category, limit } = req.query || {};

  const result = await leaderboardService.getLeaderboard(db, {
    periodKey: period_key || leaderboardService.getCurrentMonthPeriodKey(),
    category: category || 'SALER_REVENUE',
    limit: limit ? parseInt(limit, 10) : 50,
    currentUserId: user?.id || null,
  });

  return reply.send(result);
}

export async function adminComputeSnapshot(req, reply) {
  const db = req.db || req.server?.db;
  const { period_key, category } = req.body || {};

  const result = await leaderboardService.computeLeaderboardSnapshot(db, {
    periodKey: period_key || leaderboardService.getCurrentMonthPeriodKey(),
    category: category || 'SALER_REVENUE',
  });

  return reply.send({
    message: 'Leaderboard snapshot computed successfully.',
    snapshot_count: result.length,
    snapshots: result,
  });
}
