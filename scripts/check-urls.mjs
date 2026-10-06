/* =========================================================
   scripts/check-urls.mjs — every shop address is clean, and every old one
   still lands in the right place

   node scripts/check-urls.mjs <site>        e.g. http://localhost:3100

   For each page in the site's sitemap: 200 at its clean address, a
   canonical equal to that address, no link or URL to an .html page, and
   its old .html address answering 308 to the clean one (query kept).
   Every internal link found on those pages must answer 200 directly.
   Plus: unknown addresses are 404, home's old address goes to /.
   Exits 1 on any failure.
   ========================================================= */
const site = (process.argv[2] || "").replace(/\/$/, "");
if (!site) { console.error("usage: check-urls.mjs <site>"); process.exit(2); }
const LIVE = "https://www.sheglampk.online";
const fails = [];
const get = (p, method = "GET") => fetch(site + p, { method, redirect: "manual" });

const xml = await (await get("/sitemap.xml")).text();
const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
if (!paths.length) fails.push("sitemap lists no pages");
for (const p of paths) if (p.endsWith(".html")) fails.push(`sitemap lists an .html address: ${p}`);

const links = new Set();
for (const p of paths) {
  const r = await get(p);
  const body = await r.text();
  if (r.status !== 200) { fails.push(`${p} → ${r.status}`); continue; }
  const canon = (body.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  if (canon !== LIVE + p) fails.push(`${p} canonical is ${canon}`);
  const leaks = [...body.matchAll(/(?:href="|sheglampk\.online)([^"#?\s]*\.html)/g)].map((m) => m[1])
    .filter((h) => !h.startsWith("/admin") && !/^https?:\/\/(?!www\.sheglampk)/.test(h));
  if (leaks.length) fails.push(`${p} still links to ${[...new Set(leaks)].slice(0, 3).join(", ")}`);
  for (const m of body.matchAll(/href="([^"#]*)"/g)) {
    const h = m[1];
    if (!h || /^(https?:|mailto:|tel:|data:|javascript:|\/\/)/.test(h) || h.startsWith("/assets") || h.startsWith("/admin")) continue;
    links.add(new URL(h, LIVE + p).pathname + (new URL(h, LIVE + p).search || ""));
  }
  if (p !== "/") {
    const old = await get(p + ".html?x=1");
    const to = old.headers.get("location") || "";
    if (old.status !== 308 || !to.endsWith(p + "?x=1")) fails.push(`${p}.html → ${old.status} ${to}`);
  }
}
for (const l of links) {
  if (l.startsWith("/assets/") || l.startsWith("/data/")) continue;
  const r = await get(l, "HEAD");
  if (r.status !== 200) fails.push(`link ${l} → ${r.status} ${r.headers.get("location") || ""}`);
}
const expect = async (p, status, loc) => {
  const r = await get(p);
  const to = r.headers.get("location") || "";
  if (r.status !== status || (loc && !to.endsWith(loc))) fails.push(`${p} → ${r.status} ${to} (wanted ${status} ${loc || ""})`);
};
await expect("/index.html", 308, "/");
await expect("/nope", 404);
await expect("/nope.html", 404);
await expect("/product/nope", 404);
await expect("/product/nope.html", 404);
await expect("/admin/login", 200);

console.log(`${paths.length} pages, ${links.size} internal links checked`);
fails.forEach((f) => console.log("  ✗ " + f));
console.log(fails.length ? `${fails.length} problem(s)` : "  ✓ every address clean, every old one redirects");
process.exit(fails.length ? 1 : 0);
