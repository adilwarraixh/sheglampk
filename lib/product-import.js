/* =========================================================
   lib/product-import.js — bring products in from a spreadsheet

   Two phases, deliberately separate:

     analyse() reads the file and reports exactly what would happen —
     every row classified as create, update, or error, with the reason.
     It writes nothing.

     apply() takes that same file and performs it.

   The preview is not decoration. A spreadsheet is the easiest way to
   wreck a catalogue in one click: a shifted column, a stray decimal, a
   duplicated SKU. Seeing "12 create, 3 update, 2 errors" before
   committing is what makes the feature safe to hand to somebody.

   Rows are matched on SKU first, then slug, then exact name. A row that
   matches nothing is a new product.
   ========================================================= */
const { sql } = require("../db/client.js");
const csv = require("./csv.js");
const P = require("./products-admin.js");

/* Header aliases, so a file exported from Shopify, WooCommerce or typed
   by hand all land in the same place. Keys are normalised (lowercase,
   alphanumeric only) before lookup. */
const FIELDS = {
  name:        ["name", "productname", "title", "product"],
  sku:         ["sku", "variantsku", "code", "productcode"],
  slug:        ["slug", "handle", "urlslug", "url"],
  description: ["description", "fulldescription", "body", "bodyhtml", "details"],
  shortDescription: ["shortdescription", "excerpt", "summary", "subtitle"],
  price:       ["price", "regularprice", "variantprice", "mrp", "rate"],
  salePrice:   ["saleprice", "discountprice", "specialprice", "variantcompareatprice"],
  stock:       ["stock", "stockquantity", "quantity", "qty", "inventory", "variantinventoryqty"],
  category:    ["category", "producttype", "productcategory", "type"],
  subcategory: ["subcategory", "subtype", "collection"],
  brand:       ["brand", "vendor", "manufacturer"],
  size:        ["size", "netcontent", "weight", "volume"],
  finish:      ["finish"],
  shades:      ["shades", "variants", "variantname", "options", "option1value", "colour", "color"],
  image:       ["image", "imageurl", "imagesrc", "photo", "picture"],
  status:      ["status", "published", "active"],
  featured:    ["featured", "isfeatured"],
  bestseller:  ["bestseller", "isbestseller"],
  newArrival:  ["newarrival", "isnew", "new"],
  tags:        ["tags", "keywords"],
  seoTitle:    ["seotitle", "metatitle"],
  seoDescription: ["seodescription", "metadescription"],
};

/* Builds header -> canonical field mapping from whatever the file has. */
function mapHeaders(keys) {
  const mapping = {};
  const unmapped = [];
  keys.forEach((k, i) => {
    if (!k) return;
    const field = Object.keys(FIELDS).find((f) => FIELDS[f].includes(k));
    if (field && mapping[field] === undefined) mapping[field] = i;
    else if (!field) unmapped.push(i);
  });
  return { mapping, unmapped };
}

/* Spreadsheets hand over prices in every shape: 1990, "Rs. 1,990.00",
   "1 990", "PKR1990". Pull out the first number-like token rather than
   stripping characters — stripping turns "abc" into "" (and Number("")
   is 0, so a typo'd price would import as free) and leaves the "." of
   "Rs." stuck to the front of the digits. */
const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const raw = String(v).replace(/\s/g, "");
  const m = raw.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return NaN;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

const bool = (v) => {
  const s = String(v || "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "on", "published", "active"].includes(s)) return true;
  if (["0", "false", "no", "n", "off", "draft", "inactive", ""].includes(s)) return false;
  return null;
};

const STATUS_WORDS = {
  published: "PUBLISHED", active: "PUBLISHED", live: "PUBLISHED", "1": "PUBLISHED", true: "PUBLISHED", yes: "PUBLISHED",
  draft: "DRAFT", "": "DRAFT",
  unpublished: "UNPUBLISHED", hidden: "UNPUBLISHED", inactive: "UNPUBLISHED", "0": "UNPUBLISHED", false: "UNPUBLISHED", no: "UNPUBLISHED",
  archived: "ARCHIVED", retired: "ARCHIVED",
};

/* Reads one record into the shape products-admin expects, collecting
   every problem rather than throwing on the first. */
function readRow(rec, rowNo) {
  const errors = [], warnings = [];
  const get = (f) => (rec[f] === undefined ? "" : String(rec[f]).trim());

  const name = get("name");
  if (!name) errors.push("no product name");

  const price = num(get("price"));
  if (Number.isNaN(price)) errors.push(`price "${get("price")}" is not a number`);
  const salePrice = num(get("salePrice"));
  if (Number.isNaN(salePrice)) errors.push(`sale price "${get("salePrice")}" is not a number`);
  if (price !== null && salePrice !== null && !Number.isNaN(salePrice) && salePrice >= price)
    errors.push("sale price is not below the regular price");

  const stock = num(get("stock"));
  if (Number.isNaN(stock)) errors.push(`stock "${get("stock")}" is not a number`);

  const rawStatus = get("status").toLowerCase();
  let status = STATUS_WORDS[rawStatus];
  if (status === undefined) {
    status = "DRAFT";
    if (rawStatus) warnings.push(`status "${get("status")}" not recognised, importing as DRAFT`);
  }
  if (status === "PUBLISHED" && (price === null || Number.isNaN(price))) {
    status = "DRAFT";
    warnings.push("no price, so it cannot be published — importing as DRAFT");
  }

  const shades = get("shades")
    ? get("shades").split(/[|;,]/).map((s) => s.trim()).filter(Boolean)
    : [];
  const tags = get("tags")
    ? get("tags").split(/[|;,]/).map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    row: rowNo,
    errors, warnings,
    data: {
      name,
      sku: get("sku") || null,
      slug: get("slug") || null,
      description: get("description") || null,
      shortDescription: get("shortDescription") || null,
      price: price === null || Number.isNaN(price) ? null : price,
      salePrice: salePrice === null || Number.isNaN(salePrice) ? null : salePrice,
      stockQuantity: stock === null || Number.isNaN(stock) ? 0 : Math.max(0, Math.round(stock)),
      category: get("category") || null,
      subcategory: get("subcategory") || null,
      brand: get("brand") || null,
      size: get("size") || null,
      finish: get("finish") || null,
      image: get("image") || null,
      status,
      isFeatured: bool(get("featured")) === true,
      isBestseller: bool(get("bestseller")) === true,
      isNewArrival: bool(get("newArrival")) === true,
      tags,
      seoTitle: get("seoTitle") || null,
      seoDescription: get("seoDescription") || null,
      shades,
    },
  };
}

/* Which existing product, if any, does this row refer to? */
async function matchExisting(d) {
  if (d.sku) {
    const r = await sql`SELECT id, name, slug, status FROM products WHERE lower(sku) = lower(${d.sku}) LIMIT 1`;
    if (r.length) return { ...r[0], matchedOn: "SKU" };
  }
  const slug = P.slugify(d.slug || d.name);
  if (slug) {
    const r = await sql`SELECT id, name, slug, status FROM products WHERE slug = ${slug} LIMIT 1`;
    if (r.length) return { ...r[0], matchedOn: d.slug ? "slug" : "name" };
  }
  return null;
}

async function categoryMap() {
  const rows = await sql`SELECT id, slug, name FROM categories`;
  const m = {};
  rows.forEach((c) => { m[c.slug.toLowerCase()] = c.id; m[c.name.toLowerCase()] = c.id; });
  return m;
}

/* ---------- analyse ---------- */
async function analyse(text) {
  const delimiter = csv.sniffDelimiter(text);
  const rows = csv.parse(text, { delimiter });
  if (!rows.length) return { fatal: "That file is empty." };

  const { headers, keys, records } = csv.toObjects(rows);
  const { mapping } = mapHeaders(keys);

  if (mapping.name === undefined)
    return {
      fatal: "No product name column found. The file needs a column called Name, Product Name or Title.",
      headers,
    };
  if (!records.length) return { fatal: "That file has a header row but no products.", headers };
  if (records.length > 2000)
    return { fatal: `That file has ${records.length} rows. Import up to 2000 at a time.`, headers };

  const cats = await categoryMap();
  const seenSku = new Map(), seenSlug = new Map();
  const plan = [];

  for (let i = 0; i < records.length; i++) {
    const parsed = readRow(records[i], records[i].__line);
    const d = parsed.data;

    // Duplicates inside the file itself, which the database would only
    // catch one at a time.
    if (d.sku) {
      const key = d.sku.toLowerCase();
      if (seenSku.has(key)) parsed.errors.push(`SKU "${d.sku}" is also on row ${seenSku.get(key)}`);
      else seenSku.set(key, parsed.row);
    }
    const slugKey = P.slugify(d.slug || d.name);
    if (slugKey) {
      if (seenSlug.has(slugKey)) parsed.errors.push(`this makes the same URL as row ${seenSlug.get(slugKey)}`);
      else seenSlug.set(slugKey, parsed.row);
    }

    if (d.category && cats[d.category.toLowerCase()] === undefined)
      parsed.warnings.push(`category "${d.category}" does not exist — importing without a category`);

    const existing = parsed.errors.length ? null : await matchExisting(d);

    plan.push({
      row: parsed.row,
      name: d.name || "(no name)",
      sku: d.sku,
      price: d.price,
      stock: d.stockQuantity,
      status: d.status,
      shades: d.shades.length,
      action: parsed.errors.length ? "error" : (existing ? "update" : "create"),
      matchedOn: existing ? existing.matchedOn : null,
      existingId: existing ? existing.id : null,
      existingName: existing ? existing.name : null,
      errors: parsed.errors,
      warnings: parsed.warnings,
    });
  }

  return {
    delimiter: delimiter === "\t" ? "tab" : delimiter,
    headers,
    mapped: Object.keys(mapping),
    unmappedHeaders: headers.filter((h, i) => keys[i] && !Object.values(mapping).includes(i)),
    plan,
    summary: {
      rows: plan.length,
      create: plan.filter((p) => p.action === "create").length,
      update: plan.filter((p) => p.action === "update").length,
      errors: plan.filter((p) => p.action === "error").length,
      warnings: plan.filter((p) => p.warnings.length).length,
    },
  };
}

/* ---------- apply ---------- */
async function apply(text, { skipErrors = true } = {}) {
  const analysis = await analyse(text);
  if (analysis.fatal) throw new Error(analysis.fatal);
  if (!skipErrors && analysis.summary.errors)
    throw new Error(`${analysis.summary.errors} row(s) have errors. Fix them, or import the valid rows only.`);

  const delimiter = csv.sniffDelimiter(text);
  const { records } = csv.toObjects(csv.parse(text, { delimiter }));
  const cats = await categoryMap();

  const result = { created: 0, updated: 0, skipped: 0, failed: [], products: [] };

  for (let i = 0; i < records.length; i++) {
    const step = analysis.plan[i];
    if (step.action === "error") { result.skipped++; continue; }

    const d = readRow(records[i], step.row).data;
    const body = {
      name: d.name, sku: d.sku, slug: d.slug,
      description: d.description, shortDescription: d.shortDescription,
      price: d.price, salePrice: d.salePrice, stockQuantity: d.stockQuantity,
      categoryId: d.category ? (cats[d.category.toLowerCase()] || null) : null,
      subcategory: d.subcategory, brand: d.brand, size: d.size, finish: d.finish,
      status: d.status, isFeatured: d.isFeatured, isBestseller: d.isBestseller,
      isNewArrival: d.isNewArrival, tags: d.tags,
      seoTitle: d.seoTitle, seoDescription: d.seoDescription,
    };
    // Shades and images are only replaced when the file actually supplies
    // them, so a price-only update does not wipe a product's shades.
    if (d.shades.length) body.variants = d.shades.map((s) => ({ name: s, stock: d.stockQuantity }));
    if (d.image) body.images = [{ url: d.image, alt: d.name }];

    try {
      const product = step.action === "update"
        ? await P.updateProduct(step.existingId, body)
        : await P.createProduct(body);
      result[step.action === "update" ? "updated" : "created"]++;
      result.products.push({ row: step.row, id: product.id, name: product.name, action: step.action });
    } catch (e) {
      result.failed.push({ row: step.row, name: d.name, error: e.message });
    }
  }

  return { ...result, summary: analysis.summary };
}

/* A file with the columns this importer understands, filled with the
   current catalogue — the easiest correct starting point. */
async function template({ withProducts = true } = {}) {
  const header = ["Name", "SKU", "Slug", "Category", "Subcategory", "Brand", "Price", "Sale Price",
    "Stock", "Size", "Finish", "Shades", "Status", "Featured", "Bestseller", "New Arrival",
    "Short Description", "Description", "Image", "Tags", "SEO Title", "SEO Description"];
  const rows = [header];

  if (withProducts) {
    const products = await sql`
      SELECT p.name, p.sku, p.slug, p.subcategory, p.brand, p.price, p.sale_price,
             p.stock_quantity, p.size, p.finish, p.status, p.is_featured, p.is_bestseller,
             p.is_new_arrival, p.short_description, p.description, p.tags, p.seo_title, p.seo_description,
             c.slug AS category_slug,
             (SELECT url FROM product_images i WHERE i.product_id = p.id
               ORDER BY i.is_primary DESC, i.position LIMIT 1) AS image,
             (SELECT string_agg(v.variant_name, '|' ORDER BY v.position)
                FROM product_variants v WHERE v.product_id = p.id) AS shades
        FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.status <> 'ARCHIVED' ORDER BY p.id`;

    for (const p of products) {
      rows.push([
        p.name, p.sku || "", p.slug, p.category_slug || "", p.subcategory || "", p.brand || "",
        p.price === null ? "" : Number(p.price), p.sale_price === null ? "" : Number(p.sale_price),
        p.stock_quantity, p.size || "", p.finish || "", p.shades || "", p.status,
        p.is_featured ? "yes" : "no", p.is_bestseller ? "yes" : "no", p.is_new_arrival ? "yes" : "no",
        p.short_description || "", p.description || "", p.image || "",
        (p.tags || []).join("|"), p.seo_title || "", p.seo_description || "",
      ]);
    }
  }
  return csv.stringify(rows);
}

module.exports = { analyse, apply, template, FIELDS };
