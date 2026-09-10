/* /api/admin/settings — store settings (settings:manage, Super Admin only).
   Keys are whitelisted in lib/site-admin.js: a request cannot introduce a
   new setting key, only change one the application already understands. */
const S = require("../../lib/site-admin.js");
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
      const changes = [];
      try {
        for (const key of Object.keys(body.settings || {}))
          changes.push(await S.saveSetting(key, body.settings[key], session.user.username));
      } catch (e) { return fail(res, 400, e.message); }
      if (!changes.length) return fail(res, 400, "Nothing to save");

      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "SETTINGS_UPDATED", targetType: "settings",
        detail: { keys: changes.map((c) => c.key) }, ip: clientIp(req),
      });
      return ok(res, { settings: await S.getSettings() });
    },
  })
);
