-- 002_dev_users.sql (Prompt 2.2)
-- GENERATED — do not hand-edit. Regenerate with:
--   node scripts/generate-dev-user-seed.mjs
-- DEVELOPMENT ONLY. One user per role, all sharing the password documented in
-- README under "Development only — seeded accounts". Never run against production.
-- Idempotent: every INSERT is ON CONFLICT DO NOTHING, safe to re-run.

INSERT INTO users (ref, phone, email, password_hash, is_phone_verified, is_email_verified, status) VALUES
  ('USR-DEV-SUPER-ADMIN', '+8801700000001', 'super_admin@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE'),
  ('USR-DEV-ADMIN', '+8801700000002', 'admin@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE'),
  ('USR-DEV-MODERATOR', '+8801700000003', 'moderator@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE'),
  ('USR-DEV-EDITOR', '+8801700000004', 'editor@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE'),
  ('USR-DEV-SUPPLIER', '+8801700000005', 'supplier@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE'),
  ('USR-DEV-SALER', '+8801700000006', 'saler@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE'),
  ('USR-DEV-CUSTOMER', '+8801700000007', 'customer@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE')
ON CONFLICT (phone) DO NOTHING;

INSERT INTO user_profiles (user_id, full_name, display_name)
SELECT u.id, x.full_name, x.full_name
FROM (VALUES
  ('+8801700000001', 'Dev Super Admin'),
  ('+8801700000002', 'Dev Admin'),
  ('+8801700000003', 'Dev Moderator (zero delegated permissions)'),
  ('+8801700000004', 'Dev Editor'),
  ('+8801700000005', 'Dev Supplier'),
  ('+8801700000006', 'Dev Saler'),
  ('+8801700000007', 'Dev Customer')
) AS x(phone, full_name)
JOIN users u ON u.phone = x.phone
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES
  ('+8801700000001', 'super_admin'),
  ('+8801700000002', 'admin'),
  ('+8801700000003', 'moderator'),
  ('+8801700000004', 'editor'),
  ('+8801700000005', 'supplier'),
  ('+8801700000006', 'saler'),
  ('+8801700000007', 'customer')
) AS x(phone, role_key)
JOIN users u ON u.phone = x.phone
JOIN roles r ON r.key = x.role_key
ON CONFLICT (user_id, role_id) DO NOTHING;
