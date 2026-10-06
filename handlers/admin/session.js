/* GET /api/admin/session — who am I, and what may I do?
   The admin UI calls this on load to decide what to render. The answer
   is derived entirely from the stored session, never from the request. */
const auth = require("../../lib/auth.js");
const rbac = require("../../lib/rbac.js");
const { ok, fail, methods, handler } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await auth.getSession(auth.readCookie(req.headers.cookie));
      if (!session) return fail(res, 401, "Not signed in");

      return ok(res, {
        user: session.user,
        csrfToken: session.csrf,
        permissions: rbac.permissionsFor(session.user.role),
        nav: rbac.navFor(session.user.role),
        expiresAt: session.expiresAt,
      });
    },
  })
);
