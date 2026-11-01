-- 099_delivery_zone_team_charge_and_days.sql
--
-- Every delivery zone (migration 098) gains two more things, so ALL area-based delivery numbers live
-- on one page, /admin/platform/delivery:
--
-- 1. team_charge: what a team-purchase member in that zone pays for their parcel. It replaces the
--    single shipping_charge in the group_buying module's settings (/admin/growth/group-buy): members of
--    one team can live in different zones, so one charge per team could not be right for all of them.
--    Each member's charge is now snapshotted on team_purchase_members when they join.
-- 2. days_min / days_max: how long delivery to that zone takes, shown at checkout and recorded on the
--    order, replacing the "2-3 business days" that checkout printed for every address.
--
-- WHY team_charge starts at the old team shipping charge: nobody's price changes on deploy.
-- WHY days 1-2 inside Dhaka and 3-5 elsewhere: typical courier times; the owner edits them on the page.
-- Only fields a zone does not have yet are filled, so a re-run never overwrites an admin's edit.
UPDATE platform_settings ps
SET value_json = jsonb_set(ps.value_json, '{zones}', (
  SELECT COALESCE(jsonb_agg(
    z
    || CASE WHEN z ? 'team_charge' THEN '{}'::jsonb ELSE jsonb_build_object('team_charge', tc.charge) END
    || CASE WHEN z ? 'days_min' THEN '{}'::jsonb
            ELSE jsonb_build_object('days_min', CASE WHEN z->>'key' = 'inside_dhaka' THEN 1 ELSE 3 END) END
    || CASE WHEN z ? 'days_max' THEN '{}'::jsonb
            ELSE jsonb_build_object('days_max', CASE WHEN z->>'key' = 'inside_dhaka' THEN 2 ELSE 5 END) END
    ORDER BY e.ord), '[]'::jsonb)
  FROM jsonb_array_elements(ps.value_json->'zones') WITH ORDINALITY AS e(z, ord)
))
FROM (
  SELECT COALESCE(
    (SELECT CASE WHEN jsonb_typeof(settings_json->'shipping_charge') = 'number' THEN settings_json->'shipping_charge' END
       FROM platform_modules WHERE key = 'group_buying'),
    '60'::jsonb
  ) AS charge
) tc
WHERE ps.key = 'delivery.zones'
  AND jsonb_typeof(ps.value_json->'zones') = 'array';

-- The team charge now lives in the zones; a second copy in the module would only invite someone to
-- edit the one nothing reads (and the generic module drawer would still offer it).
UPDATE platform_modules
SET settings_json = COALESCE(settings_json, '{}'::jsonb) - 'shipping_charge',
    settings_schema = COALESCE(settings_schema, '{}'::jsonb) #- '{properties,shipping_charge}'
WHERE key = 'group_buying';

-- Each member's own delivery charge and zone, fixed when they join. NULL for members who joined before
-- this migration: they keep the team's snapshot (team_purchases.shipping_charge), which is what any
-- wallet hold of theirs was taken for.
ALTER TABLE team_purchase_members
  ADD COLUMN IF NOT EXISTS shipping_charge NUMERIC(14,2) CHECK (shipping_charge IS NULL OR shipping_charge >= 0),
  ADD COLUMN IF NOT EXISTS delivery_zone TEXT;

-- The delivery time the shopper was promised at checkout, so the order page can show when to expect it.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_days_min SMALLINT CHECK (delivery_days_min IS NULL OR delivery_days_min >= 0),
  ADD COLUMN IF NOT EXISTS delivery_days_max SMALLINT CHECK (delivery_days_max IS NULL OR delivery_days_max >= 0);
