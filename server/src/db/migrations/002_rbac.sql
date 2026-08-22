-- 002_rbac.sql (Prompt 2.2)
-- Authorization tables from docs/erd.md §1: roles, permissions, role_permissions, user_roles, and
-- the three delegation modes from docs/rbac-spec.md §3 (standing grant, just-in-time, maker-checker)
-- plus user_restrictions (granular per-user activity control).

CREATE TABLE roles (
  id                  BIGSERIAL PRIMARY KEY,
  key                 TEXT UNIQUE NOT NULL,
  label_en            TEXT NOT NULL,
  label_bn            TEXT NOT NULL,
  level               INTEGER NOT NULL,                  -- 100 super_admin … 10 customer
  is_system           BOOLEAN NOT NULL DEFAULT false,    -- system roles cannot be deleted
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  key                 TEXT PRIMARY KEY,                  -- domain.resource.action
  domain              TEXT NOT NULL,
  label_en            TEXT NOT NULL,
  label_bn            TEXT NOT NULL,
  plain_en            TEXT,                              -- {plainLanguage} for request modals
  plain_bn            TEXT,
  risk_tier           TEXT NOT NULL CHECK (risk_tier IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  delegable           BOOLEAN NOT NULL,
  approval_mode       TEXT NOT NULL DEFAULT 'approve_before'
                      CHECK (approval_mode IN ('approve_before','execute_then_review')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT critical_never_delegable
    CHECK (risk_tier <> 'CRITICAL' OR delegable = false),
  CONSTRAINT plain_language_required
    CHECK (risk_tier = 'LOW' OR (plain_en IS NOT NULL AND plain_bn IS NOT NULL))
);
CREATE INDEX ON permissions (domain);

CREATE TABLE role_permissions (
  role_id             BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key      TEXT   NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX ON role_permissions (permission_key);

CREATE TABLE user_roles (
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id             BIGINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX ON user_roles (role_id);
CREATE INDEX ON user_roles (assigned_by);

-- The next three tables implement the delegation modes from docs/rbac-spec.md §3 verbatim.

CREATE TABLE user_permission_overrides (              -- Mode A: standing grant
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key      TEXT   NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  effect              TEXT   NOT NULL CHECK (effect IN ('GRANT','DENY')),
  scope_json          JSONB,
  reason              TEXT   NOT NULL CHECK (length(reason) >= 10),
  granted_by          BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  revoked_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT grant_max_90_days CHECK (expires_at <= created_at + INTERVAL '90 days')
);
CREATE UNIQUE INDEX uq_active_override
  ON user_permission_overrides (user_id, permission_key) WHERE revoked_at IS NULL;
CREATE INDEX ON user_permission_overrides (permission_key);
CREATE INDEX ON user_permission_overrides (granted_by);
CREATE INDEX ON user_permission_overrides (revoked_by);

CREATE TABLE permission_grant_requests (              -- Mode B: just-in-time
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  requester_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key      TEXT   NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  target_scope_json   JSONB,
  reason              TEXT   NOT NULL CHECK (length(reason) >= 10),
  status              TEXT   NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED')),
  approver_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approver_note       TEXT,
  decided_at          TIMESTAMPTZ,
  window_minutes      INTEGER CHECK (window_minutes > 0 AND window_minutes <= 480),
  window_expires_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_grant CHECK (approver_id IS NULL OR approver_id <> requester_id),
  CONSTRAINT window_after_decision
    CHECK (window_expires_at IS NULL OR decided_at IS NULL OR window_expires_at > decided_at)
);
CREATE INDEX ON permission_grant_requests (requester_id);
CREATE INDEX ON permission_grant_requests (permission_key);
CREATE INDEX ON permission_grant_requests (approver_id);

CREATE TABLE pending_admin_actions (                  -- Mode C: maker-checker
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  actor_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action_key          TEXT   NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  payload_json        JSONB  NOT NULL,
  target_type         TEXT   NOT NULL,
  target_ref          TEXT   NOT NULL,
  actor_note          TEXT,
  status              TEXT   NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','APPLIED','FAILED')),
  approver_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approver_note       TEXT,
  decided_at          TIMESTAMPTZ,
  applied_at          TIMESTAMPTZ,
  failure_reason      TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_approval CHECK (approver_id IS NULL OR approver_id <> actor_id)
);
CREATE INDEX ON pending_admin_actions (actor_id);
CREATE INDEX ON pending_admin_actions (action_key);
CREATE INDEX ON pending_admin_actions (approver_id);
CREATE INDEX ON pending_admin_actions (target_type, target_ref);

CREATE TABLE user_restrictions (                      -- granular per-user activity control
  id                  BIGSERIAL PRIMARY KEY,
  subject_type        TEXT NOT NULL CHECK (subject_type IN ('USER','SEGMENT')),
  subject_ref         TEXT NOT NULL,
  segment_predicate   JSONB,                             -- required when subject_type = 'SEGMENT'
  capability_key      TEXT NOT NULL,
  mode                TEXT NOT NULL
                      CHECK (mode IN ('BLOCK','THROTTLE','FORCE_REVIEW_QUEUE','SHADOW_BAN')),
  limit_value         NUMERIC(14,2),
  reason              TEXT NOT NULL CHECK (length(reason) >= 10),
  reason_bn           TEXT,
  evidence_json       JSONB,                             -- required for SHADOW_BAN
  applied_by          BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at          TIMESTAMPTZ,
  lifted_at           TIMESTAMPTZ,
  lifted_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT segment_needs_predicate
    CHECK (subject_type <> 'SEGMENT' OR segment_predicate IS NOT NULL)
);
CREATE INDEX ON user_restrictions (subject_type, subject_ref);
CREATE INDEX ON user_restrictions (applied_by);
CREATE INDEX ON user_restrictions (lifted_by);
