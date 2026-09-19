-- 048_staff_department.sql
-- The Staff Management page (/admin/staff) shows and edits the department a staff member works in
-- ("Trust & Safety", "Finance & Escrow", …). Nothing in the identity schema (001_identity.sql)
-- carried it, and it is profile data rather than an authorisation fact, so it belongs beside
-- full_name on user_profiles — not on users (auth) and not on roles (a department is not a role).
--
-- Additive and nullable (docs/erd.md §13 rule 5): every existing row stays valid with no backfill.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS department TEXT
  CONSTRAINT user_profiles_department_len CHECK (department IS NULL OR char_length(department) <= 120);
