-- 006_catalog.sql (Prompt 4.1)
-- Implements Catalog & Storefront tables per docs/erd.md §3, §7, §8.

-- Enable ltree extension for category hierarchical materialized paths if available
CREATE EXTENSION IF NOT EXISTS ltree;

-- 1. Media Assets (central storage catalog)
CREATE TABLE IF NOT EXISTS media_assets (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  owner_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  purpose             TEXT NOT NULL
                      CHECK (purpose IN ('PRODUCT','AVATAR','BANNER','STORE_LOGO','REVIEW','UGC_VIDEO',
                                         'KYC','FLYER','STORY','ACADEMY','STREAM_RECORDING','OG_IMAGE')),
  storage_driver      TEXT NOT NULL DEFAULT 'LOCAL' CHECK (storage_driver IN ('LOCAL','R2')),
  storage_key         TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          BIGINT NOT NULL CHECK (size_bytes > 0),
  width               INTEGER CHECK (width > 0),
  height              INTEGER CHECK (height > 0),
  duration_seconds    INTEGER CHECK (duration_seconds >= 0),
  derivatives_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  poster_media_id     BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  quality_score       INTEGER CHECK (quality_score BETWEEN 0 AND 100),
  quality_flags_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  moderation_status   TEXT NOT NULL DEFAULT 'APPROVED'
                      CHECK (moderation_status IN ('PENDING','APPROVED','REJECTED')),
  checksum_sha256     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

-- 2. Categories (Nested Set / Materialized Path)
CREATE TABLE IF NOT EXISTS categories (
  id                  BIGSERIAL PRIMARY KEY,
  parent_id           BIGINT REFERENCES categories(id) ON DELETE RESTRICT,
  slug                TEXT UNIQUE NOT NULL,
  path                TEXT NOT NULL,                     -- e.g. 'fashion.mens.shirts' (LTREE compatible)
  name_en             TEXT NOT NULL,
  name_bn             TEXT NOT NULL,
  icon_key            TEXT,
  display_order       INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  requires_fefo       BOOLEAN NOT NULL DEFAULT false,    -- FMCG / Cosmetics
  requires_age_check  BOOLEAN NOT NULL DEFAULT false,
  auto_approve        BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_path ON categories (path);

-- 3. Products
CREATE TABLE IF NOT EXISTS products (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,
  supplier_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id           BIGINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  slug                  TEXT UNIQUE NOT NULL,
  title_en              TEXT NOT NULL,
  title_bn              TEXT NOT NULL,
  description_en        TEXT,
  description_bn        TEXT,
  brand                 TEXT,
  base_cost             NUMERIC(14,2) NOT NULL CHECK (base_cost >= 0),
  wholesale_margin      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (wholesale_margin >= 0),
  default_retail_price  NUMERIC(14,2) NOT NULL CHECK (default_retail_price >= 0),
  min_retail_price      NUMERIC(14,2),
  stock_qty             INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_threshold   INTEGER NOT NULL DEFAULT 5,
  weight_grams          INTEGER CHECK (weight_grams > 0),
  has_variants          BOOLEAN NOT NULL DEFAULT false,
  warranty_months       INTEGER CHECK (warranty_months >= 0),
  status                TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','REJECTED','PAUSED','ARCHIVED')),
  search_vector         TSVECTOR,
  rating_avg            NUMERIC(3,2) CHECK (rating_avg BETWEEN 0 AND 5),
  rating_count          INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  sold_count            INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT retail_covers_cost
    CHECK (default_retail_price >= base_cost + wholesale_margin)
);

CREATE INDEX IF NOT EXISTS idx_products_supplier ON products (supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_active_created ON products (status, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_search ON products USING GIN (search_vector);

-- 4. Product Variants
CREATE TABLE IF NOT EXISTS product_variants (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku                 TEXT UNIQUE NOT NULL,
  attributes_json     JSONB NOT NULL,                    -- {"size":"L","color":"Navy Blue"}
  price_delta         NUMERIC(14,2) NOT NULL DEFAULT 0,
  stock_qty           INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  image_id            BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);

-- 5. Product Images
CREATE TABLE IF NOT EXISTS product_images (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id            BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  display_order       INTEGER NOT NULL DEFAULT 0,
  is_primary          BOOLEAN NOT NULL DEFAULT false,
  quality_score       INTEGER CHECK (quality_score BETWEEN 0 AND 100),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id, display_order);

-- 6. Virtual Stores
CREATE TABLE IF NOT EXISTS virtual_stores (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  saler_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slug                TEXT NOT NULL,
  shop_name           TEXT NOT NULL,
  bio                 TEXT,
  logo_media_id       BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  banner_media_id     BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  announcement        TEXT,
  social_links_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  has_physical_shop   BOOLEAN NOT NULL DEFAULT false,
  physical_open_status TEXT NOT NULL DEFAULT 'CLOSED'
                      CHECK (physical_open_status IN ('OPEN','CLOSED','AUTO')),
  business_hours_json JSONB,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_slug ON virtual_stores (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stores_saler ON virtual_stores (saler_id);

-- 7. Saler Store Items (Items curated by a Saler into their virtual store)
CREATE TABLE IF NOT EXISTS saler_store_items (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            BIGINT NOT NULL REFERENCES virtual_stores(id) ON DELETE CASCADE,
  saler_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  custom_retail_price NUMERIC(14,2) CHECK (custom_retail_price >= 0),
  collection_name     TEXT,
  display_order       INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_saler_items_store ON saler_store_items (store_id, is_active);

-- 8. Product Approvals
CREATE TABLE IF NOT EXISTS product_approvals (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  submitted_by        BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','ESCALATED')),
  auto_flags_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
  claimed_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  claimed_at          TIMESTAMPTZ,
  decided_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  reason              TEXT,
  reason_bn           TEXT,
  sla_due_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_approvals_status ON product_approvals (status, sla_due_at);

-- 9. Product Bundles
CREATE TABLE IF NOT EXISTS product_bundles (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
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

-- WHY no PRIMARY KEY here: a PK column list may only name plain columns, not expressions —
-- `PRIMARY KEY (bundle_id, product_id, COALESCE(variant_id, 0))` is invalid SQL (caught while
-- verifying Prompt 4.6's migrations against an actual Postgres wire-protocol connection). The
-- COALESCE is needed because variant_id is nullable and NULL <> NULL for uniqueness purposes;
-- expressions are allowed in an index, just not a table constraint's column list.
CREATE TABLE IF NOT EXISTS bundle_items (
  id                  BIGSERIAL PRIMARY KEY,
  bundle_id           BIGINT NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  discount_share      NUMERIC(14,2) NOT NULL CHECK (discount_share >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bundle_items ON bundle_items (bundle_id, product_id, COALESCE(variant_id, 0));

-- 10. Reviews & Review Media
CREATE TABLE IF NOT EXISTS reviews (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  order_item_id       BIGINT,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rating              INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title               TEXT,
  body                TEXT,
  is_verified_purchase BOOLEAN NOT NULL DEFAULT true,
  helpful_count       INTEGER NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
  integrity_score     INTEGER CHECK (integrity_score BETWEEN 0 AND 100),
  status              TEXT NOT NULL DEFAULT 'PUBLISHED'
                      CHECK (status IN ('PENDING','PUBLISHED','FLAGGED','REMOVED')),
  coins_awarded       INTEGER NOT NULL DEFAULT 0 CHECK (coins_awarded >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews (product_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS review_media (
  id                  BIGSERIAL PRIMARY KEY,
  review_id           BIGINT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  media_id            BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  media_kind          TEXT NOT NULL CHECK (media_kind IN ('IMAGE','VIDEO')),
  moderation_status   TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (moderation_status IN ('PENDING','APPROVED','REJECTED')),
  display_order       INTEGER NOT NULL DEFAULT 0
);
