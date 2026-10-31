-- 097_manual_operations.sql
--
-- Manual operations for the launch (owner decision 2026-10-31). At launch no MFS merchant, card
-- gateway or courier API will sign with a new platform, so the owner runs money and parcels by hand:
--   * a withdrawal is sent from the owner's own bKash/Nagad, and the admin records the TrxID;
--   * a parcel is handed to a courier the owner has a contract with, and the supplier records the
--     courier's name and tracking number, then marks it delivered or returned.
-- Everything else (escrow, profit split, ledger, audit) runs exactly as for the automatic path.
--
-- 1. The two switches. A super admin flips them at /admin/platform/operations
--    (platform.operations.update, CRITICAL). MANUAL is the default because it is the only safe
--    answer before a gateway is live: in GATEWAY mode, approving a payout calls the B2C driver, and
--    the mock driver reports success with a made-up TrxID, so a payout would read as paid when no
--    money had moved. ON CONFLICT DO NOTHING keeps a re-run from resetting a chosen value.
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'operations.modes',
  '{"payout_mode": "MANUAL", "courier_mode": "MANUAL"}'::jsonb,
  'OBJECT',
  'Payout and courier mode (manual or automatic)',
  'পেআউট ও কুরিয়ার মোড (ম্যানুয়াল বা স্বয়ংক্রিয়)',
  'operations',
  false
)
ON CONFLICT (key) DO NOTHING;

-- 2. A parcel the supplier handed to a courier by hand. carrier = 'MANUAL' marks it (so the
--    webhook path never touches it and only the manual status endpoint moves it), and courier_name
--    keeps whatever courier the owner actually used, since that is free text, not one of our
--    integrations. The CHECK is recreated by name; both 011 and 014 declared it inline, so
--    Postgres named it shipments_carrier_check.
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_carrier_check;
ALTER TABLE shipments ADD CONSTRAINT shipments_carrier_check
  CHECK (carrier IN ('STEADFAST','PATHAO','REDX','MOCK','OTHER','MANUAL'));
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS courier_name TEXT;
