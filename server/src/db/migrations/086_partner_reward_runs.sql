-- 086_partner_reward_runs.sql
--
-- Phase B of the partner reward pool: once a month the pool is shared out to shop partners by score.
--
-- Migration 085 sends the partner share of every partner-brought sale to the PARTNER_REWARD_POOL
-- wallet. Each month the `partner_reward` job (services/partnerReward.service.ts) closes the month
-- that ended:
--   1. moves `ad_revenue_share_pct` of that month's ad revenue from the treasury into the pool;
--   2. scores every active shop partner on four factors, store sales > social shares > community
--      posts > activity (the weights are this row's setting, never constants);
--   3. pays the pool's released balance out in proportion to score, one balanced ledger group.
-- Rounding paisa, and money still in escrow, stay in the pool for the next month.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS partner_reward_runs (
  id                 BIGSERIAL PRIMARY KEY,
  period_start       DATE NOT NULL UNIQUE,            -- first day of the month, platform timezone
  period_end         DATE NOT NULL,                   -- last day, inclusive
  status             TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED')),
  ad_revenue         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (ad_revenue >= 0),
  ad_share           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (ad_share >= 0),
  pool_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (pool_amount >= 0),   -- available to share
  paid_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  carried_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (carried_amount >= 0),
  partners_scored    INTEGER NOT NULL DEFAULT 0,
  rules_json         JSONB NOT NULL,                  -- the rules the month was scored with
  totals_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  txn_group_id       UUID,
  triggered_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,  -- NULL = the scheduled job
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (paid_amount + carried_amount = pool_amount)
);

CREATE TABLE IF NOT EXISTS partner_reward_payouts (
  id                 BIGSERIAL PRIMARY KEY,
  run_id             BIGINT NOT NULL REFERENCES partner_reward_runs(id) ON DELETE CASCADE,
  saler_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  metrics_json       JSONB NOT NULL,                  -- raw counts per factor
  points_json        JSONB NOT NULL,                  -- points per factor (weight x share)
  score              NUMERIC(8,4) NOT NULL CHECK (score >= 0),
  share_pct          NUMERIC(7,4) NOT NULL CHECK (share_pct >= 0 AND share_pct <= 100),
  amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, saler_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_reward_payouts_saler ON partner_reward_payouts (saler_id, run_id DESC);

-- The payout's own ledger category, so the treasury report and a partner's statement can tell a
-- reward from a sale commission.
DO $$
DECLARE
  old_name TEXT;
BEGIN
  FOR old_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%ESCROW_RELEASE%'
  LOOP
    EXECUTE format('ALTER TABLE ledger_transactions DROP CONSTRAINT %I', old_name);
  END LOOP;

  ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_category_check
    CHECK (category IN ('SALE_COMMISSION','SUPPLIER_PAYMENT','ESCROW_LOCK','ESCROW_RELEASE',
                        'CLAWBACK','REFUND','PAYOUT','PAYOUT_FEE','ADJUSTMENT','AD_SPEND',
                        'COIN_REDEMPTION','REFERRAL_BONUS','QUEST_REWARD','COD_SETTLEMENT',
                        'SUBSCRIPTION_FEE','VOLUME_INCENTIVE',
                        'SAMPLE_HOLD','SAMPLE_RELEASE','SAMPLE_REFUND',
                        'TEAM_PURCHASE_HOLD','TEAM_PURCHASE_RELEASE',
                        'FAST_PAYOUT_FEE','RETURN_PROTECTION_PREMIUM','RETURN_PROTECTION_CLAIM',
                        'REFERRAL_COMMISSION','REFERRAL_REVERSAL','LEADERBOARD_BONUS',
                        'PARTNER_REWARD'));
END $$;

-- partner_reward.rules — the business numbers. Bounds live in partnerReward.service.ts RULE_LIMITS.
--   weights                 points per factor; must add up to 100 and keep the owner's order
--                           sales >= social >= community >= activity
--   ad_revenue_share_pct    share of a month's ad revenue that joins the pool
--   community_points        what a post, and each like / comment / save it gets from others, is worth
--   max_posts_per_day       posts beyond this in one day earn nothing (stops spam farming)
--   settle_lag_days         days after month end before the month closes, so most of its sales have
--                           left escrow and are in the pool
--   timezone                where a month starts and ends
--   first_month             the first month the pool closes: the month this migration ran. Earlier
--                           months are never closed, so going live does not reach back and move
--                           old ad revenue out of the treasury. Not editable from the admin page.
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'partner_reward.rules',
  '{"weights": {"sales": 40, "social": 25, "community": 20, "activity": 15},
    "ad_revenue_share_pct": 20,
    "community_points": {"post": 3, "like": 1, "comment": 2, "save": 2},
    "max_posts_per_day": 3,
    "settle_lag_days": 7,
    "timezone": "Asia/Dhaka"}'::jsonb
    || jsonb_build_object('first_month', to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Dhaka'), 'YYYY-MM-DD')),
  'OBJECT', 'Shop partner reward pool rules', 'শপ পার্টনার রিওয়ার্ড পুলের নিয়ম', 'growth', false
)
ON CONFLICT (key) DO NOTHING;
