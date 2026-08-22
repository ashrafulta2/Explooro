-- 010_commerce.sql (Prompt 5.1)
-- Persists carts, cart items, wishlists, and abandoned carts server-side (docs/erd.md §4 & §10).

CREATE TABLE IF NOT EXISTS carts (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT REFERENCES users(id) ON DELETE CASCADE,
  guest_token         TEXT UNIQUE,
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','ABANDONED','CONVERTED','MERGED')),
  last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_order_id  BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  CONSTRAINT cart_has_owner CHECK (user_id IS NOT NULL OR guest_token IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_carts_user ON carts (user_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_carts_guest ON carts (guest_token) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_carts_activity ON carts (status, last_activity_at);

CREATE TABLE IF NOT EXISTS cart_items (
  id                  BIGSERIAL PRIMARY KEY,
  cart_id             BIGINT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,
  saler_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  bundle_id           BIGINT REFERENCES product_bundles(id) ON DELETE SET NULL,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  price_at_add        NUMERIC(14,2) NOT NULL CHECK (price_at_add >= 0),
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items (cart_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_item_variant
  ON cart_items (cart_id, product_id, COALESCE(variant_id, 0), COALESCE(bundle_id, 0));

CREATE TABLE IF NOT EXISTS wishlists (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_at_save       NUMERIC(14,2) NOT NULL CHECK (price_at_save >= 0),
  notify_on_drop      BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlists_user ON wishlists (user_id);

CREATE TABLE IF NOT EXISTS abandoned_carts (
  id                  BIGSERIAL PRIMARY KEY,
  cart_id             BIGINT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  user_id             BIGINT REFERENCES users(id) ON DELETE CASCADE,
  items_value         NUMERIC(14,2) NOT NULL CHECK (items_value >= 0),
  sequence_step       INTEGER NOT NULL DEFAULT 0 CHECK (sequence_step BETWEEN 0 AND 3),
  last_nudge_at       TIMESTAMPTZ,
  recovery_token      TEXT UNIQUE,
  incentive_coupon_id BIGINT,
  recovered_at        TIMESTAMPTZ,
  recovered_order_id  BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  recovered_value     NUMERIC(14,2),
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id)
);

CREATE INDEX IF NOT EXISTS idx_abandoned_carts_user ON abandoned_carts (user_id);
