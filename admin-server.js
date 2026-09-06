/* =========================================================
   SHEGLAM PK — admin server

   Runs on YOUR machine only. Serves the admin portal and gives it
   a small JSON API over data/products.json and data/orders.json,
   plus a button to run the site build.

   Run:  node admin-server.js
   Open: http://localhost:5600

   ⚠ SECURITY
   Binds to 127.0.0.1 so it is not reachable from your network, and
   it has no login. NEVER deploy this file or expose this port —
   it can rewrite your catalogue. The public site (server.js /
   your static host) does not use any of this.
   ========================================================= */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const auth = require("./admin-auth.js");

const ROOT = __dirname;
const PORT = process.env.ADMIN_PORT || 5600;
const HOST = "127.0.0.1";

/* =========================================================
   SESSIONS
   Kept in memory: restarting the server signs you out, which is
   the right trade-off for a local single-operator tool.
   ========================================================= */
const SESSION_COOKIE = "sgpk_admin";
const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;   // 8 hours without activity
const sessions = new Map();                    // token -> { created, lastSeen }

function newSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { created: Date.now(), lastSeen: Date.now() });
  return token;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function validSession(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.lastSeen > SESSION_IDLE_MS) { sessions.delete(token); return null; }
  s.lastSeen = Date.now();
  return token;
}

/* SameSite=Strict means the cookie is not sent on any cross-site request,
   which is what stops another page in the browser driving this API. */
const cookieHeader = (token, maxAgeSec) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;

/* =========================================================
   LOGIN THROTTLING
   One password, one operator — a simple global lockout is both
   sufficient and hard to work around.
   ========================================================= */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
let failures = 0;
let lockedUntil = 0;

const lockRemaining = () => Math.max(0, lockedUntil - Date.now());

const PRODUCTS_FILE = path.join(ROOT, "data", "products.json");
const ORDERS_FILE = path.join(ROOT, "data", "orders.json");
const BACKUP_DIR = path.join(ROOT, "data", "backups");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
};

/* ---------- helpers ---------- */
const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};

function writeJSONAtomic(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);            // atomic-ish: never leaves a half-written catalogue
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(BACKUP_DIR, `${path.basename(file, ".json")}-${stamp}.json`);
  fs.copyFileSync(file, dest);
  // keep the 20 most recent
  const kept = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(path.basename(file, ".json")))
    .sort().reverse();
  kept.slice(20).forEach((f) => { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {} });
  return path.basename(dest);
}

const send = (res, code, data, type) => {
  res.writeHead(code, {
    "Content-Type": type || TYPES[".json"],
    "Cache-Control": "no-store",
  });
  res.end(typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data));
};

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 8e6) { reject(new Error("payload too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(new Error("invalid JSON: " + e.message)); }
    });
    req.on("error", reject);
  });
}

/* ---------- validation ---------- */
const CATS = ["face", "eyes", "lips", "tools"];

function validateProducts(list) {
  const errors = [];
  if (!Array.isArray(list)) return ["products must be an array"];
  const slugs = new Set();
  list.forEach((p, i) => {
    const at = `product ${i + 1} (${p.name || "unnamed"})`;
    if (!p.name || !String(p.name).trim()) errors.push(`${at}: name is required`);
    if (!CATS.includes(p.category)) errors.push(`${at}: category must be one of ${CATS.join(", ")}`);
    if (!p.sub) errors.push(`${at}: subcategory is required`);
    if (!(+p.price > 0)) errors.push(`${at}: price must be greater than 0`);
    if (p.oldPrice && +p.oldPrice <= +p.price) errors.push(`${at}: original price must be higher than the sale price`);
    if (!p.slug) errors.push(`${at}: slug is required`);
    if (p.slug && slugs.has(p.slug)) errors.push(`${at}: duplicate slug "${p.slug}"`);
    slugs.add(p.slug);
    if (p.shades) {
      if (!Array.isArray(p.shades)) errors.push(`${at}: shades must be a list`);
      else p.shades.forEach((s, j) => {
        if (!s.name) errors.push(`${at}: shade ${j + 1} needs a name`);
        if (!/^#[0-9a-f]{6}$/i.test(s.hex || "")) errors.push(`${at}: shade "${s.name}" needs a colour like #e83e70`);
        if (+s.stock < 0 || Number.isNaN(+s.stock)) errors.push(`${at}: shade "${s.name}" stock must be 0 or more`);
      });
    }
  });
  return errors;
}

const STATUSES = ["Received", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled"];

/* ---------- auth endpoints (the only unauthenticated API) ---------- */
async function authApi(req, res, route) {
  if (route === "/api/auth/state" && req.method === "GET") {
    const rec = auth.exists() ? auth.load() : null;
    return send(res, 200, {
      ok: true,
      configured: !!rec,
      username: rec ? rec.username : null,
      signedIn: !!validSession(req),
    });
  }

  /* First-run only: creating a login is refused once one exists, so this
     can never be used to overwrite the password remotely. */
  if (route === "/api/auth/setup" && req.method === "POST") {
    if (auth.exists()) {
      return send(res, 409, { ok: false, error: "A login already exists. Use: node set-admin-password.js" });
    }
    const { username, password } = await body(req);
    const problems = auth.checkStrength(password);
    if (problems.length) {
      return send(res, 400, { ok: false, error: "That password " + problems.join(", and ") + "." });
    }
    auth.save(username, password);
    const token = newSession();
    res.setHeader("Set-Cookie", cookieHeader(token, SESSION_IDLE_MS / 1000));
    console.log(`  admin login created for "${(username || "admin").trim() || "admin"}"`);
    return send(res, 200, { ok: true });
  }

  if (route === "/api/auth/login" && req.method === "POST") {
    if (lockRemaining() > 0) {
      return send(res, 429, {
        ok: false,
        error: `Too many failed attempts. Try again in ${Math.ceil(lockRemaining() / 60000)} minute(s).`,
      });
    }
    if (!auth.exists()) return send(res, 409, { ok: false, error: "No login is configured yet." });

    const { username, password } = await body(req);
    if (auth.verify(username, password)) {
      failures = 0;
      const token = newSession();
      res.setHeader("Set-Cookie", cookieHeader(token, SESSION_IDLE_MS / 1000));
      return send(res, 200, { ok: true });
    }

    failures++;
    if (failures >= MAX_ATTEMPTS) {
      lockedUntil = Date.now() + LOCKOUT_MS;
      failures = 0;
      console.warn(`  ⚠ ${MAX_ATTEMPTS} failed sign-ins — locked for ${LOCKOUT_MS / 60000} minutes`);
      return send(res, 429, { ok: false, error: `Too many failed attempts. Locked for ${LOCKOUT_MS / 60000} minutes.` });
    }
    // Deliberately vague: never reveal which half was wrong
    return send(res, 401, {
      ok: false,
      error: `Incorrect username or password. ${MAX_ATTEMPTS - failures} attempt(s) left.`,
    });
  }

  if (route === "/api/auth/logout" && req.method === "POST") {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { ok: false, error: "unknown endpoint" });
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const route = url.pathname;

  /* --- products --- */
  if (route === "/api/products" && req.method === "GET") {
    return send(res, 200, readJSON(PRODUCTS_FILE, { products: [] }));
  }

  if (route === "/api/products" && req.method === "PUT") {
    const data = await body(req);
    const list = data.products;
    const errors = validateProducts(list);
    if (errors.length) return send(res, 400, { ok: false, errors });

    /* A malformed or truncated payload should never be able to empty the
       shop. Large deletions have to be opted into explicitly. */
    const existing = (readJSON(PRODUCTS_FILE, { products: [] }).products || []).length;
    if (existing > 0 && !data.confirmBulkDelete) {
      if (list.length === 0) {
        return send(res, 409, {
          ok: false,
          error: `Refusing to save an empty catalogue (would delete all ${existing} products). Delete them individually if you really mean to.`,
        });
      }
      if (list.length < Math.ceil(existing / 2)) {
        return send(res, 409, {
          ok: false,
          error: `Refusing to save: this would remove ${existing - list.length} of ${existing} products at once. Looks like a mistake — delete them individually, or resend with confirmBulkDelete.`,
        });
      }
    }
    const backedUp = backup(PRODUCTS_FILE);
    const current = readJSON(PRODUCTS_FILE, {});
    writeJSONAtomic(PRODUCTS_FILE, {
      _comment: current._comment,
      version: (current.version || 1),
      updated: new Date().toISOString(),
      products: list,
    });
    return send(res, 200, { ok: true, count: list.length, backup: backedUp });
  }

  /* --- build --- */
  if (route === "/api/build" && req.method === "POST") {
    return execFile(process.execPath, [path.join(ROOT, "build.js")], { cwd: ROOT, timeout: 120000 },
      (err, stdout, stderr) => {
        send(res, err ? 500 : 200, {
          ok: !err,
          output: String(stdout || "") + String(stderr || ""),
          error: err ? err.message : null,
        });
      });
  }

  /* --- orders --- */
  if (route === "/api/orders" && req.method === "GET") {
    const store = readJSON(ORDERS_FILE, { orders: [] });
    return send(res, 200, store);
  }

  if (route === "/api/orders" && req.method === "POST") {
    // Import one or many orders; existing refs are updated, not duplicated
    const data = await body(req);
    const incoming = Array.isArray(data.orders) ? data.orders : data.order ? [data.order] : [];
    if (!incoming.length) return send(res, 400, { ok: false, error: "no orders supplied" });

    const store = readJSON(ORDERS_FILE, { orders: [] });
    const byRef = new Map(store.orders.map((o) => [o.ref, o]));
    let added = 0, updated = 0;
    incoming.forEach((o) => {
      if (!o || !o.ref) return;
      if (byRef.has(o.ref)) {
        Object.assign(byRef.get(o.ref), o, { status: byRef.get(o.ref).status || o.status || "Received" });
        updated++;
      } else {
        byRef.set(o.ref, Object.assign({ status: "Received" }, o, { imported: new Date().toISOString() }));
        added++;
      }
    });
    const merged = [...byRef.values()].sort((a, b) => String(b.placed || "").localeCompare(String(a.placed || "")));
    backup(ORDERS_FILE);
    writeJSONAtomic(ORDERS_FILE, { orders: merged });
    return send(res, 200, { ok: true, added, updated, total: merged.length });
  }

  if (route.startsWith("/api/orders/") && req.method === "PATCH") {
    const ref = decodeURIComponent(route.slice("/api/orders/".length));
    const data = await body(req);
    if (data.status && !STATUSES.includes(data.status)) {
      return send(res, 400, { ok: false, error: `status must be one of ${STATUSES.join(", ")}` });
    }
    const store = readJSON(ORDERS_FILE, { orders: [] });
    const order = store.orders.find((o) => o.ref === ref);
    if (!order) return send(res, 404, { ok: false, error: "order not found" });
    if (data.status) order.status = data.status;
    if (typeof data.adminNote === "string") order.adminNote = data.adminNote;
    if (typeof data.tracking === "string") order.tracking = data.tracking;
    order.updated = new Date().toISOString();
    writeJSONAtomic(ORDERS_FILE, store);
    return send(res, 200, { ok: true, order });
  }

  if (route.startsWith("/api/orders/") && req.method === "DELETE") {
    const ref = decodeURIComponent(route.slice("/api/orders/".length));
    const store = readJSON(ORDERS_FILE, { orders: [] });
    const before = store.orders.length;
    store.orders = store.orders.filter((o) => o.ref !== ref);
    if (store.orders.length === before) return send(res, 404, { ok: false, error: "order not found" });
    backup(ORDERS_FILE);
    writeJSONAtomic(ORDERS_FILE, store);
    return send(res, 200, { ok: true });
  }

  /* --- remote sync (Google Apps Script) --- */
  if (route === "/api/orders/sync" && req.method === "POST") {
    let SITE;
    try {
      delete require.cache[require.resolve("./data/catalog.js")];
      SITE = require("./data/catalog.js").SITE;
    } catch (e) {
      return send(res, 500, { ok: false, error: "could not read config: " + e.message });
    }
    if (!SITE.ordersApi) {
      return send(res, 400, { ok: false, error: "SITE.ordersApi is not set in data/catalog.js — see tools/orders-apps-script.gs" });
    }
    try {
      const u = new URL(SITE.ordersApi);
      u.searchParams.set("action", "list");
      if (SITE.ordersApiKey) u.searchParams.set("key", SITE.ordersApiKey);
      const r = await fetch(u, { redirect: "follow" });
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); }
      catch { return send(res, 502, { ok: false, error: "endpoint did not return JSON. Is the Apps Script deployed with access set to Anyone?" }); }
      if (!r.ok || json.ok === false) {
        return send(res, 502, { ok: false, error: json.error || `remote returned ${r.status}` });
      }
      const remote = json.orders || [];
      const store = readJSON(ORDERS_FILE, { orders: [] });
      const byRef = new Map(store.orders.map((o) => [o.ref, o]));
      let added = 0;
      remote.forEach((o) => {
        if (!o || !o.ref) return;
        if (!byRef.has(o.ref)) { byRef.set(o.ref, Object.assign({ status: "Received" }, o)); added++; }
      });
      const merged = [...byRef.values()].sort((a, b) => String(b.placed || "").localeCompare(String(a.placed || "")));
      writeJSONAtomic(ORDERS_FILE, { orders: merged });
      return send(res, 200, { ok: true, added, total: merged.length, fetched: remote.length });
    } catch (e) {
      return send(res, 502, { ok: false, error: e.message });
    }
  }

  /* --- meta --- */
  if (route === "/api/meta" && req.method === "GET") {
    let D = {};
    try {
      delete require.cache[require.resolve("./data/catalog.js")];
      D = require("./data/catalog.js");
    } catch (e) { return send(res, 500, { ok: false, error: e.message }); }
    const photoDir = path.join(ROOT, "assets", "img", "products");
    let photos = [];
    try { photos = fs.readdirSync(photoDir).filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f)); } catch {}
    return send(res, 200, {
      ok: true,
      categories: D.CATEGORIES.map((c) => ({ key: c.key, label: c.label, sub: c.sub })),
      finishes: D.FINISHES,
      statuses: STATUSES,
      photos,
      site: { name: D.SITE.name, currency: D.SITE.currency, freeShippingOver: D.SITE.freeShippingOver, flatShipping: D.SITE.flatShipping },
      ordersApiConfigured: !!D.SITE.ordersApi,
    });
  }

  return send(res, 404, { ok: false, error: "unknown endpoint" });
}

/* ---------- static ---------- */
/* Only these are reachable without signing in. */
const PUBLIC_FILES = new Set(["/admin/login.html", "/favicon.ico"]);

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/admin/index.html";

  if (!PUBLIC_FILES.has(rel) && !validSession(req)) {
    const next = encodeURIComponent(url.pathname + url.search);
    res.writeHead(302, { Location: `/admin/login.html?next=${next}`, "Cache-Control": "no-store" });
    return res.end();
  }

  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain");
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    send(res, 200, data, TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
}

/* ---------- server ---------- */
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    try {
      if (url.pathname.startsWith("/api/auth/")) return await authApi(req, res, url.pathname);

      if (url.pathname.startsWith("/api/")) {
        if (!validSession(req)) return send(res, 401, { ok: false, error: "Not signed in" });
        return await api(req, res, url);
      }

      serveStatic(req, res, url);
    } catch (e) {
      send(res, 400, { ok: false, error: e.message });
    }
  })
  .listen(PORT, HOST, () => {
    console.log(`\nSHEGLAM PK admin  →  http://localhost:${PORT}`);
    console.log(`Bound to ${HOST} only. Do not deploy this file.`);
    if (auth.exists()) {
      console.log(`Sign in as "${auth.load().username}".`);
    } else {
      console.log(`\n⚠ No admin login set yet — open the URL above to create one,`);
      console.log(`  or run: node set-admin-password.js`);
    }
    console.log("");
  });
