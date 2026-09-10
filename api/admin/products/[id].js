/* /api/admin/products/:id — read, update, archive.
   DELETE archives rather than removing: order_items reference products,
   and a past order must keep showing what was actually bought. */
const P = require("../../../lib/products-admin.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../../lib/http.js");
const auth = require("../../../lib/auth.js");

module.exports = handler(async (req, res) => {
  const id = Number((req.query && req.query.id) || 0);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, "Invalid product id");

  return methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "products:view");
      if (!session) return;
      const product = await P.adminGet(id);
      if (!product) return fail(res, 404, "Product not found");
      return ok(res, {
        product,
        statuses: P.STATUSES,
        categories: await P.categories(),
        subcategories: await P.subcategories(),
      });
    },

    PATCH: async () => {
      const session = await guard(req, res, "products:update");
      if (!session) return;
      const body = await readBody(req);
      let product;
      try {
        // A bare {status} is the list view's publish/unpublish/archive action.
        product = (Object.keys(body).length === 1 && body.status)
          ? await P.setStatus(id, body.status)
          : await P.updateProduct(id, body);
      } catch (e) { return fail(res, 400, e.message); }
      if (!product) return fail(res, 404, "Product not found");

      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "PRODUCT_UPDATED", targetType: "product", targetId: String(id),
        detail: { name: product.name, status: product.status }, ip: clientIp(req),
      });
      return ok(res, { product });
    },

    POST: async () => {
      // Duplicate lives here so the list view needs no extra route.
      const session = await guard(req, res, "products:create");
      if (!session) return;
      const body = await readBody(req);
      if (body.action !== "duplicate") return fail(res, 400, "Unknown action");
      let copy;
      try { copy = await P.duplicateProduct(id); }
      catch (e) { return fail(res, 400, e.message); }
      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "PRODUCT_DUPLICATED", targetType: "product", targetId: String(copy.id),
        detail: { from: id, name: copy.name }, ip: clientIp(req),
      });
      return ok(res, { product: copy });
    },

    DELETE: async () => {
      const session = await guard(req, res, "products:delete");
      if (!session) return;
      const product = await P.archiveProduct(id);
      if (!product) return fail(res, 404, "Product not found");
      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "PRODUCT_ARCHIVED", targetType: "product", targetId: String(id),
        detail: { name: product.name }, ip: clientIp(req),
      });
      return ok(res, { product, note: "Archived, not deleted — past orders still reference it." });
    },
  });
});
