/* POST /api/admin/logout — revoke the session server-side */
const auth = require("../../lib/auth.js");
const { ok, methods, handler, clientIp, IS_PROD } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    POST: async () => {
      const token = auth.readCookie(req.headers.cookie);
      const session = token ? await auth.getSession(token) : null;

      if (token) await auth.revokeSession(token);
      if (session) {
        await auth.audit({
          actorId: session.user.id, actorUsername: session.user.username,
          action: "LOGOUT", ip: clientIp(req),
        });
      }

      // Clearing the cookie alone is not enough — the row is revoked above,
      // so a copied cookie value is dead too.
      res.setHeader("Set-Cookie", auth.clearCookie({ secure: IS_PROD }));
      return ok(res);
    },
  })
);
