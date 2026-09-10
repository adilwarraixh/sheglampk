/* =========================================================
   test-orders.js — the order + notification workflow, end to end.
   Covers the eight scenarios in the order-system brief.

   Run: node test-orders.js
   ========================================================= */
const P = __dirname.split(String.fromCharCode(92)).join("/");
const { sql } = require(P + "/db/client");
const auth = require(P + "/lib/auth");
const notify = require(P + "/lib/order-emails");

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    end(p) { try { this.body = JSON.parse(p); } catch { this.body = p; } },
  };
}
async function call(mod, { method = "GET", cookie, csrf, query = {}, body, url = "/" } = {}) {
  const res = mockRes();
  await require(P + mod)({
    method, url,
    headers: { cookie: cookie || "", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    socket: { remoteAddress: "203.0.113.44" }, query, body, on() {},
  }, res);
  return res;
}

const out = [];
const t = (label, cond, extra = "") => out.push(`${cond ? "✓" : "✗"} ${label}${extra ? "  → " + extra : ""}`);

const PHONES = ["03009998877", "03009998878", "03009998879"];

(async () => {
  const mk = async (username) => {
    const [r] = await sql`SELECT id FROM users WHERE username = ${username}`;
    await sql`UPDATE users SET must_change_password = false WHERE id = ${r.id}`;
    const s = await auth.createSession(r.id, { ip: "127.0.0.1", userAgent: "otest" });
    return { id: r.id, cookie: `sgpk_session=${s.token}`, csrf: s.csrf, token: s.token };
  };
  const U = await mk("umama"), A = await mk("ashba");
  const R = {
    checkout: "/api/orders.js",
    adminOrders: "/api/admin/orders/index.js",
    adminOrder: "/api/admin/orders/[id].js",
    notif: "/api/admin/notifications.js",
    retry: "/api/notifications/retry.js",
    dash: "/api/admin/dashboard.js",
  };

  await sql`DELETE FROM login_attempts`;
  const [prod] = await sql`
    SELECT id, name, price FROM products WHERE status = 'PUBLISHED' AND sku = 'SGPK-005' LIMIT 1`;
  const [variant] = await sql`
    SELECT v.id, v.stock_quantity, v.variant_name FROM product_variants v
      JOIN products p ON p.id = v.product_id WHERE p.sku = 'SGPK-002' ORDER BY v.position LIMIT 1`;

  const base = {
    customerName: "Test Buyer", customerPhone: PHONES[0], customerEmail: "buyer@example.com",
    shippingCity: "Lahore", shippingAddress: "House 9, Street 4, Gulberg III, Lahore",
    customerNote: "Please call before delivery",
  };

  /* ---------- Test 1: a successful order ---------- */
  const stockBefore = variant.stock_quantity;
  const r1 = await call(R.checkout, { method: "POST", body: { ...base,
    items: [{ variantId: variant.id, quantity: 2 }, { productId: prod.id, quantity: 1 }] } });
  t("order accepted", r1.statusCode === 200, r1.body.error || r1.body.reference);
  const ref = r1.body.reference;
  t("reference formatted SG-YYMM-XXXXX", /^SG-\d{4}-[A-Z0-9]{5}$/.test(ref || ""), ref);

  const [order] = await sql`SELECT * FROM orders WHERE reference = ${ref}`;
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${order.id} ORDER BY id`;
  t("order stored in the database", !!order && order.status === "PENDING");
  t("items stored with name/sku/price snapshots",
    items.length === 2 && items.every((i) => i.product_name && i.unit_price !== null));
  t("slug and image snapshotted too",
    items.every((i) => i.product_slug) && items.some((i) => i.image_url));

  const sub = items.reduce((s, i) => s + Number(i.line_total), 0);
  t("totals computed server-side", Math.abs(Number(order.subtotal) - sub) < 0.01, `subtotal=${Number(order.subtotal)}`);
  t("shipping decided by the threshold, not the client",
    Number(order.shipping_fee) === (sub >= 3500 ? 0 : 250), `sub=${sub} ship=${Number(order.shipping_fee)}`);
  t("total = subtotal + shipping + tax − discount",
    Math.abs(Number(order.total) -
      (Number(order.subtotal) + Number(order.shipping_fee) + Number(order.tax_amount) - Number(order.discount))) < 0.01);

  const [vAfter] = await sql`SELECT stock_quantity FROM product_variants WHERE id = ${variant.id}`;
  t("inventory decremented", vAfter.stock_quantity === stockBefore - 2, `${stockBefore} → ${vAfter.stock_quantity}`);

  const hist = await sql`SELECT * FROM order_status_history WHERE order_id = ${order.id}`;
  t("status history created", hist.length === 1 && hist[0].to_status === "PENDING");

  /* prices sent by the browser must be ignored */
  const tampered = await call(R.checkout, { method: "POST", body: { ...base, customerPhone: PHONES[1],
    items: [{ productId: prod.id, quantity: 1, price: 1, unitPrice: 1 }],
    subtotal: 1, total: 1, shippingFee: 0, discount: 9999 } });
  const [tOrder] = await sql`SELECT subtotal, total, discount, shipping_fee FROM orders WHERE reference = ${tampered.body.reference}`;
  t("client-sent price ignored", Number(tOrder.subtotal) === Number(prod.price),
    `sent 1, stored ${Number(tOrder.subtotal)}`);
  t("client-sent discount ignored", Number(tOrder.discount) === 0);

  /* stock check before selling */
  const sold = await call(R.checkout, { method: "POST", body: { ...base, customerPhone: PHONES[1],
    items: [{ variantId: variant.id, quantity: 99999 }] } });
  t("cannot order more than the stock", sold.statusCode === 400 && /left|sold out/i.test(sold.body.error || ""),
    sold.body.error);

  /* ---------- Test 2: email failure does not lose the order ---------- */
  const notifs = await notify.forOrder(order.id);
  t("notification rows created", notifs.length === 2, notifs.map((n) => `${n.type}:${n.status}`).join(", "));
  t("admin notification goes to the configured address",
    notifs.some((n) => n.type === "admin_new_order" && n.recipient === "sheglamofficialpk@gmail.com"));
  t("customer confirmation is a separate notification",
    notifs.some((n) => n.type === "customer_confirmation" && n.recipient === "buyer@example.com"));
  t("order survives an unsent notification",
    !!order && notifs.every((n) => n.status !== "SENT"), "no provider configured → recorded, order intact");
  t("customer still got a success response", r1.body.reference === ref && !r1.body.error);

  /* ---------- Test 3: duplicate checkout ---------- */
  const key = "idem-" + Date.now();
  const d1 = await call(R.checkout, { method: "POST", body: { ...base, customerPhone: PHONES[2],
    idempotencyKey: key, items: [{ productId: prod.id, quantity: 1 }] } });
  const d2 = await call(R.checkout, { method: "POST", body: { ...base, customerPhone: PHONES[2],
    idempotencyKey: key, items: [{ productId: prod.id, quantity: 1 }] } });
  t("replayed checkout returns the first order", d1.body.reference === d2.body.reference, d1.body.reference);
  t("replay reported as a duplicate", d2.body.duplicate === true);
  const [dupes] = await sql`SELECT count(*)::int n FROM orders WHERE idempotency_key = ${key}`;
  t("only one order exists for that key", dupes.n === 1);

  /* ---------- Test 4: duplicate notification ---------- */
  const nBefore = (await notify.forOrder(order.id)).length;
  await notify.queueForOrder(order.id, { customerEmail: "buyer@example.com" });
  await notify.queueForOrder(order.id, { customerEmail: "buyer@example.com" });
  const nAfter = (await notify.forOrder(order.id)).length;
  t("re-queuing adds no extra notifications", nBefore === nAfter, `${nBefore} → ${nAfter}`);

  /* ---------- Test 5: status progression ---------- */
  let allOk = true;
  for (const s of ["PROCESSING", "PACKED", "SHIPPED", "DELIVERED"]) {
    const r = await call(R.adminOrder, { method: "PATCH", cookie: U.cookie, csrf: U.csrf,
      query: { id: String(order.id) }, body: { status: s } });
    if (r.statusCode !== 200) allOk = false;
  }
  t("PENDING → PROCESSING → PACKED → SHIPPED → DELIVERED", allOk);
  const hist2 = await sql`
    SELECT from_status, to_status, changed_by FROM order_status_history
     WHERE order_id = ${order.id} ORDER BY created_at`;
  t("each change recorded", hist2.length === 5, hist2.map((h) => h.to_status).join(" → "));
  t("with the admin who made it", hist2.slice(1).every((h) => h.changed_by === "umama"));
  t("and the status it came from", hist2[1].from_status === "PENDING");

  /* ---------- Test 6: cancellation ---------- */
  const cancel = await call(R.adminOrder, { method: "PATCH", cookie: U.cookie, csrf: U.csrf,
    query: { id: String(order.id) }, body: { status: "CANCELLED" } });
  const [cancelled] = await sql`SELECT status FROM orders WHERE id = ${order.id}`;
  t("order can be cancelled", cancel.statusCode === 200 && cancelled.status === "CANCELLED");
  const [cancelHist] = await sql`
    SELECT to_status FROM order_status_history WHERE order_id = ${order.id} ORDER BY created_at DESC LIMIT 1`;
  t("cancellation recorded in the history", cancelHist.to_status === "CANCELLED");

  /* ---------- Test 7: a product archived after the order ---------- */
  await sql`UPDATE products SET status = 'ARCHIVED', archived_at = now() WHERE id = ${prod.id}`;
  const detail = await call(R.adminOrder, { cookie: U.cookie, query: { id: String(order.id) } });
  t("archived product still reads correctly on the old order",
    detail.body.order.items.every((i) => i.product_name && i.product_name.length > 2),
    detail.body.order.items.map((i) => i.product_name).join(" / "));
  const pub = await require(P + "/lib/catalogue").publishedProducts({ limit: 200 });
  t("and has gone from the live catalogue", !pub.products.some((p) => String(p.id) === String(prod.id)));
  await sql`UPDATE products SET status = 'PUBLISHED', archived_at = NULL WHERE id = ${prod.id}`;

  /* ---------- Test 8: both admins ---------- */
  const uList = await call(R.adminOrders, { cookie: U.cookie, url: "/api/admin/orders" });
  const aList = await call(R.adminOrders, { cookie: A.cookie, url: "/api/admin/orders" });
  t("both admins see the same live orders",
    uList.body.total === aList.body.total && uList.body.total > 0, `${uList.body.total} orders`);
  t("ashba can update a status",
    (await call(R.adminOrder, { method: "PATCH", cookie: A.cookie, csrf: A.csrf,
      query: { id: String(order.id) }, body: { status: "PROCESSING" } })).statusCode === 200);
  t("ashba cannot delete an order → 403",
    (await call(R.adminOrder, { method: "DELETE", cookie: A.cookie, csrf: A.csrf,
      query: { id: String(order.id) } })).statusCode === 403);
  const uSees = await call(R.adminOrder, { cookie: U.cookie, query: { id: String(order.id) } });
  t("umama sees ashba's change", uSees.body.order.status === "PROCESSING");

  /* ---------- notifications in the admin ---------- */
  const nStat = await call(R.notif, { cookie: U.cookie, query: { orderId: String(order.id) } });
  t("notification state readable in admin", nStat.statusCode === 200 && Array.isArray(nStat.body.notifications));
  t("provider status reports names, never values",
    Array.isArray(nStat.body.mail.missing) &&
    !/RESEND_API_KEY=|SMTP_PASSWORD=|Bearer /.test(JSON.stringify(nStat.body.mail)));
  t("admin can resend",
    (await call(R.notif, { method: "POST", cookie: U.cookie, csrf: U.csrf,
      body: { orderId: order.id, type: "admin_new_order" } })).statusCode === 200);
  t("resend without CSRF refused",
    (await call(R.notif, { method: "POST", cookie: U.cookie,
      body: { orderId: order.id, type: "admin_new_order" } })).statusCode === 403);

  t("retry sweep refuses anonymous callers", (await call(R.retry)).statusCode === 401);
  t("retry sweep accepts a signed-in admin", (await call(R.retry, { cookie: U.cookie })).statusCode === 200);

  /* ---------- dashboard ---------- */
  const dash = await call(R.dash, { cookie: U.cookie });
  t("dashboard counts real orders", dash.body.totals.orders_total > 0, `${dash.body.totals.orders_total} orders`);

  /* ---------- email content ---------- */
  const full = await notify.loadOrder(order.id);
  const mail = notify.adminEmail(full, full.items, "https://sheglampk.online");
  t("subject names the order", mail.subject === `New Order Received — ${ref}`, mail.subject);
  const has = (s) => mail.html.includes(s);
  t("email carries customer, address, item and totals",
    has(full.customer_name) && has(full.shipping_address) && has(full.items[0].product_name) && has("Total"));
  t("email links into the admin portal", has(`https://sheglampk.online/admin/orders?open=${order.id}`));
  t("email says the order is already in the portal", /already visible in the admin portal/i.test(mail.html));
  t("plain-text fallback present", mail.text.includes(ref) && mail.text.includes("TOTAL"));

  const cust = notify.customerEmail(full, full.items, "https://sheglampk.online");
  t("customer email does not link to the admin portal", !cust.html.includes("/admin/"));
  t("customer email does not carry the internal note", !cust.html.includes("internal_note"));
  t("customer email states cash on delivery", /pay the courier/i.test(cust.html));

  /* ---------- cleanup ---------- */
  await sql`DELETE FROM orders WHERE customer_phone = ANY(${PHONES})`;
  await sql`DELETE FROM customers WHERE phone = ANY(${PHONES})`;
  await sql`UPDATE product_variants SET stock_quantity = ${stockBefore} WHERE id = ${variant.id}`;
  await sql`
    UPDATE products p SET stock_quantity =
      COALESCE((SELECT sum(v.stock_quantity)::int FROM product_variants v WHERE v.product_id = p.id),
               p.stock_quantity)`;
  await auth.revokeSession(U.token);
  await auth.revokeSession(A.token);
  await sql`UPDATE users SET must_change_password = true`;

  console.log(out.join("\n"));
  const failed = out.filter((l) => l.startsWith("✗")).length;
  console.log(`\n${out.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERR", e.message, e.stack); process.exit(1); });
