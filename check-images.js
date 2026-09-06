/* =========================================================
   check-images.js — product photography checklist

   Lists every product photo the site expects, whether it exists,
   and flags files that are the wrong shape or too small.

   Run:  node check-images.js
   Write a shooting list:  node check-images.js --list > to-shoot.txt
   ========================================================= */
const fs = require("fs");
const path = require("path");
const D = require("./data/catalog.js");

const DIR = path.join(__dirname, "assets", "img", "products");
const MIN_W = 800;
const listOnly = process.argv.includes("--list");

fs.mkdirSync(DIR, { recursive: true });

/* Reads width/height from a JPEG/PNG/WebP header without any dependencies. */
function dimensions(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(65536);
    const read = fs.readSync(fd, buf, 0, 65536, 0);

    // PNG
    if (buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a") {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    // WebP (VP8X / VP8 / VP8L — VP8X carries explicit canvas size)
    if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
      if (buf.slice(12, 16).toString("ascii") === "VP8X") {
        return { w: (buf.readUIntLE(24, 3) & 0xffffff) + 1, h: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
      }
      return { w: 0, h: 0 };
    }
    // JPEG — walk the segment markers to a SOF frame header
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < read - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    return { w: 0, h: 0 };
  } catch {
    return { w: 0, h: 0 };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

const EXTS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];
const findFile = (slug) => {
  for (const e of EXTS) {
    const f = path.join(DIR, slug + e);
    if (fs.existsSync(f)) return f;
  }
  return null;
};

const rows = D.PRODUCTS.map((p) => {
  const file = findFile(p.slug);
  if (!file) return { p, status: "missing" };
  const { w, h } = dimensions(file);
  const notes = [];
  if (w && w < MIN_W) notes.push(`only ${w}px wide, want ${MIN_W}+`);
  if (w && h && h <= w) notes.push(`${w}x${h} — should be portrait (taller than wide)`);
  return { p, status: notes.length ? "warn" : "ok", notes, w, h };
});

const missing = rows.filter((r) => r.status === "missing");
const warn = rows.filter((r) => r.status === "warn");
const ok = rows.filter((r) => r.status === "ok");

if (listOnly) {
  missing.forEach((r) => console.log(`${r.p.slug}.jpg    ${r.p.name}${r.p.shades ? ` (${r.p.shades.length} shades)` : ""}`));
  process.exit(0);
}

console.log(`\nProduct photography — ${DIR}\n`);
console.log(`  present : ${ok.length}`);
console.log(`  issues  : ${warn.length}`);
console.log(`  missing : ${missing.length}`);
console.log(`  total   : ${rows.length}\n`);

if (warn.length) {
  console.log("Needs attention:");
  warn.forEach((r) => console.log(`  ! ${r.p.slug}.jpg — ${r.notes.join("; ")}`));
  console.log("");
}

if (missing.length) {
  const byCat = {};
  missing.forEach((r) => {
    const k = `${r.p.categoryLabel} › ${r.p.sub}`;
    (byCat[k] = byCat[k] || []).push(r.p);
  });
  console.log("Still to shoot, grouped so you can photograph a whole set in one go:\n");
  Object.keys(byCat).sort().forEach((k) => {
    console.log(`  ${k}`);
    byCat[k].forEach((p) => console.log(`    ${(p.slug + ".jpg").padEnd(56)} ${p.name}`));
    console.log("");
  });
  console.log("Save each as assets/img/products/<name above>, portrait, 1000x1200px or larger.");
  console.log("Anything missing falls back to a generated studio tile — nothing breaks.\n");
  console.log("Easier: start the server (node server.js) and open");
  console.log("  http://localhost:5599/tools/photo-import.html");
  console.log("Drop your photos in and it crops, resizes and renames them for you.\n");
} else {
  console.log("All product photos are in place. Run `node build.js` to publish them.\n");
}
