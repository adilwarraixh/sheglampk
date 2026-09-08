/* GET /api/admin/orders — list, filter and search orders
   Both roles may read orders; the guard still runs so an unauthenticated
   or disabled account gets nothing. */
const orders = require("../../../lib/orders.js");
const { ok, methods, guard, handler } = require("../../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "orders:view");
      if (!session) return;                       // guard already responded

      const url = new URL(req.url, "http://localhost");
      const result = await orders.listOrders({
        status: url.searchParams.get("status") || undefined,
        search: url.searchParams.get("q") || undefined,
        limit: url.searchParams.get("limit") || 50,
        offset: url.searchParams.get("offset") || 0,
      });

      return ok(res, { ...result, statuses: orders.STATUSES });
    },
  })
);
