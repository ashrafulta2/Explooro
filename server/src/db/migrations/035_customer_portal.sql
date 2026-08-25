-- 035_customer_portal.sql — Customer Portal, Store Follows & Price Drop Alerts (Prompt 11.3)

CREATE TABLE IF NOT EXISTS store_follows (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id BIGINT NOT NULL REFERENCES virtual_stores(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_store_follows_user ON store_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_store_follows_store ON store_follows(store_id);

CREATE TABLE IF NOT EXISTS price_drop_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  saved_price NUMERIC(12, 2) NOT NULL,
  dropped_price NUMERIC(12, 2) NOT NULL,
  drop_amount NUMERIC(12, 2) NOT NULL,
  notification_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_drop_alerts_user ON price_drop_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_drop_alerts_product ON price_drop_alerts(product_id);
