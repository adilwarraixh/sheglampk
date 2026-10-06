/* =========================================================
   scripts/parity.mjs — does the new host answer exactly like the old one?

   Fetches the same paths from two sites (or one site and a saved report)
   and compares, per path: status, redirect target, the security and
   caching headers, and a hash of the body. Timestamps are blanked before
   hashing, since every build stamps the time it ran.

   node scripts/parity.mjs <siteA> [<siteB>] [--save report.json] [--against report.json]

   VERCEL_AUTOMATION_BYPASS_SECRET (env or .env.local), if set, is sent so
   protected preview deployments answer. Exits 1 on any difference.
   ========================================================= */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const save = flag("--save"), against = flag("--against");
const [siteA, siteB] = args.map((s) => s.replace(/\/$/, ""));
if (!siteA) { console.error("usage: parity.mjs <siteA> [<siteB>] [--save f] [--against f]"); process.exit(2); }

const fromEnvFile = existsSync(".env.local")
  && (readFileSync(".env.local", "utf8").match(/^VERCEL_AUTOMATION_BYPASS_SECRET=(.+)$/m) || [])[1];
const bypass = (process.env.VERCEL_AUTOMATION_BYPASS_SECRET || fromEnvFile || "").trim();
const HEADERS = ["location", "cache-control", "x-robots-tag", "x-frame-options", "referrer-policy", "x-content-type-options", "content-type"];
const STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z|Last updated: \d{4}-\d{2}-\d{2}/g;

async function probe(site, path, method = "GET") {
  const res = await fetch(site + path, {
    method, redirect: "manual",
    headers: bypass ? { "x-vercel-protection-bypass": bypass } : {},
  });
  // A Windows checkout serves CRLF files where a Vercel build serves LF; that is not a difference.
  const body = method === "HEAD" ? "" : (await res.text()).replace(/\r\n/g, "\n").replace(STAMP, "<time>");
  const out = { status: res.status, body: createHash("sha256").update(body).digest("hex").slice(0, 16) };
  for (const h of HEADERS) {
    const v = res.headers.get(h);
    if (v) out[h] = h === "location" ? v.replace(site, "") : h === "content-type" ? v.toLowerCase() : v;
  }
  return out;
}

async function pathsOf(site) {
  const xml = await (await fetch(site + "/sitemap.xml", { headers: bypass ? { "x-vercel-protection-bypass": bypass } : {} })).text();
  const fromSitemap = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const admin = ["", "/login", "/orders", "/password", "/products", "/product", "/inventory", "/customers",
    "/analytics", "/audit", "/users", "/homepage", "/settings", "/import", "/inbox"];
  const product = fromSitemap.find((p) => p.startsWith("/product/")) || "/product/x.html";
  return [...new Set([
    ...fromSitemap, "/", "/index.html", "/404.html", "/robots.txt", "/sitemap.xml",
    "/data/products.js", "/data/catalog.js", "/data/templates.js", "/assets/css/style.css",
    "/face", "/face.html/", product.replace(/\.html$/, ""), "/product/nope.html", "/nope", "/a/b/c",
    ...admin.map((a) => "/admin" + a), ...admin.slice(1).map((a) => "/admin" + a + ".html"),
    "/api/admin/session", "/api/products", "/api/cron/refresh", "/api/nope",
  ])];
}

async function report(site, paths) {
  const r = {};
  for (const p of paths) {
    r["GET " + p] = await probe(site, p);
    if (p === "/nope" || p === "/") r["HEAD " + p] = await probe(site, p, "HEAD");
  }
  return r;
}

const paths = await pathsOf(siteA);
const a = await report(siteA, paths);
if (save) writeFileSync(save, JSON.stringify({ site: siteA, at: new Date().toISOString(), report: a }, null, 1));
const b = siteB ? await report(siteB, paths) : against ? JSON.parse(readFileSync(against, "utf8")).report : null;
if (!b) { console.log(`${Object.keys(a).length} responses recorded from ${siteA}${save ? " → " + save : ""}`); process.exit(0); }

const diffs = [];
for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
  const x = a[key] || {}, y = b[key] || {};
  for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (x[f] !== y[f]) diffs.push(`${key}  ${f}: ${x[f] ?? "—"}  →  ${y[f] ?? "—"}`);
  }
}
console.log(`${Object.keys(a).length} responses compared, ${diffs.length} difference${diffs.length === 1 ? "" : "s"}`);
diffs.forEach((d) => console.log("  " + d));
process.exit(diffs.length ? 1 : 0);
