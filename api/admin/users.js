/* /api/admin/users — Super Admin manages the other admin account.
   users:view / users:manage are both SUPER_ADMIN-only in rbac.js, so a
   request from ashba never reaches the module behind this. */
const U = require("../../lib/users-admin.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../lib/http.js");
const auth = require("../../lib/auth.js");
const { AuthError } = require("../../lib/rbac.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "users:view");
      if (!session) return;
      const q = req.query || {};
      if (q.id) {
        const user = await U.getUser(Number(q.id));
        if (!user) return fail(res, 404, "Account not found");
        return ok(res, { user, me: session.user.id });
      }
      return ok(res, { users: await U.listUsers(), me: session.user.id });
    },

    PATCH: async () => {
      const session = await guard(req, res, "users:manage");
      if (!session) return;
      const body = await readBody(req);
      const targetId = Number(body.id);
      const actorId = session.user.id;

      try {
        let result, action, detail;
        if (body.status)            { result = await U.setStatus(actorId, targetId, body.status);
                                      action = "USER_STATUS_CHANGED"; detail = { status: result.status }; }
        else if (body.role)         { result = await U.setRole(actorId, targetId, body.role);
                                      action = "USER_ROLE_CHANGED"; detail = { role: result.role }; }
        else if (body.displayName)  { result = await U.setDisplayName(actorId, targetId, body.displayName);
                                      action = "USER_RENAMED"; detail = { displayName: result.display_name }; }
        else if (body.action === "reset-password") {
          result = await U.resetPassword(actorId, targetId);
          action = "USER_PASSWORD_RESET"; detail = { username: result.username };
          await auth.audit({ actorId, actorUsername: session.user.username, action,
            targetType: "user", targetId: String(targetId), detail, ip: clientIp(req) });
          // The one-time password is returned here and nowhere else — not
          // stored readable, not written into the audit detail.
          return ok(res, { username: result.username, password: result.password,
            note: "Give this to them directly. They must change it on first sign-in." });
        }
        else if (body.action === "revoke-sessions") {
          result = await U.revokeSessions(actorId, targetId);
          action = "USER_SESSIONS_REVOKED"; detail = { username: result.username };
        }
        else return fail(res, 400, "Nothing to change");

        await auth.audit({ actorId, actorUsername: session.user.username, action,
          targetType: "user", targetId: String(targetId), detail, ip: clientIp(req) });
        return ok(res, { user: result });
      } catch (e) {
        if (e instanceof AuthError) {
          await auth.audit({ actorId, actorUsername: session.user.username,
            action: "USER_CHANGE_REFUSED", result: "DENIED", targetType: "user",
            targetId: String(targetId), detail: { reason: e.message }, ip: clientIp(req) });
          return fail(res, e.status, e.message);
        }
        throw e;
      }
    },
  })
);
