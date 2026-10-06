/* =========================================================
   test-inbox.js — newsletter, contact and reviews are kept; reviews wait
   for approval; customers can track their own order and nobody else's

   Run:  node test-inbox.js     (against the dev branch; refuses production)

   Calls the real API handlers. Mail is switched off, so nothing is sent.
   Everything it creates is removed; admin passwords and sessions are put
   back as they were (test-helpers.js).
   ========================================================= */
const P = __dirname.split(String.fromCharCode(92)).join("/");
const { sql } = require(P + "/db/client");
process.env.MAIL_PROVIDER = "none";
delete process.env.RESEND_API_KEY;
delete process.env.BREVO_API_KEY;
process.env.DEPLOY_HOOK_URL = "";

const auth = require(P + "/lib/auth");
const O = require(P + "/lib/orders");
const PA = require(P + "/lib/products-admin");
const R = require(P + "/lib/rebuild");
const C = require(P + "/lib/catalogue");
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
async function call(mod, { method = "GET", cookie, csrf, query = {}, body, ip = "203.0.113.61" } = {}) {
  const res = mockRes();
  await require(P + mod)({
    method, url: mod, headers: { cookie: cookie || "", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    socket: { remoteAddress: ip }, query, body, on() {},
  }, res);
  return res;
}

let pass = 0, fail = 0;
const results = [];
function check(name, condition, detail = "") {
  if (condition) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
}

const IPS = ["203.0.113.61", "203.0.113.62", "203.0.113.63", "203.0.113.64"];
const PHONE = "03009998896";

(async () => {
  const tag = "zzin" + Date.now().toString(36);
  const email = `${tag}@example.com`;
  const saved = await snapshotCredentials();
  const mk = async (username) => {
    const [r] = await sql`SELECT id FROM users WHERE username = ${username}`;
    await sql`UPDATE users SET must_change_password = false WHERE id = ${r.id}`;
    const s = await auth.createSession(r.id, { ip: "127.0.0.1", userAgent: "itest" });
    return { cookie: `sgpk_session=${s.token}`, csrf: s.csrf, token: s.token };
  };
  const U = await mk("umama"), A = await mk("ashba");
  const [prod] = await sql`
    SELECT p.slug, (SELECT variant_name FROM product_variants v WHERE v.product_id = p.id AND v.is_available LIMIT 1) AS shade
      FROM products p WHERE p.status = 'PUBLISHED' ORDER BY p.id LIMIT 1`;
  const forms = (body, ip) => call("/api/forms.js", { method: "POST", body, ip });
  const [cat] = await sql`SELECT id FROM categories WHERE is_active ORDER BY position LIMIT 1`;
  const made = [];   // throwaway products
  // A run within the hour of the last one must not start over its limits.
  await sql`DELETE FROM login_attempts WHERE ip = ANY(${IPS})`;

  try {
    console.log("\n=== NEWSLETTER ===");
    let r = await forms({ kind: "newsletter", email: email.toUpperCase(), source: "test" });
    check("a sign-up is accepted", r.statusCode === 200 && r.body.subscribed === true, JSON.stringify(r.body));
    await forms({ kind: "newsletter", email });
    const [{ n: subs }] = await sql`SELECT count(*)::int AS n FROM subscribers WHERE email = ${email}`;
    check("stored once, in lower case, however often they sign up", subs === 1);
    r = await forms({ kind: "newsletter", email: "not an email" });
    check("a bad email is refused with a message", r.statusCode === 400 && /valid email/i.test(r.body.error));
    r = await forms({ kind: "newsletter", email: `bot-${email}`, website: "http://spam" });
    const [{ n: bots }] = await sql`SELECT count(*)::int AS n FROM subscribers WHERE email = ${"bot-" + email}`;
    check("the honeypot answers OK but stores nothing", r.statusCode === 200 && bots === 0);

    console.log("\n=== CONTACT ===");
    r = await forms({ kind: "contact", name: "Test Person", email, phone: "0300 1234567", message: `Hello ${tag}, do you have this in stock?` });
    check("a message is accepted", r.statusCode === 200 && r.body.received === true, JSON.stringify(r.body));
    const [msg] = await sql`SELECT id, phone, handled_at FROM contact_messages WHERE email = ${email}`;
    check("and stored, unanswered", msg && msg.handled_at === null);
    r = await forms({ kind: "contact", name: "T", email, message: "short" });
    check("an incomplete message is refused", r.statusCode === 400);
    r = await forms({ kind: "contact", name: "Nul\u0000 Byte", email, message: `A stray NUL\u0000 ${tag} in here` });
    const [nul] = await sql`SELECT name FROM contact_messages WHERE email = ${email} AND name LIKE 'Nul%'`;
    check("a NUL byte is dropped, not a server error", r.statusCode === 200 && nul && nul.name === "Nul Byte", `${r.statusCode} ${nul && nul.name}`);
    r = await forms("null");
    check("a body that is not a form gets 400, not 500", r.statusCode === 400, String(r.statusCode));

    console.log("\n=== REVIEWS ===");
    r = await forms({ kind: "review", slug: prod.slug, name: "Test Reviewer", rating: 5, shade: prod.shade || "",
                      text: `Lovely colour ${tag}`, verified: true });
    check("a review is accepted", r.statusCode === 200, JSON.stringify(r.body));
    const [rev] = await sql`SELECT id, status, verified, shade FROM reviews WHERE body = ${"Lovely colour " + tag}`;
    check("it waits for approval", rev && rev.status === "PENDING");
    check("a customer cannot mark it verified", rev && rev.verified === false);
    if (prod.shade) check("the shade they picked is kept", rev && rev.shade === prod.shade, rev && rev.shade);
    r = await forms({ kind: "review", slug: prod.slug, name: "X Y", rating: 9, text: "Ten out of five" });
    check("a rating outside 1–5 is refused", r.statusCode === 400);
    r = await forms({ kind: "review", slug: `no-such-${tag}`, name: "X Y", rating: 4, text: "Nice product indeed" });
    check("a review for a product not on sale is refused", r.statusCode === 400);
    let snap = await snapshot();
    const onShop = () => ((snap.products.find((x) => x.slug === prod.slug) || {}).reviews || []).some((x) => x.t === `Lovely colour ${tag}`);
    check("a pending review is not on the shop", !onShop());

    console.log("\n=== INBOX (admin) ===");
    r = await call("/api/admin/inbox.js", { cookie: A.cookie, query: { tab: "messages" } });
    check("ashba can read the inbox", r.statusCode === 200 && r.body.messages.some((m) => m.email === email));
    r = await call("/api/admin/inbox.js", { method: "PATCH", cookie: A.cookie, csrf: A.csrf, body: { type: "message", id: msg.id, handled: true } });
    check("ashba can mark a message answered", r.statusCode === 200 && r.body.message.handled_at);
    r = await call("/api/admin/inbox.js", { method: "PATCH", cookie: A.cookie, csrf: A.csrf, body: { type: "review", id: rev.id, status: "APPROVED" } });
    check("ashba cannot approve a review → 403", r.statusCode === 403);
    r = await call("/api/admin/inbox.js", { method: "PATCH", cookie: U.cookie, body: { type: "review", id: rev.id, status: "APPROVED" } });
    check("approving without the CSRF token is refused", r.statusCode === 403);
    r = await call("/api/admin/inbox.js", { method: "PATCH", cookie: U.cookie, csrf: U.csrf, body: { type: "review", id: rev.id, status: "APPROVED", verified: true } });
    check("umama approves it and marks it verified", r.statusCode === 200 && r.body.review.status === "APPROVED" && r.body.review.verified === true);
    check("approving asks for a shop update", r.body.rebuild && r.body.rebuild.status === "not-configured", JSON.stringify(r.body.rebuild));
    snap = await snapshot();
    check("an approved review is on the shop", onShop());
    r = await call("/api/admin/inbox.js", { cookie: A.cookie, query: { export: "subscribers" } });
    check("ashba cannot download subscribers → 403", r.statusCode === 403);
    r = await call("/api/admin/inbox.js", { cookie: U.cookie, query: { export: "subscribers" } });
    check("umama downloads them as CSV", r.statusCode === 200 && typeof r.body === "string" && r.body.includes(email));

    console.log("\n=== ORDER TRACKING ===");
    const [pp] = await sql`SELECT p.id FROM products p WHERE p.status = 'PUBLISHED' AND p.stock_quantity > 0
                            AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_available) LIMIT 1`;
    const order = await O.createOrder({ customerName: "Track Test", customerPhone: PHONE, shippingAddress: "House 1, Street 2, Test Town",
                                        items: [{ productId: pp.id, quantity: 1 }] });
    const track = (body, ip = IPS[1]) => call("/api/track.js", { method: "POST", body, ip });
    r = await track({ reference: order.reference.toLowerCase(), phone: "+92 300 999 8896" });
    check("the customer finds it with reference + phone (any format)", r.statusCode === 200 && r.body.order.reference === order.reference, JSON.stringify(r.body).slice(0, 120));
    check("it shows the real status and items", r.body.order && r.body.order.status === "PENDING" && r.body.order.items.length === 1);
    check("and nothing private (no address, no notes)", r.body.order && !("shipping_address" in r.body.order) && !("internal_note" in r.body.order)
      && !JSON.stringify(r.body).includes("House 1"));
    const wrongPhone = await track({ reference: order.reference, phone: "03001111111" });
    const wrongRef = await track({ reference: "SG-0000-AAAAA", phone: PHONE });
    check("a wrong phone and a wrong reference get the same answer",
      wrongPhone.statusCode === 404 && wrongRef.statusCode === 404 && wrongPhone.body.error === wrongRef.body.error);
    await sql`INSERT INTO login_attempts (username, ip, success) SELECT '__track__', ${IPS[2]}, true FROM generate_series(1, 30)`;
    r = await track({ reference: order.reference, phone: PHONE }, IPS[2]);
    check("lookups are limited per hour", r.statusCode === 429);
    await O.updateOrder(order.id, { status: "SHIPPED" }, "test");
    r = await track({ reference: order.reference, phone: PHONE });
    check("a status the shop sets is what the customer sees", r.body.order && r.body.order.status === "SHIPPED" && /courier/.test(r.body.order.says));

    console.log("\n=== RATE LIMIT ON FORMS ===");
    await sql`DELETE FROM login_attempts WHERE ip = ${IPS[0]}`;
    for (let i = 0; i < 10; i++) await forms({ kind: "newsletter", email: `rl${i}-${email}` }, IPS[0]);
    r = await forms({ kind: "newsletter", email: `rl-over-${email}` }, IPS[0]);
    check("an 11th sign-up from one address within the hour is refused", r.statusCode === 429);
    const burst = await Promise.all(Array.from({ length: 16 }, (_, i) =>
      forms({ kind: "newsletter", email: `burst${i}-${email}` }, IPS[3])));
    const let_in = burst.filter((x) => x.statusCode === 200).length;
    check("16 at once from one address: exactly 10 get in", let_in === 10 && burst.filter((x) => x.statusCode === 429).length === 6,
      burst.map((x) => x.statusCode).join(","));
    const [{ n: rows }] = await sql`SELECT count(*)::int AS n FROM login_attempts WHERE ip = ${IPS[3]}`;
    check("and the refused ones wrote nothing", rows === 10, String(rows));

    console.log("\n=== REVIEWS FOLLOW THEIR PRODUCT ===");
    const T = await PA.createProduct({ name: `Test Review ${tag}`, sku: `TST-${tag}`, status: "PUBLISHED", categoryId: cat.id, price: 1000, stockQuantity: 5 });
    made.push(T.id);
    await forms({ kind: "review", slug: T.slug, name: "Rename Tester", rating: 4, text: `Follows the product ${tag}` }, IPS[1]);
    const [tr] = await sql`SELECT id FROM reviews WHERE body = ${"Follows the product " + tag}`;
    await call("/api/admin/inbox.js", { method: "PATCH", cookie: U.cookie, csrf: U.csrf, body: { type: "review", id: tr.id, status: "APPROVED" } });
    const reviewsOn = (s, slug) => ((s.products.find((x) => x.slug === slug) || {}).reviews || []).length;
    await sql`UPDATE products SET slug = ${T.slug + "-renamed"} WHERE id = ${T.id}`;
    snap = await snapshot();
    check("a renamed product keeps its reviews", reviewsOn(snap, T.slug + "-renamed") === 1);
    await PA.archiveProduct(T.id);
    r = await call("/api/admin/inbox.js", { method: "PATCH", cookie: U.cookie, csrf: U.csrf, body: { type: "review", id: tr.id, status: "REJECTED" } });
    check("moderating a review of a product off the shop starts no rebuild",
      r.statusCode === 200 && r.body.rebuild.status === "not-needed", JSON.stringify(r.body.rebuild));
    await call("/api/admin/inbox.js", { method: "PATCH", cookie: U.cookie, csrf: U.csrf, body: { type: "review", id: tr.id, status: "APPROVED" } });
    await PA.deleteProduct(T.id);
    const T2 = await PA.createProduct({ name: `Test Review ${tag}`, sku: `TST2-${tag}`, status: "PUBLISHED", categoryId: cat.id, price: 1000, stockQuantity: 5 });
    made.push(T2.id);
    snap = await snapshot();
    check("a new product given a deleted one's slug does not inherit its reviews",
      T2.slug === T.slug && reviewsOn(snap, T2.slug) === 0, `${T2.slug} ${reviewsOn(snap, T2.slug)}`);

    console.log("\n=== PUBLIC CATALOGUE AND BUILD STAMP ===");
    await sql`UPDATE products SET price = 1000, sale_price = 800, sale_starts_at = now() + interval '7 days' WHERE id = ${T2.id}`;
    const pub = await C.productBySlug(T2.slug);
    check("the public API does not announce a scheduled sale", pub && !("sale_starts_at" in pub) && !("sale_ends_at" in pub) && pub.salePrice === null,
      pub && Object.keys(pub).filter((k) => /sale/.test(k)).join(","));
    const [before] = await sql`SELECT exported_at::text AS t FROM site_rebuilds WHERE id = 1`;
    const mark = await R.markExported();
    await R.unmarkExported(mark);
    const [after] = await sql`SELECT exported_at::text AS t FROM site_rebuilds WHERE id = 1`;
    check("a failed export puts the build stamp back exactly", (before ? before.t : null) === after.t, `${before && before.t} → ${after.t}`);
  } finally {
    for (const id of made) await sql`DELETE FROM products WHERE id = ${id}`;
    await sql`DELETE FROM login_attempts WHERE ip = ANY(${IPS})`;
    await sql`DELETE FROM subscribers WHERE email LIKE ${"%" + email}`;
    await sql`DELETE FROM contact_messages WHERE email = ${email}`;
    await sql`DELETE FROM reviews WHERE body LIKE ${"%" + tag + "%"}`;
    await sql`DELETE FROM orders WHERE customer_phone = ${PHONE}`;
    await sql`DELETE FROM customers WHERE phone = ${PHONE}`;
    await auth.revokeSession(U.token);
    await auth.revokeSession(A.token);
    await restoreCredentials(saved);
    const [{ n }] = await sql`SELECT (SELECT count(*) FROM subscribers WHERE email LIKE ${"%" + email})
                                   + (SELECT count(*) FROM reviews WHERE body LIKE ${"%" + tag + "%"}) AS n`;
    check("cleaned up", Number(n) === 0, String(n));
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\ntest error:", e.message, "\n", e.stack); process.exit(1); });
