-- 100_supplier_type.sql
-- What kind of business a supplier is: a MANUFACTURER makes the goods it lists, a DISTRIBUTOR
-- carries one or more brands' stock, a TRADER buys and resells. The role stays "supplier" for all
-- three (owner decision 2026-11-02: the name is kept, the kind is recorded beside it), so this is
-- profile data, not a role and not an authorisation fact.
--
-- On user_profiles, beside department (048), because it describes the person's business the way
-- department describes a staff member's team. Only profile.service.ts writes it, and only for an
-- account holding the supplier role; for everyone else it stays NULL.
--
-- Additive and nullable (docs/erd.md §13 rule 5): existing suppliers read as "not set" until they
-- choose, with no backfill. TEXT + CHECK rather than a native ENUM (docs/erd.md §0.7).
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS supplier_type TEXT
  CONSTRAINT user_profiles_supplier_type_check
    CHECK (supplier_type IS NULL OR supplier_type IN ('MANUFACTURER','DISTRIBUTOR','TRADER'));
