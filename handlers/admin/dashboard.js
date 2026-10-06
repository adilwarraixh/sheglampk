/* GET /api/admin/dashboard — headline figures for the landing screen.
   Both roles may see this; the numbers themselves are identical because
   both people run the same shop. */
const orders = require("../../lib/orders.js");
const { ok, methods, guard, handler } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "dashboard:view");
      if (!session) return;

      const stats = await orders.dashboardStats();
      return ok(res, { ...stats, viewer: { name: session.user.displayName, role: session.user.role } });
    },
  })
);
