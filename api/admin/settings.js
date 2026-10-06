/* /api/admin/settings — store settings (settings:manage, Super Admin only).
   Keys are whitelisted in lib/site-admin.js: a request cannot introduce a
   new setting key, only change one the application already understands. */
const S = require("../../lib/site-admin.js");
const R = require("../../lib/rebuild.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../lib/http.js");
const auth = require("../../lib/auth.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "settings:manage");
      if (!session) return;
      return ok(res, { settings: await S.getSettings() });
    },
    PATCH: async () => {
      const session = await guard(req, res, "settings:manage");
      if (!session) return;
      const body = await readBody(req);
      if (!body.settings || !Object.keys(body.settings).length) return fail(res, 400, "Nothing to save");
      let changes;
      try { changes = await S.saveSettings(body.settings, session.user.username); }
      catch (e) { return fail(res, 400, e.message); }
      // Saved, but nothing differed: no audit entry, no rebuild.
      if (!changes.length) return ok(res, { settings: await S.getSettings(), rebuild: { status: "not-needed" } });

      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "SETTINGS_UPDATED", targetType: "settings",
        detail: { keys: changes.map((c) => c.key), changes: Object.fromEntries(changes.map((c) => [c.key, [c.previous, c.value]])) },
        ip: clientIp(req),
      });
      /* The checkout reads these at once; the shop's pages print them, so
         they change when the site is rebuilt. */
      const rebuild = await R.requestRebuild("settings changed", { by: session.user.username });
      return ok(res, { settings: await S.getSettings(), rebuild });
    },
  })
);
