/* /api/admin/audit — the audit trail (audit:view, Super Admin only) */
const D = require("../../lib/admin-data.js");
const { ok, guard, handler, methods } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "audit:view");
      if (!session) return;
      const q = req.query || {};
      return ok(res, await D.auditLog({ q: q.q, action: q.action, actor: q.actor, limit: q.limit, offset: q.offset }));
    },
  })
);
