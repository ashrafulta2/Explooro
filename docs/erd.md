# Explooro — Database Schema Specification (ERD)

> **Produced by:** Prompt 0.5
> **Implemented by:** Prompts 2.2, 3.1, 4.1, 5.1, 5.3, 6.1, 7.1, 7.2, 8.1, 8.2, 9.1–9.5, 10.1, 10.4–10.7
> **Depends on:** [`rbac-spec.md`](rbac-spec.md), [`ia-sitemap.md`](ia-sitemap.md)
>
> `prompt.md` v1.0 specified **20 tables with no column types**, and referenced two tables
> (`platform_settings`, `warehouse_nodes`) that its own migration never created. This document
> replaces it with **95 tables** (98 as of Prompt 4.6, which added Product Q&A — see §14), every
> column typed, every foreign key given an explicit `ON DELETE` behaviour.

---

## 0. Conventions — non-negotiable

### 0.1 Money

```sql
amount NUMERIC(14,2) NOT NULL
```

**Never `FLOAT`, `REAL`, or `DOUBLE PRECISION`.** `NUMERIC(14,2)` holds up to
৳999,999,999,999.99 with exact decimal arithmetic. The PRD requires 100.00% ledger accuracy;
binary floating point cannot deliver it — `0.1 + 0.2 ≠ 0.3` is not an acceptable property for a
wallet.

Storage is `NUMERIC(14,2)`. **Computation** inside `pricing.service.js` is done in integer paisa
and rounded once at the boundary (Prompt 4.3), so repeated percentage splits cannot drift.

### 0.2 Identifiers — two-column strategy

| Column | Type | Purpose |
| :--- | :--- | :--- |
| `id` | `BIGSERIAL PRIMARY KEY` | Internal. Fast joins, compact indexes, sequential insert locality |
| `ref` | `TEXT UNIQUE` | Public-facing. ULID or a prefixed short code |

**Why both.** A sequential integer in a URL leaks business volume — `order/1042` tells a competitor
exactly how many orders the platform has taken. Any identifier a user can see gets a `ref`:

```
orders.ref          ORD-8F2K9QX7
sub_orders.ref      SUB-8F2K9QX7-1
payout_requests.ref PAY-3M7V2WQ1
return_requests.ref RET-9K4P8ZN2
disputes.ref        DSP-2R6Y1LM5
```

Internal-only tables (`role_permissions`, `cart_items`, `ad_impressions`) have no `ref`.

### 0.3 Timestamps

```sql
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ
```

**Always `TIMESTAMPTZ`, never `TIMESTAMP`.** The platform serves Bangladesh (UTC+6) from a
Singapore VPS (UTC+8) with a global CDN. A naive timestamp is a bug waiting for the first
cross-midnight escrow release.

`updated_at` is maintained by a shared trigger, not by application code.

### 0.4 Foreign keys — explicit `ON DELETE`, always

| Relationship | Policy | Reason |
| :--- | :--- | :--- |
| Financial record → its subject | `RESTRICT` | A wallet with ledger history can never be deleted |
| Child → parent (owned rows) | `CASCADE` | `cart_items` die with their `cart` |
| Optional reference | `SET NULL` | `moderator_id` survives the moderator leaving |
| Audit / historical | `RESTRICT` | History is not deletable by definition |

A foreign key without an explicit `ON DELETE` clause is a defect.

### 0.5 Soft delete

```sql
deleted_at TIMESTAMPTZ
```

Applied where a record must survive for audit, financial, or dispute reasons: `products`,
`virtual_stores`, `users`, `reviews`, `stories`. Every query against these tables filters
`WHERE deleted_at IS NULL`; partial unique indexes do the same.

Rows with no audit consequence (`cart_items`, `wishlists`, `quest_progress`) are hard-deleted.

### 0.6 PII — encrypted at rest

Columns marked 🔐 are encrypted with application-level envelope encryption
(`PII_ENCRYPTION_KEY`, AES-256-GCM), not stored in plaintext:

```
kyc_verifications.nid_number 🔐      kyc_documents.storage_key 🔐
payout_requests.account_number 🔐    user_profiles.date_of_birth 🔐
b2b_escrow_milestones.bank_ref 🔐
```

Rules:
- Encrypted columns are `TEXT` (ciphertext), never indexed directly. Lookup uses a separate
  `*_hash` column holding a keyed HMAC, so equality search works without decryption.
- **Never** appear in logs, API responses, exports, or `audit_logs.before_json` / `after_json`.
- Every read of a 🔐 column writes an audit row naming the reader (`users.kyc.document_view`).

### 0.7 Naming

- Tables: `snake_case`, plural (`sub_orders`).
- Booleans: `is_` / `has_` / `can_` prefix.
- Money: `_amount` suffix. Quantities: `_qty`. Percentages: `_pct` as `NUMERIC(5,2)`.
- Enums are `TEXT` + `CHECK`, **not** PostgreSQL `ENUM` types — adding a value to a native enum
  requires `ALTER TYPE` and is painful to reverse; a `CHECK` is a one-line forward migration.
- JSON is `JSONB`, never `JSON`.

### 0.8 Quantities

```sql
stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0)
```

The `CHECK` is the last line of defence behind `SELECT … FOR UPDATE`. If a race condition ever
slips past the application lock, the database refuses the write rather than silently going
negative.

---

## 1. Identity & Access — 17 tables

```sql
-- Core identity. NOTE: no `role` column. Roles live in user_roles (rbac-spec.md §1).
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

CREATE TABLE user_profiles (
  user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name           TEXT,
  display_name        TEXT,
  avatar_media_id     BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
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

CREATE TABLE refresh_tokens (
  id                  BIGSERIAL PRIMARY KEY,
  session_id          BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash          TEXT NOT NULL UNIQUE,              -- sha256 of the opaque token
  used_at             TIMESTAMPTZ,                       -- non-NULL + reuse = theft signal
  replaced_by         BIGINT REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE staff_2fa (
  user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted    TEXT NOT NULL,                     -- 🔐 TOTP shared secret
  recovery_codes_hash JSONB NOT NULL DEFAULT '[]'::jsonb,
  enrolled_at         TIMESTAMPTZ,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE role_permissions (
  role_id             BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key      TEXT   NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE user_roles (
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id             BIGINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
```

The next three tables implement the delegation modes from `rbac-spec.md` §3 verbatim:

```sql
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
```

```sql
CREATE TABLE kyc_verifications (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kyc_type            TEXT NOT NULL CHECK (kyc_type IN ('SUPPLIER','SALER','CUSTOMER','AGE')),
  nid_number          TEXT,                              -- 🔐 encrypted
  nid_hash            TEXT,                              -- keyed HMAC, for duplicate detection
  trade_license_no    TEXT,                              -- 🔐 encrypted
  vat_tin             TEXT,                              -- 🔐 encrypted
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
  purge_after         TIMESTAMPTZ,                       -- document retention policy
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);
CREATE INDEX ON kyc_verifications (nid_hash) WHERE nid_hash IS NOT NULL;

CREATE TABLE kyc_documents (
  id                  BIGSERIAL PRIMARY KEY,
  kyc_id              BIGINT NOT NULL REFERENCES kyc_verifications(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL
                      CHECK (doc_type IN ('NID_FRONT','NID_BACK','SELFIE','TRADE_LICENSE',
                                          'VAT_CERT','FACILITY_PHOTO','BANK_STATEMENT')),
  storage_key         TEXT NOT NULL,                     -- 🔐 encrypted object key
  mime_type           TEXT NOT NULL,
  size_bytes          BIGINT NOT NULL CHECK (size_bytes > 0),
  last_viewed_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  last_viewed_at      TIMESTAMPTZ,
  view_count          INTEGER NOT NULL DEFAULT 0,
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
```

---

## 2. Platform Configuration — 8 tables

```sql
CREATE TABLE platform_settings (            -- ⚠️ referenced by v1.0 but never created there
  key                 TEXT PRIMARY KEY,
  value_json          JSONB NOT NULL,
  value_type          TEXT NOT NULL CHECK (value_type IN ('NUMBER','STRING','BOOLEAN','OBJECT')),
  label_en            TEXT NOT NULL,
  label_bn            TEXT NOT NULL,
  group_key           TEXT NOT NULL,
  is_sensitive        BOOLEAN NOT NULL DEFAULT false,
  updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);
-- Seeded keys: default_saler_split_pct, default_platform_split_pct, escrow_hold_days,
-- min_payout_amount, cod_otp_threshold, high_value_refund_threshold, jit_window_minutes,
-- max_grant_days, return_window_days, coin_redemption_rate …

CREATE TABLE platform_modules (
  key                 TEXT PRIMARY KEY,
  group_key           TEXT NOT NULL,
  label_en            TEXT NOT NULL,
  label_bn            TEXT NOT NULL,
  description_en      TEXT,
  description_bn      TEXT,
  is_enabled          BOOLEAN NOT NULL DEFAULT true,
  default_enabled     BOOLEAN NOT NULL DEFAULT true,
  settings_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings_schema     JSONB,                             -- JSON Schema for sub-settings
  depends_on          TEXT[] NOT NULL DEFAULT '{}',
  scheduled_on_at     TIMESTAMPTZ,
  scheduled_off_at    TIMESTAMPTZ,
  last_reason         TEXT,
  updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE module_targeting_rules (
  id                  BIGSERIAL PRIMARY KEY,
  module_key          TEXT NOT NULL REFERENCES platform_modules(key) ON DELETE CASCADE,
  target_type         TEXT NOT NULL
                      CHECK (target_type IN ('ROLE','TIER','DISTRICT','USER','PERCENTAGE')),
  target_value        TEXT NOT NULL,
  is_enabled          BOOLEAN NOT NULL,
  priority            INTEGER NOT NULL DEFAULT 0,        -- USER > DISTRICT > TIER > ROLE
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE commission_rules (
  id                  BIGSERIAL PRIMARY KEY,
  scope_type          TEXT NOT NULL CHECK (scope_type IN ('GLOBAL','CATEGORY','PRODUCT','SELLER')),
  scope_ref           TEXT,
  saler_split_pct     NUMERIC(5,2) NOT NULL CHECK (saler_split_pct BETWEEN 0 AND 100),
  platform_split_pct  NUMERIC(5,2) NOT NULL CHECK (platform_split_pct BETWEEN 0 AND 100),
  min_margin_pct      NUMERIC(5,2),
  effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to        TIMESTAMPTZ,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT splits_sum_to_100 CHECK (saler_split_pct + platform_split_pct = 100)
);

CREATE TABLE theme_palettes (
  id                  BIGSERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  preset_key          TEXT,                              -- alibaba_enterprise, amazon_pro, …
  tokens_json         JSONB NOT NULL,                    -- the 6 section token groups
  is_published        BOOLEAN NOT NULL DEFAULT false,
  contrast_report     JSONB,                             -- measured ratios at save time
  published_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at        TIMESTAMPTZ,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX only_one_published_theme ON theme_palettes ((true)) WHERE is_published;

-- Append-only, hash-chained. UPDATE and DELETE blocked by trigger.
CREATE TABLE audit_logs (
  id                  BIGSERIAL,
  actor_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_role          TEXT,
  action              TEXT NOT NULL,
  target_type         TEXT,
  target_ref          TEXT,
  before_json         JSONB,                             -- PII redacted before insert
  after_json          JSONB,
  undo_payload        JSONB,                             -- present when reversible
  risk_tier           TEXT,
  is_breakglass       BOOLEAN NOT NULL DEFAULT false,
  ip_address          INET,
  user_agent          TEXT,
  trace_id            TEXT,
  prev_hash           TEXT,
  row_hash            TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE i18n_locales (
  code                TEXT PRIMARY KEY,                  -- 'en', 'bn'
  label_native        TEXT NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  direction           TEXT NOT NULL DEFAULT 'ltr' CHECK (direction IN ('ltr','rtl')),
  completeness_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE i18n_strings (
  id                  BIGSERIAL PRIMARY KEY,
  namespace           TEXT NOT NULL,                     -- 'nav', 'access', 'vault' …
  key                 TEXT NOT NULL,                     -- dot path within namespace
  locale              TEXT NOT NULL REFERENCES i18n_locales(code) ON DELETE CASCADE,
  value               TEXT NOT NULL,
  is_machine_translated BOOLEAN NOT NULL DEFAULT false,
  updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  UNIQUE (namespace, key, locale)
);
```

---

## 3. Catalog — 12 tables

```sql
CREATE TABLE categories (
  id                  BIGSERIAL PRIMARY KEY,
  parent_id           BIGINT REFERENCES categories(id) ON DELETE RESTRICT,
  slug                TEXT UNIQUE NOT NULL,
  path                LTREE NOT NULL,                    -- materialised path for subtree queries
  name_en             TEXT NOT NULL,
  name_bn             TEXT NOT NULL,
  icon_key            TEXT,
  display_order       INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  requires_fefo       BOOLEAN NOT NULL DEFAULT false,    -- FMCG / cosmetics
  requires_age_check  BOOLEAN NOT NULL DEFAULT false,
  auto_approve        BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE products (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,
  supplier_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id           BIGINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  slug                  TEXT UNIQUE NOT NULL,
  title_en              TEXT NOT NULL,
  title_bn              TEXT NOT NULL,
  description_en        TEXT,
  description_bn        TEXT,
  brand                 TEXT,
  base_cost             NUMERIC(14,2) NOT NULL CHECK (base_cost >= 0),
  wholesale_margin      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (wholesale_margin >= 0),
  default_retail_price  NUMERIC(14,2) NOT NULL CHECK (default_retail_price >= 0),
  min_retail_price      NUMERIC(14,2),
  stock_qty             INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_threshold   INTEGER NOT NULL DEFAULT 5,
  weight_grams          INTEGER CHECK (weight_grams > 0),
  has_variants          BOOLEAN NOT NULL DEFAULT false,
  warranty_months       INTEGER CHECK (warranty_months >= 0),
  status                TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','REJECTED','PAUSED','ARCHIVED')),
  search_vector         TSVECTOR,
  rating_avg            NUMERIC(3,2) CHECK (rating_avg BETWEEN 0 AND 5),
  rating_count          INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  sold_count            INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT retail_covers_cost
    CHECK (default_retail_price >= base_cost + wholesale_margin)
);

CREATE TABLE product_variants (             -- ⚠️ v1.0 had a variant selector with no table
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku                 TEXT UNIQUE NOT NULL,
  attributes_json     JSONB NOT NULL,                    -- {"size":"L","color":"Red"}
  price_delta         NUMERIC(14,2) NOT NULL DEFAULT 0,
  stock_qty           INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  image_id            BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE product_images (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id            BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  display_order       INTEGER NOT NULL DEFAULT 0,
  is_primary          BOOLEAN NOT NULL DEFAULT false,
  quality_score       INTEGER CHECK (quality_score BETWEEN 0 AND 100),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE warehouse_nodes (              -- ⚠️ referenced by v1.0 but never created there
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name                TEXT NOT NULL,
  division            TEXT NOT NULL,
  district            TEXT NOT NULL,
  upazila             TEXT,
  address_line        TEXT NOT NULL,
  latitude            NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude           NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180),
  priority            INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE warehouse_stock (
  warehouse_node_id   BIGINT NOT NULL REFERENCES warehouse_nodes(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,
  stock_qty           INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reserved_qty        INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  updated_at          TIMESTAMPTZ,
  PRIMARY KEY (warehouse_node_id, product_id, COALESCE(variant_id, 0))
);

CREATE TABLE product_batches (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
  warehouse_node_id   BIGINT NOT NULL REFERENCES warehouse_nodes(id) ON DELETE RESTRICT,
  batch_number        TEXT NOT NULL,
  mfg_date            DATE,
  exp_date            DATE,
  qty                 INTEGER NOT NULL CHECK (qty >= 0),
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','EXPIRING_SOON','EXPIRED','RECALLED','DEPLETED')),
  recalled_at         TIMESTAMPTZ,
  recall_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  UNIQUE (product_id, batch_number, warehouse_node_id)
);
CREATE INDEX fefo_lookup ON product_batches (product_id, warehouse_node_id, exp_date)
  WHERE status = 'ACTIVE' AND qty > 0;

CREATE TABLE virtual_stores (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  saler_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slug                TEXT NOT NULL,
  shop_name           TEXT NOT NULL,
  bio                 TEXT,
  logo_media_id       BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  banner_media_id     BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  announcement        TEXT,
  social_links_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  has_physical_shop   BOOLEAN NOT NULL DEFAULT false,
  physical_open_status TEXT NOT NULL DEFAULT 'CLOSED'
                      CHECK (physical_open_status IN ('OPEN','CLOSED','AUTO')),
  business_hours_json JSONB,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_store_slug ON virtual_stores (slug) WHERE deleted_at IS NULL;
-- Reserved slugs (admin, api, store, checkout, account, saler, supplier, moderator, editor,
-- dev, live, help, legal, search, cart, s, c, team) are rejected at the service layer.

CREATE TABLE saler_store_items (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            BIGINT NOT NULL REFERENCES virtual_stores(id) ON DELETE CASCADE,
  saler_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  custom_retail_price NUMERIC(14,2) CHECK (custom_retail_price >= 0),
  collection_name     TEXT,
  display_order       INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, product_id)
);

CREATE TABLE product_approvals (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  submitted_by        BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','ESCALATED')),
  auto_flags_json     JSONB NOT NULL DEFAULT '[]'::jsonb, -- keyword / price / duplicate hits
  claimed_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  claimed_at          TIMESTAMPTZ,
  decided_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  reason              TEXT,
  reason_bn           TEXT,
  sla_due_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_bundles (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  saler_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_en            TEXT NOT NULL,
  title_bn            TEXT NOT NULL,
  bundle_price        NUMERIC(14,2) NOT NULL CHECK (bundle_price >= 0),
  sum_of_parts        NUMERIC(14,2) NOT NULL CHECK (sum_of_parts >= 0),
  discount_amount     NUMERIC(14,2) NOT NULL CHECK (discount_amount >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE bundle_items (
  bundle_id           BIGINT NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  -- Deterministic apportionment of the bundle discount, per prompt.md 10.5.
  discount_share      NUMERIC(14,2) NOT NULL CHECK (discount_share >= 0),
  PRIMARY KEY (bundle_id, product_id, COALESCE(variant_id, 0))
);
```

---

## 4. Commerce — 12 tables

```sql
CREATE TABLE carts (                        -- ⚠️ v1.0 had a client-only cart
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT REFERENCES users(id) ON DELETE CASCADE,
  guest_token         TEXT UNIQUE,                       -- for pre-login carts
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','ABANDONED','CONVERTED','MERGED')),
  last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_order_id  BIGINT,                            -- FK added after orders exists
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  CONSTRAINT cart_has_owner CHECK (user_id IS NOT NULL OR guest_token IS NOT NULL)
);

CREATE TABLE cart_items (
  id                  BIGSERIAL PRIMARY KEY,
  cart_id             BIGINT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,
  saler_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,   -- attribution
  bundle_id           BIGINT REFERENCES product_bundles(id) ON DELETE SET NULL,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  price_at_add        NUMERIC(14,2) NOT NULL CHECK (price_at_add >= 0),
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id, COALESCE(variant_id, 0), COALESCE(bundle_id, 0))
);

CREATE TABLE wishlists (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_at_save       NUMERIC(14,2) NOT NULL CHECK (price_at_save >= 0),
  notify_on_drop      BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

CREATE TABLE orders (                       -- master order; money detail lives in sub_orders
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,              -- ORD-8F2K9QX7
  customer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  total_amount        NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  items_amount        NUMERIC(14,2) NOT NULL CHECK (items_amount >= 0),
  shipping_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  coins_redeemed      INTEGER NOT NULL DEFAULT 0 CHECK (coins_redeemed >= 0),
  coins_discount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (coins_discount >= 0),
  currency            TEXT NOT NULL DEFAULT 'BDT',
  payment_method      TEXT NOT NULL CHECK (payment_method IN ('BKASH','NAGAD','ROCKET','CARD','COD')),
  payment_status      TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (payment_status IN ('PENDING','PAID','FAILED','PARTIALLY_REFUNDED','REFUNDED')),
  is_otp_verified     BOOLEAN NOT NULL DEFAULT false,    -- COD anti-fraud
  trust_score_at_order INTEGER,
  coupon_id           BIGINT,                            -- FK added after coupons exists
  team_purchase_id    BIGINT,
  idempotency_key     TEXT UNIQUE,
  recipient_name      TEXT NOT NULL,
  recipient_phone     TEXT NOT NULL,
  division            TEXT NOT NULL,
  district            TEXT NOT NULL,
  upazila             TEXT,
  address_line        TEXT NOT NULL,
  placed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  CONSTRAINT total_is_consistent
    CHECK (total_amount = items_amount + shipping_amount - discount_amount - coins_discount)
);

CREATE TABLE sub_orders (                   -- one per supplier: one parcel, one settlement
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,              -- SUB-8F2K9QX7-1
  order_id            BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  saler_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  warehouse_node_id   BIGINT REFERENCES warehouse_nodes(id) ON DELETE SET NULL,
  subtotal_base       NUMERIC(14,2) NOT NULL CHECK (subtotal_base >= 0),
  wholesale_margin    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (wholesale_margin >= 0),
  net_retail_margin   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (net_retail_margin >= 0),
  saler_commission    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (saler_commission >= 0),
  platform_margin     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (platform_margin >= 0),
  shipping_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  discount_share      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_share >= 0),
  total_amount        NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  status              TEXT NOT NULL DEFAULT 'PLACED'
                      CHECK (status IN ('PLACED','CONFIRMED','PACKED','SHIPPED','IN_TRANSIT',
                                        'DELIVERED','CANCELLED','RETURNED','REFUNDED')),
  delivered_at        TIMESTAMPTZ,                       -- starts the escrow clock
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  CONSTRAINT margin_splits_reconcile
    CHECK (saler_commission + platform_margin = net_retail_margin)
);

CREATE TABLE order_items (
  id                  BIGSERIAL PRIMARY KEY,
  sub_order_id        BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
  batch_id            BIGINT REFERENCES product_batches(id) ON DELETE RESTRICT,  -- FEFO allocation
  bundle_id           BIGINT REFERENCES product_bundles(id) ON DELETE SET NULL,
  title_snapshot      TEXT NOT NULL,                     -- immutable: titles change, receipts don't
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  base_price          NUMERIC(14,2) NOT NULL CHECK (base_price >= 0),
  retail_price        NUMERIC(14,2) NOT NULL CHECK (retail_price >= 0),
  line_total          NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE coupons (
  id                  BIGSERIAL PRIMARY KEY,
  code                TEXT UNIQUE NOT NULL,
  discount_type       TEXT NOT NULL
                      CHECK (discount_type IN ('PERCENT','FIXED','FREE_SHIPPING','BUY_X_GET_Y')),
  discount_value      NUMERIC(14,2) NOT NULL CHECK (discount_value >= 0),
  max_discount        NUMERIC(14,2) CHECK (max_discount >= 0),
  min_spend           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (min_spend >= 0),
  budget_cap          NUMERIC(14,2) CHECK (budget_cap >= 0),
  budget_used         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (budget_used >= 0),
  usage_limit         INTEGER CHECK (usage_limit > 0),
  usage_count         INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  per_user_limit      INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  first_order_only    BOOLEAN NOT NULL DEFAULT false,
  is_stackable        BOOLEAN NOT NULL DEFAULT false,
  scope_type          TEXT NOT NULL CHECK (scope_type IN ('PLATFORM','SUPPLIER','SALER','CATEGORY','PRODUCT')),
  scope_ref           TEXT,
  -- Who pays for the discount. Getting this wrong silently corrupts margins.
  funded_by           TEXT NOT NULL CHECK (funded_by IN ('PLATFORM','SUPPLIER','SALER')),
  funded_by_user_id   BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  starts_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT budget_within_cap CHECK (budget_cap IS NULL OR budget_used <= budget_cap)
);

CREATE TABLE coupon_redemptions (
  id                  BIGSERIAL PRIMARY KEY,
  coupon_id           BIGINT NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id            BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  discount_amount     NUMERIC(14,2) NOT NULL CHECK (discount_amount >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, order_id)
);

CREATE TABLE flash_sales (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  title_en            TEXT NOT NULL,
  title_bn            TEXT NOT NULL,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,
  sale_price          NUMERIC(14,2) NOT NULL CHECK (sale_price >= 0),
  allocated_qty       INTEGER NOT NULL CHECK (allocated_qty > 0),
  sold_qty            INTEGER NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
  per_user_limit      INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT never_oversell CHECK (sold_qty <= allocated_qty),
  CONSTRAINT valid_window   CHECK (ends_at > starts_at)
);

CREATE TABLE team_purchases (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id          BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
  initiator_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  required_members    INTEGER NOT NULL CHECK (required_members >= 2),
  joined_members      INTEGER NOT NULL DEFAULT 0 CHECK (joined_members >= 0),
  team_price          NUMERIC(14,2) NOT NULL CHECK (team_price >= 0),
  regular_price       NUMERIC(14,2) NOT NULL CHECK (regular_price >= 0),
  reserved_qty        INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  status              TEXT NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN','COMPLETED','EXPIRED','CANCELLED')),
  expires_at          TIMESTAMPTZ NOT NULL,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_not_overfilled CHECK (joined_members <= required_members)
);

CREATE TABLE team_purchase_members (
  id                  BIGSERIAL PRIMARY KEY,
  team_purchase_id    BIGINT NOT NULL REFERENCES team_purchases(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  qty                 INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  -- Money is AUTHORIZED on join, CAPTURED only when the team completes.
  authorized_amount   NUMERIC(14,2) NOT NULL CHECK (authorized_amount >= 0),
  payment_txn_id      BIGINT,
  order_id            BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'AUTHORIZED'
                      CHECK (status IN ('AUTHORIZED','CAPTURED','REFUNDED','FAILED')),
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_purchase_id, user_id)
);

CREATE TABLE abandoned_carts (
  id                  BIGSERIAL PRIMARY KEY,
  cart_id             BIGINT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  user_id             BIGINT REFERENCES users(id) ON DELETE CASCADE,
  items_value         NUMERIC(14,2) NOT NULL CHECK (items_value >= 0),
  sequence_step       INTEGER NOT NULL DEFAULT 0 CHECK (sequence_step BETWEEN 0 AND 3),
  last_nudge_at       TIMESTAMPTZ,
  recovery_token      TEXT UNIQUE,
  incentive_coupon_id BIGINT REFERENCES coupons(id) ON DELETE SET NULL,
  recovered_at        TIMESTAMPTZ,
  recovered_order_id  BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  recovered_value     NUMERIC(14,2),
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id)
);
```

---

## 5. Finance — 8 tables

```sql
CREATE TABLE wallets (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  available_balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  pending_escrow_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (pending_escrow_balance >= 0),
  held_balance          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (held_balance >= 0),
  lifetime_earned       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_withdrawn    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (lifetime_withdrawn >= 0),
  currency              TEXT NOT NULL DEFAULT 'BDT',
  version               BIGINT NOT NULL DEFAULT 0,       -- optimistic concurrency
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);
-- available_balance may go negative ONLY via a clawback recovery (prompt.md 6.2). Any other
-- negative value is a defect and the integrity check flags it.

-- TRUE double entry. Append-only: UPDATE and DELETE blocked by trigger.
CREATE TABLE ledger_transactions (
  id                    BIGSERIAL,
  txn_group_id          UUID NOT NULL,                   -- entries in a group MUST sum to zero
  wallet_id             BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  entry_type            TEXT NOT NULL CHECK (entry_type IN ('DEBIT','CREDIT')),
  amount                NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  balance_bucket        TEXT NOT NULL
                        CHECK (balance_bucket IN ('AVAILABLE','ESCROW','HELD')),
  category              TEXT NOT NULL
                        CHECK (category IN ('SALE_COMMISSION','SUPPLIER_PAYMENT','ESCROW_LOCK',
                                            'ESCROW_RELEASE','CLAWBACK','REFUND','PAYOUT',
                                            'PAYOUT_FEE','ADJUSTMENT','AD_SPEND','COIN_REDEMPTION',
                                            'REFERRAL_BONUS','QUEST_REWARD','COD_SETTLEMENT')),
  reference_type        TEXT NOT NULL,
  reference_id          BIGINT NOT NULL,
  idempotency_key       TEXT,
  memo                  TEXT,
  created_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE UNIQUE INDEX ON ledger_transactions (idempotency_key, created_at)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE escrow_entries (
  id                    BIGSERIAL PRIMARY KEY,
  sub_order_id          BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  wallet_id             BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  beneficiary_role      TEXT NOT NULL CHECK (beneficiary_role IN ('SUPPLIER','SALER','PLATFORM')),
  amount                NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  status                TEXT NOT NULL DEFAULT 'LOCKED'
                        CHECK (status IN ('LOCKED','RELEASED','CLAWED_BACK','FROZEN','FAILED')),
  hold_until            TIMESTAMPTZ NOT NULL,
  released_at           TIMESTAMPTZ,
  frozen_by             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  freeze_reason         TEXT,
  failure_count         INTEGER NOT NULL DEFAULT 0,
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sub_order_id, wallet_id, beneficiary_role)
);
CREATE INDEX escrow_due ON escrow_entries (hold_until) WHERE status = 'LOCKED';

CREATE TABLE payout_requests (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,            -- PAY-3M7V2WQ1
  wallet_id             BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  method                TEXT NOT NULL CHECK (method IN ('BKASH','NAGAD','ROCKET','BANK')),
  account_number        TEXT NOT NULL,                   -- 🔐 encrypted
  account_name          TEXT NOT NULL,
  bank_name             TEXT,
  amount                NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  fee_amount            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  net_amount            NUMERIC(14,2) NOT NULL CHECK (net_amount > 0),
  status                TEXT NOT NULL DEFAULT 'REQUESTED'
                        CHECK (status IN ('REQUESTED','HELD','APPROVED','PROCESSING',
                                          'COMPLETED','FAILED','REJECTED','CANCELLED')),
  risk_flags_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  pending_action_id     BIGINT REFERENCES pending_admin_actions(id) ON DELETE SET NULL,
  approved_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,
  gateway_ref           TEXT,
  gateway_receipt       JSONB,
  failure_reason        TEXT,
  processed_at          TIMESTAMPTZ,
  idempotency_key       TEXT UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ,
  CONSTRAINT net_is_consistent CHECK (net_amount = amount - fee_amount)
);

CREATE TABLE payment_transactions (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,
  order_id              BIGINT REFERENCES orders(id) ON DELETE RESTRICT,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  gateway               TEXT NOT NULL CHECK (gateway IN ('BKASH','NAGAD','SSLCOMMERZ','COD','MOCK')),
  intent                TEXT NOT NULL CHECK (intent IN ('SALE','AUTHORIZE','CAPTURE','REFUND','PAYOUT')),
  gateway_ref           TEXT,
  amount                NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status                TEXT NOT NULL DEFAULT 'INITIATED'
                        CHECK (status IN ('INITIATED','PENDING','SUCCESS','FAILED','TIMEOUT','REVERSED')),
  raw_request           JSONB,                           -- credentials masked before write
  raw_response          JSONB,
  idempotency_key       TEXT UNIQUE,
  reconciled_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);
CREATE INDEX stuck_payments ON payment_transactions (created_at)
  WHERE status IN ('INITIATED','PENDING');

CREATE TABLE payment_webhook_events (
  id                    BIGSERIAL PRIMARY KEY,
  gateway               TEXT NOT NULL,
  provider_event_id     TEXT NOT NULL,
  signature_valid       BOOLEAN NOT NULL,
  payload_json          JSONB NOT NULL,
  processed_at          TIMESTAMPTZ,
  process_result        TEXT,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gateway, provider_event_id)                    -- replay protection at the DB level
);

CREATE TABLE cod_reconciliation (
  id                    BIGSERIAL PRIMARY KEY,
  sub_order_id          BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  courier               TEXT NOT NULL,
  consignment_id        TEXT,
  expected_amount       NUMERIC(14,2) NOT NULL CHECK (expected_amount >= 0),
  courier_reported      NUMERIC(14,2),
  deposit_received      NUMERIC(14,2),
  variance              NUMERIC(14,2),
  status                TEXT NOT NULL DEFAULT 'AWAITING'
                        CHECK (status IN ('AWAITING','MATCHED','SHORT_COLLECTION','OVER_COLLECTION',
                                          'MISSING_DEPOSIT','DUPLICATE','UNMATCHED_CONSIGNMENT',
                                          'TIMING_DIFFERENCE','RESOLVED')),
  settlement_batch_ref  TEXT,
  resolved_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  resolution_reason     TEXT,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ,
  UNIQUE (sub_order_id)
);

CREATE TABLE b2b_escrow_milestones (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,
  sub_order_id          BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  buyer_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supplier_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sequence_no           INTEGER NOT NULL CHECK (sequence_no > 0),
  label_en              TEXT NOT NULL,
  label_bn              TEXT NOT NULL,
  release_pct           NUMERIC(5,2) NOT NULL CHECK (release_pct > 0 AND release_pct <= 100),
  amount                NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  evidence_required     TEXT NOT NULL
                        CHECK (evidence_required IN ('NONE','DISPATCH_PROOF','DELIVERY_PROOF','INSPECTION')),
  evidence_media_json   JSONB,
  bank_ref              TEXT,                            -- 🔐 encrypted
  status                TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','EVIDENCE_SUBMITTED','RELEASED','FROZEN','REFUNDED')),
  agreed_terms_hash     TEXT NOT NULL,                   -- immutable snapshot of agreed schedule
  released_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  released_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sub_order_id, sequence_no)
);
```

---

## 6. Logistics & Support — 8 tables

```sql
CREATE TABLE shipments (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  sub_order_id        BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  courier             TEXT NOT NULL CHECK (courier IN ('STEADFAST','PATHAO','REDX','PAPERFLY','MOCK')),
  consignment_id      TEXT,
  tracking_code       TEXT,
  label_url           TEXT,
  cod_amount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cod_amount >= 0),
  shipping_cost       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  is_reverse          BOOLEAN NOT NULL DEFAULT false,    -- return pickup
  status              TEXT NOT NULL DEFAULT 'CREATED'
                      CHECK (status IN ('CREATED','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY',
                                        'DELIVERED','FAILED_ATTEMPT','RETURNED','CANCELLED')),
  rider_name          TEXT,
  rider_phone         TEXT,
  last_latitude       NUMERIC(9,6),
  last_longitude      NUMERIC(9,6),
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  UNIQUE (courier, consignment_id)
);

CREATE TABLE shipment_events (              -- full history, never just the latest status
  id                  BIGSERIAL PRIMARY KEY,
  shipment_id         BIGINT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  provider_event_id   TEXT,
  raw_status          TEXT NOT NULL,                     -- the carrier's own vocabulary
  normalized_status   TEXT NOT NULL,                     -- our enum
  note                TEXT,
  latitude            NUMERIC(9,6),
  longitude           NUMERIC(9,6),
  occurred_at         TIMESTAMPTZ NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, provider_event_id)
);

CREATE TABLE return_requests (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,              -- RET-9K4P8ZN2
  sub_order_id        BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  customer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason_code         TEXT NOT NULL
                      CHECK (reason_code IN ('DAMAGED','WRONG_ITEM','NOT_AS_DESCRIBED','MISSING_PARTS',
                                             'CHANGED_MIND','SIZE_ISSUE','LATE_DELIVERY','OTHER')),
  reason_text         TEXT,
  evidence_media_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution_type     TEXT CHECK (resolution_type IN ('REFUND_MFS','REFUND_WALLET','REPLACEMENT','REJECTED')),
  refund_amount       NUMERIC(14,2) CHECK (refund_amount >= 0),
  status              TEXT NOT NULL DEFAULT 'REQUESTED'
                      CHECK (status IN ('REQUESTED','UNDER_REVIEW','APPROVED','REJECTED',
                                        'PICKUP_SCHEDULED','RECEIVED','INSPECTED','REFUNDED','DISPUTED')),
  reverse_shipment_id BIGINT REFERENCES shipments(id) ON DELETE SET NULL,
  reviewed_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  window_expires_at   TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE return_items (
  id                  BIGSERIAL PRIMARY KEY,
  return_id           BIGINT NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  order_item_id       BIGINT NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  condition_on_receipt TEXT CHECK (condition_on_receipt IN ('SELLABLE','DAMAGED','UNUSABLE','NOT_RECEIVED')),
  refund_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  restocked           BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE dispute_threads (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,              -- DSP-2R6Y1LM5
  return_id           BIGINT REFERENCES return_requests(id) ON DELETE RESTRICT,
  sub_order_id        BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  customer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  saler_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  moderator_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  disputed_amount     NUMERIC(14,2) NOT NULL CHECK (disputed_amount >= 0),
  outcome             TEXT CHECK (outcome IN ('FULL_REFUND','PARTIAL_REFUND','REPLACEMENT',
                                              'REJECTED','SPLIT_LIABILITY')),
  outcome_split_json  JSONB,                             -- who bears what share
  status              TEXT NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN','AWAITING_CUSTOMER','AWAITING_SELLER',
                                        'UNDER_ARBITRATION','ESCALATED','RESOLVED','CLOSED')),
  sla_due_at          TIMESTAMPTZ,
  escalated_at        TIMESTAMPTZ,
  resolved_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE dispute_messages (
  id                  BIGSERIAL PRIMARY KEY,
  dispute_id          BIGINT NOT NULL REFERENCES dispute_threads(id) ON DELETE CASCADE,
  sender_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sender_role         TEXT NOT NULL CHECK (sender_role IN ('CUSTOMER','SALER','SUPPLIER','MODERATOR')),
  body                TEXT NOT NULL,
  attachments_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_internal_note    BOOLEAN NOT NULL DEFAULT false,    -- moderator-only; must never leak
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE warranty_cards (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  order_item_id       BIGINT NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  customer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  serial_number       TEXT,
  coverage_terms_en   TEXT,
  coverage_terms_bn   TEXT,
  is_transferable     BOOLEAN NOT NULL DEFAULT false,
  starts_at           TIMESTAMPTZ NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_item_id)
);

CREATE TABLE warranty_claims (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  warranty_card_id    BIGINT NOT NULL REFERENCES warranty_cards(id) ON DELETE RESTRICT,
  customer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issue_description   TEXT NOT NULL,
  evidence_media_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution          TEXT CHECK (resolution IN ('REPAIR','REPLACE','REFUND','REJECTED')),
  status              TEXT NOT NULL DEFAULT 'SUBMITTED'
                      CHECK (status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED',
                                        'IN_PROGRESS','COMPLETED','ESCALATED')),
  reverse_shipment_id BIGINT REFERENCES shipments(id) ON DELETE SET NULL,
  sla_due_at          TIMESTAMPTZ,
  decided_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);
```

---

## 7. Engagement — 18 tables (+3 Prompt 4.6: product_questions, product_question_upvotes, product_answers — Q&A was absent from every earlier draft of this ERD)

```sql
CREATE TABLE reviews (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  order_item_id       BIGINT NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rating              INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title               TEXT,
  body                TEXT,
  is_verified_purchase BOOLEAN NOT NULL DEFAULT true,
  helpful_count       INTEGER NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
  integrity_score     INTEGER CHECK (integrity_score BETWEEN 0 AND 100),
  status              TEXT NOT NULL DEFAULT 'PUBLISHED'
                      CHECK (status IN ('PENDING','PUBLISHED','FLAGGED','REMOVED')),
  coins_awarded       INTEGER NOT NULL DEFAULT 0 CHECK (coins_awarded >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  UNIQUE (order_item_id, user_id)                        -- one review per purchased item
);

CREATE TABLE review_media (
  id                  BIGSERIAL PRIMARY KEY,
  review_id           BIGINT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  media_id            BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  media_kind          TEXT NOT NULL CHECK (media_kind IN ('IMAGE','VIDEO')),
  moderation_status   TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (moderation_status IN ('PENDING','APPROVED','REJECTED')),
  display_order       INTEGER NOT NULL DEFAULT 0
);

-- Product Q&A (Prompt 4.6 — added here; absent from every earlier draft of this ERD).
CREATE TABLE product_questions (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body                TEXT NOT NULL,
  upvote_count        INTEGER NOT NULL DEFAULT 0 CHECK (upvote_count >= 0),
  status              TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','FLAGGED','REMOVED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_question_upvotes (
  question_id         BIGINT NOT NULL REFERENCES product_questions(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, user_id)
);

CREATE TABLE product_answers (               -- responder_id is enforced saler/supplier-only in the service, not a CHECK
  id                  BIGSERIAL PRIMARY KEY,
  question_id         BIGINT NOT NULL REFERENCES product_questions(id) ON DELETE CASCADE,
  responder_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','FLAGGED','REMOVED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE follows (
  follower_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id),
  CONSTRAINT no_self_follow CHECK (follower_id <> followed_id)
);

CREATE TABLE notification_templates (
  key                 TEXT PRIMARY KEY,
  category            TEXT NOT NULL
                      CHECK (category IN ('TRANSACTIONAL','SECURITY','MARKETING','SOCIAL','SYSTEM')),
  priority            TEXT NOT NULL DEFAULT 'NORMAL'
                      CHECK (priority IN ('CRITICAL','HIGH','NORMAL','LOW')),
  default_channels    TEXT[] NOT NULL DEFAULT '{IN_APP}',
  subject_en          TEXT, subject_bn TEXT,
  body_en             TEXT NOT NULL, body_bn TEXT NOT NULL,
  sms_body_en         TEXT, sms_body_bn TEXT,
  variables_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  version             INTEGER NOT NULL DEFAULT 1,
  updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE notifications (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_key        TEXT NOT NULL REFERENCES notification_templates(key) ON DELETE RESTRICT,
  channel             TEXT NOT NULL CHECK (channel IN ('IN_APP','SMS','PUSH','EMAIL','WHATSAPP')),
  data_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
  deep_link           TEXT,
  status              TEXT NOT NULL DEFAULT 'QUEUED'
                      CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED','SUPPRESSED')),
  failure_reason      TEXT,
  retry_count         INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  read_at             TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_preferences (
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category            TEXT NOT NULL,
  channel             TEXT NOT NULL,
  is_enabled          BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start   TIME,
  quiet_hours_end     TIME,
  PRIMARY KEY (user_id, category, channel)
);

CREATE TABLE chat_threads (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  thread_type         TEXT NOT NULL
                      CHECK (thread_type IN ('CUSTOMER_SALER','SALER_SUPPLIER','SUPPORT','WHATSAPP','MESSENGER')),
  participant_a       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_b       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id          BIGINT REFERENCES products(id) ON DELETE SET NULL,
  external_channel_id TEXT,                              -- WhatsApp phone number id
  last_message_at     TIMESTAMPTZ,
  unread_a            INTEGER NOT NULL DEFAULT 0 CHECK (unread_a >= 0),
  unread_b            INTEGER NOT NULL DEFAULT 0 CHECK (unread_b >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT distinct_participants CHECK (participant_a <> participant_b)
);

CREATE TABLE chat_messages (
  id                  BIGSERIAL PRIMARY KEY,
  thread_id           BIGINT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_message_id   TEXT NOT NULL,                     -- client-generated; idempotency
  body                TEXT,
  attachments_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_card_id     BIGINT REFERENCES products(id) ON DELETE SET NULL,
  is_read             BOOLEAN NOT NULL DEFAULT false,
  is_flagged          BOOLEAN NOT NULL DEFAULT false,
  flag_reason         TEXT,                              -- e.g. contact-info sharing
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (thread_id, client_message_id)
);

CREATE TABLE coin_balances (
  user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance             INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned     INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_redeemed   INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_redeemed >= 0),
  checkin_streak      INTEGER NOT NULL DEFAULT 0 CHECK (checkin_streak >= 0),
  last_checkin_date   DATE,
  updated_at          TIMESTAMPTZ
);

-- Coins are a platform LIABILITY. Double-entry, exactly like cash.
CREATE TABLE coin_transactions (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  txn_group_id        UUID NOT NULL,
  entry_type          TEXT NOT NULL CHECK (entry_type IN ('DEBIT','CREDIT')),
  amount              INTEGER NOT NULL CHECK (amount > 0),
  reason              TEXT NOT NULL
                      CHECK (reason IN ('DAILY_CHECKIN','ORDER_COMPLETE','REVIEW','VIDEO_REVIEW',
                                        'REFERRAL','QUEST','REDEMPTION','EXPIRY','ADMIN_ADJUST','REVERSAL')),
  reference_type      TEXT, reference_id BIGINT,
  idempotency_key     TEXT UNIQUE,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quests (
  id                  BIGSERIAL PRIMARY KEY,
  key                 TEXT UNIQUE NOT NULL,
  scope               TEXT NOT NULL CHECK (scope IN ('DAILY','WEEKLY','MILESTONE')),
  target_role         TEXT NOT NULL CHECK (target_role IN ('CUSTOMER','SALER','SUPPLIER','ALL')),
  title_en            TEXT NOT NULL, title_bn TEXT NOT NULL,
  goal_type           TEXT NOT NULL,                     -- ORDERS, SHARES, LISTINGS, REVIEWS …
  goal_value          INTEGER NOT NULL CHECK (goal_value > 0),
  reward_coins        INTEGER NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  reward_ad_credit    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (reward_ad_credit >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quest_progress (
  id                  BIGSERIAL PRIMARY KEY,
  quest_id            BIGINT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key          TEXT NOT NULL,                     -- '2026-08-21' or '2026-W34'
  progress            INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
  completed_at        TIMESTAMPTZ,
  claimed_at          TIMESTAMPTZ,
  UNIQUE (quest_id, user_id, period_key)
);

CREATE TABLE leaderboard_snapshots (        -- nightly rollup; never a live aggregate
  id                  BIGSERIAL PRIMARY KEY,
  period_key          TEXT NOT NULL,                     -- '2026-08'
  metric              TEXT NOT NULL CHECK (metric IN ('REVENUE','ORDERS','RATING')),
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank                INTEGER NOT NULL CHECK (rank > 0),
  value               NUMERIC(14,2) NOT NULL,
  bonus_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_key, metric, user_id)
);

CREATE TABLE referrals (
  id                  BIGSERIAL PRIMARY KEY,
  referrer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referred_id         BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  tier                INTEGER NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 3),
  referral_code       TEXT NOT NULL,
  qualifying_event    TEXT CHECK (qualifying_event IN ('SIGNUP','FIRST_ORDER','FIRST_SALE','KYC')),
  qualified_at        TIMESTAMPTZ,
  fraud_flags_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_suspicious       BOOLEAN NOT NULL DEFAULT false,
  device_fingerprint  TEXT,
  signup_ip           INET,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_referral CHECK (referrer_id <> referred_id)
);

CREATE TABLE referral_earnings (
  id                  BIGSERIAL PRIMARY KEY,
  referral_id         BIGINT NOT NULL REFERENCES referrals(id) ON DELETE RESTRICT,
  beneficiary_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_order_id     BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  tier                INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
  amount              NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  status              TEXT NOT NULL DEFAULT 'HOLDING'
                      CHECK (status IN ('HOLDING','RELEASED','REVERSED','FORFEITED')),
  hold_until          TIMESTAMPTZ NOT NULL,
  released_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 8. Growth & Media — 12 tables

```sql
CREATE TABLE media_assets (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  owner_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  purpose             TEXT NOT NULL
                      CHECK (purpose IN ('PRODUCT','AVATAR','BANNER','STORE_LOGO','REVIEW','UGC_VIDEO',
                                         'KYC','FLYER','STORY','ACADEMY','STREAM_RECORDING','OG_IMAGE')),
  storage_driver      TEXT NOT NULL CHECK (storage_driver IN ('LOCAL','R2')),
  storage_key         TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          BIGINT NOT NULL CHECK (size_bytes > 0),
  width               INTEGER CHECK (width > 0),         -- lets the client reserve space (no CLS)
  height              INTEGER CHECK (height > 0),
  duration_seconds    INTEGER CHECK (duration_seconds >= 0),
  derivatives_json    JSONB NOT NULL DEFAULT '{}'::jsonb, -- {thumb, card, detail} x {avif, webp, jpg}
  poster_media_id     BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  quality_score       INTEGER CHECK (quality_score BETWEEN 0 AND 100),
  quality_flags_json  JSONB NOT NULL DEFAULT '[]'::jsonb, -- screenshot, watermark, low-res
  moderation_status   TEXT NOT NULL DEFAULT 'APPROVED'
                      CHECK (moderation_status IN ('PENDING','APPROVED','REJECTED')),
  checksum_sha256     TEXT,                              -- duplicate detection
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE ad_campaigns (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  advertiser_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name                TEXT NOT NULL,
  objective           TEXT NOT NULL CHECK (objective IN ('TRAFFIC','SALES','AWARENESS')),
  placement           TEXT NOT NULL
                      CHECK (placement IN ('SEARCH','CATEGORY_BANNER','FEED','PRODUCT_PAGE','STORE')),
  targeting_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  bid_amount          NUMERIC(14,2) NOT NULL CHECK (bid_amount > 0),
  daily_budget        NUMERIC(14,2) NOT NULL CHECK (daily_budget > 0),
  total_budget        NUMERIC(14,2) NOT NULL CHECK (total_budget > 0),
  spent_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (spent_amount >= 0),
  quality_score       NUMERIC(5,2) CHECK (quality_score BETWEEN 0 AND 100),
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','PENDING_REVIEW','ACTIVE','PAUSED',
                                        'BUDGET_EXHAUSTED','COMPLETED','REJECTED')),
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  CONSTRAINT never_overspend CHECK (spent_amount <= total_budget)
);

CREATE TABLE ad_creatives (
  id                  BIGSERIAL PRIMARY KEY,
  campaign_id         BIGINT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  product_id          BIGINT REFERENCES products(id) ON DELETE CASCADE,
  media_id            BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  headline_en         TEXT, headline_bn TEXT,
  is_ai_generated     BOOLEAN NOT NULL DEFAULT false,
  approved_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ad_impressions (               -- high volume; partitioned monthly
  id                  BIGSERIAL,
  campaign_id         BIGINT NOT NULL,
  creative_id         BIGINT NOT NULL,
  user_id             BIGINT,
  session_ref         TEXT,
  placement           TEXT NOT NULL,
  is_viewable         BOOLEAN NOT NULL DEFAULT false,    -- viewability-based, not render-based
  is_billable         BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE ad_clicks (
  id                  BIGSERIAL,
  campaign_id         BIGINT NOT NULL,
  creative_id         BIGINT NOT NULL,
  user_id             BIGINT,
  impression_id       BIGINT,
  cost_amount         NUMERIC(14,2) NOT NULL CHECK (cost_amount >= 0),
  is_billable         BOOLEAN NOT NULL DEFAULT true,     -- false for self-clicks / duplicates
  fraud_reason        TEXT,
  converted_order_id  BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE ad_billing (
  id                  BIGSERIAL PRIMARY KEY,
  campaign_id         BIGINT NOT NULL REFERENCES ad_campaigns(id) ON DELETE RESTRICT,
  advertiser_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  clicks_billed       INTEGER NOT NULL DEFAULT 0 CHECK (clicks_billed >= 0),
  amount              NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  ledger_group_id     UUID,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','CHARGED','FAILED','WAIVED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, period_start, period_end)
);

CREATE TABLE live_streams (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  host_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title_en            TEXT NOT NULL, title_bn TEXT NOT NULL,
  provider            TEXT NOT NULL,                     -- decided in prompt.md 10.1
  room_id             TEXT,
  status              TEXT NOT NULL DEFAULT 'SCHEDULED'
                      CHECK (status IN ('SCHEDULED','LIVE','ENDED','TERMINATED','FAILED')),
  scheduled_at        TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  peak_viewers        INTEGER NOT NULL DEFAULT 0 CHECK (peak_viewers >= 0),
  total_viewers       INTEGER NOT NULL DEFAULT 0 CHECK (total_viewers >= 0),
  revenue_amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (revenue_amount >= 0),
  recording_media_id  BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  terminated_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  termination_reason  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE live_stream_products (
  stream_id           BIGINT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  is_pinned           BOOLEAN NOT NULL DEFAULT false,
  display_order       INTEGER NOT NULL DEFAULT 0,
  units_sold          INTEGER NOT NULL DEFAULT 0 CHECK (units_sold >= 0),
  PRIMARY KEY (stream_id, product_id)
);

CREATE TABLE live_stream_messages (
  id                  BIGSERIAL PRIMARY KEY,
  stream_id           BIGINT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body                TEXT NOT NULL,
  is_muted            BOOLEAN NOT NULL DEFAULT false,
  muted_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stories (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  author_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slug                TEXT UNIQUE NOT NULL,
  title_en            TEXT NOT NULL, title_bn TEXT NOT NULL,
  body_en             TEXT, body_bn TEXT,
  cover_media_id      BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  linked_products     BIGINT[] NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','PENDING','PUBLISHED','REJECTED','ARCHIVED')),
  is_featured         BOOLEAN NOT NULL DEFAULT false,
  view_count          INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE academy_courses (
  id                  BIGSERIAL PRIMARY KEY,
  slug                TEXT UNIQUE NOT NULL,
  title_en            TEXT NOT NULL, title_bn TEXT NOT NULL,
  description_en      TEXT, description_bn TEXT,
  cover_media_id      BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  target_role         TEXT NOT NULL CHECK (target_role IN ('SALER','SUPPLIER','ALL')),
  display_order       INTEGER NOT NULL DEFAULT 0,
  is_published        BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE academy_lessons (
  id                  BIGSERIAL PRIMARY KEY,
  course_id           BIGINT NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  title_en            TEXT NOT NULL, title_bn TEXT NOT NULL,
  media_id            BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  body_en             TEXT, body_bn TEXT,
  duration_seconds    INTEGER CHECK (duration_seconds > 0),
  display_order       INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 9. Developer Platform — 3 tables

```sql
CREATE TABLE api_keys (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,
  owner_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name                TEXT NOT NULL,
  key_prefix          TEXT NOT NULL,                     -- shown in the UI: expl_live_a1b2…
  key_hash            TEXT NOT NULL UNIQUE,              -- argon2id of the full key
  scopes              TEXT[] NOT NULL DEFAULT '{}',      -- permission keys from the SAME catalog
  ip_allowlist        INET[],
  rate_limit_per_min  INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_per_min > 0),
  last_used_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  revoked_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_subscriptions (
  id                  BIGSERIAL PRIMARY KEY,
  api_key_id          BIGINT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  target_url          TEXT NOT NULL,
  events              TEXT[] NOT NULL,
  signing_secret      TEXT NOT NULL,                     -- 🔐 encrypted
  is_active           BOOLEAN NOT NULL DEFAULT true,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  disabled_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id                  BIGSERIAL PRIMARY KEY,
  subscription_id     BIGINT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL,
  payload_json        JSONB NOT NULL,
  attempt             INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  response_status     INTEGER,
  response_body       TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','DELIVERED','FAILED','DEAD_LETTER')),
  next_retry_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 10. Index Strategy

**Every foreign key gets an index.** PostgreSQL does not create them automatically, and their
absence turns every `ON DELETE` check into a sequential scan.

Beyond that, indexes exist for measured query paths, not speculatively — each one costs write
throughput and storage.

```sql
-- Catalog browse (the single hottest path)
CREATE INDEX ON products (category_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON products (supplier_id, status)                  WHERE deleted_at IS NULL;
CREATE INDEX ON products USING GIN (search_vector);
CREATE INDEX ON products USING GIN (title_en gin_trgm_ops);     -- typo tolerance
CREATE INDEX ON products USING GIN (title_bn gin_trgm_ops);     -- Bengali typo tolerance
CREATE INDEX ON categories USING GIST (path);                   -- subtree queries

-- Order history
CREATE INDEX ON orders     (customer_id, placed_at DESC);
CREATE INDEX ON sub_orders (supplier_id, status, created_at DESC);
CREATE INDEX ON sub_orders (saler_id,    status, created_at DESC);
CREATE INDEX ON sub_orders (status, delivered_at) WHERE status = 'DELIVERED';

-- Finance
CREATE INDEX ON ledger_transactions (wallet_id, created_at DESC);
CREATE INDEX ON ledger_transactions (txn_group_id);
CREATE INDEX ON ledger_transactions (reference_type, reference_id);
CREATE INDEX ON payout_requests     (status, created_at) WHERE status IN ('REQUESTED','HELD','APPROVED');

-- Chat
CREATE INDEX ON chat_messages (thread_id, created_at DESC);
CREATE INDEX ON chat_threads  (participant_a, last_message_at DESC);
CREATE INDEX ON chat_threads  (participant_b, last_message_at DESC);

-- Work queues — partial indexes keep them tiny regardless of table size
CREATE INDEX ON pending_admin_actions      (status, created_at) WHERE status = 'PENDING';
CREATE INDEX ON permission_grant_requests  (status, created_at) WHERE status = 'PENDING';
CREATE INDEX ON product_approvals          (status, sla_due_at) WHERE status = 'PENDING';
CREATE INDEX ON dispute_threads            (status, sla_due_at) WHERE status <> 'CLOSED';
CREATE INDEX ON return_requests            (status, created_at) WHERE status <> 'REFUNDED';
CREATE INDEX ON notifications              (user_id, created_at DESC) WHERE read_at IS NULL;

-- Geo
CREATE INDEX ON warehouse_nodes USING GIST (point(longitude, latitude)) WHERE is_active;

-- Active-grant resolution (called on nearly every authenticated request)
CREATE INDEX ON user_permission_overrides (user_id) WHERE revoked_at IS NULL;
```

**Extensions required:** `pg_trgm` (fuzzy search), `ltree` (category paths), `pgcrypto` (hashing).

---

## 11. Partitioning

Three tables grow without bound and are partitioned by month on `created_at`:

| Table | Why | Retention |
| :--- | :--- | :--- |
| `ledger_transactions` | Every financial event, forever | Never dropped — detach and archive to cold storage |
| `audit_logs` | Every staff action, forever | Never dropped — detach and archive |
| `ad_impressions` | Highest write volume in the system | Drop partitions after 13 months |

```sql
CREATE TABLE ledger_transactions_2026_08 PARTITION OF ledger_transactions
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
```

A monthly job creates the next **three** months' partitions in advance. A missing partition is an
insert failure, and an insert failure on the ledger is an outage — three months of headroom means
a failed job has to be ignored for a full quarter before it can hurt.

Partitioned tables carry `PRIMARY KEY (id, created_at)` because PostgreSQL requires the partition
key to be part of every unique constraint.

---

## 12. The Ledger Invariant

> **For every wallet, at every moment:**
>
> ```
> SUM(ledger CREDIT) − SUM(ledger DEBIT)  ==  available_balance
>                                            + pending_escrow_balance
>                                            + held_balance
> ```
>
> **And for every `txn_group_id`, debits and credits sum to exactly zero.**

These two statements are the definition of correctness for the entire financial system. The PRD
target of *"100.00% matching ledger balance"* means precisely this, and nothing else.

**How it is enforced**

1. Balance columns are `NUMERIC(14,2)` — exact decimal, no floating point.
2. `ledger_transactions` is append-only; `UPDATE` and `DELETE` are blocked by trigger. A balance is
   corrected by writing a compensating entry, never by editing history.
3. Every mutation runs inside `withTransaction` with `SELECT … FOR UPDATE` on the wallet row.
4. Every vault operation carries an `idempotency_key`, so a retried webhook cannot double-credit.
5. `GET /api/v1/admin/finance/integrity` (Prompt 6.1) verifies both statements across all wallets
   and reports any drift. **It must report zero at all times.** It runs nightly and on demand, and
   drives an alert card on the admin dashboard.
6. Prompt 12.1 adds a property-based test: for any random sequence of valid vault operations, both
   statements must still hold.

**The one permitted exception:** `available_balance` may go negative through a clawback recovery
(`prompt.md` 6.2) when escrow has already been released and the customer's return is approved. Any
other negative balance is a defect, and the integrity check reports it as such.

---

## 13. Migration Policy

### Naming

```
server/src/db/migrations/NNN_snake_case_description.sql
001_identity.sql   002_rbac.sql   003_audit.sql   004_platform_config.sql
005_theme.sql      006_catalog.sql  007_warehouse.sql  008_commerce.sql
009_payments.sql   010_finance.sql  011_logistics.sql  012_returns.sql
013_chat.sql       014_notifications.sql  015_ads.sql  016_promotions.sql
017_referral.sql   018_gamification.sql   019_group_buy.sql  020_live.sql
021_warranty.sql   022_bundles.sql        023_developer.sql  024_content.sql
```

### Rules

1. **Forward-only.** No `down` migrations. A mistake is corrected by a new forward migration.
   Down-migrations create a false sense of safety: they are rarely tested, and they cannot restore
   data that a destructive change already discarded.
2. **Each file runs inside one transaction.** PostgreSQL supports transactional DDL — a partially
   applied migration is never left behind.
3. **Applied migrations are immutable.** Editing a file that has run on any environment is
   forbidden; the runner records a checksum and refuses to proceed if it changed.
4. **Every file opens with a comment** stating what changed and why (Prompt 0.8 convention).
5. **Additive first.** To rename a column: add the new one, backfill, dual-write, switch reads,
   then drop in a later release. Never rename in place on a live table.
6. **Migrations are a separate, reviewable CI step** that runs before the API rollout (Prompt 12.7),
   so a schema failure never takes the application down with it.

---

## 14. Table Count Summary

| Group | Tables |
| :--- | ---: |
| 1. Identity & Access | 17 |
| 2. Platform Configuration | 8 |
| 3. Catalog | 12 |
| 4. Commerce | 12 |
| 5. Finance | 8 |
| 6. Logistics & Support | 8 |
| 7. Engagement | 18 |
| 8. Growth & Media | 12 |
| 9. Developer Platform | 3 |
| **Total** | **98** |

Compared with v1.0's 20 untyped tables — and note that both tables v1.0 referenced without
creating, `platform_settings` (§2) and `warehouse_nodes` (§3), are now defined. Engagement grew
from 15 to 18 in Prompt 4.6: `product_questions`, `product_question_upvotes`, and
`product_answers` (Product Q&A) were absent from every earlier draft of this ERD.

---

## 15. Implementation Checklist

- [ ] Every money column is `NUMERIC(14,2)` — verify against `information_schema.columns`
- [ ] Every timestamp is `TIMESTAMPTZ`, never `TIMESTAMP`
- [ ] Every foreign key declares `ON DELETE` explicitly
- [ ] Every FK column is indexed
- [ ] `ledger_transactions` and `audit_logs` reject `UPDATE` and `DELETE` by trigger
- [ ] `audit_logs` hash chain populated on insert
- [ ] Partitions exist for the current month plus three ahead
- [ ] `pg_trgm`, `ltree` and `pgcrypto` extensions enabled
- [ ] 🔐 columns encrypted; matching `*_hash` columns exist for lookups
- [ ] Ledger integrity endpoint returns zero drift against seed data
- [ ] Migration runner refuses a file whose checksum changed

