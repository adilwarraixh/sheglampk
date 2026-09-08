/* POST /api/admin/login — authenticate and open a session */
const auth = require("../../lib/auth.js");
const { ok, fail, readBody, clientIp, methods, handler, IS_PROD } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    POST: async () => {
      const body = await readBody(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");

      if (!username || !password) return fail(res, 400, "Invalid username or password.");

      const result = await auth.login(username, password, {
        ip: clientIp(req),
        userAgent: req.headers["user-agent"],
      });

      // 401 for bad credentials, 429 once the throttle has tripped
      if (!result.ok) {
        const status = /too many/i.test(result.error) ? 429 : 401;
        return fail(res, status, result.error);
      }

      res.setHeader("Set-Cookie", auth.sessionCookie(result.session.token, { secure: IS_PROD }));

      // The CSRF token is returned so the client can echo it on writes.
      // The session token itself stays in the HttpOnly cookie, unreadable by JS.
      return ok(res, {
        user: result.user,
        csrfToken: result.session.csrf,
        mustChangePassword: result.user.mustChangePassword,
      });
    },
  })
);
