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
   ========================================================= */
const crypto = require("crypto");
const { sql } = require("../db/client.js");

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
  const existing = await sql`SELECT id, filename, mime, byte_size, width, height FROM media WHERE sha256 = ${sha256} LIMIT 1`;
  if (existing.length) return { ...existing[0], url: `/api/media/${existing[0].id}`, deduped: true };

  const rows = await sql`
    INSERT INTO media (sha256, filename, mime, extension, byte_size, width, height, bytes, uploaded_by)
    VALUES (${sha256}, ${safeName(filename)}, ${sig.mime}, ${sig.ext}, ${buf.length},
            ${dim ? dim.width : null}, ${dim ? dim.height : null}, ${buf}, ${uploadedBy || null})
    RETURNING id, filename, mime, byte_size, width, height`;

  return { ...rows[0], url: `/api/media/${rows[0].id}`, deduped: false };
}

async function fetchMedia(id) {
  const rows = await sql`SELECT id, mime, bytes, byte_size, sha256 FROM media WHERE id = ${id} LIMIT 1`;
  return rows.length ? rows[0] : null;
}

async function listMedia({ limit = 60, offset = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 60, 1), 200);
  offset = Math.max(parseInt(offset, 10) || 0, 0);
  const rows = await sql`
    SELECT id, filename, mime, byte_size, width, height, uploaded_by, created_at,
           count(*) OVER () AS total_count
      FROM media ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  return {
    media: rows.map(({ total_count, ...r }) => ({ ...r, url: `/api/media/${r.id}` })),
    total: rows.length ? Number(rows[0].total_count) : 0, limit, offset,
  };
}

/* Refuses while a product still points at it, so deleting an image can
   never leave a product with a broken picture. */
async function deleteMedia(id) {
  const url = `/api/media/${id}`;
  const [used] = await sql`SELECT count(*)::int n FROM product_images WHERE url = ${url}`;
  if (used.n > 0) throw new Error(`This image is used by ${used.n} product image${used.n === 1 ? "" : "s"}. Remove it there first.`);
  const rows = await sql`DELETE FROM media WHERE id = ${id} RETURNING id, filename`;
  if (!rows.length) throw new Error("Image not found");
  return rows[0];
}

module.exports = { store, fetchMedia, listMedia, deleteMedia, MAX_BYTES, MAX_DIMENSION };
