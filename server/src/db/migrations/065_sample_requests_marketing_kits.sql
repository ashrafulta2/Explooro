-- 065_sample_requests_marketing_kits.sql (supplier attraction, step 4: Sample Request + Marketing Kit)
--
-- Two things a saler wants before committing to a supplier's product, and a supplier can now offer:
--
--   * a SAMPLE: the saler pays for one unit up front, the supplier ships it, and the money is only
--     released to the supplier once the saler confirms it arrived (or the confirm window runs out).
--     The platform keeps `platform_fee_pct` of the sample price - that is how it earns from this.
--   * a MARKETING KIT: the captions, hashtags, selling points and video the saler needs to actually
--     promote the product. Free; it exists so a saler's first listing is not a blank page.
--
-- Money never leaves the saler's own wallet until it is earned: the sample total is moved from their
-- AVAILABLE bucket to their HELD bucket (one balanced ledger group on the same wallet), and later
-- either released (HELD -> supplier + treasury) or refunded (HELD -> AVAILABLE).

-- 1. What a supplier offers: one sample price per product.
CREATE TABLE IF NOT EXISTS sample_offers (
  id            BIGSERIAL PRIMARY KEY,
  product_id    BIGINT NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  supplier_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price         NUMERIC(14,2) NOT NULL CHECK (price > 0),
  shipping_fee  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sample_offers_supplier ON sample_offers (supplier_id);

-- 2. A saler's request. Price, shipping and the platform's share are SNAPSHOTTED on the row, so a
--    supplier editing the offer later never changes what an open request will pay out.
CREATE TABLE IF NOT EXISTS sample_requests (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  saler_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  price               NUMERIC(14,2) NOT NULL CHECK (price > 0),
  shipping_fee        NUMERIC(14,2) NOT NULL CHECK (shipping_fee >= 0),
  platform_fee        NUMERIC(14,2) NOT NULL CHECK (platform_fee >= 0),
  status              TEXT NOT NULL DEFAULT 'REQUESTED'
                      CHECK (status IN ('REQUESTED','ACCEPTED','SHIPPED','DELIVERED','DECLINED','CANCELLED','EXPIRED')),
  ship_to_name        TEXT NOT NULL,
  ship_to_phone       TEXT NOT NULL,
  ship_to_address     TEXT NOT NULL,
  note                TEXT,
  tracking_note       TEXT,
  decline_reason      TEXT,
  hold_txn_group_id   UUID,
  close_txn_group_id  UUID,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at        TIMESTAMPTZ,
  shipped_at          TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  CONSTRAINT sample_fee_within_price CHECK (platform_fee <= price)
);

-- One sample per saler per product, unless the earlier one fell through. This is what stops a saler
-- farming free stock, and it holds even if two requests race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sample_requests_one_live
  ON sample_requests (saler_id, product_id)
  WHERE status IN ('REQUESTED','ACCEPTED','SHIPPED','DELIVERED');

CREATE INDEX IF NOT EXISTS idx_sample_requests_supplier ON sample_requests (supplier_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_sample_requests_saler ON sample_requests (saler_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_sample_requests_open ON sample_requests (status, requested_at)
  WHERE status IN ('REQUESTED','ACCEPTED','SHIPPED');

-- 3. A supplier's promotional material for one product.
CREATE TABLE IF NOT EXISTS marketing_kits (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  supplier_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption_en      TEXT,
  caption_bn      TEXT,
  hashtags        JSONB NOT NULL DEFAULT '[]'::jsonb,       -- ["#eid", "#panjabi"]
  selling_points  JSONB NOT NULL DEFAULT '[]'::jsonb,       -- ["100% cotton", "Free size"]
  video_url       TEXT,
  is_published    BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_kits_supplier ON marketing_kits (supplier_id);

-- 4. The ledger's category list is a CHECK constraint with a generated name (see 052), so it is found
--    by definition. Re-runnable: skipped once the sample categories are present.
DO $$
DECLARE
  old_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%SAMPLE_HOLD%'
  ) THEN
    RETURN;
  END IF;

  SELECT conname INTO old_name FROM pg_constraint
  WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%VOLUME_INCENTIVE%';
  IF old_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ledger_transactions DROP CONSTRAINT %I', old_name);
  END IF;

  ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_category_check
    CHECK (category IN ('SALE_COMMISSION','SUPPLIER_PAYMENT','ESCROW_LOCK','ESCROW_RELEASE',
                        'CLAWBACK','REFUND','PAYOUT','PAYOUT_FEE','ADJUSTMENT','AD_SPEND',
                        'COIN_REDEMPTION','REFERRAL_BONUS','QUEST_REWARD','COD_SETTLEMENT',
                        'SUBSCRIPTION_FEE','VOLUME_INCENTIVE',
                        'SAMPLE_HOLD','SAMPLE_RELEASE','SAMPLE_REFUND'));
END $$;

-- 5. Business numbers live in platform_settings, never in code. One OBJECT row.
--   platform_fee_pct     share of the SAMPLE PRICE (not the shipping) the platform keeps (0..50)
--   min_price/max_price  bounds on what a supplier may charge for a sample (BDT)
--   max_shipping_fee     highest shipping charge a supplier may add (BDT)
--   response_days        days a supplier has to ship before the request expires and is refunded
--   auto_confirm_days    days after shipping before the money is released without the saler's click
--   max_open_per_saler   samples a saler may have in flight at once (REQUESTED/ACCEPTED/SHIPPED)
--   blocked_grades       scorecard grades that may not offer samples
--   max_hashtags / max_selling_points / caption_max_chars   limits on a marketing kit
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'supplier.sample_kit',
    '{
      "platform_fee_pct": 10,
      "min_price": 10,
      "max_price": 5000,
      "max_shipping_fee": 300,
      "response_days": 3,
      "auto_confirm_days": 10,
      "max_open_per_saler": 3,
      "blocked_grades": ["D"],
      "max_hashtags": 15,
      "max_selling_points": 8,
      "caption_max_chars": 1000
    }'::jsonb,
    'OBJECT',
    'Sample request and marketing kit rules',
    'স্যাম্পল অনুরোধ ও মার্কেটিং কিটের নিয়ম',
    'scorecard',
    false
  )
ON CONFLICT (key) DO NOTHING;

-- 6. Notification templates. WHY rows here as well as in DEFAULT_TEMPLATES: `notifications.template_key`
--    is a foreign key to this table, and nothing copies the in-code defaults into it, so a template that
--    exists only in code fails the insert. (Found by running a real request, not by reading the code.)
INSERT INTO notification_templates
  (template_key, category, priority, title_en, title_bn, body_template_en, body_template_bn, default_channels, can_override_preferences)
VALUES
  ('SAMPLE_REQUESTED', 'ORDER', 'NORMAL',
   'A saler asked for a sample', 'একজন সেলার স্যাম্পল চেয়েছেন',
   'Sample request for {{productTitleEn}}. Accept or ship it within {{days}} days or it expires and the saler is refunded.',
   '{{productTitleBn}}-এর স্যাম্পলের অনুরোধ এসেছে। {{days}} দিনের মধ্যে গ্রহণ বা পাঠান, না হলে মেয়াদ শেষ হয়ে সেলারকে টাকা ফেরত দেওয়া হবে।',
   '["INAPP"]'::jsonb, true),
  ('SAMPLE_UPDATED', 'ORDER', 'NORMAL',
   'Sample update', 'স্যাম্পলের আপডেট',
   'Your sample of {{productTitleEn}} {{statusEn}}.',
   '{{productTitleBn}}-এর স্যাম্পল {{statusBn}}।',
   '["INAPP"]'::jsonb, true)
ON CONFLICT (template_key) DO NOTHING;
