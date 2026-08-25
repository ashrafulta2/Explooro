-- 037_registration_email_and_phone.sql
-- Enables dual registration: user can register with mobile number, email address, or both.
-- Phone is made nullable on users and otp_codes, with a constraint ensuring at least one identifier is present.

ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_or_email_required'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_phone_or_email_required
      CHECK (phone IS NOT NULL OR email IS NOT NULL);
  END IF;
END $$;

ALTER TABLE otp_codes ALTER COLUMN phone DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'otp_codes' AND column_name = 'email'
  ) THEN
    ALTER TABLE otp_codes ADD COLUMN email TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'otp_codes_phone_or_email_required'
  ) THEN
    ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_phone_or_email_required
      CHECK (phone IS NOT NULL OR email IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_otp_codes_email_purpose ON otp_codes (email, purpose);
