/* =========================================================
   db/move-media-to-blob.js — copy uploaded images into Vercel Blob

   Images uploaded through the admin have lived as bytes in the media
   table, served one function call at a time by /api/media/:id. This
   copies each into the Blob store, checks the copy, and points product
   photos at it, so the shop loads them from Blob's CDN.

     node db/move-media-to-blob.js                 dev branch, report only
     node db/move-media-to-blob.js --apply         dev branch
     node db/move-media-to-blob.js --production --apply
     node db/move-media-to-blob.js --production --rollback

   Safe by construction:
   - nothing is deleted: the bytes stay in the media table, so --rollback
     points product photos back at /api/media/:id and serves from there;
   - each upload is downloaded again and its sha256 compared before the
     row records where it lives;
   - product photos switch only once every image has verified;
   - /api/media/:id redirects to Blob, so past orders' image links and
     anything else holding the old address keep working.
   Needs BLOB_READ_WRITE_TOKEN (in .env.local after `vercel env pull`).
   ========================================================= */
if (process.argv.includes("--production")) process.env.SGPK_TARGET = "production";
const crypto = require("crypto");
const { sql, describeTarget } = require("./client.js");
const M = require("../lib/media.js");

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
// Files for the live shop go in its folder; the dev branch's in the preview folder.
const ENV = process.env.SGPK_TARGET === "production" ? "production" : "preview";
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

/* Back to serving every image from the database: product photos point at
   /api/media/:id again, and that stops redirecting to Blob. One
   transaction, so the shop never sees half of it. The Blob files stay;
   --apply again re-links them (same names, same bytes). */
async function rollback() {
  const [moved, unlinked] = await sql.transaction([
    sql`UPDATE product_images i SET url = '/api/media/' || m.id
          FROM media m WHERE i.url = m.blob_url AND m.bytes IS NOT NULL
        RETURNING i.id`,
    sql`UPDATE media SET blob_url = NULL WHERE blob_url IS NOT NULL AND bytes IS NOT NULL RETURNING id`,
  ]);
  const [{ stuck }] = await sql`SELECT count(*)::int AS stuck FROM media WHERE bytes IS NULL`;
  console.log(`  ${moved.length} product photo(s) point at /api/media/:id again; ${unlinked.length} image(s) served from the database.`);
  if (stuck) console.log(`  ! ${stuck} image(s) have no bytes in the database and still need Blob.`);
  console.log('  Rebuild the shop ("Update shop now" in Products) so its pages use the old addresses.\n');
}

async function main() {
  console.log(`\nMedia → Vercel Blob  (${describeTarget()}, folder ${M.blobFolder(ENV)}/)`);
  if (ROLLBACK) return rollback();                 // touches only the database
  if (!M.blobConfigured()) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");

  const todo = await sql`SELECT id, sha256, mime, extension FROM media WHERE blob_url IS NULL ORDER BY id`;
  const [{ photos }] = await sql`SELECT count(*)::int AS photos FROM product_images WHERE url LIKE '/api/media/%'`;
  console.log(`  ${todo.length} image(s) still only in the database; ${photos} product photo(s) use /api/media/:id`);
  if (!APPLY) { console.log("  Report only. Add --apply to copy them.\n"); return; }

  let failed = 0;
  for (const m of todo) {
    // One at a time, so a 77-image run never holds them all in memory.
    const [{ bytes }] = await sql`SELECT bytes FROM media WHERE id = ${m.id}`;
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (sha(buf) !== m.sha256) { console.error(`  ✗ #${m.id}: stored bytes do not match their sha256 — skipped`); failed++; continue; }
    const sig = M.detect(buf) || { mime: m.mime, ext: m.extension };
    const url = await M.putBlob(buf, m.sha256, sig, ENV);
    const copy = Buffer.from(await (await fetch(url)).arrayBuffer());
    if (sha(copy) !== m.sha256) { console.error(`  ✗ #${m.id}: the Blob copy does not match — not recorded`); failed++; continue; }
    await sql`UPDATE media SET blob_url = ${url} WHERE id = ${m.id} AND blob_url IS NULL`;
    process.stdout.write(".");
  }
  console.log(`\n  ${todo.length - failed} copied and verified, ${failed} failed`);
  if (failed) { console.log("  Product photos were NOT switched. Fix the failures and run again.\n"); process.exitCode = 1; return; }

  const switched = await sql`
    UPDATE product_images i SET url = m.blob_url
      FROM media m WHERE i.url = '/api/media/' || m.id AND m.blob_url IS NOT NULL
    RETURNING i.id`;
  const [{ left }] = await sql`SELECT count(*)::int AS left FROM product_images WHERE url LIKE '/api/media/%'`;
  console.log(`  ${switched.length} product photo(s) now load from Blob; ${left} still use /api/media/:id`);
  console.log("  The shop shows them after its next rebuild (\"Update shop now\" in Products, or any deploy).");
  console.log("  Undo:  node db/move-media-to-blob.js" + (ENV === "production" ? " --production" : "") + " --rollback\n");
}

main().then(() => process.exit(process.exitCode || 0))
  .catch((e) => { console.error(`\n! ${e.message}\n`); process.exit(1); });
