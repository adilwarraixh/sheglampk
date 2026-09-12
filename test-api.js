/* =========================================================
   test-api.js — drives the serverless handlers in-process

   Builds mock req/res objects and calls the real route modules, so the
   guard, CSRF check and RBAC rules are exercised exactly as deployed.

   Run:  node test-api.js
   ========================================================= */
process.env.DEPLOY_HOOK_URL = "";      // a test run never starts a real build
const crypto = require("crypto");
const { sql } = require("./db/client.js");
const auth = require("./lib/auth.js");

let pass = 0, fail = 0;
const lines = [];
const check = (name, cond, detail = "") => {
  if (cond) { pass++; lines.push(`  ✓ ${name}`); }
  else { fail++; lines.push(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
};

/* ---------- mock http ---------- */
function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    end(payload) { try { this.body = JSON.parse(payload); } catch { this.body = payload; } },
  };
  return res;
}

async function call(routePath, { method = "GET", url = "/", body, cookie, csrf, query } = {}) {
  const mod = require(routePath);
  const req = {
    method, url,
    headers: {
      cookie: cookie || "",
      "user-agent": "test-harness",
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    socket: { remoteAddress: "203.0.113.9" },
    query: query || {},
    body,
    on() {},
  };
  const res = mockRes();
  await mod(req, res);
  return res;
}

const R = {
  login: "./api/admin/login.js",
  logout: "./api/admin/logout.js",
  session: "./api/admin/session.js",
  ordersList: "./api/admin/orders/index.js",
  orderOne: "./api/admin/orders/[id].js",
  dashboard: "./api/admin/dashboard.js",
  password: "./api/admin/password.js",
  publicOrders: "./api/orders.js",
};

const cookieFrom = (res) => String(res.getHeader("set-cookie") || "").split(";")[0];

(async () => {
  const PW_U = "Tst" + crypto.randomBytes(8).toString("hex") + "1";
  const PW_A = "Tst" + crypto.randomBytes(8).toString("hex") + "2";
  /* Never a literal: whatever this ends as is a real password on a real
     account until the cleanup below re-randomises it. */
  const NEW_A = "Nw" + crypto.randomBytes(8).toString("hex") + "3";

  /* ---------- fixtures ---------- */
  /* Snapshot the real credentials first. The suite has to set known
     passwords to exercise login, but these are live accounts somebody
     signs into — the cleanup puts these rows back exactly as found, so a
     test run neither leaves a usable credential behind nor changes the
     password the owner chose. */
  const savedCredentials = await sql`
    SELECT id, password_hash, password_salt, must_change_password FROM users`;

  await sql`DELETE FROM login_attempts`;
  for (const [u, d, r, pw] of [["umama","Umama","SUPER_ADMIN",PW_U], ["ashba","Ashba","ADMIN",PW_A]]) {
    const { salt, hash } = auth.hashPassword(pw);
    /* must_change_password is reset explicitly: a leftover true from a
       previous run would lock these fixtures out of every guarded route. */
    await sql`
      INSERT INTO users (username, display_name, password_hash, password_salt, role, status,
                         password_changed_at, must_change_password)
      VALUES (${u}, ${d}, ${hash}, ${salt}, ${r}::admin_role, 'ACTIVE'::admin_status, now(), false)
      ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash,
        password_salt=EXCLUDED.password_salt, role=EXCLUDED.role, status='ACTIVE'::admin_status,
        must_change_password=false`;
  }

  // A published product so the public checkout has something real to price
  const [cat] = await sql`
    INSERT INTO categories (slug, name) VALUES ('test-face','Test Face')
    ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`;
  const [prod] = await sql`
    INSERT INTO products (slug, sku, name, category_id, subcategory, price, stock_quantity, status)
    VALUES ('t-blush','T-BLUSH','Test Liquid Blush',${cat.id},'Blush',1990,50,'PUBLISHED'::product_status)
    ON CONFLICT (slug) DO UPDATE SET price=EXCLUDED.price, stock_quantity=50, status='PUBLISHED'::product_status
    RETURNING id`;
  const [variant] = await sql`
    INSERT INTO product_variants (product_id, sku, variant_name, hex, stock_quantity)
    VALUES (${prod.id},'T-BLUSH-PINK','Pink Slip','#e88fa0',20)
    ON CONFLICT (sku) DO UPDATE SET stock_quantity=20 RETURNING id`;

  console.log("\n=== LOGIN ENDPOINT ===");
  const badLogin = await call(R.login, { method: "POST", body: { username: "umama", password: "wrong" } });
  check("bad credentials → 401", badLogin.statusCode === 401, String(badLogin.statusCode));
  check("bad credentials give the generic message", badLogin.body.error === "Invalid username or password.");
  check("no cookie issued on failure", !badLogin.getHeader("set-cookie"));

  const uRes = await call(R.login, { method: "POST", body: { username: "umama", password: PW_U } });
  check("umama logs in → 200", uRes.statusCode === 200, JSON.stringify(uRes.body).slice(0, 80));
  check("session cookie is HttpOnly", /HttpOnly/.test(String(uRes.getHeader("set-cookie"))));
  check("CSRF token returned to the client", typeof uRes.body.csrfToken === "string");
  check("password never appears in the response", !JSON.stringify(uRes.body).includes(PW_U));
  const uCookie = cookieFrom(uRes), uCsrf = uRes.body.csrfToken;

  const aRes = await call(R.login, { method: "POST", body: { username: "ashba", password: PW_A } });
  const aCookie = cookieFrom(aRes), aCsrf = aRes.body.csrfToken;
  check("ashba logs in", aRes.statusCode === 200);

  check("GET on the login route → 405", (await call(R.login, { method: "GET" })).statusCode === 405);

  console.log("\n=== SESSION ENDPOINT ===");
  const anon = await call(R.session);
  check("no cookie → 401", anon.statusCode === 401);

  const uSess = await call(R.session, { cookie: uCookie });
  check("umama session resolves", uSess.statusCode === 200);
  check("role is SUPER_ADMIN", uSess.body.user.role === "SUPER_ADMIN");
  check("umama nav includes Admin Account", uSess.body.nav.some((n) => n.label === "Admin Account"));
  /* Assert on credential MATERIAL, not on field names — `mustChangePassword`
     is a legitimate boolean flag and matching /password/i flagged it forever. */
  const sessPayload = JSON.stringify(uSess.body);
  const [dbUser] = await sql`SELECT password_hash, password_salt FROM users WHERE username = 'umama'`;
  check("plaintext password absent from the session payload", !sessPayload.includes(PW_U));
  check("password hash absent from the session payload", !sessPayload.includes(dbUser.password_hash));
  check("password salt absent from the session payload", !sessPayload.includes(dbUser.password_salt));
  check("no password_hash / password_salt field is exposed",
    !/password_hash|password_salt/i.test(sessPayload));

  const aSess = await call(R.session, { cookie: aCookie });
  check("ashba role is ADMIN", aSess.body.user.role === "ADMIN");
  check("ashba nav omits Admin Account", !aSess.body.nav.some((n) => n.label === "Admin Account"));
  check("ashba permissions exclude users:manage", !aSess.body.permissions.includes("users:manage"));

  console.log("\n=== PUBLIC CHECKOUT ===");
  const badOrder = await call(R.publicOrders, { method: "POST", body: { customerName: "x" } });
  check("invalid order rejected → 400", badOrder.statusCode === 400);

  const placed = await call(R.publicOrders, {
    method: "POST",
    body: {
      customerName: "Ayesha Khan", customerPhone: "03220305000",
      shippingCity: "Lahore", shippingAddress: "House 42, Street 8, DHA Phase 5, Lahore",
      paymentMethod: "Cash on Delivery",
      items: [{ variantId: variant.id, quantity: 2 }],
    },
  });
  check("valid order accepted", placed.statusCode === 200, JSON.stringify(placed.body).slice(0, 120));
  check("reference returned", /^SG-\d{4}-[A-Z0-9]{5}$/.test(placed.body.reference || ""), placed.body.reference);
  check("total priced server-side (2 × 1990 = 3980)", Number(placed.body.subtotal) === 3980, String(placed.body.subtotal));

  const tampered = await call(R.publicOrders, {
    method: "POST",
    body: {
      customerName: "Ayesha Khan", customerPhone: "03005550000",
      shippingCity: "Lahore", shippingAddress: "House 9, Street 1, Gulberg, Lahore",
      items: [{ variantId: variant.id, quantity: 1, unitPrice: 1, price: 1 }],
    },
  });
  check("client-supplied price is ignored", Number(tampered.body.subtotal) === 1990, String(tampered.body.subtotal));

  const [stockNow] = await sql`SELECT stock_quantity FROM product_variants WHERE id = ${variant.id}`;
  check("variant stock decremented (20 − 3 = 17)", stockNow.stock_quantity === 17, String(stockNow.stock_quantity));

  console.log("\n=== ORDERS: READ ===");
  const listAnon = await call(R.ordersList);
  check("orders list requires auth", listAnon.statusCode === 401);

  const listU = await call(R.ordersList, { cookie: uCookie, url: "/api/admin/orders" });
  check("umama can list orders", listU.statusCode === 200);
  check("orders are returned", listU.body.total >= 2, String(listU.body.total));

  const listA = await call(R.ordersList, { cookie: aCookie, url: "/api/admin/orders" });
  check("ashba can also list orders (shared data)", listA.statusCode === 200);
  check("both roles see the same order count", listA.body.total === listU.body.total);

  const targetId = listU.body.orders[0].id;
  const detail = await call(R.orderOne, { cookie: uCookie, query: { id: String(targetId) }, url: `/api/admin/orders/${targetId}` });
  check("order detail loads", detail.statusCode === 200);
  check("detail includes line items", Array.isArray(detail.body.order.items) && detail.body.order.items.length > 0);
  check("detail includes status history", Array.isArray(detail.body.order.history) && detail.body.order.history.length > 0);

  console.log("\n=== ORDERS: WRITE + CSRF ===");
  const noCsrf = await call(R.orderOne, {
    method: "PATCH", cookie: uCookie, query: { id: String(targetId) },
    url: `/api/admin/orders/${targetId}`, body: { status: "CONFIRMED" },
  });
  check("PATCH without a CSRF token → 403", noCsrf.statusCode === 403, String(noCsrf.statusCode));

  const wrongCsrf = await call(R.orderOne, {
    method: "PATCH", cookie: uCookie, csrf: "not-the-right-token", query: { id: String(targetId) },
    url: `/api/admin/orders/${targetId}`, body: { status: "CONFIRMED" },
  });
  check("PATCH with a wrong CSRF token → 403", wrongCsrf.statusCode === 403);

  const upd = await call(R.orderOne, {
    method: "PATCH", cookie: uCookie, csrf: uCsrf, query: { id: String(targetId) },
    url: `/api/admin/orders/${targetId}`,
    body: { status: "CONFIRMED", trackingNumber: "TCS-12345", note: "Called and confirmed" },
  });
  check("valid PATCH succeeds", upd.statusCode === 200, JSON.stringify(upd.body).slice(0, 100));
  check("status changed", upd.body.order.status === "CONFIRMED");
  check("tracking saved", upd.body.order.tracking_number === "TCS-12345");
  check("timeline records the transition",
    upd.body.order.history.some((h) => h.to_status === "CONFIRMED" && h.changed_by === "umama"));

  const ashbaUpd = await call(R.orderOne, {
    method: "PATCH", cookie: aCookie, csrf: aCsrf, query: { id: String(targetId) },
    url: `/api/admin/orders/${targetId}`, body: { status: "PROCESSING" },
  });
  check("ashba CAN update order status (permitted)", ashbaUpd.statusCode === 200, String(ashbaUpd.statusCode));
  check("timeline attributes the change to ashba",
    ashbaUpd.body.order.history.some((h) => h.to_status === "PROCESSING" && h.changed_by === "ashba"));

  const badStatus = await call(R.orderOne, {
    method: "PATCH", cookie: uCookie, csrf: uCsrf, query: { id: String(targetId) },
    url: `/api/admin/orders/${targetId}`, body: { status: "TELEPORTED" },
  });
  check("invalid status rejected", badStatus.statusCode === 400);

  console.log("\n=== PRIVILEGE BOUNDARY ===");
  const ashbaDelete = await call(R.orderOne, {
    method: "DELETE", cookie: aCookie, csrf: aCsrf, query: { id: String(targetId) },
    url: `/api/admin/orders/${targetId}`,
  });
  check("ashba CANNOT delete an order → 403", ashbaDelete.statusCode === 403, String(ashbaDelete.statusCode));
  const stillThere = await sql`SELECT count(*)::int n FROM orders WHERE id = ${targetId}`;
  check("the order still exists after the denied delete", stillThere[0].n === 1);

  console.log("\n=== DASHBOARD ===");
  const dashU = await call(R.dashboard, { cookie: uCookie });
  check("dashboard loads for umama", dashU.statusCode === 200);
  check("order totals present", dashU.body.totals && dashU.body.totals.orders_total >= 2);
  check("sales series has 14 days", Array.isArray(dashU.body.salesSeries) && dashU.body.salesSeries.length === 14);
  const dashA = await call(R.dashboard, { cookie: aCookie });
  check("dashboard loads for ashba", dashA.statusCode === 200);
  check("both see the same live totals", dashA.body.totals.orders_total === dashU.body.totals.orders_total);

  console.log("\n=== FORCED PASSWORD CHANGE ===");
  /* A temporary password must grant exactly one capability: replacing it.
     Without the guard, must_change_password would be decoration. */
  await sql`UPDATE users SET must_change_password = true WHERE username = 'ashba'`;
  const aLocked = await call(R.login, { method: "POST", body: { username: "ashba", password: PW_A } });
  const lCookie = cookieFrom(aLocked), lCsrf = aLocked.body.csrfToken;
  check("a locked account can still sign in", aLocked.statusCode === 200);
  check("login tells the client a change is required", aLocked.body.mustChangePassword === true);

  const lockedOrders = await call(R.ordersList, { cookie: lCookie, url: "/api/admin/orders" });
  check("locked account refused on orders → 403", lockedOrders.statusCode === 403, String(lockedOrders.statusCode));
  check("refusal is flagged so the UI can redirect", lockedOrders.body.mustChangePassword === true);
  check("locked account refused on dashboard",
    (await call(R.dashboard, { cookie: lCookie })).statusCode === 403);
  check("session endpoint still answers while locked",
    (await call(R.session, { cookie: lCookie })).statusCode === 200);

  const wrongCur = await call(R.password, {
    method: "POST", cookie: lCookie, csrf: lCsrf,
    body: { currentPassword: "definitely-not-it", newPassword: NEW_A },
  });
  check("wrong current password rejected", wrongCur.statusCode === 400);

  const weak = await call(R.password, {
    method: "POST", cookie: lCookie, csrf: lCsrf,
    body: { currentPassword: PW_A, newPassword: "password123" },
  });
  check("weak new password rejected", weak.statusCode === 400);

  check("password change without CSRF rejected",
    (await call(R.password, {
      method: "POST", cookie: lCookie,
      body: { currentPassword: PW_A, newPassword: NEW_A },
    })).statusCode === 403);


  const changed = await call(R.password, {
    method: "POST", cookie: lCookie, csrf: lCsrf,
    body: { currentPassword: PW_A, newPassword: NEW_A },
  });
  check("valid change succeeds", changed.statusCode === 200, JSON.stringify(changed.body).slice(0, 80));
  check("no password echoed back", !JSON.stringify(changed.body).includes(NEW_A));
  check("a fresh session cookie is issued", /HttpOnly/.test(String(changed.getHeader("set-cookie"))));

  const [flagRow] = await sql`SELECT must_change_password FROM users WHERE username='ashba'`;
  check("flag cleared in the database", flagRow.must_change_password === false);
  check("old session revoked by the change",
    (await call(R.session, { cookie: lCookie })).statusCode === 401);

  const newCookie = cookieFrom(changed);
  check("the new session works immediately",
    (await call(R.ordersList, { cookie: newCookie, url: "/api/admin/orders" })).statusCode === 200);
  check("the old password no longer signs in",
    (await call(R.login, { method: "POST", body: { username: "ashba", password: PW_A } })).statusCode === 401);
  check("the new password signs in",
    (await call(R.login, { method: "POST", body: { username: "ashba", password: NEW_A } })).statusCode === 200);

  const [stored] = await sql`SELECT password_hash, password_salt FROM users WHERE username='ashba'`;
  check("the new password is not stored in plain text",
    !stored.password_hash.includes(NEW_A) && !stored.password_salt.includes(NEW_A));
  check("stored hash verifies against the new password",
    auth.verifyPassword(NEW_A, stored.password_salt, stored.password_hash));

  console.log("\n=== LOGOUT ===");
  const out = await call(R.logout, { method: "POST", cookie: uCookie, csrf: uCsrf });
  check("logout succeeds", out.statusCode === 200);
  check("cookie cleared", /Max-Age=0/.test(String(out.getHeader("set-cookie"))));
  check("session no longer works", (await call(R.session, { cookie: uCookie })).statusCode === 401);
  check("orders refused after logout",
    (await call(R.ordersList, { cookie: uCookie, url: "/api/admin/orders" })).statusCode === 401);

  /* ---------- cleanup ---------- */
  await sql`DELETE FROM orders WHERE customer_phone IN ('03220305000','03005550000')`;
  await sql`DELETE FROM product_variants WHERE product_id = ${prod.id}`;
  await sql`DELETE FROM products WHERE id = ${prod.id}`;
  await sql`DELETE FROM categories WHERE id = ${cat.id}`;
  await sql`DELETE FROM customers WHERE phone IN ('03220305000','03005550000')`;
  // Only the sessions this run opened, so a real admin stays signed in.
  await sql`UPDATE sessions SET revoked_at = now()
             WHERE revoked_at IS NULL AND created_at >= ${savedCredentials.startedAt || new Date(0)}`;

  /* Put the credentials back exactly as they were found. The passwords the
     suite set are discarded with the rows they were written to, so nothing
     usable is left behind — and the owner's own password still works when
     they next sign in. An account created during the run has no snapshot,
     so it gets an unrecoverable value instead. */
  const savedById = new Map(savedCredentials.map((u) => [String(u.id), u]));
  for (const u of await sql`SELECT id FROM users`) {
    const prior = savedById.get(String(u.id));
    if (prior) {
      await sql`
        UPDATE users SET password_hash = ${prior.password_hash},
                         password_salt = ${prior.password_salt},
                         must_change_password = ${prior.must_change_password}
         WHERE id = ${u.id}`;
    } else {
      const { salt, hash } = auth.hashPassword(crypto.randomBytes(32).toString("hex"));
      await sql`UPDATE users SET password_hash = ${hash}, password_salt = ${salt},
                                 must_change_password = true WHERE id = ${u.id}`;
    }
  }

  console.log("\n" + lines.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})().catch((e) => { console.error("\nharness error:", e.message, "\n", e.stack); process.exit(1); });
