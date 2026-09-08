/* =========================================================
   fetch-open-images.js — pull openly-licensed product photos

   Source: Open Beauty Facts (openbeautyfacts.org), a community
   database whose photos are published under CC-BY-SA 3.0. That
   licence permits commercial use with attribution, so these are
   safe to put on your storefront — unlike photography taken from
   a brand's own site.

   Coverage is thin (community-contributed), so expect this to
   fill a handful of products, not the whole catalogue. It writes
   assets/img/products/<slug>.jpg plus an ATTRIBUTION.md that the
   licence requires you to keep.

   Run:  node fetch-open-images.js          (preview, downloads nothing)
         node fetch-open-images.js --write  (download the matches)
   ========================================================= */
const fs = require("fs");
const path = require("path");
const D = require("./data/catalog.js");

const WRITE = process.argv.includes("--write");
const OUT = path.join(__dirname, "assets", "img", "products");
const ATTRIB = path.join(__dirname, "assets", "img", "products", "ATTRIBUTION.md");
const API = "https://world.openbeautyfacts.org/cgi/search.pl";

/* Loose comparison: strip brand, punctuation, shade numbers and case. */
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/sheglam/g, " ")
    .replace(/\b\d{2,3}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokens = (s) => new Set(norm(s).split(" ").filter((t) => t.length > 2));

function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  A.forEach((t) => { if (B.has(t)) shared++; });
  return shared / Math.min(A.size, B.size);        // how much of the shorter name is covered
}

async function search(page) {
  const url = `${API}?search_terms=sheglam&search_simple=1&action=process&json=1&page_size=100&page=${page}`;
  const res = await fetch(url, { headers: { "User-Agent": "SheglamPK-catalogue/1.0 (reseller storefront)" } });
  if (!res.ok) throw new Error(`Open Beauty Facts returned ${res.status}`);
  return res.json();
}

(async () => {
  console.log("\nOpen Beauty Facts — licensed product photos\n");

  let remote = [];
  for (let page = 1; page <= 3; page++) {
    const j = await search(page);
    const batch = (j.products || []).filter((p) => p.image_front_url);
    remote = remote.concat(batch);
    if (remote.length >= (j.count || 0) || !batch.length) break;
  }
  console.log(`  candidates with a photo: ${remote.length}`);

  /* Best match per catalogue product, above a confidence floor. */
  const MIN = 0.6;
  const matches = [];
  const used = new Set();

  D.PRODUCTS.forEach((p) => {
    let best = null, bestScore = 0;
    remote.forEach((r) => {
      const id = r.code || r.id;
      if (used.has(id)) return;
      const score = similarity(p.name, r.product_name || r.generic_name || "");
      if (score > bestScore) { bestScore = score; best = r; }
    });
    if (best && bestScore >= MIN) {
      used.add(best.code || best.id);
      matches.push({ product: p, remote: best, score: +bestScore.toFixed(2) });
    }
  });

  if (!matches.length) {
    console.log("\n  No confident matches. The database has few SHEGLAM entries and the");
    console.log("  names differ from the ones on your site.\n");
    console.log("  Your realistic options remain: photograph your own stock, or ask your");
    console.log("  supplier for their media pack. Both load via tools/photo-import.html.\n");
    process.exit(0);
  }

  console.log(`  confident matches (>=${MIN}): ${matches.length}\n`);
  matches.forEach((m) =>
    console.log(`   ${String(m.score).padEnd(5)} ${m.product.slug}\n         ← ${(m.remote.product_name || "").slice(0, 62)}`)
  );

  if (!WRITE) {
    console.log(`\n  Re-run with --write to download these ${matches.length} photos.\n`);
    process.exit(0);
  }

  fs.mkdirSync(OUT, { recursive: true });
  let saved = 0;
  const credits = [];

  for (const m of matches) {
    try {
      const res = await fetch(m.remote.image_front_url);
      if (!res.ok) { console.log(`   ✗ ${m.product.slug} — HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 3000) { console.log(`   ✗ ${m.product.slug} — image too small`); continue; }
      fs.writeFileSync(path.join(OUT, m.product.slug + ".jpg"), buf);
      credits.push(`- **${m.product.name}** — photo from [Open Beauty Facts](https://world.openbeautyfacts.org/product/${m.remote.code || ""}), CC-BY-SA 3.0`);
      saved++;
      console.log(`   ✓ ${m.product.slug}.jpg  (${Math.round(buf.length / 1024)}KB)`);
    } catch (e) {
      console.log(`   ✗ ${m.product.slug} — ${e.message}`);
    }
  }

  if (credits.length) {
    fs.writeFileSync(ATTRIB,
      "# Image attribution\n\n" +
      "These photographs come from Open Beauty Facts and are used under the\n" +
      "Creative Commons Attribution-ShareAlike 3.0 licence, which requires this\n" +
      "credit to be kept. Do not delete this file while those images are in use.\n\n" +
      credits.join("\n") + "\n", "utf8");
  }

  console.log(`\n✓ ${saved} photo(s) saved to assets/img/products/`);
  console.log(`  Attribution written to assets/img/products/ATTRIBUTION.md`);
  console.log(`  Check them with: node check-images.js`);
  console.log(`  Then rebuild:    node build.js\n`);
})();
