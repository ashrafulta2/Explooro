-- 096_supplier_flash_sales.sql — a supplier runs a flash sale on their own product and pays for it.
--
-- Owner decision 2026-10-31:
--   * A supplier may start a flash sale on their own product, live at once if it fits the limits an
--     admin sets (flash_sale.supplier_rules below); an admin can still emergency-stop it.
--   * The supplier funds the whole discount: the platform's and the partner pool's share of each unit
--     stay what they are at the regular retail price, and the supplier is paid that much less
--     (pricing.service calculateSupplierFundedBreakdown). Deals an admin creates stay PLATFORM-funded.
--   * A product must have sold at its current retail price for `min_listing_days` before a supplier
--     can discount it, so a struck price is always one shoppers were really charged, and listing an
--     old product again as "new" cannot dodge the funding.

-- Who pays the discount. Existing (admin-made) deals keep their old behaviour.
ALTER TABLE flash_sales
  ADD COLUMN IF NOT EXISTS funded_by TEXT NOT NULL DEFAULT 'PLATFORM'
    CHECK (funded_by IN ('PLATFORM', 'SUPPLIER'));

-- WHY a timestamp, not products.created_at: a supplier could otherwise raise the price, wait out the
-- window on the product's age, and discount back to the old price. Any retail change restarts it.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS retail_price_since TIMESTAMPTZ;

UPDATE products SET retail_price_since = COALESCE(created_at, now()) WHERE retail_price_since IS NULL;

ALTER TABLE products ALTER COLUMN retail_price_since SET DEFAULT now();
ALTER TABLE products ALTER COLUMN retail_price_since SET NOT NULL;

-- A trigger, not service code: retail is written from several paths (product edit, admin re-price,
-- seeds), and every one of them must restart the clock.
CREATE OR REPLACE FUNCTION products_touch_retail_price_since() RETURNS trigger AS $$
BEGIN
  IF NEW.default_retail_price IS DISTINCT FROM OLD.default_retail_price THEN
    NEW.retail_price_since := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_retail_price_since ON products;
CREATE TRIGGER trg_products_retail_price_since
  BEFORE UPDATE OF default_retail_price ON products
  FOR EACH ROW EXECUTE FUNCTION products_touch_retail_price_since();

-- The limits a supplier's flash sale must fit. Edited at /admin/growth/campaigns, read only by
-- services/supplierFlashSale.service.ts (RULE_LIMITS there bounds every field).
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, updated_at)
VALUES ('flash_sale.supplier_rules',
        '{"enabled": true, "max_discount_pct": 50, "max_duration_hours": 72, "max_live_deals": 5, "min_listing_days": 7}'::jsonb,
        'OBJECT', 'Supplier flash sale limits', 'সাপ্লায়ারের ফ্ল্যাশ সেলের সীমা', 'growth', now())
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_flash_sales_created_by ON flash_sales (created_by, status);
