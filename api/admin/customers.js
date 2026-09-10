/* /api/admin/customers — customer list and one customer's order history.
   Personal data: reachable only with customers:view, never from a public
   route, and no bulk export. */
const D = require("../../lib/admin-data.js");
const { ok, fail, guard, handler, methods } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "customers:view");
      if (!session) return;
      const q = req.query || {};
      if (q.id) {
        const detail = await D.customerDetail(Number(q.id));
        if (!detail) return fail(res, 404, "Customer not found");
        return ok(res, detail);
      }
      return ok(res, await D.customers({ q: q.q, limit: q.limit, offset: q.offset }));
    },
  })
);
