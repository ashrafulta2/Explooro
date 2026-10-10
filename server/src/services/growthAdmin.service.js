/**
 * growthAdmin.service.js — read models and policy writes behind the Phase 9 admin pages
 * (/admin/growth/ads, /admin/growth/quests, /admin/growth/coins).
 *
 * Nothing here owns business numbers: the coin policy lives in the `loyalty_coins` module's
 * `settings_json` (the same row the coin engine reads), and every write goes through
 * `updateModuleSettings`, which writes the audit_logs row with before/after.
 */

import { AppError } from '../plugins/errorHandler.js';
import { calculateQualityScore } from './adAuction.service.js';
import { getCoinSettings } from './coin.service.js';
import { updateModuleSettings } from './module.service.js';

// WHY: the admin form speaks in operator terms (coins_per_bdt), the engine stores its own keys.
// This map is the only place the two vocabularies meet.
const POLICY_KEYS = Object.freeze({
  coins_per_bdt: 'coins_per_bdt_redemption',
  max_redeem_pct_of_order: 'max_redemption_order_pct',
  daily_earn_cap: 'daily_earn_cap',
  expiry_days: 'expiry_days',
  min_redeem_balance: 'min_redeem_balance',
});

export const POLICY_LIMITS = Object.freeze({
  coins_per_bdt: { min: 1, max: 1000 },
  max_redeem_pct_of_order: { min: 1, max: 100 },
  daily_earn_cap: { min: 0, max: 100000 },
  expiry_days: { min: 0, max: 3650 },
  min_redeem_balance: { min: 0, max: 1000000 },
});

const POLICY_DEFAULTS = Object.freeze({
  coins_per_bdt: 10,
  max_redeem_pct_of_order: 20,
  daily_earn_cap: 0,
  expiry_days: 365,
  min_redeem_balance: 0,
});

const STREAK_CURVE_DAYS = 7;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Engine settings -> the shape the admin form edits. */
export function toCoinPolicy(settings = {}) {
  const out = {};
  for (const [formKey, engineKey] of Object.entries(POLICY_KEYS)) {
    const raw = settings[engineKey];
    out[formKey] = raw === undefined || raw === null ? POLICY_DEFAULTS[formKey] : num(raw);
  }
  return out;
}

/** Day n of a streak pays base + (n-1)*step capped at max; the multiplier is that over day 1. */
export function buildStreakCurve(settings = {}) {
  const base = num(settings.check_in_base_coins ?? 10) || 10;
  const step = num(settings.check_in_streak_step ?? 5);
  const max = num(settings.check_in_max_streak_coins ?? 50);
  const curve = [];
  for (let day = 1; day <= STREAK_CURVE_DAYS; day += 1) {
    const reward = Math.min(base + (day - 1) * step, max);
    curve.push({ day, reward_coins: reward, multiplier: Number((reward / base).toFixed(2)) });
  }
  return curve;
}

/** Strict validation: out of range or non-integer is refused, never clamped. */
export function validateCoinPolicyPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('VALIDATION_ERROR', 'A coin policy object is required.');
  }
  const patch = {};
  for (const [formKey, engineKey] of Object.entries(POLICY_KEYS)) {
    if (input[formKey] === undefined) continue;
    const v = input[formKey];
    const { min, max } = POLICY_LIMITS[formKey];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new AppError('VALIDATION_ERROR', `${formKey} must be a whole number between ${min} and ${max}.`);
    }
    patch[engineKey] = v;
  }
  if (Object.keys(patch).length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No coin policy field was supplied.');
  }
  return patch;
}

export async function updateCoinPolicy(db, cache, actor, input) {
  const patch = validateCoinPolicyPatch(input);
  await updateModuleSettings(db, cache, actor, 'loyalty_coins', {
    settings: patch,
    reason: 'Coin policy edited at /admin/growth/coins',
  });
  return toCoinPolicy(await getCoinSettings(db));
}

/** Quests + coin economy + streak curve + 30-day top earners, in the shape AdminQuestsPage reads. */
export async function getQuestsOverview(db) {
  const settings = await getCoinSettings(db);

  const { rows: questRows } = await db.query(`
    SELECT q.id, q.key, q.title_en, q.title_bn, q.description_en, q.description_bn,
           q.cadence, q.reward_coins, q.target_count, q.is_active,
           COALESCE(p.done, 0)::int AS completions_today
      FROM quests q
      LEFT JOIN (
        SELECT quest_id, COUNT(*) AS done
          FROM quest_progress
         WHERE is_completed = true AND updated_at >= date_trunc('day', now())
         GROUP BY quest_id
      ) p ON p.quest_id = q.id
     ORDER BY q.id
  `);

  const { rows: econ } = await db.query(`
    SELECT COALESCE(SUM(balance), 0)::bigint AS in_circulation,
           COUNT(*) FILTER (WHERE current_streak_days > 0 AND last_check_in_date >= CURRENT_DATE - 1)::int AS streakers
      FROM coin_balances
  `);
  const { rows: redeemed } = await db.query(`
    SELECT COALESCE(SUM(amount), 0)::bigint AS redeemed
      FROM coin_transactions
     WHERE entry_type = 'DEBIT' AND created_at >= now() - interval '30 days'
  `);

  const coinsPerBdt = POLICY_DEFAULTS.coins_per_bdt;
  const rate = num(settings.coins_per_bdt_redemption) || coinsPerBdt;
  const inCirculation = num(econ[0]?.in_circulation);

  const { rows: top } = await db.query(`
    SELECT COALESCE(up.display_name, up.full_name, u.phone) AS name,
           COALESCE(up.district, '—') AS district,
           SUM(t.amount)::int AS coins_earned_30d,
           COALESCE(b.current_streak_days, 0)::int AS streak_days
      FROM coin_transactions t
      JOIN users u ON u.id = t.user_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      LEFT JOIN coin_balances b ON b.user_id = u.id
     WHERE t.entry_type = 'CREDIT' AND t.created_at >= now() - interval '30 days'
     GROUP BY u.id, up.display_name, up.full_name, up.district, u.phone, b.current_streak_days
     ORDER BY coins_earned_30d DESC
     LIMIT 10
  `);

  return {
    quests: questRows.map((q) => ({
      id: q.id,
      key: q.key,
      title: q.title_en,
      title_bn: q.title_bn,
      description: q.description_en || '',
      description_bn: q.description_bn || '',
      reward_coins: q.reward_coins,
      target_count: q.target_count,
      // WHY: the page's labels are DAILY / WEEKLY / PER_ORDER; the table stores `cadence`.
      frequency: q.cadence,
      completions_today: q.completions_today,
      is_active: q.is_active,
    })),
    economy: {
      coins_in_circulation: inCirculation,
      total_liability_bdt: Number((inCirculation / rate).toFixed(2)),
      redeemed_coins_30d: num(redeemed[0]?.redeemed),
      active_daily_streakers: num(econ[0]?.streakers),
    },
    coin_policy: toCoinPolicy(settings),
    policy_limits: POLICY_LIMITS,
    streak_curve: buildStreakCurve(settings),
    leaderboard: top.map((r, i) => ({ rank: i + 1, ...r })),
  };
}

/** Edit one quest's reward or active flag. Writes the audit row itself (no module wrapper here). */
export async function updateQuest(db, actor, id, input, auditService) {
  const questId = Number(id);
  if (!Number.isInteger(questId) || questId <= 0) {
    throw new AppError('VALIDATION_ERROR', 'Invalid quest id.');
  }
  const sets = [];
  const params = [];
  if (input?.is_active !== undefined) {
    if (typeof input.is_active !== 'boolean') throw new AppError('VALIDATION_ERROR', 'is_active must be a boolean.');
    params.push(input.is_active);
    sets.push(`is_active = $${params.length}`);
  }
  if (input?.reward_coins !== undefined) {
    const v = input.reward_coins;
    if (!Number.isInteger(v) || v < 0 || v > 100000) {
      throw new AppError('VALIDATION_ERROR', 'reward_coins must be a whole number between 0 and 100000.');
    }
    params.push(v);
    sets.push(`reward_coins = $${params.length}`);
  }
  if (sets.length === 0) throw new AppError('VALIDATION_ERROR', 'Nothing to update.');

  const { rows: before } = await db.query('SELECT id, key, is_active, reward_coins FROM quests WHERE id = $1', [questId]);
  if (!before[0]) throw new AppError('NOT_FOUND', 'Quest not found.');

  params.push(questId);
  const { rows } = await db.query(
    `UPDATE quests SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, key, is_active, reward_coins`,
    params
  );

  await auditService.record(db, {
    actor: actor?.id ?? null,
    actor_role: actor?.role ?? 'admin',
    action: 'growth.quest.update',
    target_type: 'quest',
    target_ref: String(questId),
    before: before[0],
    after: rows[0],
    risk_tier: 'MEDIUM',
  });
  return rows[0];
}

/**
 * Pause or resume one campaign as the platform. A pause stamps `admin_paused_at` so the merchant's
 * own Resume is refused (ads.service.toggleCampaignStatus); only this function clears it.
 */
export async function setCampaignState(db, actor, campaignId, action, reason, auditSvc) {
  if (!['pause', 'resume'].includes(action)) throw new AppError('VALIDATION_ERROR', 'Action must be pause or resume.');
  const note = typeof reason === 'string' ? reason.trim() : '';
  if (note.length < 3 || note.length > 500) {
    throw new AppError('VALIDATION_ERROR', 'A reason of 3–500 characters is required.');
  }
  const { rows: found } = await db.query(
    'SELECT id, ref, status, start_date, admin_paused_at FROM ad_campaigns WHERE id = $1',
    [campaignId]
  );
  const before = found[0];
  if (!before) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found.');

  let sql;
  let params = [campaignId];
  if (action === 'pause') {
    if (!['ACTIVE', 'SCHEDULED'].includes(before.status)) {
      throw new AppError('CAMPAIGN_NOT_RUNNING', 'Only an active or scheduled campaign can be paused.');
    }
    params = [campaignId, note];
    sql = `UPDATE ad_campaigns SET status = 'PAUSED', admin_paused_at = now(), admin_pause_reason = $2, updated_at = now()
            WHERE id = $1 RETURNING id, ref, status, admin_paused_at, admin_pause_reason`;
  } else {
    if (!before.admin_paused_at) {
      throw new AppError('CAMPAIGN_NOT_ADMIN_PAUSED', 'Only a campaign the platform paused can be resumed here.');
    }
    // WHY: a campaign paused before its first booked day must go back to SCHEDULED, not ACTIVE,
    // or it would be served early.
    sql = `UPDATE ad_campaigns
              SET status = CASE WHEN start_date > now() THEN 'SCHEDULED' ELSE 'ACTIVE' END,
                  admin_paused_at = NULL, admin_pause_reason = NULL, updated_at = now()
            WHERE id = $1
        RETURNING id, ref, status, admin_paused_at, admin_pause_reason`;
  }
  const { rows } = await db.query(sql, params);

  await auditSvc.record(db, {
    actor: actor?.id ?? null,
    actor_role: actor?.role ?? 'admin',
    action: `growth.ad.admin_${action}`,
    target_type: 'ad_campaign',
    target_ref: before.ref,
    before: { status: before.status, admin_paused_at: before.admin_paused_at },
    after: { status: rows[0].status, reason: note },
    risk_tier: 'HIGH',
  });
  return { id: rows[0].id, ref: rows[0].ref, status: rows[0].status, admin_paused: Boolean(rows[0].admin_paused_at) };
}

/** Every ad campaign with its owner, plus platform-wide totals, for /admin/growth/ads. */
export async function getAdsOverview(db) {
  const { rows } = await db.query(`
    SELECT c.id, c.ref, c.title, c.placement, c.status, c.admin_paused_at, c.admin_pause_reason, c.targeting_json, c.bid_amount,
           c.daily_budget, c.total_budget, c.spent_amount, c.today_spent_amount, c.last_spent_date,
           c.start_date, c.end_date, c.impressions_count, c.clicks_count,
           COALESCE(up.display_name, up.full_name, u.phone) AS merchant_name,
           (SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = c.user_id AND r.key IN ('supplier', 'saler') LIMIT 1) AS merchant_role
      FROM ad_campaigns c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
     ORDER BY c.created_at DESC
     LIMIT 200
  `);
  const { rows: fraud } = await db.query(
    `SELECT COUNT(*)::int AS n FROM ad_clicks WHERE is_valid = false AND created_at >= now() - interval '30 days'`
  );

  const campaigns = rows.map((c) => {
    const impressions = num(c.impressions_count);
    const clicks = num(c.clicks_count);
    const spent = num(c.spent_amount);
    return {
      id: c.id,
      ref: c.ref,
      title: c.title,
      placement: c.placement,
      status: c.status,
      admin_paused: Boolean(c.admin_paused_at),
      admin_pause_reason: c.admin_pause_reason || null,
      merchant_name: c.merchant_name,
      merchant_role: (c.merchant_role || '').toUpperCase() || 'SALER',
      daily_budget: num(c.daily_budget),
      total_spent: spent,
      impressions,
      clicks,
      cpc_bdt: clicks > 0 ? Number((spent / clicks).toFixed(2)) : 0,
      // WHY: quality score is derived by the auction at serve time, never stored; recompute it with
      // the same function so the admin sees what the auction sees.
      quality_score: Number(num(calculateQualityScore(c, 'STARTER', {})).toFixed(1)),
    };
  });

  const impressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const clicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const spend = campaigns.reduce((s, c) => s + c.total_spent, 0);

  return {
    campaigns,
    stats: {
      total_spend_bdt: Number(spend.toFixed(2)),
      impressions,
      clicks,
      avg_cpc_bdt: clicks > 0 ? Number((spend / clicks).toFixed(2)) : 0,
      fraud_blocked_clicks: fraud[0]?.n || 0,
      active_campaigns: campaigns.filter((c) => c.status === 'ACTIVE').length,
    },
  };
}
