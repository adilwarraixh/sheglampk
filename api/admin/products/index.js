/* /api/admin/products — list (products:view) and create (products:create)
   products:create is Super Admin only, so ashba can browse the catalogue
   but not change it. The check is in rbac.js, applied by guard(). */
const P = require("../../../lib/products-admin.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../../lib/http.js");
const auth = require("../../../lib/auth.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "products:view");
      if (!session) return;
      const q = req.query || {};
      const data = await P.adminList({
        q: q.q, status: q.status, category: q.category, stock: q.stock,
        flag: q.flag, sort: q.sort, limit: q.limit, offset: q.offset,
      });
      return ok(res, {
        ...data,
        statuses: P.STATUSES,
        categories: await P.categories(),
        subcategories: await P.subcategories(),
      });
    },

    POST: async () => {
      const session = await guard(req, res, "products:create");
      if (!session) return;
      const body = await readBody(req);
      let product;
      try { product = await P.createProduct(body); }
      catch (e) { return fail(res, 400, e.message); }

      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "PRODUCT_CREATED", targetType: "product", targetId: String(product.id),
        detail: { name: product.name, status: product.status }, ip: clientIp(req),
      });
      return ok(res, { product });
    },
  })
);
