-- 007_warehouse.sql (Prompt 4.1)
-- Implements Warehouse Nodes, Stock Tracking & FEFO Batch Management per docs/erd.md §3.

-- 1. Warehouse Nodes (Districts & Regional Depots)
CREATE TABLE IF NOT EXISTS warehouse_nodes (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name                TEXT NOT NULL,
  division            TEXT NOT NULL,
  district            TEXT NOT NULL,
  upazila             TEXT,
  address_line        TEXT NOT NULL,
  latitude            NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude           NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180),
  priority            INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_warehouse_nodes_supplier ON warehouse_nodes (supplier_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_nodes_district ON warehouse_nodes (district, is_active);
CREATE INDEX IF NOT EXISTS idx_warehouse_nodes_coords ON warehouse_nodes (latitude, longitude) WHERE is_active = true;

-- 2. Warehouse Stock (Per Node & Variant Inventory Allocation)
-- WHY no PRIMARY KEY here: see bundle_items in 006_catalog.sql — a PK column list may only name
-- plain columns, `COALESCE(variant_id, 0)` is an expression and only valid inside an index.
CREATE TABLE IF NOT EXISTS warehouse_stock (
  id                  BIGSERIAL PRIMARY KEY,
  warehouse_node_id   BIGINT NOT NULL REFERENCES warehouse_nodes(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,
  stock_qty           INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reserved_qty        INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  updated_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_stock ON warehouse_stock (warehouse_node_id, product_id, COALESCE(variant_id, 0));

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_product ON warehouse_stock (product_id, variant_id);

-- 3. Product Batches (FEFO Expiry Tracking & Recalls)
CREATE TABLE IF NOT EXISTS product_batches (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
  warehouse_node_id   BIGINT NOT NULL REFERENCES warehouse_nodes(id) ON DELETE RESTRICT,
  batch_number        TEXT NOT NULL,
  mfg_date            DATE,
  exp_date            DATE,
  qty                 INTEGER NOT NULL CHECK (qty >= 0),
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','EXPIRING_SOON','EXPIRED','RECALLED','DEPLETED')),
  recalled_at         TIMESTAMPTZ,
  recall_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  UNIQUE (product_id, batch_number, warehouse_node_id)
);

-- FEFO (First-Expired, First-Out) query optimization index
CREATE INDEX IF NOT EXISTS idx_product_batches_fefo ON product_batches (product_id, warehouse_node_id, exp_date)
  WHERE status = 'ACTIVE' AND qty > 0;
