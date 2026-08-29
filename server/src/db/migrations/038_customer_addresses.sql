-- 038_customer_addresses.sql — Customer Saved Addresses & Address Book Management
-- Stores customer shipping addresses with administrative hierarchy, label categorization, and default flag.

CREATE TABLE IF NOT EXISTS user_addresses (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label               TEXT NOT NULL DEFAULT 'HOME' CHECK (label IN ('HOME', 'OFFICE', 'OTHER')),
  custom_label        TEXT,
  recipient_name      TEXT NOT NULL,
  recipient_phone     TEXT NOT NULL,
  division            TEXT NOT NULL,
  district            TEXT NOT NULL,
  upazila             TEXT,
  address_line        TEXT NOT NULL,
  delivery_notes      TEXT,
  postal_code         TEXT,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_addresses_user ON user_addresses (user_id);

-- WHY partial unique index: the "exactly one default address per customer" invariant must be
-- enforced by the database, not just by service-layer ordering. Without this, two concurrent
-- "set default" / "create default" transactions each read the current state, each flip their own
-- row to is_default = true, and both commit — leaving the customer with two defaults. With this
-- index the second writer gets a unique violation and the service retries/fails cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_addresses_single_default
  ON user_addresses (user_id) WHERE is_default;

CREATE TRIGGER trg_user_addresses_updated_at
  BEFORE UPDATE ON user_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
