-- 028_live.sql (Prompt 10.1: Live Stream Commerce Engine)
-- Implements DFD Subsystem 15.0: live_streams, live_stream_products, live_stream_messages,
-- order stream attribution, and platform module registration.

-- 1. Live Streams Table
CREATE TABLE IF NOT EXISTS live_streams (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,
  host_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id              BIGINT REFERENCES virtual_stores(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  cover_image           TEXT,
  status                TEXT NOT NULL DEFAULT 'SCHEDULED'
                        CHECK (status IN ('SCHEDULED', 'LIVE', 'ENDED', 'TERMINATED')),
  scheduled_for         TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  viewer_count          INTEGER NOT NULL DEFAULT 0 CHECK (viewer_count >= 0),
  peak_viewer_count     INTEGER NOT NULL DEFAULT 0 CHECK (peak_viewer_count >= 0),
  total_likes_count     INTEGER NOT NULL DEFAULT 0 CHECK (total_likes_count >= 0),
  total_sales_count     INTEGER NOT NULL DEFAULT 0 CHECK (total_sales_count >= 0),
  total_sales_amount    NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (total_sales_amount >= 0),
  room_id               TEXT UNIQUE NOT NULL,
  recording_url         TEXT,
  playback_url          TEXT,
  settings_json         JSONB NOT NULL DEFAULT '{"chat_enabled": true, "audio_only_allowed": true, "moderation_strictness": "STANDARD"}'::jsonb,
  terminated_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  termination_reason    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_live_streams_host ON live_streams (host_id, status);
CREATE INDEX IF NOT EXISTS idx_live_streams_status ON live_streams (status, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_live_streams_room ON live_streams (room_id);

-- 2. Live Stream Featured / Pinned Products
CREATE TABLE IF NOT EXISTS live_stream_products (
  id                    BIGSERIAL PRIMARY KEY,
  live_stream_id        BIGINT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  product_id            BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  is_pinned             BOOLEAN NOT NULL DEFAULT false,
  pinned_at             TIMESTAMPTZ,
  pin_order             INTEGER NOT NULL DEFAULT 0,
  special_price         NUMERIC(14,2) CHECK (special_price IS NULL OR special_price >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_live_stream_product UNIQUE (live_stream_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_live_stream_products_stream ON live_stream_products (live_stream_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_live_stream_products_product ON live_stream_products (product_id);

-- 3. Live Stream Real-time Chat & System Message Log
CREATE TABLE IF NOT EXISTS live_stream_messages (
  id                    BIGSERIAL PRIMARY KEY,
  live_stream_id        BIGINT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id               BIGINT REFERENCES users(id) ON DELETE SET NULL,
  message_type          TEXT NOT NULL DEFAULT 'CHAT'
                        CHECK (message_type IN ('CHAT', 'PIN_PRODUCT', 'BUY', 'REACTION', 'SYSTEM', 'MODERATION')),
  content               TEXT NOT NULL,
  metadata_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_stream_messages_stream ON live_stream_messages (live_stream_id, created_at);
CREATE INDEX IF NOT EXISTS idx_live_stream_messages_user ON live_stream_messages (user_id);

-- 4. Order Live Stream Attribution (Prompt 10.1 Acceptance: A purchase made during a stream is attributed to that stream)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'live_stream_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN live_stream_id BIGINT REFERENCES live_streams(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_live_stream ON orders (live_stream_id);

-- 5. Upsert Interactive Live Stream Commerce Platform Module
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, default_enabled, settings_json, settings_schema, depends_on)
VALUES
  ('live_commerce', 'growth', 'Interactive Live Stream Commerce', 'ইন্টারেক্টিভ লাইভ স্ট্রিম কমার্স',
   'WebRTC live video selling studio with dynamic product pinning, 1-click in-stream checkout, and low-bandwidth audio fallback.',
   'পিন করা প্রোডাক্ট, ১-ক্লিকে ইন-স্ট্রিম চেকআউট এবং অডিও ফলব্যাকসহ লাইভ ভিডিও শপিং স্টুডিও।',
   true, true,
   '{"driver": "mock", "max_bitrate_kbps": 1500, "audio_only_bitrate_kbps": 64, "max_pinned_products": 20, "auto_archive": true}'::jsonb,
   '{"type": "object", "properties": { "driver": { "type": "string", "enum": ["mock", "livekit"], "default": "mock" }, "max_bitrate_kbps": { "type": "integer", "default": 1500 }, "auto_archive": { "type": "boolean", "default": true } } }'::jsonb,
   ARRAY['core']::text[])
ON CONFLICT (key) DO UPDATE SET
  group_key = EXCLUDED.group_key,
  label_en = EXCLUDED.label_en,
  label_bn = EXCLUDED.label_bn,
  description_en = EXCLUDED.description_en,
  description_bn = EXCLUDED.description_bn,
  default_enabled = EXCLUDED.default_enabled,
  settings_schema = EXCLUDED.settings_schema,
  depends_on = EXCLUDED.depends_on;
