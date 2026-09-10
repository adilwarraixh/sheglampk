/* =========================================================
   lib/catalogue.js — the public view of the catalogue

   Every storefront read goes through here, and every query filters on
   status = 'PUBLISHED'. DRAFT, UNPUBLISHED and ARCHIVED products are
   invisible to the public by construction rather than by remembering to
   add a WHERE clause at each call site.

   Nothing here returns cost_price, import_notes or any other admin-only
   column — the shape is built explicitly, not SELECT *.
   ========================================================= */
const { sql } = require("../db/client.js");

/* Images and variants are attached in one round trip each rather than
   per product, so a 60-product page is 3 queries, not 121. */
async function attach(products) {
  if (!products.length) return products;
  const ids = products.map((p) => p.id);

  const images = await sql`
    SELECT product_id, variant_id, url, alt, position, is_primary
      FROM product_images WHERE product_id = ANY(${ids})
     ORDER BY product_id, position`;
  const variants = await sql`
    SELECT id, product_id, sku, variant_name, option_name, hex, price, stock_quantity, position, is_available
      FROM product_variants WHERE product_id = ANY(${ids})
     ORDER BY product_id, position`;

  const byProduct = (rows) => rows.reduce((m, r) => {
    (m[r.product_id] = m[r.product_id] || []).push(r); return m;
  }, {});
  const imgs = byProduct(images), vars = byProduct(variants);

  return products.map((p) => {
    const pi = imgs[p.id] || [];
    return {
      ...p,
      price: p.price === null ? null : Number(p.price),
      salePrice: p.sale_price === null ? null : Number(p.sale_price),
      images: pi.map((i) => ({ url: i.url, alt: i.alt, variantId: i.variant_id })),
      image: (pi.find((i) => i.is_primary) || pi[0] || {}).url || null,
      variants: (vars[p.id] || []).map((v) => ({
        id: v.id, name: v.variant_name, option: v.option_name, sku: v.sku, hex: v.hex,
        price: v.price === null ? null : Number(v.price),
        stock: v.stock_quantity, available: v.is_available,
        image: (pi.find((i) => i.variant_id === v.id) || {}).url || null,
      })),
      inStock: p.stock_quantity > 0,
    };
  });
}

/* The Neon HTTP driver only takes bound parameters, not composed SQL
   fragments, so each filter combination is written out rather than
   concatenated — verbose, but injection-proof by construction. */
async function publishedProducts({ category, subcategory, q, flag, limit = 60, offset = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 60, 1), 200);
  offset = Math.max(parseInt(offset, 10) || 0, 0);
  const cat = category || null, sub = subcategory || null;
  const term = q && q.trim() ? `%${q.trim().toLowerCase()}%` : null;
  const wantFeatured = flag === "featured", wantBest = flag === "bestseller";
  const wantNew = flag === "new", wantSale = flag === "sale";

  const rows = await sql`
    SELECT p.id, p.slug, p.sku, p.name, p.brand, p.subcategory,
           p.short_description, p.description, p.finish, p.size,
           p.price, p.sale_price, p.currency,
           p.stock_quantity, p.low_stock_threshold,
           p.is_featured, p.is_bestseller, p.is_new_arrival, p.tags,
           p.seo_title, p.seo_description, p.created_at,
           c.slug AS category_slug, c.name AS category_name,
           count(*) OVER () AS total_count
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.status = 'PUBLISHED'
       AND (${cat}::text  IS NULL OR c.slug = ${cat})
       AND (${sub}::text  IS NULL OR lower(p.subcategory) = lower(${sub}))
       AND (${term}::text IS NULL OR lower(p.name) LIKE ${term}
                                  OR lower(coalesce(p.subcategory,'')) LIKE ${term}
                                  OR lower(coalesce(p.short_description,'')) LIKE ${term})
       AND (${wantFeatured} = false OR p.is_featured)
       AND (${wantBest}     = false OR p.is_bestseller)
       AND (${wantNew}      = false OR p.is_new_arrival)
       AND (${wantSale}     = false OR p.sale_price IS NOT NULL)
     ORDER BY p.is_featured DESC, p.created_at DESC, p.id DESC
     LIMIT ${limit} OFFSET ${offset}`;

  const total = rows.length ? Number(rows[0].total_count) : 0;
  const products = await attach(rows.map(({ total_count, ...r }) => r));
  return { products, total, limit, offset };
}

async function productBySlug(slug) {
  const rows = await sql`
    SELECT p.id, p.slug, p.sku, p.name, p.brand, p.subcategory,
           p.short_description, p.description, p.finish, p.size,
           p.price, p.sale_price, p.currency,
           p.stock_quantity, p.low_stock_threshold,
           p.is_featured, p.is_bestseller, p.is_new_arrival, p.tags,
           p.seo_title, p.seo_description, p.created_at,
           c.slug AS category_slug, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = ${slug} AND p.status = 'PUBLISHED' LIMIT 1`;
  if (!rows.length) return null;
  return (await attach(rows))[0];
}

/* Related: same subcategory first, then same category. Ranked in SQL so
   the caller cannot accidentally leak an unpublished product in. */
async function relatedProducts(product, limit = 4) {
  const rows = await sql`
    SELECT p.id, p.slug, p.sku, p.name, p.brand, p.subcategory,
           p.short_description, p.description, p.finish, p.size,
           p.price, p.sale_price, p.currency, p.stock_quantity, p.low_stock_threshold,
           p.is_featured, p.is_bestseller, p.is_new_arrival, p.tags,
           p.seo_title, p.seo_description, p.created_at,
           c.slug AS category_slug, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.status = 'PUBLISHED' AND p.id <> ${product.id}
     ORDER BY (lower(coalesce(p.subcategory,'')) = lower(${product.subcategory || ""})) DESC,
              (c.slug = ${product.category_slug || ""}) DESC,
              p.is_bestseller DESC, p.id DESC
     LIMIT ${limit}`;
  return attach(rows);
}

/* Categories that actually have something to show. An empty category in
   the nav is a dead end for the customer. */
async function activeCategories() {
  return sql`
    SELECT c.id, c.slug, c.name, c.position,
           count(p.id) FILTER (WHERE p.status = 'PUBLISHED')::int AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
     WHERE c.is_active AND c.parent_id IS NULL
     GROUP BY c.id, c.slug, c.name, c.position
    HAVING count(p.id) FILTER (WHERE p.status = 'PUBLISHED') > 0
     ORDER BY c.position, c.name`;
}

async function subcategoriesFor(categorySlug) {
  return sql`
    SELECT p.subcategory AS name, count(*)::int AS product_count
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.status = 'PUBLISHED' AND p.subcategory IS NOT NULL
       AND (${categorySlug || null}::text IS NULL OR c.slug = ${categorySlug || null})
     GROUP BY p.subcategory ORDER BY p.subcategory`;
}

module.exports = { publishedProducts, productBySlug, relatedProducts, activeCategories, subcategoriesFor, attach };
