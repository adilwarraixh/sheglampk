/* /api/admin/notifications — notification state for an order, resend,
   and the mail-provider status shown in the UI.

   Resending is an order action, so it needs orders:update — the same
   permission as changing a status. Provider secrets are never returned;
   only whether a provider is configured and which variable names are
   missing. */
const notify = require("../../lib/order-emails.js");
const mailer = require("../../lib/mailer.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../lib/http.js");
const auth = require("../../lib/auth.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "orders:view");
      if (!session) return;
      const q = req.query || {};
      const payload = { mail: mailer.status() };
      if (q.orderId) payload.notifications = await notify.forOrder(Number(q.orderId));
      return ok(res, payload);
    },

    POST: async () => {
      const session = await guard(req, res, "orders:update");
      if (!session) return;
      const body = await readBody(req);
      const orderId = Number(body.orderId || 0);
      const type = String(body.type || "admin_new_order");
      if (!orderId) return fail(res, 400, "Which order?");
      if (!["admin_new_order", "customer_confirmation"].includes(type))
        return fail(res, 400, "Unknown notification type");

      let result;
      try { result = await notify.resend(orderId, type); }
      catch (e) { return fail(res, 400, e.message); }

      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "NOTIFICATION_RESENT", targetType: "order", targetId: String(orderId),
        detail: { type, ok: !!result.ok, skipped: !!result.skipped }, ip: clientIp(req),
      });

      // The provider's own error is surfaced to the admin (it is useful
      // here) but was already stripped of anything key-shaped in mailer.js.
      return ok(res, {
        result,
        notifications: await notify.forOrder(orderId),
        mail: mailer.status(),
      });
    },
  })
);
