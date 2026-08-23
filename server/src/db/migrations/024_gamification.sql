-- 024_gamification.sql (Prompt 9.4: Loyalty Coins, Daily Quests & Leaderboard)
-- Implements DFD Subsystem 13.0 schema: coin_balances, coin_transactions, quests, quest_progress, leaderboard_snapshots, and modules.

-- 1. Coin Balances Table (Double-Entry Balance Head)
CREATE TABLE IF NOT EXISTS coin_balances (
  user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance             INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned     INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_spent      INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  current_streak_days INTEGER NOT NULL DEFAULT 0 CHECK (current_streak_days >= 0),
  last_check_in_date  DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

-- 2. Coin Transactions (Double-Entry Liability Audit Trail)
CREATE TABLE IF NOT EXISTS coin_transactions (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_type          TEXT NOT NULL CHECK (entry_type IN ('CREDIT', 'DEBIT')),
  amount              INTEGER NOT NULL CHECK (amount > 0),
  balance_after       INTEGER NOT NULL CHECK (balance_after >= 0),
  source_category     TEXT NOT NULL, -- 'DAILY_CHECK_IN', 'ORDER_REWARD', 'REVIEW_REWARD', 'QUEST_REWARD', 'REFERRAL_BONUS', 'CHECKOUT_REDEMPTION', 'ORDER_CANCELLED_REFUND', 'MANUAL_ADJUSTMENT'
  reference_type      TEXT,          -- 'orders', 'quests', 'reviews', 'check_in'
  reference_id        BIGINT,
  memo                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coin_txns_user ON coin_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coin_txns_source ON coin_transactions (source_category);

-- 3. Quests Table (Data-Driven Configuration)
CREATE TABLE IF NOT EXISTS quests (
  id                  BIGSERIAL PRIMARY KEY,
  key                 TEXT UNIQUE NOT NULL,
  target_role         TEXT NOT NULL DEFAULT 'ALL' CHECK (target_role IN ('ALL', 'CUSTOMER', 'SALER', 'SUPPLIER')),
  cadence             TEXT NOT NULL DEFAULT 'DAILY' CHECK (cadence IN ('DAILY', 'WEEKLY', 'ONE_TIME')),
  title_en            TEXT NOT NULL,
  title_bn            TEXT NOT NULL,
  description_en      TEXT,
  description_bn      TEXT,
  event_type          TEXT NOT NULL, -- 'PLACE_ORDER', 'SUBMIT_REVIEW', 'SHARE_STORE', 'SELL_PRODUCT', 'DAILY_CHECK_IN'
  target_count        INTEGER NOT NULL DEFAULT 1 CHECK (target_count > 0),
  reward_coins        INTEGER NOT NULL DEFAULT 10 CHECK (reward_coins >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default starter quests
INSERT INTO quests (key, target_role, cadence, title_en, title_bn, description_en, description_bn, event_type, target_count, reward_coins, is_active)
VALUES
  ('daily_login', 'ALL', 'DAILY', 'Daily Check-in', 'দৈনিক চেক-ইন', 'Check into the app daily to build your streak.', 'ধারাবাহিকতা বাড়াতে প্রতিদিন অ্যাপে চেক-ইন করুন।', 'DAILY_CHECK_IN', 1, 10, true),
  ('daily_share_store', 'SALER', 'DAILY', 'Share Store Products', 'দোকানের পণ্য শেয়ার করুন', 'Share 3 products to social channels.', 'সোশ্যাল মিডিয়ায় ৩টি পণ্য শেয়ার করুন।', 'SHARE_STORE', 3, 25, true),
  ('daily_customer_order', 'CUSTOMER', 'DAILY', 'Place an Order', 'একটি অর্ডার সম্পন্ন করুন', 'Place any qualifying order today.', 'আজ যেকোনো একটি সফল অর্ডার সম্পন্ন করুন।', 'PLACE_ORDER', 1, 50, true),
  ('weekly_saler_sales', 'SALER', 'WEEKLY', 'Weekly Super Seller', 'সাপ্তাহিক সুপার সেলার', 'Complete 5 sales orders this week.', 'এই সপ্তাহে ৫টি সফল বিক্রয় সম্পন্ন করুন।', 'SELL_PRODUCT', 5, 150, true)
ON CONFLICT (key) DO UPDATE SET
  title_en = EXCLUDED.title_en,
  title_bn = EXCLUDED.title_bn,
  description_en = EXCLUDED.description_en,
  description_bn = EXCLUDED.description_bn;

-- 4. Quest Progress Tracking
CREATE TABLE IF NOT EXISTS quest_progress (
  id                  BIGSERIAL PRIMARY KEY,
  quest_id            BIGINT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key          TEXT NOT NULL, -- 'YYYY-MM-DD' for daily, 'YYYY-Www' for weekly
  current_count       INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  is_completed        BOOLEAN NOT NULL DEFAULT false,
  is_claimed          BOOLEAN NOT NULL DEFAULT false,
  claimed_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  CONSTRAINT uq_user_quest_period UNIQUE (quest_id, user_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_quest_progress_user ON quest_progress (user_id, period_key);

-- 5. Leaderboard Snapshots Table
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id                  BIGSERIAL PRIMARY KEY,
  period_key          TEXT NOT NULL, -- 'YYYY-MM'
  category            TEXT NOT NULL, -- 'SALER_REVENUE', 'SALER_ORDERS', 'SUPPLIER_VOLUME'
  rank                INTEGER NOT NULL CHECK (rank > 0),
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_value        NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  bonus_reward_amount NUMERIC(14,2) DEFAULT 0.00,
  bonus_distributed   BOOLEAN NOT NULL DEFAULT false,
  snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_leaderboard_rank UNIQUE (period_key, category, rank)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_period ON leaderboard_snapshots (period_key, category, rank ASC);

-- 6. Upsert Gamification Platform Modules
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, default_enabled, settings_json, settings_schema, depends_on)
VALUES
  ('loyalty_coins', 'growth', 'Loyalty Coins & Rewards', 'লয়্যালটি কয়েন ও রিওয়ার্ড',
   'Double-entry loyalty coins liability system with streak calendar and checkout redemption.',
   'স্ট্রিক ক্যালেন্ডার ও চেকআউট রিডেম্পশনসহ ডাবল-এন্ট্রি লয়্যালটি কয়েন সিস্টেম।',
   true, true,
   '{"coins_per_bdt_redemption": 10, "max_redemption_order_pct": 20, "check_in_base_coins": 10, "check_in_streak_step": 5, "check_in_max_streak_coins": 50}'::jsonb,
   '{"type": "object", "properties": { "coins_per_bdt_redemption": { "type": "integer", "default": 10 }, "max_redemption_order_pct": { "type": "integer", "default": 20 }, "check_in_base_coins": { "type": "integer", "default": 10 }, "check_in_streak_step": { "type": "integer", "default": 5 }, "check_in_max_streak_coins": { "type": "integer", "default": 50 } } }'::jsonb,
   ARRAY[]::text[]),
  ('daily_quests', 'growth', 'Daily & Weekly Quests', 'দৈনিক ও সাপ্তাহিক কোয়েস্ট',
   'Data-driven quest engine with role-specific progress tracking and coin reward claiming.',
   'রোল-নির্দিষ্ট প্রোগ্রেস ট্র্যাকিং ও কয়েন রিওয়ার্ডসহ ডেটা-চালিত কোয়েস্ট ইঞ্জিন।',
   true, true,
   '{"daily_reset_hour_utc": 0}'::jsonb,
   '{"type": "object", "properties": { "daily_reset_hour_utc": { "type": "integer", "default": 0 } } }'::jsonb,
   ARRAY['loyalty_coins']::text[]),
  ('gamification', 'growth', 'Leaderboards & Gamification', 'লিডারবোর্ড ও গ্যামিফিকেশন',
   'Nightly snapshot-based performance leaderboards with monthly prize pool distribution.',
   'মাসিক প্রাইজ পুল ডিস্ট্রিবিউশনসহ নাইটলি স্ন্যাপশট ভিত্তিক পারফরম্যান্স লিডারবোর্ড।',
   true, true,
   '{"monthly_bonus_pool_bdt": 50000.0, "top_ranks_eligible": 10}'::jsonb,
   '{"type": "object", "properties": { "monthly_bonus_pool_bdt": { "type": "number", "default": 50000.0 }, "top_ranks_eligible": { "type": "integer", "default": 10 } } }'::jsonb,
   ARRAY['loyalty_coins']::text[])
ON CONFLICT (key) DO UPDATE SET
  group_key = EXCLUDED.group_key,
  label_en = EXCLUDED.label_en,
  label_bn = EXCLUDED.label_bn,
  description_en = EXCLUDED.description_en,
  description_bn = EXCLUDED.description_bn,
  default_enabled = EXCLUDED.default_enabled,
  settings_schema = EXCLUDED.settings_schema,
  depends_on = EXCLUDED.depends_on;
