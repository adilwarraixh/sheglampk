/* /api/admin/analytics — real figures from the orders table.
   Never seeded, never estimated: an empty shop reports zeroes. */
const D = require("../../lib/admin-data.js");
const { ok, guard, handler, methods } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "analytics:view");
      if (!session) return;
      return ok(res, await D.analytics({ days: (req.query || {}).days }));
    },
  })
);
