/* =========================================================
   deploy-prepare.js — assemble the public site into dist/

   Vercel (or any static host) should serve ONLY this folder.
   Copying to an allow-list rather than deleting from the repo
   means a new admin or tooling file is excluded by default —
   the safe direction to fail in.

   Run:  node build.js && node deploy-prepare.js
   ========================================================= */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist");

/* Exact files and whole directories that make up the public site. */
const COPY_DIRS = ["assets", "product"];
const COPY_FILES = [
  "sitemap.xml",
  "robots.txt",
  "data/catalog.js",     // site config + derivation
  "data/products.js",    // generated product data for the browser
  "data/templates.js",   // shared card markup
];

/* The online admin portal ships (it is a normal web page whose data comes
   from the authenticated API). The LOCAL admin tool and every credential
   file must never leave this machine. */
const COPY_TREES = [
  { from: path.join("src", "admin"), to: "admin" },   // /admin/login, /admin, /admin/orders
];

/* Never shipped, even if something above would otherwise sweep them in. */
const DENY = [
  /^data[\\/]products\.json$/i,     // source of truth, not needed by the browser
  /^data[\\/]orders\.json$/i,       // local order store
  /^data[\\/]admin-auth\.json$/i,   // local password hash
  /^data[\\/]backups[\\/]/i,
  /(^|[\\/])admin-auth\./i,         // the local auth module
  /(^|[\\/])admin-server\./i,       // the local admin server
  /(^|[\\/])set-admin-password\./i,
  /(^|[\\/])\.env/i,
];

const denied = (rel) => DENY.some((re) => re.test(rel));

let copied = 0, skipped = 0;

function copyFile(rel) {
  if (denied(rel)) { skipped++; return; }
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return;
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied++;
}

/* Copies a folder to a DIFFERENT destination path (src/admin -> admin). */
function copyTree(fromDir, toDir) {
  const abs = path.join(ROOT, fromDir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(fromDir, entry.name);
    const dest = path.join(toDir, entry.name);
    if (entry.isDirectory()) { copyTree(rel, dest); continue; }
    if (denied(dest)) { skipped++; continue; }
    const target = path.join(OUT, dest);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), target);
    copied++;
  }
}

function copyDir(relDir) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) copyDir(rel);
    else copyFile(rel);
  }
}

/* ---- build ---- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Generated pages live at the repo root; take the .html files only.
fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".html"))
  .forEach((e) => copyFile(e.name));

COPY_DIRS.forEach(copyDir);
COPY_FILES.forEach(copyFile);
COPY_TREES.forEach(({ from, to }) => copyTree(from, to));

/* ---- verify nothing sensitive slipped through ---- */
const leaked = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(abs); continue; }
    const rel = path.relative(OUT, abs);
    /* Look for credential material and the local-only server, not merely
       the word "admin" — the admin PORTAL is a public page whose data
       comes from the authenticated API. */
    if (denied(rel) || /admin-auth|admin-server|set-admin-password|\.env|orders\.json|products\.json/i.test(rel)) {
      leaked.push(rel);
    }
  }
})(OUT);

console.log(`\n✓ dist/ ready — ${copied} files (${skipped} denied)`);
console.log(`  pages   : ${fs.readdirSync(OUT).filter((f) => f.endsWith(".html")).length}`);
console.log(`  products: ${fs.existsSync(path.join(OUT, "product")) ? fs.readdirSync(path.join(OUT, "product")).length : 0}`);

if (leaked.length) {
  console.error("\n✗ REFUSING: private files reached dist/:");
  leaked.forEach((f) => console.error("   " + f));
  process.exit(1);
}
console.log(`  no admin, credential or customer files included ✓\n`);
