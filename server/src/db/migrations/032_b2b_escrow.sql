-- 032_b2b_escrow.sql (Prompt 10.6)
-- Implements B2B Wholesale Escrow Holding & Milestone Settlement (§AG) per docs/erd.md & prompt.md 10.6.

-- 1. Ensure b2b_escrow_deals table for wholesale bulk contracts
CREATE TABLE IF NOT EXISTS b2b_escrow_deals (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,                  -- B2B-8M3K9P1W
  title_en              TEXT NOT NULL,
  title_bn              TEXT NOT NULL,
  sub_order_id          BIGINT REFERENCES sub_orders(id) ON DELETE SET NULL,
  buyer_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supplier_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  total_amount          NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
  released_amount       NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (released_amount >= 0),
  refunded_amount       NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (refunded_amount >= 0),
  frozen_amount         NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (frozen_amount >= 0),
  status                TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'PENDING_BUYER_ACCEPTANCE', 'PENDING_SUPPLIER_ACCEPTANCE', 'LOCKED_IN_ESCROW', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED', 'CANCELLED')),
  agreed_terms_hash     TEXT,                                  -- SHA-256 hash of immutable terms & schedule
  contract_terms_json   JSONB,                                 -- Snapshot of delivery terms, QA specs, warranty, penalties
  buyer_signed_at       TIMESTAMPTZ,
  supplier_signed_at    TIMESTAMPTZ,
  dispute_id            BIGINT REFERENCES dispute_threads(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_b2b_deals_buyer ON b2b_escrow_deals (buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_b2b_deals_supplier ON b2b_escrow_deals (supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_b2b_deals_ref ON b2b_escrow_deals (ref);
CREATE INDEX IF NOT EXISTS idx_b2b_deals_sub_order ON b2b_escrow_deals (sub_order_id);

-- 2. Enhance b2b_escrow_milestones table to reference deal_id
ALTER TABLE b2b_escrow_milestones ADD COLUMN IF NOT EXISTS deal_id BIGINT REFERENCES b2b_escrow_deals(id) ON DELETE CASCADE;
ALTER TABLE b2b_escrow_milestones ALTER COLUMN sub_order_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_b2b_milestones_deal ON b2b_escrow_milestones (deal_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_b2b_milestones_status ON b2b_escrow_milestones (status);

-- 3. Register b2b_escrow platform module
INSERT INTO platform_modules (
  key,
  group_key,
  label_en,
  label_bn,
  description_en,
  description_bn,
  is_enabled,
  depends_on,
  settings_json,
  created_at
) VALUES (
  'b2b_escrow',
  'finance',
  'B2B Wholesale Escrow & Milestone Settlement',
  'বিটুবি পাইকারি এসক্রো ও মাইলস্টোন সেটেলমেন্ট',
  'Multi-stage milestone escrow holding for large-value bulk wholesale orders with evidence validation, maker-checker admin reviews, and dispute freezing.',
  'প্রমাণ যাচাই, মেকার-চেকার অ্যাডমিন অনুমোদন এবং বিরোধ নিষ্পত্তিসহ বৃহৎ পাইকারি অর্ডারের জন্য বহু-পর্যায়ের মাইলস্টোন এসক্রো ব্যবস্থা।',
  true,
  ARRAY['vault']::text[],
  '{
    "min_deal_amount": 5000.00,
    "maker_checker_above_amount": 50000.00,
    "max_milestones_count": 10,
    "default_milestone_template": [
      { "sequence_no": 1, "release_pct": 30.0, "evidence_required": "NONE", "label_en": "Order Confirmation & Material Sourcing", "label_bn": "অর্ডার নিশ্চিতকরণ ও কাঁচামাল সংগ্রহ" },
      { "sequence_no": 2, "release_pct": 40.0, "evidence_required": "DISPATCH_PROOF", "label_en": "Factory Dispatch & Bill of Lading", "label_bn": "কারখানা থেকে প্রেরণ ও চালান" },
      { "sequence_no": 3, "release_pct": 30.0, "evidence_required": "INSPECTION", "label_en": "Warehouse Quality Inspection & Final Acceptance", "label_bn": "গুদাম গুণমান পরিদর্শন ও চূড়ান্ত গ্রহণ" }
    ]
  }'::jsonb,
  now()
) ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  label_bn = EXCLUDED.label_bn,
  description_en = EXCLUDED.description_en,
  description_bn = EXCLUDED.description_bn;
