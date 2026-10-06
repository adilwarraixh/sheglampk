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
const { NEW_FOR_DAYS } = require("./catalogue.js");
const { shopSettings } = require("./site-admin.js");
const { priceOf } = require("./pricing.js");

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
    SELECT p.id, p.slug, p.sku, p.name, p.status, p.price, p.sale_price, p.sale_starts_at, p.sale_ends_at, p.currency,
           p.stock_quantity, p.low_stock_threshold, p.subcategory,
           p.is_featured, p.is_bestseller, p.is_new_arrival,
           -- the shop's rule (lib/catalogue.js isNew), so the list agrees with it
           (p.is_new_arrival OR p.published_at > now() - make_interval(days => ${NEW_FOR_DAYS}::int)) AS is_new,
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
       AND (${wantNew}      = false OR p.is_new_arrival
                                    OR p.published_at > now() - make_interval(days => ${NEW_FOR_DAYS}::int))
       -- running now: the same test as lib/pricing.js priceOf()
       AND (${wantSale}     = false OR (p.sale_price < p.price
                                       AND (p.sale_starts_at IS NULL OR p.sale_starts_at <= now())
                                       AND (p.sale_ends_at IS NULL OR p.sale_ends_at > now())))
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
  const now = new Date();
  return {
    products: rows.map(({ total_count, ...r }) => {
      const pr = priceOf(r, now);
      return { ...r, sale_state: pr.saleState, percent_off: pr.percentOff || (pr.regular && r.sale_price ? Math.round((1 - Number(r.sale_price) / pr.regular) * 100) : 0) };
    }),
    total, limit, offset,
  };
}

async function adminGet(id) {
  const [rows, variants, images] = await Promise.all([
    sql`
    SELECT p.*, c.slug AS category_slug, c.name AS category_name,
           p.published_at + make_interval(days => ${NEW_FOR_DAYS}::int) AS new_until
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ${id} LIMIT 1`,
    // Retired shades are kept only so old orders resolve; they are not editable.
    sql`
    SELECT id, sku, variant_name, option_name, hex, price, stock_quantity, position, is_available
      FROM product_variants WHERE product_id = ${id} AND is_available ORDER BY position, id`,
    sql`
    SELECT id, variant_id, url, alt, position, is_primary
      FROM product_images WHERE product_id = ${id} ORDER BY position`,
  ]);
  if (!rows.length) return null;
  return { ...rows[0], variants, images };
}

/* The fields the audit log records before and after a change. Money comes
   back from the driver as strings ("2000.00"), so it is normalised to
   numbers to compare and to read. */
async function auditView(id) {
  const [p] = await sql`
    SELECT p.name, p.sku, p.slug, p.status, p.price, p.sale_price, p.sale_starts_at, p.sale_ends_at, c.name AS category,
           p.is_featured, p.is_bestseller, p.is_new_arrival, p.stock_quantity,
           (SELECT string_agg(v.variant_name || ':' || v.stock_quantity, ', ' ORDER BY v.position)
              FROM product_variants v WHERE v.product_id = p.id AND v.is_available) AS shades,
           (SELECT count(*)::int FROM product_images i WHERE i.product_id = p.id) AS photos
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ${id} LIMIT 1`;
  if (!p) return null;
  const n = (v) => (v === null ? null : Number(v));
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return { ...p, price: n(p.price), sale_price: n(p.sale_price), sale_starts_at: iso(p.sale_starts_at), sale_ends_at: iso(p.sale_ends_at) };
}

/* { field: [before, after] } for what actually changed. */
function changes(before, after) {
  const out = {};
  for (const k of Object.keys(after || {})) {
    const a = before ? before[k] : undefined, b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a === undefined ? null : a, b];
  }
  return out;
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

  /* A sale can be scheduled: optional start and end (lib/pricing.js decides
     whether it is running). Sent as ISO times by the portal. */
  const when = (v, label) => {
    if (v === undefined || v === null || v === "") return null;
    const t = new Date(v);
    if (Number.isNaN(t.getTime())) throw new Error(`${label} is not a valid date and time.`);
    return t.toISOString();
  };
  const saleStartsAt = when(body.saleStartsAt, "The sale start");
  const saleEndsAt = when(body.saleEndsAt, "The sale end");
  if (saleStartsAt && saleEndsAt && saleEndsAt <= saleStartsAt)
    throw new Error("The sale must end after it starts.");
  if ((saleStartsAt || saleEndsAt) && salePrice === null)
    throw new Error("Sale dates need a sale price. Add one, or clear the dates.");

  return {
    name,
    status,
    price,
    salePrice,
    saleStartsAt,
    saleEndsAt,
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
    // Absent (a CSV row, say): a new product takes the Settings default, an edit keeps its own.
    lowStockThreshold: body.lowStockThreshold === undefined || body.lowStockThreshold === ""
      ? null : num(body.lowStockThreshold, { max: 100000 }),
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

/* A product save is one transaction: the product row, its shades, its
   photos and its stock total land together or not at all. It used to be
   ~19 separate statements, so a failure half-way (a clashing shade SKU,
   say) left a half-saved product — and each statement was a round trip.
   Statements are built in JS first, so validation still fails before
   anything is sent. Later statements find the product by its slug, which
   is unique and known before the transaction starts — a new product has
   no id until its INSERT runs. */
async function createProduct(body) {
  try {
    const d = normalise(body);
    validateVariants(body.variants);
    const [slug, settings] = await Promise.all([uniqueSlug(d.slugRequest || d.name), shopSettings()]);
    const res = await sql.transaction([
      sql`
      INSERT INTO products
        (slug, sku, name, brand, category_id, subcategory, short_description, description,
         finish, size, price, sale_price, sale_starts_at, sale_ends_at, currency, stock_quantity, low_stock_threshold,
         status, is_featured, is_bestseller, is_new_arrival, tags,
         seo_title, seo_description, ingredients, source)
      VALUES
        (${slug}, ${d.sku}, ${d.name}, ${d.brand}, ${d.categoryId}, ${d.subcategory},
         ${d.shortDescription || autoShort(d.description)}, ${d.description},
         ${d.finish}, ${d.size}, ${d.price}, ${d.salePrice}, ${d.saleStartsAt}, ${d.saleEndsAt}, ${d.currency},
         ${d.stockQuantity}, ${d.lowStockThreshold ?? settings.lowStockDefault}, ${d.status}::product_status,
         ${d.isFeatured}, ${d.isBestseller}, ${d.isNewArrival}, ${d.tags},
         ${d.seoTitle || d.name + " — SHEGLAM PK"}, ${d.seoDescription || autoShort(d.description)},
         ${d.ingredients}, 'admin')
      RETURNING id, slug, name, status`,
      ...variantWrites(slug, body.variants, []),
      ...imageWrites(slug, body.images, new Map()),
      stockTotal(slug),
    ]);
    return res[0][0];
  } catch (e) {
    throw explain(e);
  }
}

async function updateProduct(id, body) {
  try {
    const d = normalise(body);
    validateVariants(body.variants);
    const [existing, shadesNow, photosNow] = await Promise.all([
      sql`SELECT slug FROM products WHERE id = ${id} LIMIT 1`,
      Array.isArray(body.variants) ? sql`
        SELECT v.id, v.variant_name,
               EXISTS (SELECT 1 FROM order_items i WHERE i.variant_id = v.id) AS ordered
          FROM product_variants v
         WHERE v.product_id = ${id}
         ORDER BY v.is_available DESC, v.position, v.id` : [],
      Array.isArray(body.images) ? sql`SELECT url, variant_id FROM product_images WHERE product_id = ${id}` : [],
    ]);
    if (!existing.length) throw new Error("Product not found");

    // Only re-slug when the admin actually asked for a different one.
    const slug = d.slugRequest && slugify(d.slugRequest) !== existing[0].slug
      ? await uniqueSlug(d.slugRequest, id)
      : existing[0].slug;
    const priorLink = new Map(photosNow.filter((r) => r.variant_id).map((r) => [r.url, r.variant_id]));

    const res = await sql.transaction([
      sql`
      UPDATE products SET
        slug = ${slug}, sku = ${d.sku}, name = ${d.name}, brand = ${d.brand},
        category_id = ${d.categoryId}, subcategory = ${d.subcategory},
        short_description = ${d.shortDescription || autoShort(d.description)},
        description = ${d.description}, finish = ${d.finish}, size = ${d.size},
        price = ${d.price}, sale_price = ${d.salePrice}, currency = ${d.currency},
        sale_starts_at = ${d.saleStartsAt}, sale_ends_at = ${d.saleEndsAt},
        stock_quantity = ${d.stockQuantity},
        low_stock_threshold = coalesce(${d.lowStockThreshold}::int, low_stock_threshold),
        status = ${d.status}::product_status,
        is_featured = ${d.isFeatured}, is_bestseller = ${d.isBestseller},
        is_new_arrival = ${d.isNewArrival}, tags = ${d.tags},
        seo_title = ${d.seoTitle}, seo_description = ${d.seoDescription},
        ingredients = ${d.ingredients},
        archived_at = CASE WHEN ${d.status} = 'ARCHIVED' THEN coalesce(archived_at, now()) ELSE NULL END,
        updated_at = now()
      WHERE id = ${id}
      RETURNING id, slug, name, status`,
      ...variantWrites(slug, body.variants, shadesNow),
      ...imageWrites(slug, body.images, priorLink),
      stockTotal(slug),
    ]);
    return res[0][0];
  } catch (e) {
    throw explain(e);
  }
}

/* A product sold in shades has their total as its stock (lib/stock.js). */
const stockTotal = (slug) => sql`
  UPDATE products p SET stock_quantity = s.total
    FROM (SELECT product_id, sum(stock_quantity)::int AS total FROM product_variants
           WHERE product_id = (SELECT id FROM products WHERE slug = ${slug}) AND is_available
           GROUP BY product_id) s
   WHERE p.id = s.product_id AND p.stock_quantity <> s.total`;

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
   no stock — so that order still shows what was bought.

   Returns the statements; the caller runs them inside its transaction.
   `existing` is the product's current shades (empty for a new product). */
function variantWrites(slug, variants, existing) {
  if (!Array.isArray(variants)) return [];
  const writes = [];
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
      writes.push(sql`
        UPDATE product_variants SET
          variant_name   = ${name},
          option_name    = CASE WHEN ${has(v, "option")}::boolean THEN ${option}::text ELSE option_name END,
          hex            = CASE WHEN ${has(v, "hex")}::boolean    THEN ${hex}::text    ELSE hex END,
          price          = CASE WHEN ${has(v, "price")}::boolean  THEN ${price}::numeric ELSE price END,
          sku            = CASE WHEN ${has(v, "sku")}::boolean    THEN ${sku}::text    ELSE sku END,
          stock_quantity = CASE WHEN ${has(v, "stock")}::boolean  THEN ${stock}::int   ELSE stock_quantity END,
          position       = ${position},
          is_available   = ${available}
        WHERE id = ${match.id}`);
    } else {
      writes.push(sql`
        INSERT INTO product_variants (product_id, sku, variant_name, option_name, hex, price, stock_quantity, position, is_available)
        VALUES ((SELECT id FROM products WHERE slug = ${slug}), ${sku}, ${name}, ${option}, ${hex}, ${price}, ${stock}, ${position}, ${available})`);
    }
    position++;
  }

  for (const v of unclaimed.values()) {
    writes.push(v.ordered
      ? sql`UPDATE product_variants SET is_available = false, stock_quantity = 0, position = ${1000 + position++}
             WHERE id = ${v.id}`
      : sql`DELETE FROM product_variants WHERE id = ${v.id}`);
  }
  return writes;
}

/* A photo can show one particular shade, and the shop switches to it when
   that shade is picked. The portal names the shade rather than sending its
   id, because a shade added in the same save has no id yet. Only this
   product's own shades are linked; a stray id is ignored rather than
   tying the photo to some other product.

   An entry that says nothing about a shade — the CSV import sends bare
   URLs — keeps the link that photo already had (`priorLink`: url → shade id).

   The shade is resolved in SQL, inside the same transaction, so a shade
   added or renamed earlier in this save is already there to link to; and
   only this product's available shades can match. */
function imageWrites(slug, images, priorLink) {
  if (!Array.isArray(images)) return [];
  const rows = [];
  for (const im of images) {
    const entry = typeof im === "string" ? { url: im } : (im || {});
    const url = clean(entry.url, 500);
    if (!url) continue;
    let mode = "none", shade = null, vid = null;
    if (has(entry, "shade")) {
      if (entry.shade) { mode = "shade"; shade = String(entry.shade).trim(); }
    } else if (has(entry, "variantId")) {
      if (entry.variantId != null && /^\d+$/.test(String(entry.variantId))) { mode = "id"; vid = Number(entry.variantId); }
    } else if (priorLink.has(url)) {
      mode = "id"; vid = Number(priorLink.get(url));
    }
    rows.push({ url, alt: clean(entry.alt, 200), mode, shade, vid, position: rows.length });
  }

  return [
    sql`DELETE FROM product_images WHERE product_id = (SELECT id FROM products WHERE slug = ${slug})`,
    sql`
      INSERT INTO product_images (product_id, variant_id, url, alt, position, is_primary)
      SELECT p.id,
             CASE x.mode
               WHEN 'shade' THEN (SELECT v.id FROM product_variants v
                                   WHERE v.product_id = p.id AND v.is_available
                                     AND lower(v.variant_name) = lower(x.shade) ORDER BY v.id LIMIT 1)
               WHEN 'id'    THEN (SELECT v.id FROM product_variants v
                                   WHERE v.id = x.vid AND v.product_id = p.id AND v.is_available)
             END,
             x.url, x.alt, x.position, x.position = 0
        FROM products p,
             jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
               AS x(url text, alt text, mode text, shade text, vid bigint, position int)
       WHERE p.slug = ${slug}
       ORDER BY x.position`,
  ];
}

/* Archive rather than delete: order_items point at these rows and a past
   order must keep resolving what was actually bought. */
async function archiveProduct(id) {
  const rows = await sql`
    UPDATE products SET status = 'ARCHIVED', archived_at = now(), updated_at = now()
     WHERE id = ${id} RETURNING id, name, slug, status`;
  return rows[0] || null;
}

/* Removes a product for good, with its shades and photo links (both
   cascade). Past orders are untouched: every order line keeps its own copy
   of the name, shade, SKU, price and photo, and only loses its pointer to
   the product (order_items.product_id is ON DELETE SET NULL). Uploaded
   photos stay in the media library. Archive is the reversible option. */
async function deleteProduct(id) {
  const [p] = await sql`
    SELECT p.id, p.name, p.sku, p.slug, p.status,
           (SELECT count(DISTINCT i.order_id)::int FROM order_items i WHERE i.product_id = p.id) AS orders
      FROM products p WHERE p.id = ${id} LIMIT 1`;
  if (!p) return null;
  await sql`DELETE FROM products WHERE id = ${id}`;
  return p;
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
    const shadeName = new Map(src.variants.map((v) => [String(v.id), v.variant_name]));
    const res = await sql.transaction([
      sql`
      INSERT INTO products
        (slug, sku, name, brand, category_id, subcategory, short_description, description,
         finish, size, price, sale_price, sale_starts_at, sale_ends_at, currency, stock_quantity, low_stock_threshold,
         status, is_featured, is_bestseller, is_new_arrival, tags, seo_title, seo_description,
         ingredients, source)
      VALUES
        (${slug}, ${src.sku ? src.sku + "-COPY" : null}, ${src.name + " (copy)"}, ${src.brand},
         ${src.category_id}, ${src.subcategory}, ${src.short_description}, ${src.description},
         ${src.finish}, ${src.size}, ${src.price}, ${src.sale_price}, ${src.sale_starts_at}, ${src.sale_ends_at}, ${src.currency},
         ${src.stock_quantity}, ${src.low_stock_threshold},
         'DRAFT'::product_status, false, false, false, ${src.tags},
         ${src.seo_title}, ${src.seo_description}, ${src.ingredients}, 'duplicate')
      RETURNING id, slug, name, status`,
      ...variantWrites(slug, src.variants.map((v) => ({
        name: v.variant_name, option: v.option_name, hex: v.hex,
        price: v.price, stock: v.stock_quantity, available: v.is_available,
      })), []),
      ...imageWrites(slug, src.images.map((i) => ({
        url: i.url, alt: i.alt,
        shade: i.variant_id ? shadeName.get(String(i.variant_id)) || null : null,
      })), new Map()),
      stockTotal(slug),
    ]);
    return res[0][0];
  } catch (e) {
    throw explain(e);
  }
}

module.exports = {
  STATUSES, NEW_FOR_DAYS, slugify, uniqueSlug,
  adminList, adminGet, auditView, changes, statusOf, categories, subcategories,
  createProduct, updateProduct, archiveProduct, deleteProduct, setStatus, duplicateProduct,
};
