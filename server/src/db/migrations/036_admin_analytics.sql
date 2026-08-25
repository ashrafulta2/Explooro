-- ============================================================================
-- Migration 036: Super Admin Executive Analytics, Summary Rollups & Backups
-- Prompt 11.4 / Master Spec §AL.4
-- ============================================================================

-- 1. Daily Analytics Rollup Table (Pre-computed night summary aggregates)
CREATE TABLE IF NOT EXISTS daily_analytics_rollups (
    id BIGSERIAL PRIMARY KEY,
    rollup_date DATE NOT NULL UNIQUE,
    gmv NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    platform_net_revenue NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    total_orders INT NOT NULL DEFAULT 0,
    delivered_orders INT NOT NULL DEFAULT 0,
    cancelled_orders INT NOT NULL DEFAULT 0,
    returned_orders INT NOT NULL DEFAULT 0,
    aov NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    take_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    active_sellers_count INT NOT NULL DEFAULT 0,
    new_customers_count INT NOT NULL DEFAULT 0,
    new_salers_count INT NOT NULL DEFAULT 0,
    new_suppliers_count INT NOT NULL DEFAULT 0,
    escrow_liability NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    pending_payout_liability NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    cod_exposure NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    dispute_count INT NOT NULL DEFAULT 0,
    dispute_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    conversion_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_rollups_date ON daily_analytics_rollups(rollup_date DESC);

-- 2. System Backup Snapshots Archive
CREATE TABLE IF NOT EXISTS system_backups (
    id BIGSERIAL PRIMARY KEY,
    ref VARCHAR(64) NOT NULL UNIQUE,
    snapshot_type VARCHAR(32) NOT NULL DEFAULT 'MANUAL', -- 'MANUAL' | 'SCHEDULED' | 'NIGHTLY'
    sha256_checksum VARCHAR(64) NOT NULL,
    table_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED', -- 'PENDING' | 'COMPLETED' | 'FAILED' | 'RESTORED'
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    restored_at TIMESTAMPTZ,
    restored_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_system_backups_created ON system_backups(created_at DESC);
