/**
 * referralAdmin.service.js — read model and rule writes behind /admin/growth/referrals.
 *
 * The rules live in the `referral_engine` module's `settings_json` — the same row
 * `referral.service.getReferralSettings` reads — so what the admin edits is what the engine does.
 * Writes go through `updateModuleSettings`, which writes the audit_logs row with before/after.
 *
 * Only settings the engine actually enforces are editable here. The page used to offer an
 * attribution window, a minimum order value, a payout cap and per-signal fraud switches; none of
 * those exist in the engine, so saving them would have been a lie. The engine always checks
 * self-referral, circular referral and device fingerprint; only the daily velocity cap is a number.
 */

import { AppError } from '../plugins/errorHandler.js';
import { getReferralSettings } from './referral.service.js';
import { updateModuleSettings } from './module.service.js';

// WHY: the page speaks in operator terms (tier_depth, velocity_cap_per_day), the engine stores its
// own keys. This map is the only place the two vocabularies meet.
const RULE_KEYS = Object.freeze({
  tier_depth: 'max_tier_depth',
  tier_1_rate_pct: 'tier_1_rate_pct',
  tier_2_rate_pct: 'tier_2_rate_pct',
  holding_period_days: 'holding_period_days',
  qualify_on: 'qualifying_event',
  velocity_cap_per_day: 'daily_velocity_limit',
});

// WHY depth tops out at 2: recordReferralAttribution only ever builds tier 1 and tier 2 rows.
export const RULE_LIMITS = Object.freeze({
  tier_depth: { min: 1, max: 2, integer: true },
  tier_1_rate_pct: { min: 0, max: 50 },
  tier_2_rate_pct: { min: 0, max: 50 },
  holding_period_days: { min: 0, max: 90, integer: true },
  velocity_cap_per_day: { min: 1, max: 500, integer: true },
});

// Mirrors the CHECK constraint on referrals.qualifying_event (migration 023).
export const QUALIFY_EVENTS = Object.freeze(['SIGNUP', 'FIRST_ORDER', 'FIRST_SALE', 'KYC_VERIFIED']);

const MAX_COMBINED_RATE_PCT = 50;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Engine settings -> the shape the admin form edits (defaults mirror getReferralSettings). */
export function toReferralRules(settings = {}) {
  return {
    tier_depth: num(settings.max_tier_depth, 2),
    tier_1_rate_pct: num(settings.tier_1_rate_pct, 5),
    tier_2_rate_pct: num(settings.tier_2_rate_pct, 2),
    holding_period_days: num(settings.holding_period_days, 7),
    qualify_on: settings.qualifying_event || 'FIRST_ORDER',
    velocity_cap_per_day: num(settings.daily_velocity_limit, 20),
  };
}

/** Strict validation: out of range is refused, never clamped. Returns an engine-keyed patch. */
export function validateReferralRulesPatch(input, current = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('VALIDATION_ERROR', 'A referral rules object is required.');
  }
  const form = {};
  for (const [formKey, engineKey] of Object.entries(RULE_KEYS)) {
    const v = input[formKey];
    if (v === undefined) continue;
    if (formKey === 'qualify_on') {
      if (!QUALIFY_EVENTS.includes(v)) {
        throw new AppError('VALIDATION_ERROR', `qualify_on must be one of ${QUALIFY_EVENTS.join(', ')}.`);
      }
    } else {
      const { min, max, integer } = RULE_LIMITS[formKey];
      if (typeof v !== 'number' || !Number.isFinite(v) || (integer && !Number.isInteger(v)) || v < min || v > max) {
        throw new AppError(
          'VALIDATION_ERROR',
          `${formKey} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`
        );
      }
    }
    form[formKey] = { engineKey, value: v };
  }
  if (Object.keys(form).length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No referral rule field was supplied.');
  }

  // WHY check the merged result: a tier-2 rate above tier 1 inverts the incentive and a combined
  // rate above the cap makes every referred order lose money; both depend on the stored values too.
  const merged = { ...toReferralRules(current) };
  for (const [formKey, { value }] of Object.entries(form)) merged[formKey] = value;
  if (merged.tier_depth >= 2 && merged.tier_2_rate_pct > merged.tier_1_rate_pct) {
    throw new AppError('VALIDATION_ERROR', 'tier_2_rate_pct cannot exceed tier_1_rate_pct.');
  }
  const combined = merged.tier_1_rate_pct + (merged.tier_depth >= 2 ? merged.tier_2_rate_pct : 0);
  if (combined > MAX_COMBINED_RATE_PCT) {
    throw new AppError('VALIDATION_ERROR', `Combined referral commission cannot exceed ${MAX_COMBINED_RATE_PCT}%.`);
  }

  const patch = {};
  for (const { engineKey, value } of Object.values(form)) patch[engineKey] = value;
  return patch;
}

export async function updateReferralRules(db, cache, actor, input) {
  const current = await getReferralSettings(db);
  const patch = validateReferralRulesPatch(input, current);
  await updateModuleSettings(db, cache, actor, 'referral_engine', {
    settings: patch,
    reason: 'Referral rules edited at /admin/growth/referrals',
  });
  return toReferralRules(await getReferralSettings(db));
}

/** Programme stats, current rules and the flagged queue, in the shape AdminReferralsPage reads. */
export async function getReferralAdminOverview(db) {
  const settings = await getReferralSettings(db);

  const { rows: stats } = await db.query(`
    SELECT
      COUNT(*)::int AS total_referrals,
      COUNT(*) FILTER (WHERE status = 'QUALIFIED')::int AS qualified_count,
      COUNT(*) FILTER (WHERE status = 'FRAUD_FLAGGED')::int AS fraud_flagged_count,
      COUNT(DISTINCT referrer_user_id) FILTER (WHERE created_at >= now() - interval '30 days')::int AS active_referrers_count
    FROM referrals
  `);
  const { rows: paid } = await db.query(`
    SELECT COALESCE(SUM(commission_amount), 0)::numeric(14,2) AS total
      FROM referral_earnings
     WHERE status <> 'VOIDED'
  `);
  const { rows: flagged } = await db.query(`
    SELECT r.id, r.ref, r.fraud_reason, r.created_at,
           COALESCE(rup.display_name, rup.full_name, ru.phone) AS referrer_name,
           COALESCE(up.display_name, up.full_name, u.phone) AS referee_name,
           COALESCE((SELECT SUM(re.commission_amount) FROM referral_earnings re
                      WHERE re.referral_id = r.id AND re.status = 'PENDING_ESCROW'), 0)::numeric(14,2) AS held
      FROM referrals r
      JOIN users ru ON ru.id = r.referrer_user_id
      LEFT JOIN user_profiles rup ON rup.user_id = ru.id
      JOIN users u ON u.id = r.referred_user_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE r.status = 'FRAUD_FLAGGED'
     ORDER BY r.created_at DESC
     LIMIT 50
  `);
  const { rows: mod } = await db.query(`SELECT is_enabled FROM platform_modules WHERE key = 'referral_engine'`);

  return {
    stats: stats[0],
    total_commissions_paid: paid[0]?.total || '0.00',
    rules: { ...toReferralRules(settings), is_active: mod[0]?.is_enabled !== false },
    rule_limits: { ...RULE_LIMITS, qualify_events: QUALIFY_EVENTS },
    flagged_referrals: flagged.map((f) => ({
      id: f.ref,
      reason: f.fraud_reason || 'UNSPECIFIED',
      referrer_name: f.referrer_name,
      referee_name: f.referee_name,
      amount_held_bdt: num(f.held),
      flagged_at: f.created_at,
    })),
  };
}
