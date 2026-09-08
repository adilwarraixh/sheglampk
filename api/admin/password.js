/* =========================================================
   api/admin/password.js — change your own password

   The only write an account with a temporary password may perform.
   Always requires the current password, so a stolen session cookie
   alone cannot lock the real owner out.
   ========================================================= */
const { sql } = require("../../db/client.js");
const auth = require("../../lib/auth.js");
const { ok, fail, guard, handler, methods, readBody, clientIp, IS_PROD } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    POST: async () => {
      // allowPasswordChange: reachable while the account is locked to this step
      const session = await guard(req, res, null, { allowPasswordChange: true });
      if (!session) return;

      const body = await readBody(req);
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      const user = session.user;

      const row = (await sql`
        SELECT password_hash, password_salt FROM users WHERE id = ${user.id} LIMIT 1`)[0];
      if (!row) return fail(res, 401, "Not signed in");

      if (!auth.verifyPassword(currentPassword, row.password_salt, row.password_hash)) {
        await auth.audit({
          actorId: user.id, actorUsername: user.username,
          action: "PASSWORD_CHANGE", result: "DENIED", ip: clientIp(req),
          detail: { reason: "current password incorrect" },
        });
        return fail(res, 400, "Your current password is not correct.");
      }

      const problems = auth.checkStrength(newPassword);
      if (problems.length) {
        return fail(res, 400, `New password ${problems.join("; ")}.`);
      }
      if (newPassword === currentPassword) {
        return fail(res, 400, "The new password must be different from the current one.");
      }

      const { salt, hash } = auth.hashPassword(newPassword);
      await sql`
        UPDATE users
           SET password_hash = ${hash}, password_salt = ${salt},
               must_change_password = false, password_changed_at = now()
         WHERE id = ${user.id}`;

      /* Anyone else holding a session for this account — including whoever
         issued the temporary password — is signed out. The current browser
         gets a fresh session so the user is not bounced to the login page. */
      await auth.revokeAllSessions(user.id);
      const fresh = await auth.createSession(user.id, {
        ip: clientIp(req), userAgent: req.headers["user-agent"],
      });
      res.setHeader("Set-Cookie", auth.sessionCookie(fresh.token, { secure: IS_PROD }));

      await auth.audit({
        actorId: user.id, actorUsername: user.username,
        action: "PASSWORD_CHANGE", result: "SUCCESS", ip: clientIp(req),
        targetType: "user", targetId: String(user.id),
      });

      // The password itself is never echoed back, only the new CSRF token.
      return ok(res, { csrfToken: fresh.csrf });
    },
  })
);
