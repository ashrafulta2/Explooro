-- 010_demo_team_purchases.sql (Prompt 9.5)
-- Seed realistic Bangladeshi demo data for Social Group Buying & Team Purchases:
-- 2 Active teams, 1 Completed team (converted to orders), and 1 Expired & Refunded team.

-- 1. Insert Team Purchases
INSERT INTO team_purchases (
  id, ref, product_id, initiator_user_id, required_members, current_members_count,
  group_price, original_price, status, starts_at, expires_at, completed_at
) VALUES
  -- 1. Active Smartwatch Team (2/3 joined, expires in 14 hours)
  (1, 'TEAM-9A1B2C', 11, 6, 3, 2, 2450.00, 3200.00, 'ACTIVE', now() - interval '10 hours', now() + interval '14 hours', NULL),

  -- 2. Active Dhakai Jamdani Saree Team (1/2 joined, expires in 8 hours)
  (2, 'TEAM-4D5E6F', 5, 7, 2, 1, 4850.00, 6500.00, 'ACTIVE', now() - interval '4 hours', now() + interval '8 hours', NULL),

  -- 3. Completed Maroon Panjabi Team (3/3 joined, completed 1 day ago)
  (3, 'TEAM-7G8H9J', 1, 5, 3, 3, 1250.00, 1650.00, 'COMPLETED', now() - interval '2 days', now() - interval '1 day', now() - interval '26 hours'),

  -- 4. Expired Leather Wallet Team (1/3 joined, expired 2 days ago, 100% refunded)
  (4, 'TEAM-1K2L3M', 8, 7, 3, 1, 850.00, 1150.00, 'EXPIRED', now() - interval '3 days', now() - interval '2 days', NULL)
ON CONFLICT (ref) DO UPDATE SET
  group_price = EXCLUDED.group_price,
  original_price = EXCLUDED.original_price,
  status = EXCLUDED.status,
  expires_at = EXCLUDED.expires_at;

-- 2. Insert Team Purchase Members (including Dev Customer #7)
INSERT INTO team_purchase_members (
  id, team_purchase_id, user_id, shipping_address_json, payment_method, payment_hold_status, joined_at
) VALUES
  -- Team 1 members
  (1, 1, 6, '{"street": "House 12, Road 4, Banani", "district": "Dhaka", "division": "Dhaka", "name": "Rahim Ahmed", "phone": "+8801700000006"}'::jsonb, 'BKASH', 'HELD', now() - interval '10 hours'),
  (2, 1, 7, '{"street": "House 45, Road 7, Dhanmondi", "district": "Dhaka", "division": "Dhaka", "name": "Karim Customer", "phone": "+8801700000007"}'::jsonb, 'COD', 'HELD', now() - interval '2 hours'),

  -- Team 2 member (Customer is initiator)
  (3, 2, 7, '{"street": "House 45, Road 7, Dhanmondi", "district": "Dhaka", "division": "Dhaka", "name": "Karim Customer", "phone": "+8801700000007"}'::jsonb, 'BKASH', 'HELD', now() - interval '4 hours'),

  -- Team 3 members (Completed)
  (4, 3, 5, '{"street": "Plot 10, Tejgaon I/A", "district": "Dhaka", "division": "Dhaka", "name": "Dhaka Artisan Mills", "phone": "+8801700000005"}'::jsonb, 'WALLET', 'CAPTURED', now() - interval '2 days'),
  (5, 3, 7, '{"street": "House 45, Road 7, Dhanmondi", "district": "Dhaka", "division": "Dhaka", "name": "Karim Customer", "phone": "+8801700000007"}'::jsonb, 'COD', 'CAPTURED', now() - interval '32 hours'),
  (6, 3, 6, '{"street": "House 12, Road 4, Banani", "district": "Dhaka", "division": "Dhaka", "name": "Rahim Ahmed", "phone": "+8801700000006"}'::jsonb, 'BKASH', 'CAPTURED', now() - interval '26 hours'),

  -- Team 4 member (Expired & Refunded)
  (7, 4, 7, '{"street": "House 45, Road 7, Dhanmondi", "district": "Dhaka", "division": "Dhaka", "name": "Karim Customer", "phone": "+8801700000007"}'::jsonb, 'BKASH', 'REFUNDED', now() - interval '3 days')
ON CONFLICT (team_purchase_id, user_id) DO UPDATE SET
  payment_hold_status = EXCLUDED.payment_hold_status,
  shipping_address_json = EXCLUDED.shipping_address_json;
