/* =========================================================
   lib/products-admin.js — catalogue writes for the admin portal

   Separate from lib/catalogue.js on purpose: that module is the public
   read path and hard-filters to PUBLISHED. This one sees every status,
   so it must only ever be reached through guard() with a products:*
   permission.

   Nothing here trusts the client for anything structural — status is
   validated against the enum, slugs are regenerated and de-duplicated
   server-side, and numbers are coerced and range-checked.
   ========================================================= */
const { sql } = require("../db/client.js");

const STATUSES = ["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"];

const slugify = (s) => String(s || "").toLowerCase().replace(/['’]/g, "").replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/* A slug is a URL. Two products cannot share one, and changing an
   existing product's slug would break links already in the wild, so a
   collision gets a suffix rather than overwriting. */
async function uniqueSlug(desired, excludeId = null) {
  const base = slugify(desired) || "product";
  let candidate = base;
  for (let n = 2; n < 200; n++) {
    const clash = await sql`
      SELECT id FROM products WHERE slug = ${candidate}
        AND (${excludeId}::bigint IS NULL OR id <> ${excludeId}) LIMIT 1`;
    if (!clash.length) return candidate;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

function num(v, { min = 0, max = 1e9, allowNull = false } = {}) {
  if (v === "" || v === null || v === undefined) {
    if (allowNull) return null;
    return 0;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("Expected a number");
  return Math.min(Math.max(n, min), max);
}

function clean(s, max = 5000) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t === "" ? null : t.slice(0, max);
}

/* ---------- read (all statuses) ---------- */
async function adminList({ q, status, category, stock, flag, sort, limit = 25, offset = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  offset = Math.max(parseInt(offset, 10) || 0, 0);
  const term = q && String(q).trim() ? `%${String(q).trim().toLowerCase()}%` : null;
  const st = STATUSES.includes(status) ? status : null;
  const cat = clean(category);
  const lowOnly = stock === "low", outOnly = stock === "out", inOnly = stock === "in";
  const wantFeatured = flag === "featured", wantBest = flag === "bestseller";
  const wantNew = flag === "new", wantSale = flag === "sale";

  /* ORDER BY cannot be a bound parameter, and this driver has no way to
     splice raw SQL. So the sort key is bound and selected between with
     CASE — no user text ever reaches the statement. */
  const s = ["updated", "name", "name-desc", "price", "price-desc", "stock", "newest"]
    .includes(sort) ? sort : "updated";

  const rows = await sql`
    SELECT p.id, p.slug, p.sku, p.name, p.status, p.price, p.sale_price, p.currency,
           p.stock_quantity, p.low_stock_threshold, p.subcategory,
           p.is_featured, p.is_bestseller, p.is_new_arrival,
           p.updated_at, p.import_notes,
           c.name AS category_name, c.slug AS category_slug,
           (SELECT url FROM product_images i WHERE i.product_id = p.id
             ORDER BY i.is_primary DESC, i.position LIMIT 1) AS image,
           (SELECT count(*)::int FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
           count(*) OVER () AS total_count
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE (${st}::text   IS NULL OR p.status = ${st}::product_status)
       AND (${cat}::text  IS NULL OR c.slug = ${cat})
       AND (${term}::text IS NULL OR lower(p.name) LIKE ${term}
                                  OR lower(coalesce(p.sku,'')) LIKE ${term}
                                  OR lower(coalesce(p.brand,'')) LIKE ${term}
                                  OR lower(coalesce(p.subcategory,'')) LIKE ${term}
                                  OR lower(coalesce(c.name,'')) LIKE ${term}
                                  OR EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE lower(t) LIKE ${term}))
       AND (${lowOnly} = false OR (p.stock_quantity > 0 AND p.stock_quantity <= p.low_stock_threshold))
       AND (${outOnly} = false OR p.stock_quantity = 0)
       AND (${inOnly}  = false OR p.stock_quantity > p.low_stock_threshold)
       AND (${wantFeatured} = false OR p.is_featured)
       AND (${wantBest}     = false OR p.is_bestseller)
       AND (${wantNew}      = false OR p.is_new_arrival)
       AND (${wantSale}     = false OR p.sale_price IS NOT NULL)
     ORDER BY
       CASE WHEN ${s} = 'name'       THEN lower(p.name) END ASC,
       CASE WHEN ${s} = 'name-desc'  THEN lower(p.name) END DESC,
       CASE WHEN ${s} = 'price'      THEN p.price END ASC NULLS LAST,
       CASE WHEN ${s} = 'price-desc' THEN p.price END DESC NULLS LAST,
       CASE WHEN ${s} = 'stock'      THEN p.stock_quantity END ASC,
       CASE WHEN ${s} = 'newest'     THEN p.created_at END DESC,
       p.updated_at DESC, p.id DESC
     LIMIT ${limit} OFFSET ${offset}`;

  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { products: rows.map(({ total_count, ...r }) => r), total, limit, offset };
}

async function adminGet(id) {
  const rows = await sql`
    SELECT p.*, c.slug AS category_slug, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ${id} LIMIT 1`;
  if (!rows.length) return null;
  const product = rows[0];
  product.variants = await sql`
    SELECT id, sku, variant_name, option_name, hex, price, stock_quantity, position, is_available
      FROM product_variants WHERE product_id = ${id} ORDER BY position`;
  product.images = await sql`
    SELECT id, variant_id, url, alt, position, is_primary
      FROM product_images WHERE product_id = ${id} ORDER BY position`;
  return product;
}

async function categories() {
  return sql`
    SELECT c.id, c.slug, c.name, c.parent_id, c.position, c.is_active,
           (SELECT count(*)::int FROM products p WHERE p.category_id = c.id) AS product_count
      FROM categories c ORDER BY c.position, c.name`;
}

async function subcategories() {
  const rows = await sql`
    SELECT DISTINCT subcategory AS name FROM products
     WHERE subcategory IS NOT NULL ORDER BY subcategory`;
  return rows.map((r) => r.name);
}

/* ---------- write ---------- */
function normalise(body) {
  const name = clean(body.name, 200);
  if (!name) throw new Error("Product name is required");

  const status = STATUSES.includes(body.status) ? body.status : "DRAFT";
  const price = num(body.price, { allowNull: true, max: 10000000 });
  const salePrice = num(body.salePrice, { allowNull: true, max: 10000000 });

  if (status === "PUBLISHED" && price === null)
    throw new Error("A published product needs a price. Set one, or save it as a draft.");
  if (salePrice !== null && price !== null && salePrice >= price)
    throw new Error("The sale price must be lower than the regular price.");

  return {
    name,
    status,
    price,
    salePrice,
    sku: clean(body.sku, 60),
    brand: clean(body.brand, 80) || "SHEGLAM",
    categoryId: body.categoryId ? num(body.categoryId) : null,
    subcategory: clean(body.subcategory, 80),
    shortDescription: clean(body.shortDescription, 400),
    description: clean(body.description, 20000),
    finish: clean(body.finish, 80),
    size: clean(body.size, 60),
    currency: clean(body.currency, 8) || "PKR",
    stockQuantity: num(body.stockQuantity, { max: 1000000 }),
    lowStockThreshold: num(body.lowStockThreshold, { max: 100000 }),
    isFeatured: !!body.isFeatured,
    isBestseller: !!body.isBestseller,
    isNewArrival: !!body.isNewArrival,
    tags: Array.isArray(body.tags) ? body.tags.map((t) => clean(t, 40)).filter(Boolean).slice(0, 25) : [],
    seoTitle: clean(body.seoTitle, 200),
    seoDescription: clean(body.seoDescription, 400),
    ingredients: clean(body.ingredients, 5000),
    slugRequest: clean(body.slug, 100),
  };
}

async function createProduct(body) {
  const d = normalise(body);
  const slug = await uniqueSlug(d.slugRequest || d.name);
  const rows = await sql`
    INSERT INTO products
      (slug, sku, name, brand, category_id, subcategory, short_description, description,
       finish, size, price, sale_price, currency, stock_quantity, low_stock_threshold,
       status, is_featured, is_bestseller, is_new_arrival, tags,
       seo_title, seo_description, ingredients, source)
    VALUES
      (${slug}, ${d.sku}, ${d.name}, ${d.brand}, ${d.categoryId}, ${d.subcategory},
       ${d.shortDescription || autoShort(d.description)}, ${d.description},
       ${d.finish}, ${d.size}, ${d.price}, ${d.salePrice}, ${d.currency},
       ${d.stockQuantity}, ${d.lowStockThreshold}, ${d.status}::product_status,
       ${d.isFeatured}, ${d.isBestseller}, ${d.isNewArrival}, ${d.tags},
       ${d.seoTitle || d.name + " — SHEGLAM PK"}, ${d.seoDescription || autoShort(d.description)},
       ${d.ingredients}, 'admin')
    RETURNING id, slug, name, status`;
  const product = rows[0];
  await replaceVariants(product.id, body.variants);
  await replaceImages(product.id, body.images);
  return product;
}

async function updateProduct(id, body) {
  const d = normalise(body);
  const existing = await sql`SELECT slug FROM products WHERE id = ${id} LIMIT 1`;
  if (!existing.length) throw new Error("Product not found");

  // Only re-slug when the admin actually asked for a different one.
  const slug = d.slugRequest && slugify(d.slugRequest) !== existing[0].slug
    ? await uniqueSlug(d.slugRequest, id)
    : existing[0].slug;

  const rows = await sql`
    UPDATE products SET
      slug = ${slug}, sku = ${d.sku}, name = ${d.name}, brand = ${d.brand},
      category_id = ${d.categoryId}, subcategory = ${d.subcategory},
      short_description = ${d.shortDescription || autoShort(d.description)},
      description = ${d.description}, finish = ${d.finish}, size = ${d.size},
      price = ${d.price}, sale_price = ${d.salePrice}, currency = ${d.currency},
      stock_quantity = ${d.stockQuantity}, low_stock_threshold = ${d.lowStockThreshold},
      status = ${d.status}::product_status,
      is_featured = ${d.isFeatured}, is_bestseller = ${d.isBestseller},
      is_new_arrival = ${d.isNewArrival}, tags = ${d.tags},
      seo_title = ${d.seoTitle}, seo_description = ${d.seoDescription},
      ingredients = ${d.ingredients},
      archived_at = CASE WHEN ${d.status} = 'ARCHIVED' THEN coalesce(archived_at, now()) ELSE NULL END,
      updated_at = now()
    WHERE id = ${id}
    RETURNING id, slug, name, status`;

  if (body.variants !== undefined) await replaceVariants(id, body.variants);
  if (body.images !== undefined) await replaceImages(id, body.images);
  return rows[0];
}

const autoShort = (desc) => {
  if (!desc) return null;
  const t = String(desc).replace(/\s+/g, " ").trim();
  return t.length <= 155 ? t : t.slice(0, 155).replace(/\s\S*$/, "") + "…";
};

/* Variants are replaced wholesale, but rows referenced by an order line
   are kept so historical orders still resolve their shade. */
async function replaceVariants(productId, variants) {
  if (!Array.isArray(variants)) return;
  const keep = await sql`
    SELECT DISTINCT v.id FROM product_variants v
      JOIN order_items i ON i.variant_id = v.id WHERE v.product_id = ${productId}`;
  const keepIds = keep.map((k) => k.id);

  if (keepIds.length) {
    await sql`DELETE FROM product_variants WHERE product_id = ${productId} AND id <> ALL(${keepIds})`;
  } else {
    await sql`DELETE FROM product_variants WHERE product_id = ${productId}`;
  }

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i] || {};
    const name = clean(v.name, 120);
    if (!name) continue;
    const price = num(v.price, { allowNull: true, max: 10000000 });
    if (v.id && keepIds.includes(Number(v.id))) {
      await sql`
        UPDATE product_variants SET variant_name = ${name}, option_name = ${clean(v.option, 40) || "Shade"},
               hex = ${clean(v.hex, 12)}, price = ${price}, stock_quantity = ${num(v.stock, { max: 1000000 })},
               position = ${i}, is_available = ${v.available !== false}, sku = ${clean(v.sku, 60)}
         WHERE id = ${v.id}`;
    } else {
      await sql`
        INSERT INTO product_variants (product_id, sku, variant_name, option_name, hex, price, stock_quantity, position, is_available)
        VALUES (${productId}, ${clean(v.sku, 60)}, ${name}, ${clean(v.option, 40) || "Shade"},
                ${clean(v.hex, 12)}, ${price}, ${num(v.stock, { max: 1000000 })}, ${i}, ${v.available !== false})`;
    }
  }
}

async function replaceImages(productId, images) {
  if (!Array.isArray(images)) return;
  await sql`DELETE FROM product_images WHERE product_id = ${productId}`;
  for (let i = 0; i < images.length; i++) {
    const im = images[i] || {};
    const url = clean(typeof im === "string" ? im : im.url, 500);
    if (!url) continue;
    await sql`
      INSERT INTO product_images (product_id, variant_id, url, alt, position, is_primary)
      VALUES (${productId}, ${im.variantId || null}, ${url}, ${clean(im.alt, 200)}, ${i}, ${i === 0})`;
  }
}

/* Archive rather than delete: order_items point at these rows and a past
   order must keep resolving what was actually bought. */
async function archiveProduct(id) {
  const rows = await sql`
    UPDATE products SET status = 'ARCHIVED', archived_at = now(), updated_at = now()
     WHERE id = ${id} RETURNING id, name, slug, status`;
  return rows[0] || null;
}

async function setStatus(id, status) {
  if (!STATUSES.includes(status)) throw new Error("Unknown product status");
  if (status === "PUBLISHED") {
    const p = await sql`SELECT price FROM products WHERE id = ${id} LIMIT 1`;
    if (!p.length) throw new Error("Product not found");
    if (p[0].price === null) throw new Error("This product has no price yet, so it cannot be published.");
  }
  const rows = await sql`
    UPDATE products SET status = ${status}::product_status,
      archived_at = CASE WHEN ${status} = 'ARCHIVED' THEN coalesce(archived_at, now()) ELSE NULL END,
      updated_at = now()
     WHERE id = ${id} RETURNING id, name, slug, status`;
  return rows[0] || null;
}

async function duplicateProduct(id) {
  const src = await adminGet(id);
  if (!src) throw new Error("Product not found");
  const slug = await uniqueSlug(src.slug + "-copy");
  const rows = await sql`
    INSERT INTO products
      (slug, sku, name, brand, category_id, subcategory, short_description, description,
       finish, size, price, sale_price, currency, stock_quantity, low_stock_threshold,
       status, is_featured, is_bestseller, is_new_arrival, tags, seo_title, seo_description,
       ingredients, source)
    VALUES
      (${slug}, ${src.sku ? src.sku + "-COPY" : null}, ${src.name + " (copy)"}, ${src.brand},
       ${src.category_id}, ${src.subcategory}, ${src.short_description}, ${src.description},
       ${src.finish}, ${src.size}, ${src.price}, ${src.sale_price}, ${src.currency},
       ${src.stock_quantity}, ${src.low_stock_threshold},
       'DRAFT'::product_status, false, false, false, ${src.tags},
       ${src.seo_title}, ${src.seo_description}, ${src.ingredients}, 'duplicate')
    RETURNING id, slug, name, status`;
  const copy = rows[0];
  await replaceVariants(copy.id, src.variants.map((v) => ({
    name: v.variant_name, option: v.option_name, hex: v.hex,
    price: v.price, stock: v.stock_quantity, available: v.is_available,
  })));
  await replaceImages(copy.id, src.images.map((i) => ({ url: i.url, alt: i.alt })));
  return copy;
}

module.exports = {
  STATUSES, slugify, uniqueSlug,
  adminList, adminGet, categories, subcategories,
  createProduct, updateProduct, archiveProduct, setStatus, duplicateProduct,
};
