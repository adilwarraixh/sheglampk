/* /api/admin/upload — accept an image, list what has been uploaded,
   remove one. Requires products:update, so ashba cannot upload. */
const M = require("../../lib/media.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../lib/http.js");
const auth = require("../../lib/auth.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "products:view");
      if (!session) return;
      const q = req.query || {};
      return ok(res, { ...(await M.listMedia({ limit: q.limit, offset: q.offset })),
                       maxBytes: M.MAX_BYTES, maxDimension: M.MAX_DIMENSION });
    },

    POST: async () => {
      const session = await guard(req, res, "products:update");
      if (!session) return;
      // Base64 inflates by ~33%, so the body cap sits above the file cap.
      const body = await readBody(req, Math.ceil(M.MAX_BYTES * 1.4) + 8192);
      let media;
      try { media = await M.store({ data: body.data, filename: body.filename, uploadedBy: session.user.username }); }
      catch (e) { return fail(res, 400, e.message); }

      if (!media.deduped) {
        await auth.audit({
          actorId: session.user.id, actorUsername: session.user.username,
          action: "MEDIA_UPLOADED", targetType: "media", targetId: String(media.id),
          detail: { filename: media.filename, mime: media.mime, bytes: media.byte_size }, ip: clientIp(req),
        });
      }
      return ok(res, { media });
    },

    DELETE: async () => {
      const session = await guard(req, res, "products:delete");
      if (!session) return;
      let removed;
      try { removed = await M.deleteMedia(Number((req.query || {}).id || 0)); }
      catch (e) { return fail(res, 400, e.message); }
      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "MEDIA_DELETED", targetType: "media", targetId: String(removed.id),
        detail: { filename: removed.filename }, ip: clientIp(req),
      });
      return ok(res, { media: removed });
    },
  })
);
