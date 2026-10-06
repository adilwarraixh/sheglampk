/* =========================================================
   test-admin.js — product saves are all-or-nothing, the audit log says
   what changed, Shopify files import the right way round, and Settings
   reach the shop

   Run:  node test-admin.js     (against the dev branch; refuses production)

   Throwaway products and settings are removed or restored at the end.
   Never starts a shop rebuild.
   ========================================================= */
process.env.DEPLOY_HOOK_URL = "";      // set before db/client.js loads .env.local

const fs = require("fs");
const vm = require("vm");
const { sql } = require("./db/client.js");
const P = require("./lib/products-admin.js");
const D = require("./lib/admin-data.js");
const S = require("./lib/site-admin.js");
const I = require("./lib/product-import.js");
const { snapshot } = require("./db/export-catalogue.js");

let pass = 0, fail = 0;
const results = [];
function check(name, condition, detail = "") {
  if (condition) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
}
const refused = async (fn, re) => { try { await fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };

(async () => {
  const tag = "zzad" + Date.now().toString(36);
  const [cat] = await sql`SELECT id, slug FROM categories WHERE is_active ORDER BY position LIMIT 1`;
  const settingsBefore = await sql`SELECT key, value, updated_by, updated_at FROM settings`;
  const created = [];
  const base = (extra) => ({ name: `Test Admin ${tag}`, sku: `TST-${tag}`, status: "DRAFT", categoryId: cat.id, price: 2000, ...extra });

  try {
    console.log("\n=== A PRODUCT SAVE IS ALL OR NOTHING ===");
    const other = await P.createProduct({ name: `Other ${tag}`, sku: `TST-${tag}-O`, status: "DRAFT", price: 100,
      variants: [{ name: "Taken", sku: `TST-${tag}-SHADE`, stock: 1 }] });
    created.push(other.id);
    const p = await P.createProduct(base({ variants: [{ name: "Rose", stock: 2 }], images: [{ url: `/assets/img/${tag}.png`, shade: "Rose" }] }));
    created.push(p.id);
    check("a new product's photo links to its new shade in the same save",
      (await P.adminGet(p.id)).images[0].variant_id !== null);
    const clash = await refused(() => P.updateProduct(p.id, base({ name: `Renamed ${tag}`, price: 2500,
      variants: [{ name: "Rose", stock: 2 }, { name: "Nude", sku: `TST-${tag}-SHADE`, stock: 3 }] })), /SKU/);
    check("a shade SKU used elsewhere is refused with a readable message", clash);
    const after = await P.adminGet(p.id);
    check("…and nothing of that save landed: name, price and shades unchanged",
      after.name === `Test Admin ${tag}` && Number(after.price) === 2000 && after.variants.length === 1,
      `${after.name} / ${after.price} / ${after.variants.length} shades`);

    console.log("\n=== THE AUDIT LOG RECORDS BEFORE → AFTER ===");
    const before = await P.auditView(p.id);
    await P.updateProduct(p.id, base({ price: 2400, salePrice: 1800, isBestseller: true, variants: [{ name: "Rose", stock: 7 }] }));
    const diff = P.changes(before, await P.auditView(p.id));
    check("price change recorded as [2000, 2400]", JSON.stringify(diff.price) === "[2000,2400]", JSON.stringify(diff.price));
    check("sale recorded as [null, 1800]", JSON.stringify(diff.sale_price) === "[null,1800]", JSON.stringify(diff.sale_price));
    check("flag and shade stock recorded", diff.is_bestseller && diff.shades && /Rose:7/.test(diff.shades[1]), JSON.stringify(diff));
    check("unchanged fields are left out", !("name" in diff) && !("status" in diff), Object.keys(diff).join(","));
    const shade = (await P.adminGet(p.id)).variants[0];
    const stock = await D.setStock({ variantId: shade.id, quantity: 4 });
    check("a stock edit reports the figure it replaced (7 → 4)", stock.previous === 7 && stock.quantity === 4, JSON.stringify(stock));
    check("a product sold in shades refuses a product-level stock edit",
      await refused(() => D.setStock({ productId: p.id, quantity: 9 }), /per shade/));

    console.log("\n=== SHOPIFY FILES IMPORT THE RIGHT WAY ROUND ===");
    const csv = [
      "Title,Variant SKU,Variant Price,Variant Compare At Price,Status",
      `Shopify Sale ${tag},TST-${tag}-S1,1500,2000,draft`,
      `Shopify Full ${tag},TST-${tag}-S2,1800,,draft`,
      `Shopify Same ${tag},TST-${tag}-S3,1800,1800,draft`,
    ].join("\n");
    const plan = await I.analyse(csv);
    check("the file is understood, no errors", plan.summary && plan.summary.errors === 0, JSON.stringify(plan.summary || plan.fatal));
    const done = await I.apply(csv);
    created.push(...done.products.map((x) => x.id));
    const row = async (sku) => (await sql`SELECT price, sale_price FROM products WHERE sku = ${sku}`)[0];
    const s1 = await row(`TST-${tag}-S1`), s2 = await row(`TST-${tag}-S2`), s3 = await row(`TST-${tag}-S3`);
    check("compare-at 2000 / price 1500 → regular 2000, sale 1500", Number(s1.price) === 2000 && Number(s1.sale_price) === 1500, JSON.stringify(s1));
    check("no compare-at → regular 1800, no sale", Number(s2.price) === 1800 && s2.sale_price === null, JSON.stringify(s2));
    check("compare-at not higher → no sale", Number(s3.price) === 1800 && s3.sale_price === null, JSON.stringify(s3));

    // The importer's own template headers ("Sale Price", "Short Description"…) used to read as empty.
    const tpl = await I.apply([
      "Name,SKU,Price,Sale Price,Short Description,SEO Title,Status",
      `Template Row ${tag},TST-${tag}-T1,2000,1500,Short words,Seo words,draft`,
    ].join("\n"));
    created.push(...tpl.products.map((x) => x.id));
    const [t1] = await sql`SELECT price, sale_price, short_description, seo_title FROM products WHERE sku = ${"TST-" + tag + "-T1"}`;
    check("template columns Sale Price / Short Description / SEO Title are read",
      t1 && Number(t1.sale_price) === 1500 && t1.short_description === "Short words" && t1.seo_title === "Seo words", JSON.stringify(t1));

    console.log("\n=== SETTINGS ===");
    const bad = await refused(() => S.saveSettings({ flat_shipping: 999, contact_email: "not-an-email" }, "test"), /email/);
    const [{ value: flatNow }] = await sql`SELECT coalesce((SELECT value FROM settings WHERE key = 'flat_shipping'), '"unset"'::jsonb) AS value`;
    check("one bad value saves nothing (flat charge untouched)", bad && JSON.stringify(flatNow) !== "999", JSON.stringify(flatNow));
    const changed = await S.saveSettings({ flat_shipping: 300, free_shipping_over: 4000, whatsapp_number: "+92 300 1234567",
      contact_email: "help@example.com", announcement: `Test announcement ${tag}`, return_days: 10 }, "test");
    check("only values that changed are reported", changed.length >= 1 && changed.every((c) => JSON.stringify(c.previous) !== JSON.stringify(c.value)));
    const again = await S.saveSettings({ flat_shipping: 300 }, "test");
    check("saving the same value again reports no change", again.length === 0, JSON.stringify(again));
    check("a blank delivery charge is refused, not stored as 0",
      await refused(() => S.saveSettings({ flat_shipping: "" }, "test"), /needs a number/));
    await S.saveSettings({ low_stock_default: 2.6 }, "test");
    check("decimals are rounded (2.6 → 3)", (await S.shopSettings()).lowStockDefault === 3);
    await S.saveSettings({ whatsapp_number: "0300 1234567" }, "test");
    check("a local WhatsApp number becomes international (0300… → 92300…)", (await S.shopSettings()).whatsapp === "923001234567");
    check("a WhatsApp number that is too short is refused", await refused(() => S.saveSettings({ whatsapp_number: "12345" }, "test"), /international/));
    await sql`DELETE FROM settings WHERE key = 'orders_enabled'`;
    const shown = (await S.getSettings()).find((x) => x.key === "orders_enabled");
    check("a setting never saved shows the value in use (ordering on), not blank/off", shown.value === true && shown.isSet === false);
    const live = await S.shopSettings();
    check("WhatsApp number stored as digits for wa.me links", live.whatsapp === "923001234567", live.whatsapp);
    const snap = await snapshot();
    check("the export carries the settings to the shop", snap.settings && snap.settings.flatShipping === 300 && snap.settings.freeShippingOver === 4000);
    const self = { SGPK_PRODUCTS: snap.products, SGPK_SETTINGS: snap.settings, SGPK_PHOTOS: [] };
    vm.runInNewContext(fs.readFileSync(__dirname + "/data/catalog.js", "utf8"), { self, console });
    const SITE = self.SGPK.SITE;
    check("the shop's delivery figures come from Settings", SITE.freeShippingOver === 4000 && SITE.flatShipping === 300);
    check("…and its contact details and returns window", SITE.email === "help@example.com" && SITE.whatsapp === "923001234567" && SITE.returnDays === 10);
    check("the announcement leads the top bar", self.SGPK.PROMOS[0] === `Test announcement ${tag}`, self.SGPK.PROMOS[0]);
    check("the FAQ quotes the same charges", /Rs\. 300.*Rs\. 4,000/.test(self.SGPK.FAQ[0].items[2].a), self.SGPK.FAQ[0].items[2].a);
  } finally {
    await sql`DELETE FROM settings`;
    for (const s of settingsBefore)
      await sql`INSERT INTO settings (key, value, updated_by, updated_at) VALUES (${s.key}, ${JSON.stringify(s.value)}::jsonb, ${s.updated_by}, ${s.updated_at})`;
    for (const id of created) await sql`DELETE FROM products WHERE id = ${id}`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM products WHERE sku LIKE ${"TST-" + tag + "%"} OR name LIKE ${"%" + tag + "%"}`;
    check("cleaned up, settings restored", n === 0, `${n} products left`);
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\ntest error:", e.message, "\n", e.stack); process.exit(1); });
