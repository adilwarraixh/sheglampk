-- =========================================================
-- 006_published_at.sql — "New" is worked out from when a product went live
--
-- New arrivals were a checkbox nobody had to tick, so products added in
-- the portal never reached the homepage's New in section, and the ones
-- that were ticked stayed "new" for ever. A product is now New for a
-- fixed time after it is first published (lib/catalogue.js), which needs
-- to know when that was.
--
-- published_at is stamped by a trigger rather than by the application, so
-- every path that publishes — the product form, the Publish action, the
-- CSV import, scripts — records it without having to remember to. It is
-- the FIRST publish: taking a product down and putting it back does not
-- make it new again.
-- =========================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS published_at timestamptz;

CREATE OR REPLACE FUNCTION stamp_published_at() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'PUBLISHED' AND NEW.published_at IS NULL THEN
    NEW.published_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_published_at ON products;
CREATE TRIGGER products_published_at BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION stamp_published_at();

-- The two backfills below must not count as edits: with the touch trigger
-- on, every product would show as updated just now.
ALTER TABLE products DISABLE TRIGGER products_touch;

-- Products already live went live when they were created; nothing better
-- is recorded.
UPDATE products SET published_at = created_at
 WHERE status = 'PUBLISHED' AND published_at IS NULL;

-- is_new_arrival now means "keep this New after its first month". The
-- ticks set under the old meaning would pin those products as New for
-- ever, so they are cleared — and listed in the audit log first, so any
-- that should stay pinned can be ticked again.
INSERT INTO audit_logs (actor_username, action, target_type, detail)
SELECT 'system', 'NEW_ARRIVAL_TICKS_CLEARED', 'catalogue',
       jsonb_build_object(
         'reason', 'New is now worked out from the publish date (migration 006)',
         'products', jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY id))
  FROM products WHERE is_new_arrival
HAVING count(*) > 0;

UPDATE products SET is_new_arrival = false WHERE is_new_arrival;

ALTER TABLE products ENABLE TRIGGER products_touch;
