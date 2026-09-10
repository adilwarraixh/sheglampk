-- =========================================================
-- 002_product_status.sql — lifecycle states and a nullable price
--
-- is_published was a boolean, which cannot express the difference
-- between "not written yet", "deliberately taken down" and "retired but
-- still referenced by past orders". The brief needs all four.
--
-- price becomes nullable because the supplied catalogue does not carry
-- prices for every product, and inventing one is worse than admitting
-- it is unset. A product without a price cannot be PUBLISHED — enforced
-- below rather than left to the application.
-- =========================================================

DO $$ BEGIN
  CREATE TYPE product_status AS ENUM ('DRAFT','PUBLISHED','UNPUBLISHED','ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE products ADD COLUMN IF NOT EXISTS status product_status NOT NULL DEFAULT 'DRAFT';

-- Carry the existing boolean across so nothing changes visibility on deploy.
UPDATE products SET status = CASE WHEN is_published THEN 'PUBLISHED' ELSE 'UNPUBLISHED' END::product_status
 WHERE status = 'DRAFT';

-- is_published stays as a generated mirror: existing queries keep working,
-- and the two can no longer drift apart.
ALTER TABLE products DROP COLUMN IF EXISTS is_published;
ALTER TABLE products ADD COLUMN is_published boolean
  GENERATED ALWAYS AS (status = 'PUBLISHED') STORED;

ALTER TABLE products ALTER COLUMN price DROP NOT NULL;

-- A published product must be purchasable: it needs a price.
ALTER TABLE products DROP CONSTRAINT IF EXISTS published_needs_price;
ALTER TABLE products ADD CONSTRAINT published_needs_price
  CHECK (status <> 'PUBLISHED' OR price IS NOT NULL);

ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS source text;          -- where the record came from
ALTER TABLE products ADD COLUMN IF NOT EXISTS import_notes text;    -- flagged issues, shown in admin

-- Storefront reads are always "published, by category, newest first".
CREATE INDEX IF NOT EXISTS products_status_idx      ON products (status);
CREATE INDEX IF NOT EXISTS products_status_cat_idx  ON products (status, category_id);
CREATE INDEX IF NOT EXISTS products_featured_idx    ON products (status, is_featured);
CREATE INDEX IF NOT EXISTS products_bestseller_idx  ON products (status, is_bestseller);
CREATE INDEX IF NOT EXISTS products_new_idx         ON products (status, is_new_arrival);

-- Admin search covers name, SKU, brand and subcategory. array_to_string is
-- only STABLE, so tags cannot join this expression index; they get their
-- own GIN index below and are queried with the array operators.
CREATE INDEX IF NOT EXISTS products_search_idx ON products
  USING gin (to_tsvector('simple',
    coalesce(name,'') || ' ' || coalesce(sku,'') || ' ' ||
    coalesce(brand,'') || ' ' || coalesce(subcategory,'')));

CREATE INDEX IF NOT EXISTS products_tags_idx ON products USING gin (tags);

-- Categories need a parent to express subcategories (brief §16).
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id bigint REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS position int NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories (parent_id, position);

-- Order lines keep their own copy of what was bought, so archiving a
-- product never rewrites history (brief §12, §47).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_slug text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image_url text;
