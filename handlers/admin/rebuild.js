/* /api/admin/rebuild — is the live shop up to date with the catalogue?

   GET   where the last rebuild has got to (products:view)
   POST  ask for a rebuild now (products:update, Super Admin only) —
         for when a request failed, or after changing data outside the
         portal. */
const R = require("../../lib/rebuild.js");
const { ok, guard, handler, methods, clientIp } = require("../../lib/http.js");
const auth = require("../../lib/auth.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "products:view");
      if (!session) return;
      return ok(res, { rebuild: await R.rebuildStatus() });
    },

    POST: async () => {
      const session = await guard(req, res, "products:update");
      if (!session) return;
      const result = await R.requestRebuild("requested from the portal", { by: session.user.username });
      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "SITE_REBUILD_REQUESTED", targetType: "site",
        detail: { status: result.status, coalesced: !!result.coalesced }, ip: clientIp(req),
      });
      return ok(res, { result, rebuild: await R.rebuildStatus() });
    },
  })
);
