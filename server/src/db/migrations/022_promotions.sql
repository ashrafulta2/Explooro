-- 022_promotions.sql (Prompt 9.2: Coupons, Vouchers & Flash Sale Campaigns)
-- Implements DFD Subsystem 17.0 schema: flash_sales, coupon enhancements, and growth modules.

-- 1. Flash Sales Table
CREATE TABLE IF NOT EXISTS flash_sales (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,                   -- FLS-8X2P9K1L
  title                 TEXT NOT NULL,
  product_id            BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id            BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,
  discount_price        NUMERIC(14,2) NOT NULL CHECK (discount_price > 0),
  original_price        NUMERIC(14,2) NOT NULL CHECK (original_price >= discount_price),
  allocated_qty         INTEGER NOT NULL CHECK (allocated_qty > 0),
  sold_qty              INTEGER NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
  reserved_qty          INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  per_user_limit        INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  starts_at             TIMESTAMPTZ NOT NULL,
  ends_at               TIMESTAMPTZ NOT NULL,
  status                TEXT NOT NULL DEFAULT 'SCHEDULED'
                        CHECK (status IN ('SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  emergency_stopped_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  emergency_stopped_at  TIMESTAMPTZ,
  created_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ,
  CONSTRAINT flash_sale_stock_cap CHECK (sold_qty + reserved_qty <= allocated_qty),
  CONSTRAINT flash_sale_time_window CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_flash_sales_status ON flash_sales (status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_flash_sales_product ON flash_sales (product_id, variant_id);

-- Ensure platform_modules has coupons and flash_sale modules registered
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, default_enabled, settings_json, settings_schema, depends_on)
VALUES
  ('coupons', 'growth', 'Coupons & vouchers', 'কুপন ও ভাউচার',
   'Discount codes scoped to the platform, a supplier, a saler, a category or a product.',
   'প্ল্যাটফর্ম, সরবরাহকারী, সেলার, ক্যাটেগরি বা পণ্যভিত্তিক ছাড়ের কোড।',
   true, true, '{"allow_stacking": false, "max_discount_pct": 50, "seller_coupons_need_review": false}'::jsonb,
   '{"type": "object", "properties": { "allow_stacking": { "type": "boolean", "default": false }, "max_discount_pct": { "type": "number", "default": 50 }, "seller_coupons_need_review": { "type": "boolean", "default": false } } }'::jsonb,
   ARRAY[]::text[]),

  ('flash_sale', 'growth', 'Flash sales', 'ফ্ল্যাশ সেল',
   'Time-boxed deals with reserved stock and a live countdown.',
   'নির্দিষ্ট সময়ের অফার, আলাদা রাখা স্টক ও লাইভ কাউন্টডাউনসহ।',
   true, true, '{"max_duration_hours": 24, "default_per_user_limit": 1}'::jsonb,
   '{"type": "object", "properties": { "max_duration_hours": { "type": "integer", "default": 24 }, "default_per_user_limit": { "type": "integer", "default": 1 } } }'::jsonb,
   ARRAY['coupons']::text[])
ON CONFLICT (key) DO UPDATE SET
  group_key = EXCLUDED.group_key,
  label_en = EXCLUDED.label_en,
  label_bn = EXCLUDED.label_bn,
  description_en = EXCLUDED.description_en,
  description_bn = EXCLUDED.description_bn,
  default_enabled = EXCLUDED.default_enabled,
  settings_schema = EXCLUDED.settings_schema,
  depends_on = EXCLUDED.depends_on;
