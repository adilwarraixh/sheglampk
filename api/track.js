/* POST /api/track — where is my order?

   Tracking used to read only the browser's own memory, so it worked on the
   phone the order was placed from and nowhere else, and it always said
   "Received" whatever the shop had done since. It now asks the database.

   It needs the reference AND the phone number on the order: a reference
   alone (it is printed on the parcel) reveals nothing. A wrong reference
   and a wrong phone get the same answer, every lookup counts towards a
   per-IP hourly limit, and the reply carries only what the customer
   already knows — no address, no internal notes, no other customer. */
const { sql } = require("../db/client.js");
const { ok, fail, readBody, takeSlot, methods, handler, clientIp } = require("../lib/http.js");

const PER_HOUR = 30;
const REF = /^SG-\d{4}-[A-Z0-9]{5}$/;
const lastTen = (p) => String(p || "").replace(/\D/g, "").slice(-10);

/* What a customer reads, for each status the shop can set. */
const SAYS = {
  PENDING: "Received — we will confirm it with you on WhatsApp shortly.",
  CONFIRMED: "Confirmed — we are getting it ready.",
  PROCESSING: "Being prepared.",
  PACKED: "Packed and waiting for the courier.",
  SHIPPED: "With the courier on its way to you.",
  DELIVERED: "Delivered.",
  CANCELLED: "Cancelled.",
  REFUNDED: "Refunded.",
};

module.exports = handler(async (req, res) =>
  methods(req, res, {
    POST: async () => {
      const body = await readBody(req, 4000);
      const ip = clientIp(req);
      const reference = String(body.reference || "").trim().toUpperCase();
      const phone = lastTen(body.phone);

      if (!(await takeSlot("__track__", ip, PER_HOUR))) return fail(res, 429, "Too many lookups for now. Please try again later, or message us on WhatsApp.");

      const notFound = () => fail(res, 404, "We could not find an order with that reference and phone number.");
      if (!REF.test(reference) || phone.length !== 10) return notFound();

      const [order] = await sql`
        SELECT id, reference, status, payment_method, placed_at, subtotal, shipping_fee, total,
               tracking_number, customer_phone, shipping_city
          FROM orders WHERE reference = ${reference} LIMIT 1`;
      if (!order || lastTen(order.customer_phone) !== phone) return notFound();

      const [items, history] = await Promise.all([
        sql`SELECT product_name, variant_name, quantity FROM order_items WHERE order_id = ${order.id} ORDER BY id`,
        sql`SELECT to_status, created_at FROM order_status_history
             WHERE order_id = ${order.id} AND (from_status IS DISTINCT FROM to_status)
             ORDER BY created_at, id`,
      ]);

      return ok(res, {
        order: {
          reference: order.reference,
          status: order.status,
          says: SAYS[order.status] || order.status,
          placedAt: order.placed_at,
          payment: order.payment_method,
          city: order.shipping_city,
          trackingNumber: order.tracking_number,
          subtotal: Number(order.subtotal), shippingFee: Number(order.shipping_fee), total: Number(order.total),
          items: items.map((i) => ({ name: i.product_name, shade: i.variant_name, qty: i.quantity })),
          history: history.map((h) => ({ status: h.to_status, at: h.created_at })),
        },
      });
    },
  })
);
