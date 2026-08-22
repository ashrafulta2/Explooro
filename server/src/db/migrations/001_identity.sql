-- 001_identity.sql (Prompt 2.2)
-- Core identity tables from docs/erd.md §1: users, user_profiles, sessions, refresh_tokens,
-- otp_codes, staff_2fa, trust_scores. `users` deliberately has NO `role` column — authorization
-- lives entirely in 002_rbac.sql's user_roles, per docs/rbac-spec.md §1.
--
-- user_profiles.avatar_media_id has no FK yet: media_assets (docs/erd.md §8) does not exist until
-- Prompt 4.2's migration, which adds the constraint once it does. Additive-first, per
-- docs/erd.md §13 rule 5 — never block an earlier table on a later one.

-- Shared updated_at maintenance (docs/erd.md §0.3: "maintained by a shared trigger, not
-- application code"). Reused unmodified by every later migration that has an updated_at column.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  phone               TEXT UNIQUE NOT NULL,              -- normalised E.164 (+8801XXXXXXXXX)
  email               TEXT UNIQUE,
  password_hash       TEXT,                              -- argon2id; NULL for OTP-only accounts
  is_phone_verified   BOOLEAN NOT NULL DEFAULT false,
  is_email_verified   BOOLEAN NOT NULL DEFAULT false,
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','SUSPENDED','BANNED','PENDING_VERIFICATION')),
  locale              TEXT NOT NULL DEFAULT 'bn' CHECK (locale IN ('bn','en')),
  ui_mode             TEXT NOT NULL DEFAULT 'simple' CHECK (ui_mode IN ('simple','advanced')),
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ
);
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_profiles (
  user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name           TEXT,
  display_name        TEXT,
  avatar_media_id     BIGINT,                            -- FK to media_assets added in Prompt 4.2
  date_of_birth       TEXT,                              -- 🔐 encrypted
  gender              TEXT CHECK (gender IN ('MALE','FEMALE','OTHER','UNSPECIFIED')),
  division            TEXT,
  district            TEXT,
  upazila             TEXT,
  address_line        TEXT,
  postal_code         TEXT,
  bio                 TEXT,
  timezone            TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  use_bengali_numerals BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id           UUID NOT NULL,                     -- refresh-rotation family
  ip_address          INET,
  user_agent          TEXT,
  device_label        TEXT,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON sessions (user_id);
CREATE INDEX ON sessions (family_id);

CREATE TABLE refresh_tokens (
  id                  BIGSERIAL PRIMARY KEY,
  session_id          BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash          TEXT NOT NULL UNIQUE,              -- sha256 of the opaque token
  used_at             TIMESTAMPTZ,                       -- non-NULL + reuse = theft signal
  replaced_by         BIGINT REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON refresh_tokens (session_id);

CREATE TABLE otp_codes (
  id                  BIGSERIAL PRIMARY KEY,
  phone               TEXT NOT NULL,
  code_hash           TEXT NOT NULL,                     -- never store the plain OTP
  purpose             TEXT NOT NULL
                      CHECK (purpose IN ('LOGIN','REGISTER','COD_CONFIRM','PAYOUT_CONFIRM','RESET')),
  attempts            INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts        INTEGER NOT NULL DEFAULT 5,
  consumed_at         TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_codes (phone, purpose);

CREATE TABLE staff_2fa (
  user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted    TEXT NOT NULL,                     -- 🔐 TOTP shared secret
  recovery_codes_hash JSONB NOT NULL DEFAULT '[]'::jsonb,
  enrolled_at         TIMESTAMPTZ,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trust_scores (
  user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score               INTEGER NOT NULL DEFAULT 50 CHECK (score BETWEEN 0 AND 100),
  tier                TEXT NOT NULL DEFAULT 'STARTER'
                      CHECK (tier IN ('STARTER','VERIFIED_TRADER','ELITE_PARTNER')),
  delivery_success_rate NUMERIC(5,2) CHECK (delivery_success_rate BETWEEN 0 AND 100),
  return_rate           NUMERIC(5,2) CHECK (return_rate BETWEEN 0 AND 100),
  dispute_rate          NUMERIC(5,2) CHECK (dispute_rate BETWEEN 0 AND 100),
  cod_refusal_count     INTEGER NOT NULL DEFAULT 0 CHECK (cod_refusal_count >= 0),
  completed_orders      INTEGER NOT NULL DEFAULT 0 CHECK (completed_orders >= 0),
  manual_adjustment     INTEGER NOT NULL DEFAULT 0,
  adjusted_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  computed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);
CREATE TRIGGER trg_trust_scores_updated_at
  BEFORE UPDATE ON trust_scores FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ON trust_scores (adjusted_by);
