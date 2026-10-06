/* =========================================================
   test-new-in.js — a newly published product reaches the homepage's
   New in section by itself, and leaves it by date

   Run:  node test-new-in.js

   The homepage is built from the catalogue export, run through
   data/catalog.js. This test does the same: it takes the export's
   snapshot, loads it into the real catalog.js (its browser code path, in a
   sandbox) and reads FEEDS.new — the list the homepage section and the
   New In page are made from. Works on throwaway products, removed at the
   end; never starts a shop rebuild.
   ========================================================= */
process.env.DEPLOY_HOOK_URL = "";      // set before db/client.js loads .env.local

const fs = require("fs");
const vm = require("vm");
const { sql } = require("./db/client.js");
const P = require("./lib/products-admin.js");
const catalogue = require("./lib/catalogue.js");
const { snapshot } = require("./db/export-catalogue.js");

let pass = 0, fail = 0;
const results = [];
function check(name, condition, detail = "") {
  if (condition) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
}

const CATALOG_SRC = fs.readFileSync(__dirname + "/data/catalog.js", "utf8");
/* What the shop would show right now. src/content.js puts the first five of
   FEEDS.new() in the homepage's New in section. */
async function shop() {
  const self = { SGPK_PRODUCTS: (await snapshot()).products, SGPK_PHOTOS: [] };
  vm.runInNewContext(CATALOG_SRC, { self, console });
  const D = self.SGPK;
  return {
    homepageNew: D.FEEDS.new().slice(0, 5).map((p) => p.slug),
    newIn: D.FEEDS.new().map((p) => p.slug),
    all: D.FEEDS.all().map((p) => p.slug),
    category: (key) => D.FEEDS[key]().map((p) => p.slug),
  };
}

(async () => {
  const tag = "zznew" + Date.now().toString(36);
  const [cat] = await sql`SELECT id, slug FROM categories WHERE is_active AND slug IN ('face','eyes','lips') ORDER BY position LIMIT 1`;
  const created = [];
  const stamp = async (id) => (await sql`SELECT published_at FROM products WHERE id = ${id}`)[0].published_at;

  try {
    console.log("\n=== A DRAFT IS NOT NEW, OR ANYWHERE ===");
    const p = await P.createProduct({ name: `Test New ${tag}`, sku: `TST-${tag}`, status: "DRAFT", price: 1500, categoryId: cat.id, stockQuantity: 5 });
    created.push(p.id);
    check("a draft has no publish date", (await stamp(p.id)) === null);
    let s = await shop();
    check("a draft is not in the catalogue", !s.all.includes(p.slug));

    console.log("\n=== PUBLISHED IN THE PORTAL, NOTHING ELSE TICKED ===");
    await P.setStatus(p.id, "PUBLISHED");
    const first = await stamp(p.id);
    check("the database stamps the publish date", first !== null);
    s = await shop();
    check("it is in the homepage's New in section", s.homepageNew.includes(p.slug), s.homepageNew.join(", "));
    check("it leads the section (newest first)", s.homepageNew[0] === p.slug, s.homepageNew[0]);
    check("it is on the New In page", s.newIn.includes(p.slug));
    check("it is in the catalogue", s.all.includes(p.slug));
    check("and on its category page", s.category(cat.slug).includes(p.slug));
    const viaApi = await catalogue.publishedProducts({ flag: "new", limit: 5 });
    check("the public API agrees it is new", viaApi.products.some((x) => x.slug === p.slug && x.isNew === true));

    console.log("\n=== UNPUBLISHED ===");
    await P.setStatus(p.id, "UNPUBLISHED");
    s = await shop();
    check("gone from New in", !s.newIn.includes(p.slug));
    check("gone from the catalogue", !s.all.includes(p.slug));

    console.log("\n=== PUBLISHED AGAIN ===");
    await P.setStatus(p.id, "PUBLISHED");
    check("keeps its first publish date (re-publishing is not 'new')", String(await stamp(p.id)) === String(first));

    console.log("\n=== NEW BY DATE ===");
    await sql`UPDATE products SET published_at = now() - make_interval(days => ${catalogue.NEW_FOR_DAYS + 1}) WHERE id = ${p.id}`;
    s = await shop();
    check(`after ${catalogue.NEW_FOR_DAYS} days it leaves New in`, !s.newIn.includes(p.slug));
    check("but stays in the catalogue", s.all.includes(p.slug));
    await sql`UPDATE products SET published_at = now() - make_interval(days => ${catalogue.NEW_FOR_DAYS - 1}) WHERE id = ${p.id}`;
    s = await shop();
    check(`a day before ${catalogue.NEW_FOR_DAYS} days it is still New`, s.newIn.includes(p.slug));

    console.log("\n=== KEPT NEW BY HAND ===");
    await sql`UPDATE products SET published_at = now() - interval '200 days', is_new_arrival = true WHERE id = ${p.id}`;
    s = await shop();
    check("'Keep showing as New' keeps an old product in New in", s.newIn.includes(p.slug));

    console.log("\n=== CREATED ALREADY PUBLISHED ===");
    const q = await P.createProduct({ name: `Test New Direct ${tag}`, sku: `TST-${tag}-2`, status: "PUBLISHED", price: 900, categoryId: cat.id, stockQuantity: 5 });
    created.push(q.id);
    check("publishing on creation also stamps the date", (await stamp(q.id)) !== null);
    s = await shop();
    check("and it leads New in", s.homepageNew[0] === q.slug, s.homepageNew[0]);
  } finally {
    for (const id of created) await sql`DELETE FROM products WHERE id = ${id}`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM products WHERE sku LIKE ${"TST-" + tag + "%"}`;
    check("cleaned up", n === 0, `${n} left`);
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\ntest error:", e.message, "\n", e.stack); process.exit(1); });
