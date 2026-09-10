/* GET /api/media/:id — serve an uploaded image.

   Public: product photos appear on the storefront. The content type is
   the one detected from the bytes at upload, never one supplied by the
   uploader, and nosniff stops the browser second-guessing it. Together
   with refusing SVG at upload, that is what prevents an "image" being
   rendered as a page on our own origin.

   Bytes are immutable once stored — an edit produces a new id — so this
   can be cached hard. */
const M = require("../../lib/media.js");
const { fail, methods, handler } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const id = Number((req.query && req.query.id) || 0);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, "Invalid image id");

      const media = await M.fetchMedia(id);
      if (!media) return fail(res, 404, "Image not found");

      const buf = Buffer.isBuffer(media.bytes) ? media.bytes : Buffer.from(media.bytes);
      const etag = `"${media.sha256.slice(0, 32)}"`;
      if (req.headers["if-none-match"] === etag) { res.statusCode = 304; return res.end(); }

      res.statusCode = 200;
      res.setHeader("Content-Type", media.mime);
      res.setHeader("Content-Length", buf.length);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("ETag", etag);
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Belt and braces: even if something served this as a document, it
      // could not run script or be framed.
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("X-Frame-Options", "DENY");
      return res.end(buf);
    },
  })
);
