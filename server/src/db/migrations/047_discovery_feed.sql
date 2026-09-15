-- 047_discovery_feed.sql — Discovery feed behavioral tracking (interest-based product feed).
--
-- Backs the /discover surface: a full-screen, one-product-at-a-time swipe feed whose ordering is
-- personalized from the signals recorded here. Every meaningful interaction (a slide viewed, dwelt
-- on, tapped through, added to cart/wishlist, or purchased) is logged as one row; the feed ranking
-- (server/src/services/discoveryFeed.service.js) reads a recent, decayed aggregate of these to
-- boost the categories / brands / suppliers a shopper actually engages with.
--
-- Guests are tracked by an opaque session_id (no user_id); signed-in users by user_id. The
-- `audience` column keeps the customer feed's affinity separate from the saler sourcing feed's,
-- since the same person browsing as a shopper vs. sourcing for their store has different intent.

CREATE TABLE IF NOT EXISTS product_interaction_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('VIEW', 'DWELL', 'CLICK', 'ADD_CART', 'WISHLIST', 'PURCHASE')),
  dwell_ms INTEGER NOT NULL DEFAULT 0,
  weight NUMERIC(6, 2) NOT NULL DEFAULT 1.0,
  audience TEXT NOT NULL DEFAULT 'customer'
    CHECK (audience IN ('customer', 'saler')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- An event with neither actor is unattributable noise the ranking can never use.
  CONSTRAINT chk_pie_actor CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

-- The ranking reads "this actor's recent events", so both actor columns are indexed by recency.
CREATE INDEX IF NOT EXISTS idx_pie_user_created ON product_interaction_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pie_session_created ON product_interaction_events (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pie_product ON product_interaction_events (product_id);
CREATE INDEX IF NOT EXISTS idx_pie_category ON product_interaction_events (category_id);
