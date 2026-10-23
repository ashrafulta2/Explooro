-- 085_partner_reward_pool.sql
--
-- Shop partners become advertisers, not shopkeepers (Phase A of the partner reward pool).
--
--   * The supplier sets the price AND the partner's profit per product (products.partner_profit, a
--     per-unit BDT amount). A shop partner can no longer change a price, so saler_store_items stops
--     holding one: every existing custom price is cleared and a CHECK keeps it NULL from now on. Every
--     reader already does COALESCE(custom_retail_price, default_retail_price), so they all fall back
--     to the supplier's price without further changes.
--   * A sale a partner brought no longer pays that partner. Its partner share is escrowed to the
--     PARTNER_REWARD_POOL system wallet (vault.service.ts), and the monthly reward job (Phase B)
--     shares that wallet out by score. Escrow, release and clawback treat the pool's entry like any
--     other, so a refund or return takes the share back out of the pool, never out of a partner.
--
-- Safe to re-run.

ALTER TABLE products ADD COLUMN IF NOT EXISTS partner_profit NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Backfill: what the partner earned per unit under the old global split, so prices and the
-- partner/platform balance of every existing product stay where they were. Only rows still at 0
-- are touched, so a re-run never overwrites a supplier's own figure.
UPDATE products p
SET partner_profit = round(
      (p.default_retail_price - p.base_cost - p.wholesale_margin)
      * COALESCE((SELECT (value_json->>'saler_split_pct')::numeric
                  FROM platform_settings WHERE key = 'commission.default_splits'), 40) / 100,
      2)
WHERE p.partner_profit = 0
  AND p.default_retail_price > p.base_cost + p.wholesale_margin;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_profit_within_margin') THEN
    ALTER TABLE products ADD CONSTRAINT partner_profit_within_margin
      CHECK (partner_profit >= 0 AND partner_profit <= default_retail_price - base_cost - wholesale_margin);
  END IF;
END $$;

UPDATE saler_store_items SET custom_retail_price = NULL WHERE custom_retail_price IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_price_locked') THEN
    ALTER TABLE saler_store_items ADD CONSTRAINT store_price_locked CHECK (custom_retail_price IS NULL);
  END IF;
END $$;

INSERT INTO wallets (user_id, system_key, available_balance, pending_escrow_balance, held_balance,
                     lifetime_earned, lifetime_withdrawn, currency, version)
VALUES (NULL, 'PARTNER_REWARD_POOL', 0.00, 0.00, 0.00, 0.00, 0.00, 'BDT', 0)
ON CONFLICT (system_key) DO NOTHING;
