/* =========================================================
   db/import-pdf-catalogue.js — load the supplied PDF catalogue

   Reads data/pdf-catalogue.json (transcribed from PRODUCT LIST.pdf) and
   data/pdf-image-manifest.json (images extracted from the same PDF, matched
   by position), and makes the database match it.

   Products already in the database that are NOT in the PDF are ARCHIVED,
   not deleted: order_items reference them, and past orders must keep
   showing what was actually bought.

   Dry run by default. Pass --confirm to write.

   Run:  node db/import-pdf-catalogue.js
         node db/import-pdf-catalogue.js --confirm
   ========================================================= */
const fs = require("fs");
const path = require("path");
const { sql, rawClient, describeTarget } = require("./client.js");

const APPLY = process.argv.includes("--confirm");
const ROOT = path.join(__dirname, "..");
const CATALOGUE = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "pdf-catalogue.json"), "utf8"));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "pdf-image-manifest.json"), "utf8"));

const slugify = (s) => String(s).toLowerCase().replace(/['’]/g, "").replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const CATEGORIES = [
  { slug: "face", name: "Face", position: 1 },
  { slug: "lips", name: "Lips", position: 2 },
  { slug: "eyes", name: "Eyes", position: 3 },
];

/* ---------- validate before touching anything (brief §41) ---------- */
function validate() {
  const problems = [], warnings = [];
  const seenName = new Map(), seenSlug = new Map();

  for (const p of CATALOGUE.products) {
    const where = `#${p.num} ${p.name}`;
    if (!p.name || !p.name.trim()) problems.push(`${where}: missing name`);
    if (!p.description || p.description.trim().length < 20) problems.push(`${where}: missing or too-short description`);

    const key = p.name.toLowerCase().trim();
    if (seenName.has(key)) problems.push(`${where}: duplicate name, also #${seenName.get(key)}`);
    seenName.set(key, p.num);

    const slug = slugify(p.name);
    if (seenSlug.has(slug)) problems.push(`${where}: slug "${slug}" collides with #${seenSlug.get(slug)}`);
    seenSlug.set(slug, p.num);

    const imgs = MANIFEST.filter((m) => m.num === p.num);
    if (!imgs.length) problems.push(`${where}: no image extracted`);
    for (const m of imgs) {
      if (!fs.existsSync(path.join(ROOT, "assets", "img", "products", m.file)))
        problems.push(`${where}: image file missing on disk — ${m.file}`);
    }
    // Shade count must equal image count wherever the PDF declared shades,
    // otherwise a shade would silently get the wrong picture.
    if (p.shades.length > 1 && imgs.length !== p.shades.length)
      problems.push(`${where}: ${p.shades.length} shades but ${imgs.length} images — association unsafe`);

    if (p.price === null) warnings.push(`${where}: no price — will import as DRAFT`);
    if (p.issue) warnings.push(`${where}: ${p.issue}`);
    if (p.priceNote) warnings.push(`${where}: ${p.priceNote}`);
  }
  return { problems, warnings };
}

(async () => {
  console.log(`\nTarget: ${describeTarget()}`);
  console.log(APPLY ? "Mode:   APPLY\n" : "Mode:   DRY RUN — nothing will be written\n");

  const { problems, warnings } = validate();
  const products = CATALOGUE.products;

  console.log("=== VALIDATION ===");
  if (problems.length) { console.log("BLOCKING:"); problems.forEach((p) => console.log("  ✗ " + p)); }
  else console.log("  no blocking problems");
  if (warnings.length) { console.log("Flagged for your attention:"); warnings.forEach((w) => console.log("  ! " + w)); }
  console.log("");

  if (problems.length) {
    console.error("Refusing to import while blocking problems remain.\n");
    process.exit(1);
  }

  const existing = await sql`SELECT id, slug, name, status FROM products`;
  const pdfSlugs = new Set(products.map((p) => slugify(p.name)));
  const toArchive = existing.filter((e) => !pdfSlugs.has(e.slug) && e.status !== "ARCHIVED");

  const willPublish = products.filter((p) => p.price !== null).length;
  const willDraft = products.length - willPublish;
  const totalImages = MANIFEST.length;
  const totalShades = products.reduce((a, p) => a + Math.max(p.shades.length, 0), 0);

  console.log("=== PLAN ===");
  console.log(`  products in PDF        : ${products.length}`);
  console.log(`  will import PUBLISHED  : ${willPublish}`);
  console.log(`  will import DRAFT      : ${willDraft}   (no authorised price)`);
  console.log(`  variants (shades)      : ${totalShades}`);
  console.log(`  images                 : ${totalImages}`);
  console.log(`  already in DB          : ${existing.length}`);
  console.log(`  will ARCHIVE (not in PDF): ${toArchive.length}`);
  if (toArchive.length) toArchive.slice(0, 10).forEach((e) => console.log(`      - ${e.slug}`));
  if (toArchive.length > 10) console.log(`      … and ${toArchive.length - 10} more`);
  console.log("");

  if (!APPLY) { console.log("Dry run only. Re-run with --confirm to write.\n"); return; }

  const c = await rawClient();
  const summary = { imported: 0, published: 0, draft: 0, variants: 0, images: 0, archived: 0 };
  try {
    await c.query("BEGIN");

    const catId = {};
    for (const cat of CATEGORIES) {
      const r = await c.query(
        `INSERT INTO categories (slug, name, position, is_active) VALUES ($1,$2,$3,true)
         ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, position=EXCLUDED.position, is_active=true
         RETURNING id`, [cat.slug, cat.name, cat.position]);
      catId[cat.slug] = r.rows[0].id;
    }

    for (const p of products) {
      const slug = slugify(p.name);
      const sku = "SGPK-" + String(p.num).padStart(3, "0");
      const status = p.price === null ? "DRAFT" : "PUBLISHED";
      const notes = [p.issue, p.priceNote].filter(Boolean).join(" | ") || null;
      const short = p.description.replace(/\s+/g, " ").trim().slice(0, 155).replace(/\s\S*$/, "") + "…";

      const r = await c.query(
        `INSERT INTO products
           (slug, sku, name, brand, category_id, subcategory, short_description, description,
            size, price, currency, stock_quantity, low_stock_threshold, status, tags,
            seo_title, seo_description, source, import_notes)
         VALUES ($1,$2,$3,'SHEGLAM',$4,$5,$6,$7,$8,$9,'PKR',0,5,$10::product_status,$11,$12,$13,'PRODUCT LIST.pdf',$14)
         ON CONFLICT (slug) DO UPDATE SET
            sku=EXCLUDED.sku, name=EXCLUDED.name, category_id=EXCLUDED.category_id,
            subcategory=EXCLUDED.subcategory, short_description=EXCLUDED.short_description,
            description=EXCLUDED.description, size=EXCLUDED.size, price=EXCLUDED.price,
            status=EXCLUDED.status, tags=EXCLUDED.tags, seo_title=EXCLUDED.seo_title,
            seo_description=EXCLUDED.seo_description, source=EXCLUDED.source,
            import_notes=EXCLUDED.import_notes, archived_at=NULL, updated_at=now()
         RETURNING id`,
        [slug, sku, p.name, catId[p.category], p.subcategory, short, p.description,
         p.size || null, p.price, status, [p.category, p.subcategory.toLowerCase()],
         `${p.name} — SHEGLAM PK`, short, notes]);
      const productId = r.rows[0].id;
      summary.imported++;
      status === "PUBLISHED" ? summary.published++ : summary.draft++;

      // Replace variants and images so a re-run converges rather than piles up.
      await c.query("DELETE FROM product_images WHERE product_id=$1", [productId]);
      await c.query("DELETE FROM product_variants WHERE product_id=$1", [productId]);

      const imgs = MANIFEST.filter((m) => m.num === p.num);
      const variantIdByShade = {};
      for (let i = 0; i < p.shades.length; i++) {
        const shade = p.shades[i];
        const v = await c.query(
          `INSERT INTO product_variants (product_id, sku, variant_name, option_name, stock_quantity, position, is_available)
           VALUES ($1,$2,$3,'Shade',0,$4,true) RETURNING id`,
          [productId, `${sku}-${slugify(shade).toUpperCase()}`, shade, i]);
        variantIdByShade[shade] = v.rows[0].id;
        summary.variants++;
      }

      for (let i = 0; i < imgs.length; i++) {
        const m = imgs[i];
        await c.query(
          `INSERT INTO product_images (product_id, variant_id, url, alt, position, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [productId, m.shade ? variantIdByShade[m.shade] || null : null,
           `/assets/img/products/${m.file}`,
           m.shade ? `${p.name} — ${m.shade}` : p.name, i, i === 0]);
        summary.images++;
      }
    }

    /* Everything not in the PDF is archived. ARCHIVED products vanish from
       the storefront but their rows survive, so order_items still resolve. */
    if (toArchive.length) {
      const res = await c.query(
        `UPDATE products SET status='ARCHIVED', archived_at=now(), updated_at=now()
          WHERE id = ANY($1) RETURNING id`, [toArchive.map((e) => e.id)]);
      summary.archived = res.rowCount;
    }

    await c.query("COMMIT");

    console.log("=== IMPORT SUMMARY ===");
    console.log(`  Products found in PDF : ${products.length}`);
    console.log(`  Products imported     : ${summary.imported}`);
    console.log(`  Products published    : ${summary.published}`);
    console.log(`  Products draft        : ${summary.draft}`);
    console.log(`  Products archived     : ${summary.archived}`);
    console.log(`  Variants created      : ${summary.variants}`);
    console.log(`  Images linked         : ${summary.images}`);
    console.log(`  Products with issues  : ${products.filter((p) => p.issue).length}`);
    products.filter((p) => p.issue).forEach((p) => console.log(`      #${p.num} ${p.name}`));
    console.log("");
  } catch (e) {
    await c.query("ROLLBACK");
    console.error(`\n✗ Rolled back — nothing imported: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error("\n✗", e.message, "\n"); process.exit(1); });
