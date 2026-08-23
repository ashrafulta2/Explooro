-- 027_social_seller_kit.sql (Prompt 9.7: Social Seller Kit — Flyers, QR & Affiliate Links)
-- Implements idea proposition.md §P viral distribution toolkit schema: short_links, short_link_clicks, and social_seller_kit module.

-- 1. Short Links Table (Tracked Affiliate Redirection & Attribution)
CREATE TABLE IF NOT EXISTS short_links (
  id                  BIGSERIAL PRIMARY KEY,
  code                TEXT UNIQUE NOT NULL,                       -- e.g. 7F9X2A
  saler_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id          BIGINT REFERENCES products(id) ON DELETE CASCADE,
  store_id            BIGINT REFERENCES virtual_stores(id) ON DELETE CASCADE,
  target_url          TEXT NOT NULL,
  source_channel      TEXT NOT NULL DEFAULT 'GENERAL'
                      CHECK (source_channel IN ('GENERAL', 'WHATSAPP', 'FACEBOOK', 'PRINT_FLYER', 'QR_CODE', 'INSTAGRAM')),
  clicks_count        INTEGER NOT NULL DEFAULT 0 CHECK (clicks_count >= 0),
  conversions_count   INTEGER NOT NULL DEFAULT 0 CHECK (conversions_count >= 0),
  revenue_generated   NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (revenue_generated >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_short_links_code ON short_links (code);
CREATE INDEX IF NOT EXISTS idx_short_links_saler ON short_links (saler_id);
CREATE INDEX IF NOT EXISTS idx_short_links_product ON short_links (product_id);

-- 2. Short Link Clicks Audit Log
CREATE TABLE IF NOT EXISTS short_link_clicks (
  id                  BIGSERIAL PRIMARY KEY,
  short_link_id       BIGINT NOT NULL REFERENCES short_links(id) ON DELETE CASCADE,
  ip_hash             TEXT,
  user_agent          TEXT,
  referrer            TEXT,
  clicked_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_short_link_clicks_link ON short_link_clicks (short_link_id, clicked_at);

-- 3. Upsert Social Seller Kit Platform Module
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, default_enabled, settings_json, settings_schema, depends_on)
VALUES
  ('social_seller_kit', 'growth', 'Social Seller Kit & Flyers', 'সোশ্যাল সেলার কিট ও ফ্লায়ার',
   'Viral promotional poster builder, zero-dependency local QR code generator, and tracked affiliate short links.',
   'পোস্টার জেনারেটর, লোকাল কিউআর কোড এবং ট্র্যাকযোগ্য অ্যাফিলিয়েট শর্ট লিংক।',
   true, true,
   '{"base_shortlink_url": "https://explooro.com/s", "qr_code_size": 256, "allowed_templates": ["DARK", "MINIMAL", "GOLD"]}'::jsonb,
   '{"type": "object", "properties": { "base_shortlink_url": { "type": "string", "default": "https://explooro.com/s" }, "qr_code_size": { "type": "integer", "default": 256 } } }'::jsonb,
   ARRAY[]::text[])
ON CONFLICT (key) DO UPDATE SET
  group_key = EXCLUDED.group_key,
  label_en = EXCLUDED.label_en,
  label_bn = EXCLUDED.label_bn,
  description_en = EXCLUDED.description_en,
  description_bn = EXCLUDED.description_bn,
  default_enabled = EXCLUDED.default_enabled,
  settings_schema = EXCLUDED.settings_schema,
  depends_on = EXCLUDED.depends_on;
