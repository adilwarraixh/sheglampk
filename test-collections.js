/* =========================================================
   test-collections.js — collections from the admin portal, and search

   Run:  node test-collections.js     (against the dev branch; refuses production)

   Calls the real API handlers. Never starts a shop rebuild. Everything it
   creates is removed; admin passwords and sessions are put back as they
   were (test-helpers.js).
   ========================================================= */
const P = __dirname.split(String.fromCharCode(92)).join("/");
const { sql } = require(P + "/db/client");
process.env.DEPLOY_HOOK_URL = "";

const auth = require(P + "/lib/auth");
const C = require(P + "/lib/catalogue");
const PA = require(P + "/lib/products-admin");
const { snapshot } = require(P + "/db/export-catalogue");
const { snapshotCredentials, restoreCredentials } = require("./test-helpers.js");

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    end(p) { try { this.body = JSON.parse(p); } catch { this.body = p; } },
  };
}
async function call({ method = "GET", cookie, csrf, query = {}, body }) {
  const res = mockRes();
  await require(P + "/api/admin/collections.js")({
    method, url: "/api/admin/collections", headers: { cookie: cookie || "", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    socket: { remoteAddress: "127.0.0.1" }, query, body, on() {},
  }, res);
  return res;
}

let pass = 0, fail = 0;
const results = [];
function check(name, condition, detail = "") {
  if (condition) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
}

(async () => {
  const tag = "zzcol" + Date.now().toString(36);
  const saved = await snapshotCredentials();
  const mk = async (username) => {
    const [r] = await sql`SELECT id FROM users WHERE username = ${username}`;
    await sql`UPDATE users SET must_change_password = false WHERE id = ${r.id}`;
    const s = await auth.createSession(r.id, { ip: "127.0.0.1", userAgent: "ctest" });
    return { cookie: `sgpk_session=${s.token}`, csrf: s.csrf, token: s.token };
  };
  const U = await mk("umama"), A = await mk("ashba");
  const created = [];

  try {
    console.log("\n=== COLLECTIONS IN THE ADMIN ===");
    let r = await call({ cookie: A.cookie });
    check("ashba cannot manage collections → 403", r.statusCode === 403, String(r.statusCode));
    r = await call({ cookie: U.cookie });
    check("umama sees the four collections the shop had", r.statusCode === 200
      && ["camera-on-complexion", "blush-bar", "peel-and-reveal", "under-2000"].every((s) => r.body.collections.some((c) => c.slug === s)));
    const pub = r.body.products.filter((p) => p.status === "PUBLISHED");
    const [p1, p2] = pub;

    const body = { slug: `${tag}-edit`, title: `Test Edit ${tag}`, subtitle: "Hand-picked", blurb: "Two products.",
      tint: "#e83e70", position: 99, isActive: true, productIds: [p1.id, p2.id] };
    r = await call({ method: "POST", cookie: U.cookie, body });
    check("creating needs the CSRF token", r.statusCode === 403);
    r = await call({ method: "POST", cookie: U.cookie, csrf: U.csrf, body });
    check("a hand-picked collection is created", r.statusCode === 200 && r.body.collection.picks.length === 2, JSON.stringify(r.body).slice(0, 160));
    const id = r.body.collection && r.body.collection.id;
    if (id) created.push(id);
    check("and the shop is asked to update", r.body.rebuild && r.body.rebuild.status === "not-configured");

    let snap = await snapshot();
    let col = (snap.collections || []).find((c) => c.slug === `${tag}-edit`);
    check("the shop gets exactly the two picked products", col && col.dbIds.length === 2
      && col.dbIds.includes(p1.id) && col.dbIds.includes(p2.id), col && JSON.stringify(col.dbIds));

    r = await call({ method: "POST", cookie: U.cookie, csrf: U.csrf, body: { ...body, title: "Dup" } });
    check("a second collection cannot take the same web address", r.statusCode === 400 && /already uses/.test(r.body.error));
    for (const [what, bad] of [["a colour that is not #rrggbb", { tint: "red;background:url(x)" }],
                               ["a web address with a slash", { slug: "../x" }],
                               ["no title", { title: " " }]]) {
      r = await call({ method: "POST", cookie: U.cookie, csrf: U.csrf, body: { ...body, slug: `${tag}-bad`, ...bad } });
      check(`${what} is refused`, r.statusCode === 400, String(r.statusCode));
    }

    console.log("\n=== RULES PLUS PICKS ===");
    const sub = pub.find((p) => p.subcategory && p.id !== p1.id).subcategory;
    r = await call({ method: "PATCH", cookie: U.cookie, csrf: U.csrf, query: { id: String(id) },
      body: { ...body, ruleSubcategories: [sub], productIds: [p1.id] } });
    check("rules and picks are saved", r.statusCode === 200 && r.body.collection.rule_subcategories[0] === sub);
    snap = await snapshot();
    col = snap.collections.find((c) => c.slug === `${tag}-edit`);
    const bySub = snap.products.filter((p) => p.sub === sub).map((p) => p.dbId);
    check("it shows the pick plus every product in the subcategory",
      col && col.dbIds.includes(p1.id) && bySub.every((d) => col.dbIds.includes(d)) && !col.dbIds.includes(p2.id) === !bySub.includes(p2.id),
      col && JSON.stringify({ got: col.dbIds, sub: bySub }));
    const [audit] = await sql`SELECT detail FROM audit_logs WHERE action = 'COLLECTION_UPDATED' AND target_id = ${String(id)} ORDER BY id DESC LIMIT 1`;
    check("the audit log shows what changed", audit && audit.detail.changes && audit.detail.changes.ruleSubcategories
      && audit.detail.changes.productIds, audit && JSON.stringify(audit.detail.changes));

    r = await call({ method: "PATCH", cookie: U.cookie, csrf: U.csrf, query: { id: String(id) }, body: { ...body, isActive: false } });
    snap = await snapshot();
    check("a hidden collection leaves the shop", r.statusCode === 200 && !snap.collections.some((c) => c.slug === `${tag}-edit`));

    r = await call({ method: "DELETE", cookie: U.cookie, csrf: U.csrf, query: { id: String(id) } });
    check("it can be deleted", r.statusCode === 200);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM product_collections WHERE collection_id = ${id}`;
    check("with its picks", n === 0);
    const [{ still }] = await sql`SELECT count(*)::int AS still FROM products WHERE id = ANY(${[p1.id, p2.id]})`;
    check("and the products themselves untouched", still === 2);

    console.log("\n=== SEARCH ===");
    const blush = await C.publishedProducts({ q: "blushes" });
    check("\"blushes\" finds the blush products (stemming)", blush.products.some((p) => /blush/i.test(p.name)),
      blush.products.map((p) => p.name).join(", "));
    const partial = await C.publishedProducts({ q: "camer" });
    check("a half-typed word finds its products", partial.products.length > 0 && /camera/i.test(partial.products[0].name),
      partial.products.map((p) => p.name).slice(0, 3).join(", "));
    const best = await C.publishedProducts({ q: "setting spray" });
    check("the best match comes first", best.products.length && /setting spray/i.test(best.products[0].name),
      best.products.map((p) => p.name).slice(0, 3).join(", "));
    let threw = null;
    try { await C.publishedProducts({ q: "!!! & | :* ()" }); } catch (e) { threw = e; }
    check("punctuation cannot break the query", !threw, threw && threw.message);
    const admin = await PA.adminList({ q: "blushes" });
    check("the admin product search uses it too", admin.products.some((p) => /blush/i.test(p.name)));
    const sku = await sql`SELECT sku FROM products WHERE sku IS NOT NULL LIMIT 1`;
    const bySku = await PA.adminList({ q: sku[0].sku.slice(0, 6) });
    check("…and still finds part of a SKU", bySku.products.some((p) => p.sku === sku[0].sku));
  } finally {
    for (const id of created) await sql`DELETE FROM collections WHERE id = ${id}`;
    await sql`DELETE FROM collections WHERE slug LIKE ${tag + "%"}`;
    await auth.revokeSession(U.token);
    await auth.revokeSession(A.token);
    await restoreCredentials(saved);
    const [{ left }] = await sql`SELECT count(*)::int AS left FROM collections WHERE slug LIKE ${tag + "%"}`;
    check("cleaned up", left === 0, String(left));
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\ntest error:", e.message, "\n", e.stack); process.exit(1); });
