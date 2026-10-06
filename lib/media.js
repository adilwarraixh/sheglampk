/* =========================================================
   lib/media.js — accepting an uploaded image

   The rule here is that nothing the client says about a file is trusted.
   Not the filename, not the extension, not the Content-Type. The bytes
   are inspected, and the type WE detect is the type that gets stored and
   later served.

   Why that matters: a file called photo.png, declared image/png, can
   contain HTML. Serve it back with a guessed content type on your own
   origin and a browser may render it as a page — that is stored XSS
   against your own admin session. Detecting from magic bytes and serving
   with nosniff closes it.

   SVG is refused outright. It is a legitimate image format and also a
   document format that can carry script; there is no safe way to serve
   attacker-supplied SVG from your own origin.

   Where the bytes live: with a Blob store configured (BLOB_READ_WRITE_TOKEN)
   an image is served from Vercel Blob's CDN, on its own domain; without
   one (the local tests) /api/media/:id serves it from the media table, as
   before. The table keeps the bytes either way, so going back to serving
   from the database (db/move-media-to-blob.js --rollback) covers every
   image, including ones uploaded after the move. Blob names are the image's sha256
   under a folder per environment, and a delete only ever removes a file
   in this environment's folder: the dev database is a copy of
   production's, so its rows can point at production's files.
   ========================================================= */
const crypto = require("crypto");
const { sql } = require("../db/client.js");

const blobConfigured = () => !!String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
const blobFolder = (env = process.env.VERCEL_ENV) => (env === "production" ? "media" : `media-${env || "local"}`);

async function putBlob(buf, sha256, sig, env) {
  const { put } = require("@vercel/blob");
  const r = await put(`${blobFolder(env)}/${sha256}.${sig.ext}`, buf, {
    access: "public", contentType: sig.mime, addRandomSuffix: false, allowOverwrite: true,
    cacheControlMaxAge: 31536000,   // the name is the content hash, so it never changes
  });
  return r.url;
}

/* Removes the stored file, but only one this environment wrote. */
async function dropBlob(url, env) {
  if (!url || !blobConfigured()) return;
  let path;
  try { path = new URL(url).pathname; } catch { return; }
  if (!path.startsWith(`/${blobFolder(env)}/`)) return;
  await require("@vercel/blob").del(url);
}

const MAX_BYTES = 3 * 1024 * 1024;          // 3MB — comfortably above a product photo
const MAX_DIMENSION = 6000;                  // guards against decompression-bomb dimensions

/* Signatures checked against the actual bytes. The declared MIME is
   ignored entirely. */
const SIGNATURES = [
  { mime: "image/jpeg", ext: "jpg",  test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png",  ext: "png",  test: (b) => b.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP" },
  { mime: "image/gif",  ext: "gif",  test: (b) => b.slice(0, 6).toString("ascii") === "GIF87a" || b.slice(0, 6).toString("ascii") === "GIF89a" },
];

function detect(buf) {
  if (buf.length < 12) return null;
  for (const s of SIGNATURES) { try { if (s.test(buf)) return s; } catch { /* keep looking */ } }
  return null;
}

/* Dimensions read from the header, so an image whose pixel count would
   blow up memory on decode is refused before anything decodes it. */
function dimensions(buf, mime) {
  try {
    if (mime === "image/png") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/gif") {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === "image/webp") {
      const fmt = buf.slice(12, 16).toString("ascii");
      if (fmt === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (fmt === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (fmt === "VP8X") return { width: (buf.readUIntLE(24, 3) & 0xffffff) + 1, height: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
      return null;
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        // SOF0-SOF15, excluding the non-frame markers in that range
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
  } catch { /* malformed header — treated as unknown below */ }
  return null;
}

const safeName = (s) =>
  String(s || "upload").split(/[\\/]/).pop()          // strip any path the client sent
    .replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120) || "upload";

/* dataUrlOrBase64 is what the browser's FileReader produced. */
async function store({ data, filename, uploadedBy }) {
  if (typeof data !== "string" || !data) throw new Error("No file data received.");

  const base64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  let buf;
  try { buf = Buffer.from(base64, "base64"); }
  catch { throw new Error("That file could not be read."); }

  if (!buf.length) throw new Error("That file is empty.");
  if (buf.length > MAX_BYTES)
    throw new Error(`That image is ${(buf.length / 1048576).toFixed(1)}MB. The limit is ${MAX_BYTES / 1048576}MB.`);

  const sig = detect(buf);
  if (!sig) {
    throw new Error("That is not a JPEG, PNG, WebP or GIF image. " +
      "SVG is not accepted, because it can carry scripts.");
  }

  const dim = dimensions(buf, sig.mime);
  if (dim && (dim.width > MAX_DIMENSION || dim.height > MAX_DIMENSION))
    throw new Error(`That image is ${dim.width}×${dim.height}. The limit is ${MAX_DIMENSION}px on a side.`);

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  // Same bytes uploaded twice reuse the existing row rather than duplicating.
  const existing = await sql`SELECT id, filename, mime, byte_size, width, height, blob_url FROM media WHERE sha256 = ${sha256} LIMIT 1`;
  if (existing.length) {
    const { blob_url, ...row } = existing[0];
    return { ...row, url: blob_url || `/api/media/${row.id}`, deduped: true };
  }

  const blobUrl = blobConfigured() ? await putBlob(buf, sha256, sig) : null;
  const rows = await sql`
    INSERT INTO media (sha256, filename, mime, extension, byte_size, width, height, bytes, blob_url, uploaded_by)
    VALUES (${sha256}, ${safeName(filename)}, ${sig.mime}, ${sig.ext}, ${buf.length},
            ${dim ? dim.width : null}, ${dim ? dim.height : null}, ${buf}, ${blobUrl}, ${uploadedBy || null})
    RETURNING id, filename, mime, byte_size, width, height`;

  return { ...rows[0], url: blobUrl || `/api/media/${rows[0].id}`, deduped: false };
}

/* The bytes are only read when they are still in the database. */
async function fetchMedia(id) {
  const rows = await sql`
    SELECT id, mime, byte_size, sha256, blob_url, CASE WHEN blob_url IS NULL THEN bytes END AS bytes
      FROM media WHERE id = ${id} LIMIT 1`;
  return rows.length ? rows[0] : null;
}

async function listMedia({ limit = 60, offset = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 60, 1), 200);
  offset = Math.max(parseInt(offset, 10) || 0, 0);
  const rows = await sql`
    SELECT id, filename, mime, byte_size, width, height, uploaded_by, created_at, blob_url,
           count(*) OVER () AS total_count
      FROM media ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  return {
    media: rows.map(({ total_count, blob_url, ...r }) => ({ ...r, url: blob_url || `/api/media/${r.id}` })),
    total: rows.length ? Number(rows[0].total_count) : 0, limit, offset,
  };
}

/* Refuses while a product still points at it — by either address — so
   deleting an image can never leave a product with a broken picture. */
async function deleteMedia(id) {
  const [m] = await sql`SELECT blob_url FROM media WHERE id = ${id}`;
  if (!m) throw new Error("Image not found");
  const [used] = await sql`
    SELECT count(*)::int n FROM product_images WHERE url = ${`/api/media/${id}`} OR url = ${m.blob_url}`;
  if (used.n > 0) throw new Error(`This image is used by ${used.n} product image${used.n === 1 ? "" : "s"}. Remove it there first.`);
  const rows = await sql`DELETE FROM media WHERE id = ${id} RETURNING id, filename`;
  if (!rows.length) throw new Error("Image not found");
  // Same bytes, same file name: a fresh upload of this image may already point at it.
  const [{ shared }] = await sql`SELECT count(*)::int AS shared FROM media WHERE blob_url = ${m.blob_url}`;
  try { if (!shared) await dropBlob(m.blob_url); }
  catch (e) { console.error("[media] the stored file could not be removed:", e.message); }   // the row is gone; a stray file costs nothing
  return rows[0];
}

module.exports = {
  store, fetchMedia, listMedia, deleteMedia, putBlob, blobFolder, blobConfigured,
  MAX_BYTES, MAX_DIMENSION, detect,
};
