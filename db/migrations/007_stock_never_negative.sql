-- =========================================================
-- 007_stock_never_negative.sql — overselling becomes impossible
--
-- The checkout used to read the stock, then decrement it with
-- GREATEST(0, stock - qty). Two customers buying the last unit at the same
-- moment both passed the read, both "succeeded", and the floor hid the
-- oversell. The checkout now decrements inside one transaction and lets
-- the database refuse a negative result: the second order fails as a whole
-- and the customer is told it has just sold out.
--
-- Existing rows are all >= 0 (the old floor guaranteed it), so the
-- constraints validate immediately.
-- =========================================================

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_nonneg;
ALTER TABLE products ADD CONSTRAINT products_stock_nonneg CHECK (stock_quantity >= 0);

ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS variants_stock_nonneg;
ALTER TABLE product_variants ADD CONSTRAINT variants_stock_nonneg CHECK (stock_quantity >= 0);

-- Lookups the checkout and the admin make by these columns. Tiny tables
-- today; these keep them cheap as orders accumulate.
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items (product_id);
CREATE INDEX IF NOT EXISTS order_items_variant_idx ON order_items (variant_id);
CREATE INDEX IF NOT EXISTS orders_phone_placed_idx ON orders (customer_phone, placed_at DESC);

-- 004 meant to add orders (status, placed_at) but reused the name of 001's
-- orders(status) index, so IF NOT EXISTS skipped it; and it duplicated
-- orders_placed_idx under another name.
CREATE INDEX IF NOT EXISTS orders_status_placed_idx ON orders (status, placed_at DESC);
DROP INDEX IF EXISTS orders_placed_at_idx;
