-- 069_delivery_charge_and_cod_gate.sql
--
-- 1. The delivery charge for a normal checkout becomes a setting.
--    checkout.service.js and cart.service.js charged a hard-coded ৳60 per supplier parcel, and the
--    client repeated the 60 in three places. A super admin now sets it at /admin/platform/delivery
--    (platform.delivery.update, CRITICAL). Team purchase keeps its own charge in the group_buying
--    module (068), because a team snapshots its price when it starts.
--
--    WHY NUMBER: platform_settings.value_type allows NUMBER/STRING/BOOLEAN/OBJECT only. The range
--    (0-5000) is enforced by services/deliveryCharge.service.js, like the genie and language rows.
--    ON CONFLICT DO NOTHING keeps a re-run from resetting a value an admin already chose.
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'delivery.per_parcel_charge',
  '60'::jsonb,
  'NUMBER',
  'Delivery charge per parcel (৳)',
  'প্রতি পার্সেলে ডেলিভারি চার্জ (৳)',
  'delivery',
  false
)
ON CONFLICT (key) DO NOTHING;

-- 2. Team-purchase COD members now pass the same trust / OTP gate as checkout. What the gate found
--    is kept on the member and copied onto the order when the team completes, as checkout records it
--    on orders.is_otp_verified / trust_score_at_order.
ALTER TABLE team_purchase_members
  ADD COLUMN IF NOT EXISTS is_otp_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trust_score_at_join INTEGER;
