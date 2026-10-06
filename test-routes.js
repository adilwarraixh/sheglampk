/* =========================================================
   test-routes.js — every handler is reachable, and none is left on
   Next's 1 MB body parser

   Each handlers/<path>.js must have exactly one pages/api/<path>.ts that
   re-exports it with bodyParser off (lib/http.js reads and limits bodies
   itself), and every wrapper must point at a handler that exists. A new
   handler without a wrapper would silently 404.

   Run:  node test-routes.js      (no database)
   ========================================================= */
const fs = require("fs");
const path = require("path");

const files = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p.split(path.sep).join("/")] : [];
});

const fails = [];
const handlers = files("handlers", ".js").map((h) => h.slice("handlers/".length, -3));
const wrappers = files("pages/api", ".ts").map((w) => w.slice("pages/api/".length, -3)).filter((w) => w !== "not-found");

for (const h of handlers) {
  const w = `pages/api/${h}.ts`;
  if (!fs.existsSync(w)) { fails.push(`no wrapper for handlers/${h}.js`); continue; }
  const src = fs.readFileSync(w, "utf8");
  if (!src.includes(`/handlers/${h}.js"`)) fails.push(`${w} does not re-export handlers/${h}.js`);
  if (!/bodyParser:\s*false/.test(src)) fails.push(`${w} leaves Next's body parser on`);
}
for (const w of wrappers) if (!handlers.includes(w)) fails.push(`pages/api/${w}.ts has no handler`);

console.log(`\n${handlers.length} handlers, ${wrappers.length} wrappers`);
fails.forEach((f) => console.log(`  ✗ ${f}`));
console.log(fails.length ? `\n${fails.length} failed\n` : "  ✓ every handler mounted once, body parser off\n");
process.exit(fails.length ? 1 : 0);
