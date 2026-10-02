-- 050_grant_revocation_reason.sql
-- Revoking a standing grant (DELETE /admin/grants/:id) requires a ≥10-character reason, but
-- user_permission_overrides had nowhere to keep it: the reason reached audit_logs and nothing else,
-- so the Access Grants page could say a grant was revoked but never by whom or why.
--
-- Additive and nullable (docs/erd.md §13 rule 5): rows revoked before this migration keep NULL,
-- and their reason is still recoverable from the admin.grant.revoke audit row.
ALTER TABLE user_permission_overrides
  ADD COLUMN IF NOT EXISTS revocation_reason TEXT
  CONSTRAINT upo_revocation_reason_len CHECK (revocation_reason IS NULL OR char_length(revocation_reason) >= 10);
