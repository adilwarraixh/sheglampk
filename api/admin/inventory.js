/* /api/admin/inventory — stock levels (inventory:view) and updates
   (inventory:update, Super Admin only). */
const D = require("../../lib/admin-data.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../lib/http.js");
const auth = require("../../lib/auth.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "inventory:view");
      if (!session) return;
      const q = req.query || {};
      return ok(res, await D.inventory({ q: q.q, level: q.level, limit: q.limit, offset: q.offset }));
    },
    PATCH: async () => {
      const session = await guard(req, res, "inventory:update");
      if (!session) return;
      const body = await readBody(req);
      let r;
      try { r = await D.setStock(body); }
      catch (e) { return fail(res, 400, e.message); }
      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "STOCK_UPDATED",
        targetType: body.variantId ? "variant" : "product",
        targetId: String(body.variantId || body.productId),
        detail: { name: r.name, quantity: r.quantity }, ip: clientIp(req),
      });
      return ok(res, r);
    },
  })
);
