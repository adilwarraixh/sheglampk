-- =========================================================
-- 010_collection_name_rule.sql — "every product whose name starts with…"
--
-- The Camera On Edit used to include every product named "Camera On …"
-- (data/catalog.js). 009 froze the ones that existed into hand-picks, so
-- a new Camera On product would no longer join by itself. A collection
-- can now also include every published product whose name starts with
-- include_name_prefix. Like a pick, it stands on its own: it is not
-- combined with the category/subcategory/price rules.
--
-- The Camera On picks it replaces are removed; membership is unchanged.
-- =========================================================
ALTER TABLE collections ADD COLUMN IF NOT EXISTS include_name_prefix text;
ALTER TABLE collections DROP CONSTRAINT IF EXISTS collections_name_prefix_length;
ALTER TABLE collections ADD CONSTRAINT collections_name_prefix_length
  CHECK (include_name_prefix IS NULL OR length(include_name_prefix) BETWEEN 2 AND 60);

UPDATE collections SET include_name_prefix = 'Camera On'
 WHERE slug = 'camera-on-complexion' AND include_name_prefix IS NULL;

DELETE FROM product_collections pc
 USING collections c, products p
 WHERE pc.collection_id = c.id AND pc.product_id = p.id
   AND c.slug = 'camera-on-complexion' AND c.include_name_prefix = 'Camera On'
   AND p.name LIKE 'Camera On%';
