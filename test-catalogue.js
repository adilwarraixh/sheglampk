/* =========================================================
   test-catalogue.js — product saves, shade photos, stock, rebuilds

   Run:  node test-catalogue.js

   Works on throwaway DRAFT products it creates and deletes, and on a
   local stand-in for Vercel's deploy hook, so a run changes nothing a
   customer can see and never starts a real build.
   ========================================================= */
process.env.DEPLOY_HOOK_URL = "";      // set before db/client.js loads .env.local

const http = require("http");
const { sql } = require("./db/client.js");
const P = require("./lib/products-admin.js");
const R = require("./lib/rebuild.js");
const catalogue = require("./lib/catalogue.js");

let pass = 0, fail = 0;
const results = [];
function check(name, condition, detail = "") {
  if (condition) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
}
async function refused(fn, pattern) {
  try { await fn(); return false; } catch (e) { return pattern ? pattern.test(e.message) : true; }
}

(async () => {
  const tag = "zztest" + Date.now().toString(36);
  const [cat] = await sql`SELECT id FROM categories WHERE is_active ORDER BY position LIMIT 1`;
  const [rebuildBefore] = await sql`SELECT * FROM site_rebuilds WHERE id = 1`;
  const created = [];
  let server = null;

  const base = (extra = {}) => ({
    name: `Test Lip ${tag}`, status: "DRAFT", price: 1000, categoryId: cat.id, sku: `TST-${tag}`, ...extra,
  });

  try {
    /* ---------------------------------------------------------- */
    console.log("\n=== SHADES AND THEIR PHOTOS ===");
    const p = await P.createProduct(base({
      variants: [
        { name: "Rose", hex: "#E83E70", stock: 4 },
        { name: "Nude", hex: "c9a", stock: 6 },
        { name: "Berry", hex: null, stock: 0 },
      ],
      images: [
        { url: `/assets/img/${tag}-main.png`, alt: "main", shade: null },
        { url: `/assets/img/${tag}-rose.png`, alt: "rose", shade: "Rose" },
        { url: `/assets/img/${tag}-nude.png`, alt: "nude", shade: "nude" },
      ],
    }));
    created.push(p.id);

    let full = await P.adminGet(p.id);
    const shade = (n) => full.variants.find((v) => v.variant_name === n) || {};
    const linkOf = (suffix) => (full.images.find((i) => i.url.endsWith(suffix)) || {}).variant_id;
    const stockOf = async (id) => (await sql`SELECT stock_quantity FROM products WHERE id = ${id}`)[0].stock_quantity;

    check("colour stored as lower-case hex", shade("Rose").hex === "#e83e70", shade("Rose").hex);
    check("short hex widened (#c9a → #cc99aa)", shade("Nude").hex === "#cc99aa", shade("Nude").hex);
    check("no colour stays empty, not grey", shade("Berry").hex === null, String(shade("Berry").hex));
    check("photo linked to its shade by name", String(linkOf("rose.png")) === String(shade("Rose").id));
    check("shade name match ignores case", String(linkOf("nude.png")) === String(shade("Nude").id));
    check("general photo belongs to no shade", linkOf("main.png") === null);
    check("product stock is the total of its shades", (await stockOf(p.id)) === 10, String(await stockOf(p.id)));

    const roseId = shade("Rose").id, nudeId = shade("Nude").id;

    /* Saved again the way the portal does it: rename, reorder, drop one. */
    await P.updateProduct(p.id, base({
      price: 1200,
      variants: [
        { id: nudeId, name: "Nude", hex: "#ccaa99", stock: 6 },
        { id: roseId, name: "Rose Petal", hex: "#e83e70", stock: 9 },
      ],
      images: [
        { url: `/assets/img/${tag}-main.png`, alt: "main", shade: null },
        { url: `/assets/img/${tag}-rose.png`, alt: "rose", shade: "Rose Petal" },
        { url: `/assets/img/${tag}-nude.png`, alt: "nude", shade: "Nude" },
      ],
    }));
    full = await P.adminGet(p.id);
    check("shade ids survive a save", String(shade("Nude").id) === String(nudeId) && String(shade("Rose Petal").id) === String(roseId));
    check("a renamed shade keeps its photo", String(linkOf("rose.png")) === String(roseId));
    check("a removed shade is deleted", !full.variants.some((v) => v.variant_name === "Berry"));
    check("shade order follows the list", full.variants[0].variant_name === "Nude");
    check("product stock follows shade changes", (await stockOf(p.id)) === 15, String(await stockOf(p.id)));

    /* ---------------------------------------------------------- */
    console.log("\n=== AN IMPORT-STYLE UPDATE KEEPS WHAT IT DOES NOT SEND ===");
    await P.updateProduct(p.id, base({
      price: 1200,
      variants: [{ name: "Nude", stock: 2 }, { name: "Rose Petal", stock: 3 }],
      images: [`/assets/img/${tag}-rose.png`],
    }));
    full = await P.adminGet(p.id);
    check("colour kept when the update does not send one", shade("Rose Petal").hex === "#e83e70", shade("Rose Petal").hex);
    check("shade matched by name keeps its id", String(shade("Rose Petal").id) === String(roseId));
    check("a bare image URL keeps its shade link", String(linkOf("rose.png")) === String(roseId));

    /* ---------------------------------------------------------- */
    console.log("\n=== VALIDATION ===");
    check("a colour that is not a hex code is refused",
      await refused(() => P.updateProduct(p.id, base({ variants: [{ name: "X", hex: "red;background:url(x)" }] })), /colour/i));
    check("the same shade twice is refused",
      await refused(() => P.updateProduct(p.id, base({ variants: [{ name: "Same" }, { name: "same" }] })), /twice/i));
    const [{ n: variantsNow }] = await sql`SELECT count(*)::int AS n FROM product_variants WHERE product_id = ${p.id}`;
    check("a refused save changes nothing", variantsNow === 2, `${variantsNow} shades`);
    check("publishing without a category is refused",
      await refused(() => P.createProduct({ name: `No Category ${tag}`, status: "PUBLISHED", price: 500 }), /category/i));
    const noCat = await P.createProduct({ name: `No Category ${tag}`, status: "DRAFT", price: 500 });
    created.push(noCat.id);
    check("the Publish action also needs a category",
      await refused(() => P.setStatus(noCat.id, "PUBLISHED"), /category/i));

    /* ---------------------------------------------------------- */
    console.log("\n=== A SHADE WITH ORDERS IS RETIRED, NOT DELETED ===");
    const [order] = await sql`
      INSERT INTO orders (reference, customer_name, customer_phone, shipping_address, payment_method, subtotal, total)
      VALUES (${"TEST-" + tag}, 'Test', '0000000000', 'Test', 'Cash on Delivery', 0, 0) RETURNING id`;
    await sql`
      INSERT INTO order_items (order_id, product_id, variant_id, product_name, unit_price, quantity, line_total)
      VALUES (${order.id}, ${p.id}, ${nudeId}, 'Test', 0, 1, 0)`;
    await P.updateProduct(p.id, base({ variants: [{ id: roseId, name: "Rose Petal", stock: 3 }] }));
    const [retired] = await sql`SELECT is_available, stock_quantity FROM product_variants WHERE id = ${nudeId}`;
    check("ordered shade kept for the order, hidden and emptied",
      retired && retired.is_available === false && retired.stock_quantity === 0, JSON.stringify(retired));
    full = await P.adminGet(p.id);
    check("retired shade not offered in the portal form", !full.variants.some((v) => String(v.id) === String(nudeId)));
    check("retired shade not counted in product stock", (await stockOf(p.id)) === 3, String(await stockOf(p.id)));
    const [shaped] = await catalogue.attach([{ id: p.id, price: 1200, sale_price: null, stock_quantity: 3 }]);
    check("retired shade not sent to the shop", shaped.variants.length === 1 && shaped.variants[0].name === "Rose Petal");
    check("shop receives the shade's photo", /rose\.png$/.test(shaped.variants[0].image || ""), shaped.variants[0].image);
    check("in stock worked out from the shades", shaped.inStock === true);

    await P.updateProduct(p.id, base({ variants: [{ id: roseId, name: "Rose Petal", stock: 3 }, { name: "Nude", stock: 5 }] }));
    const [revived] = await sql`SELECT is_available, stock_quantity FROM product_variants WHERE id = ${nudeId}`;
    check("adding the shade back revives the same row", revived.is_available === true && revived.stock_quantity === 5);
    await sql`DELETE FROM orders WHERE id = ${order.id}`;

    const copy = await P.duplicateProduct(p.id);
    created.push(copy.id);
    const copyFull = await P.adminGet(copy.id);
    const copyRose = copyFull.variants.find((v) => v.variant_name === "Rose Petal");
    const copyImg = copyFull.images.find((i) => i.url.endsWith("rose.png"));
    check("a duplicate keeps each photo on its shade", copyRose && copyImg && String(copyImg.variant_id) === String(copyRose.id));

    /* ---------------------------------------------------------- */
    console.log("\n=== SHOP REBUILDS ===");
    check("without a hook it says so instead of pretending", (await R.requestRebuild("t")).status === "not-configured");

    let hits = 0, answer = 201;
    server = http.createServer((req, res) => { if (req.method === "POST") hits++; res.statusCode = answer; res.end("{}"); });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.DEPLOY_HOOK_URL = `http://127.0.0.1:${server.address().port}/deploy/secret-token`;
    await sql`UPDATE site_rebuilds SET requested_at = NULL, trigger_status = NULL, trigger_error = NULL, exported_at = NULL WHERE id = 1`;

    const r1 = await R.requestRebuild("first", { by: "test" });
    check("a change starts a build", r1.status === "queued" && !r1.coalesced && hits === 1, `${JSON.stringify(r1)} hits=${hits}`);
    const r2 = await R.requestRebuild("second", { by: "test" });
    check("a change before that build reads the catalogue joins it", r2.coalesced === true && hits === 1, `hits=${hits}`);
    check("status: on its way", (await R.rebuildStatus()).state === "queued");

    await R.markExported();
    check("status: publishing once the build has read the catalogue", (await R.rebuildStatus()).state === "publishing");
    const r3 = await R.requestRebuild("third", { by: "test" });
    check("a change after the build read the catalogue starts another", r3.status === "queued" && !r3.coalesced && hits === 2, `hits=${hits}`);

    answer = 500;
    await sql`UPDATE site_rebuilds SET exported_at = now() WHERE id = 1`;
    const r4 = await R.requestRebuild("fourth", { by: "test" });
    check("Vercel refusing is reported, not hidden", r4.status === "failed" && /500/.test(r4.error || ""), JSON.stringify(r4));
    check("the hook URL never appears in the error", !/127\.0\.0\.1|secret-token/.test(String(r4.error)));
    check("status: failed", (await R.rebuildStatus()).state === "failed");
    answer = 201;
    const r5 = await R.requestRebuild("retry", { by: "test" });
    check("a failed request does not block the next", r5.status === "queued" && hits === 4, `hits=${hits}`);

    await sql`UPDATE site_rebuilds SET requested_at = now() - interval '11 minutes', trigger_status = 'QUEUED', exported_at = NULL WHERE id = 1`;
    check("status: flags a build that never ran", (await R.rebuildStatus()).state === "stuck");
    const r6 = await R.requestRebuild("after stuck", { by: "test" });
    check("an expired request does not swallow new changes", r6.status === "queued" && !r6.coalesced && hits === 5, `hits=${hits}`);

    await sql`UPDATE site_rebuilds SET exported_at = now() WHERE id = 1`;
    const before = hits;
    const both = await Promise.all([R.requestRebuild("a"), R.requestRebuild("b")]);
    check("two saves at the same moment start one build",
      hits - before === 1 && both.filter((x) => x.coalesced).length === 1, `builds=${hits - before} ${JSON.stringify(both)}`);
  } finally {
    if (server) server.close();
    process.env.DEPLOY_HOOK_URL = "";
    await sql`DELETE FROM orders WHERE reference = ${"TEST-" + tag}`;
    for (const id of created) await sql`DELETE FROM products WHERE id = ${id}`;
    if (rebuildBefore) {
      await sql`
        UPDATE site_rebuilds SET requested_at = ${rebuildBefore.requested_at}, requested_by = ${rebuildBefore.requested_by},
               reason = ${rebuildBefore.reason}, trigger_status = ${rebuildBefore.trigger_status},
               trigger_error = ${rebuildBefore.trigger_error}, exported_at = ${rebuildBefore.exported_at}
         WHERE id = 1`;
    }
    const [{ n: left }] = await sql`SELECT count(*)::int AS n FROM products WHERE sku LIKE ${"TST-" + tag + "%"} OR name LIKE ${"%" + tag + "%"}`;
    check("cleaned up", left === 0, `${left} test products left`);
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\ntest error:", e.message, "\n", e.stack); process.exit(1); });
