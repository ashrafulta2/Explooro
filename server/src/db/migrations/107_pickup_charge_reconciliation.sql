-- 107_pickup_charge_reconciliation.sql
--
-- A courier pickup's charge (migration 106) is collected from the supplier or the customer into
-- the treasury, while the courier bills the business for the real price. These columns let staff
-- see both side by side at /admin/platform/operations and spot a pickup charge that no longer
-- covers what couriers bill (reversePickup.service.ts getPickupCharges):
--   courier_charge   what the courier quoted when the pickup was booked (its API's own price);
--   fee_charged      what the refund collected for it (returnShipping.service.ts), and from whom;
--   courier_billed   what the courier's bill finally said, typed by staff when it arrives.
-- WHY typed by hand: no courier sends invoices through its API yet; the quoted price is the best
-- guess until a bill is recorded. Paying the courier stays outside the ledger, as the owner pays
-- it from the company's bank account.
ALTER TABLE reverse_pickups ADD COLUMN IF NOT EXISTS courier_charge NUMERIC(14,2) CHECK (courier_charge >= 0);
ALTER TABLE reverse_pickups ADD COLUMN IF NOT EXISTS fee_charged NUMERIC(14,2) CHECK (fee_charged >= 0);
ALTER TABLE reverse_pickups ADD COLUMN IF NOT EXISTS fee_charged_from TEXT CHECK (fee_charged_from IN ('SUPPLIER', 'CUSTOMER'));
ALTER TABLE reverse_pickups ADD COLUMN IF NOT EXISTS courier_billed NUMERIC(14,2) CHECK (courier_billed >= 0);
ALTER TABLE reverse_pickups ADD COLUMN IF NOT EXISTS billed_recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reverse_pickups ADD COLUMN IF NOT EXISTS billed_recorded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reverse_pickups_created ON reverse_pickups (created_at DESC);

-- A supplier-paid return shipping charge that takes a supplier's vault below zero is recorded as
-- a recovery, like a clawback the supplier cannot cover (returnShipping.service.ts). The daily
-- settleDeficitRecoveries job marks it recovered as their next earnings bring the vault back up.
-- WHY a link to the return: the reason text names it, but staff look recoveries up by return.
ALTER TABLE negative_balance_recoveries ADD COLUMN IF NOT EXISTS return_request_id BIGINT REFERENCES return_requests(id) ON DELETE SET NULL;
