/* POST /api/orders — public checkout endpoint

   This is the only write the storefront can make. It is deliberately
   narrow: the browser sends WHAT was ordered, never how much it costs.
   Prices, totals and shipping are recomputed server-side in lib/orders.js
   from the database, so a tampered request cannot buy at its own price.
   ========================================================= */
const orders = require("../lib/orders.js");
const auth = require("../lib/auth.js");
const { sql } = require("../db/client.js");
const { ok, fail, readBody, methods, handler, clientIp } = require("../lib/http.js");

/* Light abuse control: a handful of orders per phone number per hour is
   generous for a real shopper and stops a loop filling the table. */
async function tooManyRecent(phone, ip) {
  const [byPhone] = await sql`
    SELECT count(*)::int AS n FROM orders
    WHERE customer_phone = ${phone} AND placed_at > now() - interval '1 hour'`;
  if (byPhone.n >= 6) return true;

  if (ip) {
    const [byIp] = await sql`
      SELECT count(*)::int AS n FROM login_attempts
      WHERE ip = ${ip} AND username = '__order__' AND created_at > now() - interval '1 hour'`;
    if (byIp.n >= 20) return true;
  }
  return false;
}

/* Cash on delivery is the only method the store accepts. Anything else a
   client sends is replaced with this, so an edited request cannot record
   an order as prepaid. Add a method here and to the checkout markup in
   build.js together — this list is what the server actually honours. */
const PAYMENT_METHODS = ["Cash on Delivery"];

module.exports = handler(async (req, res) =>
  methods(req, res, {
    POST: async () => {
      const body = await readBody(req);
      const ip = clientIp(req);

      const name = String(body.customerName || "").trim();
      const phone = String(body.customerPhone || "").trim();
      const address = String(body.shippingAddress || "").trim();
      const city = String(body.shippingCity || "").trim();
      const email = String(body.customerEmail || "").trim();

      const problems = [];
      if (name.length < 3) problems.push("Please enter your full name.");
      if (!/^(\+92|0)?3\d{2}[\s-]?\d{7}$/.test(phone.replace(/\s/g, "")))
        problems.push("Enter a valid Pakistani mobile number.");
      if (city.length < 2) problems.push("Please enter your city.");
      if (address.length < 12) problems.push("Please give a complete delivery address.");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("That email does not look right.");
      if (!Array.isArray(body.items) || !body.items.length) problems.push("Your cart is empty.");
      if (problems.length) return fail(res, 400, problems[0], { problems });

      const method = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : PAYMENT_METHODS[0];

      if (await tooManyRecent(phone, ip)) {
        return fail(res, 429, "That is a lot of orders in a short time. Please contact us on WhatsApp.");
      }

      let order;
      try {
        order = await orders.createOrder({
          customerName: name, customerPhone: phone, customerEmail: email || null,
          shippingCity: city, shippingAddress: address,
          paymentMethod: method,
          customerNote: String(body.customerNote || "").slice(0, 1000) || null,
          items: body.items,
        });
      } catch (e) {
        // Genuine input problems get a clear message; anything else is a 500
        // handled by the wrapper, so internals are never exposed.
        return fail(res, 400, e.message);
      }

      await sql`INSERT INTO login_attempts (username, ip, success) VALUES ('__order__', ${ip}, true)`;
      await auth.audit({
        actorUsername: "customer", action: "ORDER_PLACED",
        targetType: "order", targetId: order.id,
        detail: { reference: order.reference, total: order.total, items: body.items.length }, ip,
      });

      // Only what the customer needs to see. No internal ids or costs.
      return ok(res, {
        reference: order.reference,
        total: order.total,
        subtotal: order.subtotal,
        shippingFee: order.shippingFee,
        placedAt: order.placedAt,
      });
    },
  })
);
