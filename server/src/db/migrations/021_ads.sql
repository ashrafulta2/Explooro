-- 021_ads.sql (Prompt 9.1: Sponsored Ads Engine)
-- Implements In-Platform Sponsored Ads Engine schema per docs/erd.md & prompt.md §9.1:
-- ad_campaigns, ad_creatives, ad_impressions (monthly partitioned), ad_clicks, ad_billing.

-- 1. Ad Campaigns
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,                   -- ADC-8X2P9K1L
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  objective             TEXT NOT NULL CHECK (objective IN ('AWARENESS', 'TRAFFIC', 'CONVERSIONS', 'SALES')),
  placement             TEXT NOT NULL CHECK (placement IN ('SEARCH_RESULTS', 'CATEGORY_BANNER', 'FEED', 'PRODUCT_PAGE')),
  status                TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                        CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'COMPLETED', 'REJECTED')),
  targeting_json        JSONB NOT NULL DEFAULT '{"categories":[], "districts":[], "keywords":[]}'::jsonb,
  daily_budget          NUMERIC(14,2) NOT NULL CHECK (daily_budget >= 0),
  total_budget          NUMERIC(14,2) NOT NULL CHECK (total_budget >= daily_budget),
  spent_amount          NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (spent_amount >= 0),
  today_spent_amount    NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (today_spent_amount >= 0),
  last_spent_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  bid_amount            NUMERIC(14,2) NOT NULL CHECK (bid_amount > 0), -- Max CPC bid
  start_date            TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_date              TIMESTAMPTZ,
  rejection_reason      TEXT,
  reviewed_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           TIMESTAMPTZ,
  impressions_count     BIGINT NOT NULL DEFAULT 0,
  clicks_count          BIGINT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_user ON ad_campaigns (user_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status_placement ON ad_campaigns (status, placement);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_targeting ON ad_campaigns USING gin (targeting_json);

-- 2. Ad Creatives
CREATE TABLE IF NOT EXISTS ad_creatives (
  id                    BIGSERIAL PRIMARY KEY,
  campaign_id           BIGINT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  product_id            BIGINT REFERENCES products(id) ON DELETE SET NULL,
  headline              TEXT NOT NULL,
  description           TEXT,
  banner_image_url      TEXT,
  call_to_action        TEXT NOT NULL DEFAULT 'SHOP_NOW',
  destination_url       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_campaign ON ad_creatives (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_product ON ad_creatives (product_id);

-- 3. Ad Impressions (Partitioned by Month)
CREATE TABLE IF NOT EXISTS ad_impressions (
  id                    BIGSERIAL,
  campaign_id           BIGINT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  creative_id           BIGINT REFERENCES ad_creatives(id) ON DELETE SET NULL,
  viewer_id             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  session_id            TEXT,
  ip_address            TEXT,
  placement             TEXT NOT NULL,
  viewable              BOOLEAN NOT NULL DEFAULT true,          -- Viewability-based (>= 50% in viewport for >= 1s)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_ad_impressions_campaign_time ON ad_impressions (campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_viewer ON ad_impressions (viewer_id, created_at);

-- Monthly Partitions for ad_impressions: current month + 3 months ahead
DO $$
DECLARE
  month_start DATE := date_trunc('month', now())::date;
  i INT;
  partition_name TEXT;
  range_start DATE;
  range_end DATE;
BEGIN
  FOR i IN 0..3 LOOP
    range_start := (month_start + (i || ' month')::interval)::date;
    range_end := (month_start + ((i + 1) || ' month')::interval)::date;
    partition_name := 'ad_impressions_p' || to_char(range_start, 'YYYY_MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = partition_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF ad_impressions FOR VALUES FROM (%L) TO (%L);',
        partition_name, range_start, range_end
      );
    END IF;
  END LOOP;
END $$;

-- 4. Ad Clicks
CREATE TABLE IF NOT EXISTS ad_clicks (
  id                    BIGSERIAL PRIMARY KEY,
  campaign_id           BIGINT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  creative_id           BIGINT REFERENCES ad_creatives(id) ON DELETE SET NULL,
  user_id               BIGINT REFERENCES users(id) ON DELETE SET NULL,
  session_id            TEXT,
  ip_address            TEXT,
  cpc_charged           NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  is_valid              BOOLEAN NOT NULL DEFAULT true,          -- Fraud protection flag
  invalid_reason        TEXT,                                   -- SELF_CLICK, DUPLICATE_CLICK, etc.
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_clicks_campaign ON ad_clicks (campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_user_ip ON ad_clicks (user_id, ip_address, created_at);

-- 5. Ad Billing Log
CREATE TABLE IF NOT EXISTS ad_billing (
  id                    BIGSERIAL PRIMARY KEY,
  campaign_id           BIGINT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  click_id              BIGINT REFERENCES ad_clicks(id) ON DELETE SET NULL,
  wallet_id             BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  amount                NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  txn_group_id          UUID NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_billing_campaign ON ad_billing (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_billing_wallet ON ad_billing (wallet_id);

-- Ensure platform_modules has sponsored_ads module registered
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, default_enabled, settings_json, settings_schema, depends_on)
VALUES
  ('sponsored_ads', 'growth', 'Sponsored ads engine', 'স্পন্সর্ড বিজ্ঞাপন ইঞ্জিন',
   'Sellers pay to boost listings in search, category banners and the feed.',
   'বিক্রেতারা টাকা দিয়ে সার্চ, ক্যাটেগরি ব্যানার ও ফিডে পণ্য প্রচার করে।',
   true, true, '{"max_ads_per_page": 3, "min_daily_budget": 50, "require_creative_review": true, "blocked_keywords": ["illegal", "replica", "counterfeit", "fake", "weapons", "adult", "gambling"]}'::jsonb,
   '{"type": "object", "properties": { "max_ads_per_page": { "type": "integer", "default": 3 }, "min_daily_budget": { "type": "number", "default": 50 }, "require_creative_review": { "type": "boolean", "default": true }, "blocked_keywords": { "type": "array", "items": { "type": "string" } } } }'::jsonb,
   ARRAY[]::text[])
ON CONFLICT (key) DO UPDATE SET
  group_key = EXCLUDED.group_key,
  label_en = EXCLUDED.label_en,
  label_bn = EXCLUDED.label_bn,
  description_en = EXCLUDED.description_en,
  description_bn = EXCLUDED.description_bn,
  default_enabled = EXCLUDED.default_enabled,
  settings_schema = EXCLUDED.settings_schema;
