/* /api/admin/import — CSV product import.

   GET     download a template pre-filled with the current catalogue
   POST    analyse a file and return exactly what would happen (writes nothing)
   PUT     perform it

   Analyse needs only products:view so ashba can check a file; performing
   it needs products:import, which is Super Admin only. */
const I = require("../../lib/product-import.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../lib/http.js");
const auth = require("../../lib/auth.js");

const MAX_CHARS = 4 * 1024 * 1024;

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "products:view");
      if (!session) return;
      const withProducts = (req.query || {}).empty !== "1";
      const body = await I.template({ withProducts });
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition",
        `attachment; filename="sheglampk-products-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      return res.end("\ufeff" + body);          // BOM so Excel reads UTF-8
    },

    POST: async () => {
      const session = await guard(req, res, "products:view");
      if (!session) return;
      const body = await readBody(req, MAX_CHARS + 65536);
      const text = decode(body);
      if (text === null) return fail(res, 400, "No file received.");
      if (text.length > MAX_CHARS) return fail(res, 400, "That file is too large. Import up to 2000 rows at a time.");

      let analysis;
      try { analysis = await I.analyse(text); }
      catch (e) { return fail(res, 400, e.message); }
      if (analysis.fatal) return fail(res, 400, analysis.fatal, { headers: analysis.headers || [] });
      return ok(res, analysis);
    },

    PUT: async () => {
      const session = await guard(req, res, "products:import");
      if (!session) return;
      const body = await readBody(req, MAX_CHARS + 65536);
      const text = decode(body);
      if (text === null) return fail(res, 400, "No file received.");

      let result;
      try { result = await I.apply(text, { skipErrors: body.skipErrors !== false }); }
      catch (e) { return fail(res, 400, e.message); }

      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "PRODUCTS_IMPORTED", targetType: "catalogue",
        detail: { created: result.created, updated: result.updated,
                  skipped: result.skipped, failed: result.failed.length },
        ip: clientIp(req),
      });
      return ok(res, result);
    },
  })
);

/* The browser sends the file as text, or as a data: URL from FileReader. */
function decode(body) {
  if (!body || typeof body.data !== "string" || !body.data) return null;
  if (!body.data.startsWith("data:")) return body.data;
  const comma = body.data.indexOf(",");
  const meta = body.data.slice(0, comma);
  const payload = body.data.slice(comma + 1);
  if (!/;base64/i.test(meta)) return decodeURIComponent(payload);
  return Buffer.from(payload, "base64").toString("utf8");
}
