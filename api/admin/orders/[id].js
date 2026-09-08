/* GET   /api/admin/orders/:id — full order detail
   PATCH /api/admin/orders/:id — status, tracking, payment, internal note

   Both roles may update an order's operational fields; only a Super Admin
   may delete one. Every change is written to the audit log and, for status,
   to the order's own timeline. */
const orders = require("../../../lib/orders.js");
const auth = require("../../../lib/auth.js");
const rbac = require("../../../lib/rbac.js");
const { ok, fail, readBody, methods, guard, handler, clientIp } = require("../../../lib/http.js");

function orderId(req) {
  if (req.query && req.query.id) return req.query.id;          // Vercel dynamic route
  const m = String(req.url || "").match(/\/orders\/([^/?]+)/);  // local dev fallback
  return m ? decodeURIComponent(m[1]) : null;
}

module.exports = handler(async (req, res) => {
  const id = orderId(req);
  if (!id || !/^\d+$/.test(String(id))) return fail(res, 400, "Invalid order id");

  return methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "orders:view");
      if (!session) return;

      const order = await orders.getOrder(id);
      if (!order) return fail(res, 404, "Order not found");
      return ok(res, { order, statuses: orders.STATUSES, paymentStatuses: orders.PAYMENT_STATUSES });
    },

    PATCH: async () => {
      const session = await guard(req, res, "orders:update");
      if (!session) return;

      const body = await readBody(req);
      const changes = {};
      if (body.status !== undefined) changes.status = body.status;
      if (body.paymentStatus !== undefined) changes.paymentStatus = body.paymentStatus;
      if (body.trackingNumber !== undefined) changes.trackingNumber = body.trackingNumber;
      if (body.internalNote !== undefined) changes.internalNote = body.internalNote;
      if (body.note !== undefined) changes.note = body.note;

      if (!Object.keys(changes).length) return fail(res, 400, "Nothing to update");

      let applied;
      try {
        applied = await orders.updateOrder(id, changes, session.user.username);
      } catch (e) {
        return fail(res, 400, e.message);
      }

      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "ORDER_UPDATED", targetType: "order", targetId: id,
        detail: applied, ip: clientIp(req),
      });

      const order = await orders.getOrder(id);
      return ok(res, { order, applied });
    },

    DELETE: async () => {
      // Deliberately Super Admin only — deleting an order destroys the
      // financial record, so ashba can cancel but never erase.
      const session = await guard(req, res, "orders:delete");
      if (!session) return;

      const order = await orders.getOrder(id);
      if (!order) return fail(res, 404, "Order not found");

      const { sql } = require("../../../db/client.js");
      await sql`DELETE FROM orders WHERE id = ${id}`;
      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "ORDER_DELETED", targetType: "order", targetId: id,
        detail: { reference: order.reference, total: order.total }, ip: clientIp(req),
      });
      return ok(res);
    },
  });
});
