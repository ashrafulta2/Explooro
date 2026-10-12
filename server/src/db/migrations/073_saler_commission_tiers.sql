-- 073_saler_commission_tiers.sql (tiered commission: a saler's split rises with what they sell)
--
-- finance.tier_bonuses (053) already says what each tier pays (BRONZE 0, SILVER 1, GOLD 2, PLATINUM 5
-- extra saler split points) and the Finance splits screen edits it - but nothing ever put a saler in
-- a tier, so those points were only ever shown in the simulator. This adds the missing half:
--
--   * `saler.commission_tiers` - the switch, the rolling window and the volume each tier asks for;
--   * `saler_commission_tiers` - the tier each saler holds, written daily by the `saler_tier` job and
--     read (one row, by primary key) when checkout prices an order.
--
-- The feature ships OFF. Turning it on moves platform margin to salers, which is a business decision.

CREATE TABLE IF NOT EXISTS saler_commission_tiers (
  saler_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier         TEXT NOT NULL DEFAULT 'BRONZE' CHECK (tier IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM')),
  volume       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (volume >= 0),  -- delivered sales inside the window
  window_days  INTEGER NOT NULL,                                       -- the window `volume` was summed over
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saler_commission_tiers_tier ON saler_commission_tiers (tier);

-- Business numbers live in platform_settings, never in code. One OBJECT row.
--   enabled       master switch; off = every saler is priced exactly as before
--   window_days   rolling window the volume is summed over (7..365)
--   thresholds    delivered volume (BDT, goods only, shipping excluded) each tier asks for; must rise
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'saler.commission_tiers',
  '{
    "enabled": false,
    "window_days": 30,
    "thresholds": { "SILVER": 50000, "GOLD": 150000, "PLATINUM": 400000 }
  }'::jsonb,
  'OBJECT',
  'Saler commission tiers',
  'সেলার কমিশন টিয়ার',
  'finance',
  false
)
ON CONFLICT (key) DO NOTHING;
