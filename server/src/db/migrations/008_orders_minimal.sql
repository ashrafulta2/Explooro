-- 008_orders_minimal.sql (Prompt 4.6)
-- Pulls forward orders/sub_orders/order_items from Prompt 5.2 (Checkout) — verbatim per
-- docs/erd.md §6, no columns added or renamed — because Prompt 4.6's review eligibility gate
-- ("a user who has not purchased cannot submit a review") requires a real DELIVERED order_item to
-- check against. Phase 5.2 adds checkout business logic (row-lock, split payment, idempotency) on
-- top of these same tables; the schema itself does not change. coupon_id/team_purchase_id stay
-- plain nullable columns with no FK yet, exactly as erd.md itself annotates ("FK added after
-- coupons/team purchases exist").

CREATE TABLE IF NOT EXISTS orders (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  customer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  total_amount        NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  items_amount        NUMERIC(14,2) NOT NULL CHECK (items_amount >= 0),
  shipping_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  coins_redeemed      INTEGER NOT NULL DEFAULT 0 CHECK (coins_redeemed >= 0),
  coins_discount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (coins_discount >= 0),
  currency            TEXT NOT NULL DEFAULT 'BDT',
  payment_method      TEXT NOT NULL CHECK (payment_method IN ('BKASH','NAGAD','ROCKET','CARD','COD')),
  payment_status      TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (payment_status IN ('PENDING','PAID','FAILED','PARTIALLY_REFUNDED','REFUNDED')),
  is_otp_verified     BOOLEAN NOT NULL DEFAULT false,
  trust_score_at_order INTEGER,
  coupon_id           BIGINT,
  team_purchase_id    BIGINT,
  idempotency_key     TEXT UNIQUE,
  recipient_name      TEXT NOT NULL,
  recipient_phone     TEXT NOT NULL,
  division            TEXT NOT NULL,
  district            TEXT NOT NULL,
  upazila             TEXT,
  address_line        TEXT NOT NULL,
  placed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  CONSTRAINT total_is_consistent
    CHECK (total_amount = items_amount + shipping_amount - discount_amount - coins_discount)
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id, placed_at);

CREATE TABLE IF NOT EXISTS sub_orders (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  order_id            BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  saler_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  warehouse_node_id   BIGINT REFERENCES warehouse_nodes(id) ON DELETE SET NULL,
  subtotal_base       NUMERIC(14,2) NOT NULL CHECK (subtotal_base >= 0),
  wholesale_margin    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (wholesale_margin >= 0),
  net_retail_margin   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (net_retail_margin >= 0),
  saler_commission    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (saler_commission >= 0),
  platform_margin     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (platform_margin >= 0),
  shipping_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  discount_share      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_share >= 0),
  total_amount        NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  status              TEXT NOT NULL DEFAULT 'PLACED'
                      CHECK (status IN ('PLACED','CONFIRMED','PACKED','SHIPPED','IN_TRANSIT',
                                        'DELIVERED','CANCELLED','RETURNED','REFUNDED')),
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  CONSTRAINT margin_splits_reconcile
    CHECK (saler_commission + platform_margin = net_retail_margin)
);

CREATE INDEX IF NOT EXISTS idx_sub_orders_order ON sub_orders (order_id);
CREATE INDEX IF NOT EXISTS idx_sub_orders_status ON sub_orders (status, delivered_at);

CREATE TABLE IF NOT EXISTS order_items (
  id                  BIGSERIAL PRIMARY KEY,
  sub_order_id        BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
  batch_id            BIGINT REFERENCES product_batches(id) ON DELETE RESTRICT,
  bundle_id           BIGINT REFERENCES product_bundles(id) ON DELETE SET NULL,
  title_snapshot      TEXT NOT NULL,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  base_price          NUMERIC(14,2) NOT NULL CHECK (base_price >= 0),
  retail_price        NUMERIC(14,2) NOT NULL CHECK (retail_price >= 0),
  line_total          NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_sub_order ON order_items (sub_order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);

-- Tighten 006_catalog.sql's `reviews` table to erd.md §7's canonical shape now that order_items
-- exists — 4.1 deliberately left order_item_id nullable/unconstrained because this table didn't
-- exist yet. The table has taken no writes yet (Prompt 4.6 is the first feature to use it), so
-- these ALTERs are safe.
ALTER TABLE reviews ALTER COLUMN order_item_id SET NOT NULL;

ALTER TABLE reviews
  ADD CONSTRAINT fk_reviews_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT;

ALTER TABLE reviews
  ADD CONSTRAINT uq_reviews_order_item_user UNIQUE (order_item_id, user_id);
