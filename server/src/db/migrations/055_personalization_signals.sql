-- 055_personalization_signals.sql — Phase A of the personalized home feed: capture the signals.
--
-- 047_discovery_feed.sql built a genuine behavioral store, but only the /discover swipe feed ever
-- wrote to it, so a shopper who never opened /discover had an empty affinity profile and no feed
-- could personalize for them. Phase A widens capture to the whole site. Three things change here:
--
--   1. The event vocabulary grows. Clicking a search result, sharing a product and following a
--      store are intent signals the enum had no room for.
--   2. Search gets its own table. `product_interaction_events.product_id` is NOT NULL by design
--      (an event with no product tells the product ranking nothing), but "what did they type" is
--      exactly the signal a query→category affinity needs. search.service.js only ever kept a
--      500-entry in-memory array of ZERO-result queries, lost on every restart, keyed globally
--      rather than per actor — unusable as a ranking input.
--   3. The indexes the ranking will actually read. The existing set answers "this actor's recent
--      events"; a trending or best-seller rail asks "this CATEGORY's recent events" and "recent
--      events of this TYPE", neither of which had an index.
--
-- Guests stay on an opaque session_id, signed-in users on user_id, and `audience` keeps a
-- shopper's history separate from the same person's saler sourcing history — same contract as 047.

-- 1. A wider event vocabulary -------------------------------------------------------------------
-- A CHECK constraint cannot be extended in place, so it is dropped and re-added. The previous
-- values are all retained, so no existing row can fail the new constraint.
ALTER TABLE product_interaction_events
  DROP CONSTRAINT IF EXISTS product_interaction_events_event_type_check;

ALTER TABLE product_interaction_events
  ADD CONSTRAINT product_interaction_events_event_type_check
  CHECK (event_type IN (
    'VIEW',         -- the product card entered the viewport
    'DWELL',        -- time actually spent on the product, in dwell_ms
    'CLICK',        -- opened the product from a grid, rail or feed
    'SEARCH_CLICK', -- opened the product from a search result page: query intent, not browse
    'ADD_CART',
    'WISHLIST',
    'SHARE',        -- sent the product to WhatsApp/Messenger/clipboard
    'FOLLOW_STORE', -- followed the supplier's store from the product
    'PURCHASE'
  ));

-- 2. Search intent ------------------------------------------------------------------------------
-- One row per search a real actor performed. `query_normalized` is the lowercased, collapsed form
-- the ranking groups by; `query_raw` is kept verbatim because merchandising needs to read what
-- people actually typed (Banglish spellings included). `clicked_product_id` is filled in by the
-- SEARCH_CLICK that follows, so a query with no click is distinguishable from one that converted —
-- a zero-click query is the strongest "our catalog is missing this" signal there is.
CREATE TABLE IF NOT EXISTS search_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT,
  query_raw TEXT NOT NULL,
  query_normalized TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  clicked_product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  audience TEXT NOT NULL DEFAULT 'customer'
    CHECK (audience IN ('customer', 'saler')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Same rule as product_interaction_events: an event with neither actor is unattributable noise.
  CONSTRAINT chk_se_actor CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

-- "What has this actor searched for recently" — the per-shopper query affinity read.
CREATE INDEX IF NOT EXISTS idx_se_user_created ON search_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_se_session_created ON search_events (session_id, created_at DESC);
-- "What is everyone searching for" — trending searches and the zero-result report that replaces
-- search.service.js's in-memory array.
CREATE INDEX IF NOT EXISTS idx_se_query_created ON search_events (query_normalized, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_se_zero_result ON search_events (created_at DESC) WHERE result_count = 0;

-- 3. Indexes for the rails Phase B/C will read --------------------------------------------------
-- Trending ("this category's last 48 hours") and best-seller ("recent PURCHASE events") both scan
-- by a dimension plus recency, which the actor-keyed indexes from 047 cannot serve.
CREATE INDEX IF NOT EXISTS idx_pie_category_created ON product_interaction_events (category_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pie_supplier_created ON product_interaction_events (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pie_type_created ON product_interaction_events (event_type, created_at DESC);
-- "Recently viewed, not yet bought" needs this actor's events for one product, newest first.
CREATE INDEX IF NOT EXISTS idx_pie_product_created ON product_interaction_events (product_id, created_at DESC);

-- 4. The module that governs capture ------------------------------------------------------------
-- WHY a module of its own rather than reusing discovery_feed: that module answers "is the /discover
-- swipe feed available". Capture now happens on every product surface, so tying it to one page's
-- flag would mean switching off the swipe feed silently blinds the whole platform's personalization
-- — and leaving it on would mean a platform that has turned personalization off still records
-- behavior. The knobs below are the capture policy, which is configuration, not code.
INSERT INTO platform_modules (
  key, group_key, label_en, label_bn, description_en, description_bn,
  is_enabled, default_enabled, settings_json, settings_schema, depends_on
)
VALUES (
  'personalization_signals', 'growth',
  'Behavioural signal capture', 'ব্যবহারের সংকেত সংগ্রহ',
  'Records what shoppers view, tap, search, save and buy so feeds and rails can be personalized. Off means every surface ranks by popularity instead.',
  'ক্রেতারা কী দেখছে, ট্যাপ করছে, খুঁজছে, সেভ ও কিনছে তা সংরক্ষণ করে, যাতে ফিড ও তালিকা ব্যক্তিগতভাবে সাজানো যায়। বন্ধ থাকলে সব জায়গায় জনপ্রিয়তা অনুযায়ী সাজানো হবে।',
  true, true,
  '{"track_guests": true, "min_dwell_ms": 1200, "batch_size": 20, "flush_interval_ms": 4000, "retention_days": 180}'::jsonb,
  '{"type": "object", "properties": {
      "track_guests": { "type": "boolean", "default": true },
      "min_dwell_ms": { "type": "integer", "minimum": 200, "maximum": 30000, "default": 1200 },
      "batch_size": { "type": "integer", "minimum": 1, "maximum": 50, "default": 20 },
      "flush_interval_ms": { "type": "integer", "minimum": 500, "maximum": 60000, "default": 4000 },
      "retention_days": { "type": "integer", "minimum": 7, "maximum": 730, "default": 180 }
    } }'::jsonb,
  ARRAY[]::text[]
)
ON CONFLICT (key) DO NOTHING;
