/* =========================================================
   scripts/compare-pages.mjs — does a React page match the page it replaces?

   node scripts/compare-pages.mjs <legacy-dir> <site> <page> [<page> …]

   <legacy-dir>/<page>.html is the page build.js generated; <site>/<page>
   is the React one. Compared after normalising what React writes
   differently but means the same (comment markers, entity spelling,
   whitespace, relative vs root links):
     head  — title, description, canonical, robots, og:*, twitter:card
     JSON-LD — every block, as data
     main  — visible text, links (resolved), ids, classes, form fields
     page  — whether the newsletter band is there
   Exits 1 on any difference.
   ========================================================= */
import { readFileSync } from "node:fs";

const [dir, siteArg, ...pages] = process.argv.slice(2);
if (!dir || !siteArg || !pages.length) { console.error("usage: compare-pages.mjs <legacy-dir> <site> <page>…"); process.exit(2); }
const site = siteArg.replace(/\/$/, "");
const LIVE = "https://www.sheglampk.online";

const decode = (s) => s.replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&middot;/g, "·").replace(/&mdash;/g, "—")
  .replace(/&ndash;/g, "–").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const meta = (html) => {
  const pick = (re) => decode((html.match(re) || [])[1] || "");
  return {
    title: pick(/<title>([^<]*)<\/title>/),
    description: pick(/<meta name="description" content="([^"]*)"/),
    canonical: pick(/<link rel="canonical" href="([^"]*)"/),
    robots: pick(/<meta name="robots" content="([^"]*)"/),
    ...Object.fromEntries([...html.matchAll(/<meta property="(og:[a-z_]+)" content="([^"]*)"/g)].map((m) => [m[1], decode(m[2])])),
    "twitter:card": pick(/<meta name="twitter:card" content="([^"]*)"/),
  };
};
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => JSON.stringify(JSON.parse(m[1]))).sort();
function main(html, path) {
  const inner = ((html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/) || [])[1] || "").replace(/<!--[\s\S]*?-->/g, "");
  const text = decode(inner.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "))
    .replace(/Last updated: \d{4}-\d{2}-\d{2}/, "Last updated: <build date>")   // stamped when built
    .replace(/\s+/g, " ").trim();
  const base = LIVE + path;
  const links = [...inner.matchAll(/href="([^"]*)"/g)].map((m) => {
    const h = decode(m[1]);
    if (/^(mailto:|tel:|javascript:)/.test(h)) return h;
    const u = new URL(h, base);
    return u.origin === LIVE ? u.pathname + u.search + u.hash : u.href;
  });
  const ids = [...inner.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]).sort();
  const classes = [...new Set([...inner.matchAll(/\sclass(?:Name)?="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))].sort();
  const fields = [...inner.matchAll(/<(input|textarea|select|button)\b([^>]*)>/g)].map((m) => {
    const a = m[2];
    // Case-insensitive: React writes autoComplete, and HTML attribute names ignore case.
    const at = (n) => (a.match(new RegExp(`\\s${n}="([^"]*)"`, "i")) || [])[1] || "";
    return [m[1], at("id"), at("name"), at("type"), /\srequired\b/.test(a) ? "required" : "", decode(at("placeholder")), at("autocomplete")].join("|");
  });
  return { text, links, ids, classes, fields };
}

let bad = 0;
for (const page of pages) {
  const legacy = readFileSync(`${dir}/${page}.html`, "utf8");
  const res = await fetch(`${site}/${page}`);
  const react = await res.text();
  const diffs = [];
  if (res.status !== 200) diffs.push(`status ${res.status}`);
  const [ma, mb] = [meta(legacy), meta(react)];
  for (const k of new Set([...Object.keys(ma), ...Object.keys(mb)])) if ((ma[k] || "") !== (mb[k] || "")) diffs.push(`head ${k}: "${ma[k] || ""}" → "${mb[k] || ""}"`);
  const [ja, jb] = [jsonLd(legacy), jsonLd(react)];
  if (JSON.stringify(ja) !== JSON.stringify(jb)) diffs.push(`JSON-LD differs:\n      legacy ${ja.join(" ").slice(0, 300)}\n      react  ${jb.join(" ").slice(0, 300)}`);
  const [a, b] = [main(legacy, "/" + page), main(react, "/" + page)];
  if (a.text !== b.text) {
    let i = 0; while (i < a.text.length && a.text[i] === b.text[i]) i++;
    diffs.push(`text differs at ${i}:\n      legacy …${a.text.slice(Math.max(0, i - 40), i + 80)}\n      react  …${b.text.slice(Math.max(0, i - 40), i + 80)}`);
  }
  for (const k of ["links", "ids", "classes", "fields"]) {
    const [x, y] = [a[k], b[k]];
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      const gone = x.filter((v) => !y.includes(v)), added = y.filter((v) => !x.includes(v));
      diffs.push(`${k}: missing ${JSON.stringify(gone.slice(0, 8))} extra ${JSON.stringify(added.slice(0, 8))}${!gone.length && !added.length ? " (order)" : ""}`);
    }
  }
  const nl = (h) => /id="newsletterForm"/.test(h);
  if (nl(legacy) !== nl(react)) diffs.push(`newsletter band: ${nl(legacy)} → ${nl(react)}`);
  console.log(`${diffs.length ? "✗" : "✓"} ${page}${diffs.length ? "" : "  (head, JSON-LD, text, links, ids, classes, fields)"}`);
  diffs.forEach((d) => console.log("    " + d));
  if (diffs.length) bad++;
}
console.log(bad ? `\n${bad} page(s) differ` : `\nall ${pages.length} match`);
process.exit(bad ? 1 : 0);
