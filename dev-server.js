/* =========================================================
   dev-server.js — run the deployed site locally

   Serves dist/ and dispatches /api/* to the same handler modules that
   Vercel runs, including the [id] dynamic route. Lets the admin portal
   be exercised end to end without deploying.

   Run:  node build.js && node deploy-prepare.js && node dev-server.js
   Open: http://localhost:5601/admin/login
   ========================================================= */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const API = path.join(ROOT, "api");
const PORT = process.env.PORT || 5601;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm",
  ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2", ".ico": "image/x-icon",
};

/* Mirrors the rewrites in vercel.json */
const REWRITES = {
  "/admin": "/admin/index.html",
  "/admin/login": "/admin/login.html",
  "/admin/orders": "/admin/orders.html",
  "/admin/password": "/admin/password.html",
  "/admin/products": "/admin/products.html",
  "/admin/product": "/admin/product.html",
  "/admin/audit": "/admin/audit.html",
  "/admin/analytics": "/admin/analytics.html",
  "/admin/customers": "/admin/customers.html",
  "/admin/inventory": "/admin/inventory.html",
};

/* Maps /api/admin/orders/42 to api/admin/orders/[id].js, exactly as
   Vercel's filesystem routing would. */
function resolveApi(pathname) {
  const rel = pathname.replace(/^\/api\/?/, "");
  const parts = rel.split("/").filter(Boolean);

  const exact = path.join(API, ...parts) + ".js";
  if (fs.existsSync(exact)) return { file: exact, params: {} };

  const index = path.join(API, ...parts, "index.js");
  if (fs.existsSync(index)) return { file: index, params: {} };

  // try the last segment as a dynamic parameter
  if (parts.length) {
    const last = parts[parts.length - 1];
    const dir = path.join(API, ...parts.slice(0, -1));
    if (fs.existsSync(dir)) {
      const dynamic = fs.readdirSync(dir).find((f) => /^\[.+\]\.js$/.test(f));
      if (dynamic) {
        const name = dynamic.slice(1, -4).replace(/\]$/, "");
        return { file: path.join(dir, dynamic), params: { [name]: decodeURIComponent(last) } };
      }
    }
  }
  return null;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  /* ---------- API ---------- */
  if (url.pathname.startsWith("/api/")) {
    const route = resolveApi(url.pathname);
    if (!route) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "No such endpoint" }));
    }
    try {
      // Reload on every request so edits apply without a restart
      delete require.cache[require.resolve(route.file)];
      const handler = require(route.file);
      req.query = Object.assign({}, Object.fromEntries(url.searchParams), route.params);
      await handler(req, res);
    } catch (e) {
      console.error(`[api] ${req.method} ${url.pathname}`, e);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Server error" }));
    }
    return;
  }

  /* ---------- static ---------- */
  let pathname = decodeURIComponent(url.pathname);
  if (REWRITES[pathname]) pathname = REWRITES[pathname];
  if (pathname === "/") pathname = "/index.html";

  let file = path.normalize(path.join(DIST, pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end("Forbidden"); }
  if (!path.extname(file) && fs.existsSync(file + ".html")) file += ".html";

  fs.readFile(file, (err, data) => {
    if (err) {
      const nf = path.join(DIST, "404.html");
      if (fs.existsSync(nf)) {
        res.writeHead(404, { "Content-Type": TYPES[".html"] });
        return res.end(fs.readFileSync(nf));
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const headers = { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" };
    if (pathname.startsWith("/admin")) headers["Cache-Control"] = "no-store";
    res.writeHead(200, headers);
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`\n  shop  → http://localhost:${PORT}`);
  console.log(`  admin → http://localhost:${PORT}/admin/login\n`);
});
