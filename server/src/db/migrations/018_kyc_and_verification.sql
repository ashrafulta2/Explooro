-- 018_kyc_and_verification.sql (Prompt 7.5)
-- KYC Verification, Blue-Tick & Trust Tiers (DFD Subsystem 11.0 / ERD §2 & §3).

CREATE TABLE IF NOT EXISTS kyc_verifications (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,                  -- KYC-8K4P9ZN1
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kyc_type            TEXT NOT NULL CHECK (kyc_type IN ('SUPPLIER','SALER','CUSTOMER','AGE')),
  nid_number          TEXT,                                  -- 🔐 encrypted
  nid_hash            TEXT,                                  -- keyed HMAC, for duplicate detection
  trade_license_no    TEXT,                                  -- 🔐 encrypted
  vat_tin             TEXT,                                  -- 🔐 encrypted
  business_name       TEXT,
  business_address    TEXT,
  current_step        INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 4),
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','UNDER_REVIEW','VERIFIED','REJECTED','APPEALED')),
  rejection_reason    TEXT,
  rejection_reason_bn TEXT,
  reviewed_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  verified_at         TIMESTAMPTZ,
  purge_after         TIMESTAMPTZ,                           -- document retention policy
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_kyc_verifications_user ON kyc_verifications (user_id, status);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_status ON kyc_verifications (status, created_at);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_type_status ON kyc_verifications (kyc_type, status);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_nid_hash ON kyc_verifications (nid_hash) WHERE nid_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS kyc_documents (
  id                  BIGSERIAL PRIMARY KEY,
  kyc_id              BIGINT NOT NULL REFERENCES kyc_verifications(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL
                      CHECK (doc_type IN ('NID_FRONT','NID_BACK','SELFIE','TRADE_LICENSE',
                                          'VAT_CERT','FACILITY_PHOTO','BANK_STATEMENT')),
  storage_key         TEXT NOT NULL,                         -- 🔐 encrypted / masked storage path
  mime_type           TEXT NOT NULL,
  size_bytes          BIGINT NOT NULL CHECK (size_bytes > 0),
  last_viewed_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  last_viewed_at      TIMESTAMPTZ,
  view_count          INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_documents_kyc_id ON kyc_documents (kyc_id);
