-- 031_bundles.sql (Prompt 10.5)
-- Implements Cross-Seller Dynamic Product Bundling (§AC) & Demand Surge Pricing (§AF) per docs/erd.md & prompt.md 10.5.

-- 1. Ensure product_bundles table
CREATE TABLE IF NOT EXISTS product_bundles (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,                  -- BND-9K2P9Q1X
  saler_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_en            TEXT NOT NULL,
  title_bn            TEXT NOT NULL,
  bundle_price        NUMERIC(14,2) NOT NULL CHECK (bundle_price >= 0),
  sum_of_parts        NUMERIC(14,2) NOT NULL CHECK (sum_of_parts >= 0),
  discount_amount     NUMERIC(14,2) NOT NULL CHECK (discount_amount >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_product_bundles_saler ON product_bundles (saler_id, is_active);
CREATE INDEX IF NOT EXISTS idx_product_bundles_ref ON product_bundles (ref);

-- 2. Ensure bundle_items table with discount apportionment
CREATE TABLE IF NOT EXISTS bundle_items (
  id                  BIGSERIAL PRIMARY KEY,
  bundle_id           BIGINT NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  discount_share      NUMERIC(14,2) NOT NULL CHECK (discount_share >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bundle_items ON bundle_items (bundle_id, product_id, COALESCE(variant_id, 0));
CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON bundle_items (bundle_id);
CREATE INDEX IF NOT EXISTS idx_bundle_items_product ON bundle_items (product_id);

-- 3. Dynamic Demand Surge Recommendations (Advisory Only per Prompt 10.5 / §AF)
CREATE TABLE IF NOT EXISTS surge_pricing_recommendations (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,                  -- SRG-8M3N5P2Q
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_price       NUMERIC(14,2) NOT NULL CHECK (current_price > 0),
  recommended_price   NUMERIC(14,2) NOT NULL CHECK (recommended_price >= current_price),
  surge_pct           NUMERIC(5,2) NOT NULL CHECK (surge_pct >= 0 AND surge_pct <= 100),
  velocity_score      NUMERIC(10,2) NOT NULL DEFAULT 0,
  depletion_rate_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  search_volume_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  reason_en           TEXT NOT NULL,
  reason_bn           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'ACCEPTED', 'DISMISSED', 'EXPIRED')),
  expires_at          TIMESTAMPTZ NOT NULL,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_surge_rec_supplier ON surge_pricing_recommendations (supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_surge_rec_product ON surge_pricing_recommendations (product_id, status);
CREATE INDEX IF NOT EXISTS idx_surge_rec_expires ON surge_pricing_recommendations (status, expires_at);

-- 4. Register platform modules
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, default_enabled)
VALUES
  ('product_bundling', 'commerce', 'Cross-Seller Bundling Engine', 'ক্রস-সেলার বান্ডেল ইঞ্জিন', 'Multi-supplier combo builder with deterministic discount apportionment', 'মাল্টি-সাপ্লায়ার কম্বো নির্মাতা ও লাভ বণ্টন ইঞ্জিন', true, true),
  ('demand_surge', 'commerce', 'Dynamic Demand Surge & Yield Optimization', 'ডায়নামিক ডিমান্ড সার্জ এবং অপ্টিমাইজেশন', 'Real-time velocity spike detection and advisory price recommendations', 'রিয়েল-টাইম চাহিদা বৃদ্ধি শনাক্তকরণ ও মূল্য সমন্বয় পরামর্শ', true, true)
ON CONFLICT (key) DO NOTHING;

-- 5. Seed default platform settings for surge pricing and bundling
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key)
VALUES
  ('surge_pricing.config',
   '{"max_increase_pct": 15.0, "min_order_velocity_24h": 5, "min_depletion_velocity": 0.25, "recommendation_ttl_hours": 48}'::jsonb,
   'OBJECT',
   'Surge Pricing Thresholds',
   'সার্জ প্রাইসিং সীমা',
   'finance')
ON CONFLICT (key) DO NOTHING;
