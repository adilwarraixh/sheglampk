/* =========================================================
   export-shopify.js — turn the catalogue into a Shopify import CSV

   Shopify's product CSV is one row PER VARIANT. The first row of a
   product carries the product-level fields (title, body, tags…);
   the rows after it repeat only the Handle and the variant columns.
   Getting that wrong is the usual reason an import creates 271
   separate products instead of 194 with variants.

   Run:  node export-shopify.js
         node export-shopify.js --url https://sheglampk.online
              (image base — Shopify DOWNLOADS images by URL, so they
               must be publicly reachable at import time)
   ========================================================= */
const fs = require("fs");
const path = require("path");
const D = require("./data/catalog.js");

const { SITE, PRODUCTS } = D;

const argUrl = (() => {
  const i = process.argv.indexOf("--url");
  return i > -1 ? String(process.argv[i + 1] || "").replace(/\/+$/, "") : "";
})();
const IMAGE_BASE = argUrl || SITE.domain.replace(/\/+$/, "");

const OUT_DIR = path.join(__dirname, "exports");
const OUT = path.join(OUT_DIR, "shopify-products.csv");

/* Shopify's expected column order. Anything omitted takes Shopify's default. */
const COLUMNS = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published",
  "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Option3 Name", "Option3 Value",
  "Variant SKU", "Variant Grams", "Variant Inventory Tracker", "Variant Inventory Qty",
  "Variant Inventory Policy", "Variant Fulfillment Service", "Variant Price",
  "Variant Compare At Price", "Variant Requires Shipping", "Variant Taxable",
  "Image Src", "Image Position", "Image Alt Text", "Gift Card",
  "SEO Title", "SEO Description", "Status",
];

/* RFC 4180: quote anything containing a comma, quote or newline; double inner quotes. */
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvRow = (obj) => COLUMNS.map((c) => csvCell(obj[c])).join(",");

/* Shopify handles: lowercase, alphanumeric and hyphens only. */
const handleOf = (slug) =>
  String(slug).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/* Rough shipping weight from the pack size — Shopify wants grams.
   Only matters if you ever use weight-based rates; flat-rate ignores it. */
function grams(size) {
  const m = String(size || "").match(/([\d.]+)\s*(ml|g)/i);
  if (!m) return 40;
  const n = parseFloat(m[1]);
  const packaging = 25;                       // bottle, cap, carton
  return Math.max(10, Math.round(n + packaging));
}

function tagsFor(p) {
  const t = [p.categoryLabel, p.sub, p.finish];
  if (p.isNew) t.push("New Arrival");
  if (p.isBestSeller) t.push("Bestseller");
  if (p.oldPrice) t.push("Sale");
  if (p.shades && p.shades.length) t.push("Multi-Shade");
  return [...new Set(t.filter(Boolean))].join(", ");
}

/* Only real photographs are exported. The generated tiles are data: URIs —
   Shopify cannot fetch those, and they are placeholders anyway. */
function imageUrlFor(p) {
  if (/^data:/.test(p.image)) return "";
  return `${IMAGE_BASE}/${String(p.image).replace(/^\/+/, "")}`;
}

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------- build ---------- */
const rows = [];
const warnings = [];
const seenHandles = new Set();
let variantCount = 0, imageCount = 0;

PRODUCTS.forEach((p) => {
  const handle = handleOf(p.slug);
  if (seenHandles.has(handle)) {
    warnings.push(`duplicate handle "${handle}" — Shopify would merge these into one product`);
    return;
  }
  seenHandles.add(handle);

  const img = imageUrlFor(p);
  if (img) imageCount++;

  const bodyHtml =
    `<p>${esc(p.desc)}</p>` +
    `<ul><li>Size: ${esc(p.size)}</li><li>Finish: ${esc(p.finish)}</li>` +
    `<li>Category: ${esc(p.categoryLabel)} — ${esc(p.sub)}</li></ul>`;

  const variants = p.shades && p.shades.length
    ? p.shades.map((s) => ({
        optName: "Shade",
        optValue: s.name,
        sku: `${p.sku}-${handleOf(s.name).toUpperCase().slice(0, 12)}`,
        qty: Number.isFinite(+s.stock) ? +s.stock : 0,
      }))
    // Shopify's own convention for a product with no real options.
    : [{ optName: "Title", optValue: "Default Title", sku: p.sku, qty: p.stock == null ? 20 : +p.stock }];

  variants.forEach((v, i) => {
    variantCount++;
    const first = i === 0;
    rows.push({
      Handle: handle,
      // Product-level fields appear on the first row only.
      Title: first ? p.name : "",
      "Body (HTML)": first ? bodyHtml : "",
      Vendor: first ? "SHEGLAM" : "",
      Type: first ? p.sub : "",
      Tags: first ? tagsFor(p) : "",
      Published: first ? "TRUE" : "",
      "Option1 Name": first ? v.optName : "",
      "Option1 Value": v.optValue,
      "Option2 Name": "", "Option2 Value": "", "Option3 Name": "", "Option3 Value": "",
      "Variant SKU": v.sku,
      "Variant Grams": grams(p.size),
      "Variant Inventory Tracker": "shopify",
      "Variant Inventory Qty": v.qty,
      "Variant Inventory Policy": "deny",         // stop selling at zero
      "Variant Fulfillment Service": "manual",
      "Variant Price": p.price,
      "Variant Compare At Price": p.oldPrice || "",
      "Variant Requires Shipping": "TRUE",
      "Variant Taxable": "TRUE",                  // your prices are tax-inclusive
      "Image Src": first ? img : "",
      "Image Position": first && img ? 1 : "",
      "Image Alt Text": first && img ? p.name : "",
      "Gift Card": first ? "FALSE" : "",
      "SEO Title": first ? `${p.name} | ${SITE.name}`.slice(0, 70) : "",
      "SEO Description": first
        ? `Buy ${p.name} in Pakistan. ${p.desc}`.replace(/\s+/g, " ").slice(0, 160)
        : "",
      Status: first ? "active" : "",
    });

    if (v.qty === 0) warnings.push(`${p.name} — shade "${v.optValue}" has 0 stock (imports as sold out)`);
  });
});

/* ---------- write ---------- */
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, [COLUMNS.join(","), ...rows.map(csvRow)].join("\n") + "\n", "utf8");

/* ---------- report ---------- */
const size = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`\nShopify product CSV\n`);
console.log(`  file      : exports/shopify-products.csv  (${size}KB)`);
console.log(`  products  : ${seenHandles.size}`);
console.log(`  rows      : ${rows.length}  (one per variant)`);
console.log(`  variants  : ${variantCount}`);
console.log(`  on sale   : ${PRODUCTS.filter((p) => p.oldPrice).length}  (compare-at price set)`);
console.log(`  images    : ${imageCount}  of ${PRODUCTS.length}`);

const zeroStock = warnings.filter((w) => w.includes("0 stock")).length;
const dupes = warnings.filter((w) => w.includes("duplicate handle"));
if (dupes.length) {
  console.log(`\n  ⚠ ${dupes.length} duplicate handle(s) skipped:`);
  dupes.slice(0, 5).forEach((w) => console.log(`     ${w}`));
}
if (zeroStock) console.log(`\n  note: ${zeroStock} variant(s) have 0 stock and import as sold out.`);

console.log(`\n  IMAGES — read this before importing`);
if (imageCount < PRODUCTS.length) {
  console.log(`  ${PRODUCTS.length - imageCount} products have no photo, so their Image Src is blank.`);
  console.log(`  They import fine and show Shopify's placeholder until you add photos.`);
}
console.log(`  Shopify DOWNLOADS images from the URL in the CSV, so the ${imageCount} that`);
console.log(`  do have one must be publicly reachable at import time. Currently pointing at:`);
console.log(`    ${IMAGE_BASE}/assets/img/products/...`);
console.log(`  If that is not live yet, re-run with:  node export-shopify.js --url https://your-live-site`);

console.log(`\n  TO IMPORT`);
console.log(`   1. Shopify admin → Products → Import`);
console.log(`   2. Upload exports/shopify-products.csv`);
console.log(`   3. Leave "Overwrite products with the same handle" UNTICKED on a first import`);
console.log(`   4. Preview, then Import. Check a multi-shade product afterwards —`);
console.log(`      e.g. Complexion Pro should show 8 shades under one product, not 8 products.`);
console.log(`   5. Build collections from the Tags column (Face, Eyes, Lips, Bestseller, Sale…)\n`);
