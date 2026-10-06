-- =========================================================
-- 009_indexes_search_collections_media.sql
--
-- Index cleanup. Indexes are judged by the queries in lib/*, not by scan
-- counts (the tables are small enough that Postgres reads them whole).
--   dropped: status-only and status+flag indexes on products (status alone
--     is the start of products_status_cat_idx; a yes/no flag narrows
--     nothing), lower(name) and tags (no query uses either), and
--     orders_status_idx (the start of orders_status_placed_idx).
--   added: a customer's orders (lib/admin-data.js customerDetail), images
--     by shade (removing a shade checks them), and a collection's products.
--
-- Full-text search. A stored, weighted search column with English
-- stemming ("blushes" finds "Blush"): name, SKU and brand count most,
-- then subcategory and finish, then the short description. It replaces
-- products_search_idx, which no query ever used.
--
-- Collections. The tables have existed since 001 but were never used; the
-- shop's four collections were rules in data/catalog.js. A collection is
-- now its hand-picked products PLUS, optionally, every published product
-- matching all of its rules (a category, any of some subcategories, a
-- price under a figure). The four are seeded so they show exactly what
-- they show today, and keep following price and range changes.
--
-- Media. Images move to Vercel Blob (lib/media.js). blob_url is where
-- each now lives; bytes stay until the move is verified, so a rollback
-- is a URL change.
-- =========================================================

-- ---------- index cleanup ----------
DROP INDEX IF EXISTS products_status_idx;
DROP INDEX IF EXISTS products_bestseller_idx;
DROP INDEX IF EXISTS products_featured_idx;
DROP INDEX IF EXISTS products_new_idx;
DROP INDEX IF EXISTS products_name_idx;
DROP INDEX IF EXISTS products_tags_idx;
DROP INDEX IF EXISTS orders_status_idx;

CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS product_images_variant_idx ON product_images (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_collections_collection_idx ON product_collections (collection_id);

-- ---------- full-text search ----------
DROP INDEX IF EXISTS products_search_idx;
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
     setweight(to_tsvector('english', coalesce(name, '')), 'A')
  || setweight(to_tsvector('simple',  coalesce(sku, '') || ' ' || coalesce(brand, '')), 'A')
  || setweight(to_tsvector('english', coalesce(subcategory, '') || ' ' || coalesce(finish, '')), 'B')
  || setweight(to_tsvector('english', coalesce(short_description, '')), 'C')
) STORED;
CREATE INDEX IF NOT EXISTS products_search_vector_idx ON products USING gin (search_vector);

-- ---------- collections ----------
ALTER TABLE collections ADD COLUMN IF NOT EXISTS rule_category_id   bigint REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE collections ADD COLUMN IF NOT EXISTS rule_subcategories text[];
ALTER TABLE collections ADD COLUMN IF NOT EXISTS rule_price_under   numeric(10,2) CHECK (rule_price_under > 0);
ALTER TABLE collections ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();
ALTER TABLE collections DROP CONSTRAINT IF EXISTS collections_slug_format;
ALTER TABLE collections ADD CONSTRAINT collections_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE collections DROP CONSTRAINT IF EXISTS collections_tint_format;
ALTER TABLE collections ADD CONSTRAINT collections_tint_format CHECK (tint IS NULL OR tint ~ '^#[0-9a-fA-F]{6}$');

INSERT INTO collections (slug, title, subtitle, blurb, tint, position, rule_subcategories)
VALUES ('camera-on-complexion', 'The Camera On Edit', 'Blur, set, lock',
        'The three-step base that survives flash photography, mehndi lights and a full day of heat.',
        '#171717', 1, ARRAY['Setting Spray'])
ON CONFLICT (slug) DO NOTHING;
INSERT INTO product_collections (product_id, collection_id)
SELECT p.id, c.id FROM products p, collections c
 WHERE c.slug = 'camera-on-complexion' AND p.name LIKE 'Camera On%'
ON CONFLICT DO NOTHING;

INSERT INTO collections (slug, title, subtitle, blurb, tint, position, rule_subcategories)
VALUES ('blush-bar', 'The Blush Bar', 'Liquid, cream, powder',
        'Every blush texture in the range, from a sheer glassy stick to a full-pigment liquid.',
        '#e83e70', 2, ARRAY['Blush', 'Highlighter'])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO collections (slug, title, subtitle, blurb, tint, position, rule_category_id)
VALUES ('peel-and-reveal', 'Peel & Reveal Lips', 'Stains that survive chai',
        'Peel-off stains, blur pens and glossy tints built to outlast a long lunch.',
        '#b32a55', 3, (SELECT id FROM categories WHERE slug = 'lips'))
ON CONFLICT (slug) DO NOTHING;

INSERT INTO collections (slug, title, subtitle, blurb, tint, position, rule_price_under)
VALUES ('under-2000', 'Everything Under Rs. 2,000', 'Build a kit for less',
        'A full face of makeup that leaves change from a five thousand rupee note.',
        '#3d3d3d', 4, 2000)
ON CONFLICT (slug) DO NOTHING;

-- ---------- media ----------
ALTER TABLE media ADD COLUMN IF NOT EXISTS blob_url text;
ALTER TABLE media ALTER COLUMN bytes DROP NOT NULL;
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_stored_somewhere;
ALTER TABLE media ADD CONSTRAINT media_stored_somewhere CHECK (bytes IS NOT NULL OR blob_url IS NOT NULL);
