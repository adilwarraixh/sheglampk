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
const { syncProductStock } = require("./stock.js");

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

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/* Shade colours end up in a style attribute on the storefront, so only a
   strict hex value is stored. #abc is widened to #aabbcc so every swatch
   is stored the same way. Empty means "no colour yet". */
function hexOrNull(value, shadeName) {
  const s = clean(value, 12);
  if (s === null) return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) throw new Error(`The colour for “${shadeName}” must be a colour code like #E83E70, or left blank.`);
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  return "#" + h.toLowerCase();
}

/* A unique-index violation reads as a database error. Say which value
   clashed instead. */
function explain(e) {
  const m = String((e && e.message) || "");
  if (/duplicate key/i.test(m) && /sku/i.test(m))
    return new Error("That SKU is already used by another product or shade. Every SKU must be unique.");
  if (/duplicate key/i.test(m) && /slug/i.test(m))
    return new Error("That URL slug is already used by another product.");
  return e;
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
           (SELECT count(*)::int FROM product_variants v WHERE v.product_id = p.id AND v.is_available) AS variant_count,
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
  // Retired shades are kept only so old orders resolve; they are not editable.
  product.variants = await sql`
    SELECT id, sku, variant_name, option_name, hex, price, stock_quantity, position, is_available
      FROM product_variants WHERE product_id = ${id} AND is_available ORDER BY position, id`;
  product.images = await sql`
    SELECT id, variant_id, url, alt, position, is_primary
      FROM product_images WHERE product_id = ${id} ORDER BY position`;
  return product;
}

async function statusOf(id) {
  const rows = await sql`SELECT status FROM products WHERE id = ${id} LIMIT 1`;
  return rows.length ? rows[0].status : null;
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
  const categoryId = body.categoryId ? num(body.categoryId) : null;

  if (status === "PUBLISHED" && price === null)
    throw new Error("A published product needs a price. Set one, or save it as a draft.");
  /* The shop's menus, category pages and breadcrumbs are all organised by
     category. A published product without one is reachable only by search. */
  if (status === "PUBLISHED" && !categoryId)
    throw new Error("Choose a category before publishing — without one the product is missing from the shop's menus and category pages.");
  if (salePrice !== null && price !== null && salePrice >= price)
    throw new Error("The sale price must be lower than the regular price.");

  return {
    name,
    status,
    price,
    salePrice,
    sku: clean(body.sku, 60),
    brand: clean(body.brand, 80) || "SHEGLAM",
    categoryId,
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

/* Checked before anything is written, so a rejected save leaves the
   product exactly as it was rather than half-updated. */
function validateVariants(variants) {
  if (!Array.isArray(variants)) return;
  const seen = new Set();
  for (const raw of variants) {
    const v = raw || {};
    const name = clean(v.name, 120);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`The shade “${name}” is listed twice. Each shade needs its own name.`);
    seen.add(key);
    if (has(v, "hex")) hexOrNull(v.hex, name);
  }
}

async function createProduct(body) {
  try {
    const d = normalise(body);
    validateVariants(body.variants);
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
    await syncProductStock(product.id);
    return product;
  } catch (e) {
    throw explain(e);
  }
}

async function updateProduct(id, body) {
  try {
    const d = normalise(body);
    validateVariants(body.variants);
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
    await syncProductStock(id);
    return rows[0];
  } catch (e) {
    throw explain(e);
  }
}

const autoShort = (desc) => {
  if (!desc) return null;
  const t = String(desc).replace(/\s+/g, " ").trim();
  return t.length <= 155 ? t : t.slice(0, 155).replace(/\s\S*$/, "") + "…";
};

/* Shades are matched to the rows already stored — by id, then by name —
   and updated in place. Replacing them wholesale gave every shade a new id
   on each save, which silently unlinked every shade from its photo
   (product_images.variant_id is ON DELETE SET NULL) and left pages built
   before the save holding shade ids that no longer existed at checkout.

   A field the caller did not send is left as it is: the CSV import sends
   only shade names and stock, and must not wipe colours or SKUs.

   A shade dropped from the list is deleted, unless an order line points
   at it. Then it is retired instead — hidden from the shop and the form,
   no stock — so that order still shows what was bought. */
async function replaceVariants(productId, variants) {
  if (!Array.isArray(variants)) return;
  const existing = await sql`
    SELECT v.id, v.variant_name,
           EXISTS (SELECT 1 FROM order_items i WHERE i.variant_id = v.id) AS ordered
      FROM product_variants v
     WHERE v.product_id = ${productId}
     ORDER BY v.is_available DESC, v.position, v.id`;
  const unclaimed = new Map(existing.map((v) => [String(v.id), v]));

  let position = 0;
  for (const raw of variants) {
    const v = raw || {};
    const name = clean(v.name, 120);
    if (!name) continue;

    let match = v.id != null && v.id !== "" ? unclaimed.get(String(v.id)) : undefined;
    if (!match) {
      const key = name.toLowerCase();
      match = [...unclaimed.values()].find((e) => e.variant_name.toLowerCase() === key);
    }

    const hex = has(v, "hex") ? hexOrNull(v.hex, name) : null;
    const price = has(v, "price") ? num(v.price, { allowNull: true, max: 10000000 }) : null;
    const sku = has(v, "sku") ? clean(v.sku, 60) : null;
    const stock = num(v.stock, { max: 1000000 });
    const option = clean(v.option, 40) || "Shade";
    // Listing a shade is what makes it available — including one that was
    // retired earlier and has now been added back.
    const available = v.available !== false;

    if (match) {
      unclaimed.delete(String(match.id));
      await sql`
        UPDATE product_variants SET
          variant_name   = ${name},
          option_name    = CASE WHEN ${has(v, "option")}::boolean THEN ${option}::text ELSE option_name END,
          hex            = CASE WHEN ${has(v, "hex")}::boolean    THEN ${hex}::text    ELSE hex END,
          price          = CASE WHEN ${has(v, "price")}::boolean  THEN ${price}::numeric ELSE price END,
          sku            = CASE WHEN ${has(v, "sku")}::boolean    THEN ${sku}::text    ELSE sku END,
          stock_quantity = CASE WHEN ${has(v, "stock")}::boolean  THEN ${stock}::int   ELSE stock_quantity END,
          position       = ${position},
          is_available   = ${available}
        WHERE id = ${match.id}`;
    } else {
      await sql`
        INSERT INTO product_variants (product_id, sku, variant_name, option_name, hex, price, stock_quantity, position, is_available)
        VALUES (${productId}, ${sku}, ${name}, ${option}, ${hex}, ${price}, ${stock}, ${position}, ${available})`;
    }
    position++;
  }

  for (const v of unclaimed.values()) {
    if (v.ordered) {
      await sql`
        UPDATE product_variants SET is_available = false, stock_quantity = 0, position = ${1000 + position++}
         WHERE id = ${v.id}`;
    } else {
      await sql`DELETE FROM product_variants WHERE id = ${v.id}`;
    }
  }
}

/* A photo can show one particular shade, and the shop switches to it when
   that shade is picked. The portal names the shade rather than sending its
   id, because a shade added in the same save has no id yet. Only this
   product's own shades are linked; a stray id is ignored rather than
   tying the photo to some other product.

   An entry that says nothing about a shade — the CSV import sends bare
   URLs — keeps the link that photo already had. */
async function replaceImages(productId, images) {
  if (!Array.isArray(images)) return;
  const shades = await sql`
    SELECT id, variant_name FROM product_variants WHERE product_id = ${productId} AND is_available`;
  const byName = new Map(shades.map((s) => [s.variant_name.toLowerCase(), s.id]));
  const ownIds = new Set(shades.map((s) => String(s.id)));
  const before = await sql`SELECT url, variant_id FROM product_images WHERE product_id = ${productId}`;
  const priorLink = new Map(before.filter((r) => r.variant_id).map((r) => [r.url, r.variant_id]));

  const rows = [];
  for (const im of images) {
    const entry = typeof im === "string" ? { url: im } : (im || {});
    const url = clean(entry.url, 500);
    if (!url) continue;
    let variantId = null;
    if (has(entry, "shade")) {
      variantId = entry.shade ? byName.get(String(entry.shade).trim().toLowerCase()) || null : null;
    } else if (has(entry, "variantId")) {
      variantId = entry.variantId != null && ownIds.has(String(entry.variantId)) ? entry.variantId : null;
    } else if (priorLink.has(url) && ownIds.has(String(priorLink.get(url)))) {
      variantId = priorLink.get(url);
    }
    rows.push({ url, alt: clean(entry.alt, 200), variantId });
  }

  await sql`DELETE FROM product_images WHERE product_id = ${productId}`;
  for (let i = 0; i < rows.length; i++) {
    await sql`
      INSERT INTO product_images (product_id, variant_id, url, alt, position, is_primary)
      VALUES (${productId}, ${rows[i].variantId}, ${rows[i].url}, ${rows[i].alt}, ${i}, ${i === 0})`;
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
    const p = await sql`SELECT price, category_id FROM products WHERE id = ${id} LIMIT 1`;
    if (!p.length) throw new Error("Product not found");
    if (p[0].price === null) throw new Error("This product has no price yet, so it cannot be published.");
    if (!p[0].category_id) throw new Error("This product has no category yet, so it cannot be published. Edit it and choose one.");
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
  try {
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
    const shadeName = new Map(src.variants.map((v) => [String(v.id), v.variant_name]));
    await replaceVariants(copy.id, src.variants.map((v) => ({
      name: v.variant_name, option: v.option_name, hex: v.hex,
      price: v.price, stock: v.stock_quantity, available: v.is_available,
    })));
    await replaceImages(copy.id, src.images.map((i) => ({
      url: i.url, alt: i.alt,
      shade: i.variant_id ? shadeName.get(String(i.variant_id)) || null : null,
    })));
    await syncProductStock(copy.id);
    return copy;
  } catch (e) {
    throw explain(e);
  }
}

module.exports = {
  STATUSES, slugify, uniqueSlug,
  adminList, adminGet, statusOf, categories, subcategories,
  createProduct, updateProduct, archiveProduct, setStatus, duplicateProduct,
};
