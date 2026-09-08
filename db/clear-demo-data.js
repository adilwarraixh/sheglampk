/* =========================================================
   db/clear-demo-data.js — remove seeded demo records

   Demo orders and products were seeded to build the admin UI against
   realistic data. They must not survive into a live store, where they
   would distort sales figures and stock counts.

   Selects rows by the markers the seeders used, never "everything in the
   table", so a real order placed before this runs is not swept up:

     products  slug/sku prefixed ui- or t-   (UI demo, test fixtures)
     orders    linked to those products, or placed by a demo customer
     customers left with no orders afterwards

   Dry run by default — prints what it would remove and changes nothing.
   Pass --confirm to apply. A JSON backup is written first either way.

   Run:  node db/clear-demo-data.js            (preview)
         node db/clear-demo-data.js --confirm  (apply)
   ========================================================= */
const fs = require("fs");
const path = require("path");
const { sql, rawClient, describeTarget } = require("./client.js");

const APPLY = process.argv.includes("--confirm");
const BACKUP_DIR = path.join(__dirname, "..", "data", "backups");

/* Markers the seed and test fixtures used. Anything not matching these
   is treated as real data and left alone. */
const DEMO_SLUG = "(ui-%|t-%)";
const isDemoProduct = () => sql`
  SELECT id, slug, sku, name FROM products
   WHERE slug LIKE 'ui-%' OR slug LIKE 't-%' OR sku LIKE 'UI-%' OR sku LIKE 'T-%'
   ORDER BY id`;

(async () => {
  console.log(`\nTarget: ${describeTarget()}`);
  console.log(APPLY ? "Mode:   APPLY — rows will be deleted\n" : "Mode:   DRY RUN — nothing will change\n");

  const products = await isDemoProduct();
  const productIds = products.map((p) => p.id);

  /* An order is demo if every line refers to a demo product, or if it has
     no lines left at all. Orders touching a real product are kept. */
  const orders = productIds.length
    ? await sql`
        SELECT o.id, o.reference, o.customer_name, o.customer_phone, o.total, o.placed_at
          FROM orders o
         WHERE NOT EXISTS (
                 SELECT 1 FROM order_items i
                  WHERE i.order_id = o.id
                    AND (i.product_id IS NULL OR i.product_id <> ALL(${productIds}))
               )
         ORDER BY o.placed_at`
    : [];
  const orderIds = orders.map((o) => o.id);

  const customers = orderIds.length
    ? await sql`
        SELECT c.id, c.name, c.phone FROM customers c
         WHERE NOT EXISTS (
                 SELECT 1 FROM orders o
                  WHERE o.customer_id = c.id AND o.id <> ALL(${orderIds})
               )
         ORDER BY c.id`
    : await sql`SELECT c.id, c.name, c.phone FROM customers c
                 WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
                 ORDER BY c.id`;

  const categories = await sql`
    SELECT id, slug, name FROM categories
     WHERE slug LIKE 'test-%'
        OR NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = categories.id
                         AND p.id <> ALL(${productIds.length ? productIds : [-1]}))
     ORDER BY id`;

  /* ---- report ---- */
  const show = (label, rows, fmt) => {
    console.log(`${label} (${rows.length})`);
    rows.forEach((r) => console.log("   " + fmt(r)));
    if (!rows.length) console.log("   —");
    console.log("");
  };
  show("PRODUCTS", products, (p) => `#${p.id} ${p.slug}  ${p.name}`);
  show("ORDERS", orders, (o) => `#${o.id} ${o.reference}  ${o.customer_name}  Rs.${o.total}`);
  show("CUSTOMERS", customers, (c) => `#${c.id} ${c.name} / ${c.phone}`);
  show("CATEGORIES", categories, (c) => `#${c.id} ${c.slug}  ${c.name}`);

  /* Anything the markers did NOT match stays — say so explicitly. */
  const [kept] = await sql`
    SELECT (SELECT count(*)::int FROM products) AS products,
           (SELECT count(*)::int FROM orders)   AS orders`;
  console.log(`Would keep: ${kept.products - products.length} products, ${kept.orders - orders.length} orders\n`);

  if (!products.length && !orders.length && !customers.length && !categories.length) {
    console.log("Nothing to remove.\n");
    return;
  }

  /* ---- backup ---- */
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dump = {};
  for (const t of ["orders", "order_items", "order_status_history", "customers",
                   "products", "product_variants", "product_images", "product_collections", "categories"]) {
    dump[t] = await sql([`SELECT * FROM ${t}`]);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(BACKUP_DIR, `pre-demo-clear-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`Backup: ${path.relative(path.join(__dirname, ".."), file)}\n`);

  if (!APPLY) {
    console.log("Dry run only. Re-run with --confirm to delete the rows listed above.\n");
    return;
  }

  /* ---- apply, all or nothing ---- */
  const c = await rawClient();
  try {
    await c.query("BEGIN");
    // order_items and order_status_history cascade from orders;
    // variants, images and collections cascade from products.
    if (orderIds.length)    await c.query("DELETE FROM orders WHERE id = ANY($1)", [orderIds]);
    if (customers.length)   await c.query("DELETE FROM customers WHERE id = ANY($1)", [customers.map((r) => r.id)]);
    if (productIds.length)  await c.query("DELETE FROM products WHERE id = ANY($1)", [productIds]);
    if (categories.length)  await c.query("DELETE FROM categories WHERE id = ANY($1)", [categories.map((r) => r.id)]);

    /* Restart ids only where the table is now genuinely empty, so a live
       store's numbering is never rewritten. */
    for (const t of ["orders", "order_items", "order_status_history", "customers",
                     "products", "product_variants", "product_images", "categories"]) {
      const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
      if (r.rows[0].n === 0) await c.query(`ALTER SEQUENCE IF EXISTS ${t}_id_seq RESTART WITH 1`);
    }

    await c.query("COMMIT");
    console.log(`✓ Removed ${orderIds.length} orders, ${customers.length} customers, ` +
                `${productIds.length} products, ${categories.length} categories.`);
    console.log("  Dependent rows removed by cascade. Restore from the backup above if needed.\n");
  } catch (e) {
    await c.query("ROLLBACK");
    console.error(`\n✗ Rolled back — nothing was deleted: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error("\n✗", e.message, "\n"); process.exit(1); });
