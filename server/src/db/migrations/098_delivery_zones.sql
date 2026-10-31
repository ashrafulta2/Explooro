-- 098_delivery_zones.sql
--
-- The normal-checkout delivery charge becomes a charge PER ZONE.
--
-- One number (delivery.per_parcel_charge, migration 069) could not price Bangladesh: couriers charge
-- one rate inside Dhaka and a higher one outside it. delivery.zones holds a list of zones, each with a
-- name, a per-parcel charge and the districts it covers (the district ids the checkout address form
-- sends), plus the default zone that charges every district no zone lists. The super admin edits it at
-- /admin/platform/delivery; services/deliveryCharge.service.ts validates it and is the one resolver.
--
-- WHY both zones get the old number: nobody's price changes on deploy. Raising "Outside Dhaka" is the
-- super admin's decision, made on the page, with a reason and an audit row.
-- WHY ON CONFLICT DO NOTHING: a re-run must not reset zones an admin already set.
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
SELECT
  'delivery.zones',
  jsonb_build_object(
    'default_zone', 'outside_dhaka',
    'zones', jsonb_build_array(
      jsonb_build_object('key', 'inside_dhaka', 'name_en', 'Inside Dhaka', 'name_bn', 'ঢাকার ভিতরে',
                         'charge', charge, 'districts', jsonb_build_array('dhaka_city')),
      jsonb_build_object('key', 'outside_dhaka', 'name_en', 'Outside Dhaka', 'name_bn', 'ঢাকার বাইরে',
                         'charge', charge, 'districts', '[]'::jsonb)
    )
  ),
  'OBJECT',
  'Delivery charge zones',
  'ডেলিভারি চার্জের এলাকা',
  'delivery',
  false
FROM (
  SELECT COALESCE(
    (SELECT CASE WHEN jsonb_typeof(value_json) = 'number' THEN value_json END
       FROM platform_settings WHERE key = 'delivery.per_parcel_charge'),
    '60'::jsonb
  ) AS charge
) legacy
ON CONFLICT (key) DO NOTHING;

-- The single number is now inside the zones; a second row would only invite someone to edit the one
-- nothing reads.
DELETE FROM platform_settings WHERE key = 'delivery.per_parcel_charge';

-- Which zone an order was charged for, so "why was I charged ৳120?" has an answer on the order itself.
-- The amount is already on orders.shipping_amount; this is the zone key at the moment of checkout.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone TEXT;
