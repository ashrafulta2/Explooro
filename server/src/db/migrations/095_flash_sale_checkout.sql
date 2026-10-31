-- 095_flash_sale_checkout.sql — checkout charges a live flash sale's price (flashSale.service.ts).
--
-- WHY a column on order_items: a flash sale's per_user_limit counts what the customer has already
-- bought at the deal price, across orders. Nothing recorded which order lines were flash lines, so
-- the limit could only ever be checked within one cart. A cancelled order gives its units back to
-- the deal (order.repository.ts restoreStock), which also needs to know which deal they came from.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS flash_sale_id BIGINT REFERENCES flash_sales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_flash_sale
  ON order_items (flash_sale_id) WHERE flash_sale_id IS NOT NULL;
