/* =========================================================
   lib/orders.js — order reads and writes

   All values go through the tagged-template driver, so they are sent as
   bound parameters. No SQL is ever built by string concatenation.
   ========================================================= */
const crypto = require("crypto");
const { sql } = require("../db/client.js");

const STATUSES = ["PENDING","CONFIRMED","PROCESSING","PACKED","SHIPPED","DELIVERED","CANCELLED","REFUNDED"];
const PAYMENT_STATUSES = ["UNPAID","PAID","REFUNDED","FAILED"];

/* Human-friendly, unambiguous reference: no O/0 or I/1 confusion. */
function makeReference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  let tail = "";
  for (let i = 0; i < 5; i++) tail += alphabet[crypto.randomInt(alphabet.length)];
  return `SG-${stamp}-${tail}`;
}

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

/* ---------- create (called by the public checkout) ---------- */
async function createOrder(input) {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw new Error("An order needs at least one item");
  if (!input.customerName || !input.customerPhone || !input.shippingAddress) {
    throw new Error("Name, phone and address are required");
  }

  /* Prices are recomputed here from the database. A tampered client
     cannot set its own price — the browser only chooses what and how many. */
  const priced = [];
  for (const raw of items) {
    const qty = Math.max(1, Math.min(99, parseInt(raw.quantity, 10) || 1));
    let row = null;

    if (raw.variantId) {
      const r = await sql`
        SELECT v.id AS variant_id, v.variant_name, v.sku, v.price AS variant_price,
               p.id AS product_id, p.name, p.price AS product_price
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.id = ${raw.variantId} AND p.is_published = true LIMIT 1`;
      row = r[0];
    } else if (raw.productId) {
      const r = await sql`
        SELECT NULL::bigint AS variant_id, NULL::text AS variant_name, p.sku,
               NULL::numeric AS variant_price, p.id AS product_id, p.name, p.price AS product_price
        FROM products p WHERE p.id = ${raw.productId} AND p.is_published = true LIMIT 1`;
      row = r[0];
    }
    if (!row) throw new Error(`Product not available: ${raw.variantId || raw.productId}`);

    const unit = money(row.variant_price ?? row.product_price);
    priced.push({
      productId: row.product_id, variantId: row.variant_id,
      name: row.name, variantName: row.variant_name, sku: row.sku,
      unit, qty, lineTotal: money(unit * qty),
    });
  }

  const subtotal = money(priced.reduce((s, i) => s + i.lineTotal, 0));
  const shippingFee = money(input.shippingFee ?? (subtotal >= 3500 ? 0 : 250));
  const discount = money(input.discount || 0);
  const total = money(subtotal + shippingFee - discount);

  /* Reuse a customer record when the phone matches, so order history
     accumulates against one person rather than fragmenting. */
  const phone = String(input.customerPhone).trim();
  const existing = await sql`SELECT id FROM customers WHERE phone = ${phone} LIMIT 1`;
  let customerId;
  if (existing.length) {
    customerId = existing[0].id;
    await sql`
      UPDATE customers SET name = ${input.customerName}, email = ${input.customerEmail || null},
             city = ${input.shippingCity || null}, address = ${input.shippingAddress}
      WHERE id = ${customerId}`;
  } else {
    const [c] = await sql`
      INSERT INTO customers (name, email, phone, city, address)
      VALUES (${input.customerName}, ${input.customerEmail || null}, ${phone},
              ${input.shippingCity || null}, ${input.shippingAddress})
      RETURNING id`;
    customerId = c.id;
  }

  /* Retry on the astronomically unlikely reference collision. */
  let order = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const reference = makeReference();
    try {
      const [row] = await sql`
        INSERT INTO orders (reference, customer_id, customer_name, customer_email, customer_phone,
                            shipping_city, shipping_address, payment_method, payment_status, status,
                            subtotal, shipping_fee, discount, total, customer_note)
        VALUES (${reference}, ${customerId}, ${input.customerName}, ${input.customerEmail || null}, ${phone},
                ${input.shippingCity || null}, ${input.shippingAddress},
                ${input.paymentMethod || "Cash on Delivery"}, 'UNPAID'::payment_status, 'PENDING'::order_status,
                ${subtotal}, ${shippingFee}, ${discount}, ${total}, ${input.customerNote || null})
        RETURNING id, reference, placed_at`;
      order = row;
    } catch (e) {
      if (!/duplicate key/i.test(e.message)) throw e;
    }
  }
  if (!order) throw new Error("Could not allocate an order reference");

  for (const i of priced) {
    await sql`
      INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_name, sku, unit_price, quantity, line_total)
      VALUES (${order.id}, ${i.productId}, ${i.variantId}, ${i.name}, ${i.variantName}, ${i.sku}, ${i.unit}, ${i.qty}, ${i.lineTotal})`;

    // Decrement stock at the level the customer actually bought
    if (i.variantId) {
      await sql`UPDATE product_variants SET stock_quantity = GREATEST(0, stock_quantity - ${i.qty}) WHERE id = ${i.variantId}`;
    } else {
      await sql`UPDATE products SET stock_quantity = GREATEST(0, stock_quantity - ${i.qty}) WHERE id = ${i.productId}`;
    }
  }

  await sql`
    INSERT INTO order_status_history (order_id, from_status, to_status, note, changed_by)
    VALUES (${order.id}, NULL, 'PENDING'::order_status, 'Order placed by customer', 'system')`;

  return { id: order.id, reference: order.reference, placedAt: order.placed_at, subtotal, shippingFee, discount, total };
}

/* ---------- read ---------- */
async function listOrders({ status, search, limit = 50, offset = 0 } = {}) {
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const off = Math.max(0, parseInt(offset, 10) || 0);
  const term = search ? `%${String(search).trim().toLowerCase()}%` : null;
  const st = status && STATUSES.includes(status) ? status : null;

  /* Both filters are optional; the SQL handles null by ignoring that clause,
     which keeps this a single parameterised statement. */
  const rows = await sql`
    SELECT o.id, o.reference, o.customer_name, o.customer_phone, o.shipping_city,
           o.status, o.payment_status, o.total, o.placed_at, o.tracking_number,
           (SELECT COALESCE(SUM(quantity),0) FROM order_items i WHERE i.order_id = o.id) AS item_count
    FROM orders o
    WHERE (${st}::text IS NULL OR o.status = ${st}::order_status)
      AND (${term}::text IS NULL OR
           lower(o.reference) LIKE ${term} OR
           lower(o.customer_name) LIKE ${term} OR
           lower(o.customer_phone) LIKE ${term} OR
           lower(COALESCE(o.shipping_city,'')) LIKE ${term})
    ORDER BY o.placed_at DESC
    LIMIT ${lim} OFFSET ${off}`;

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM orders o
    WHERE (${st}::text IS NULL OR o.status = ${st}::order_status)
      AND (${term}::text IS NULL OR
           lower(o.reference) LIKE ${term} OR
           lower(o.customer_name) LIKE ${term} OR
           lower(o.customer_phone) LIKE ${term} OR
           lower(COALESCE(o.shipping_city,'')) LIKE ${term})`;

  return { orders: rows, total: n, limit: lim, offset: off };
}

async function getOrder(id) {
  const [order] = await sql`SELECT * FROM orders WHERE id = ${id} LIMIT 1`;
  if (!order) return null;
  const items = await sql`SELECT * FROM order_items WHERE order_id = ${id} ORDER BY id`;
  const history = await sql`
    SELECT from_status, to_status, note, changed_by, created_at
    FROM order_status_history WHERE order_id = ${id} ORDER BY created_at, id`;
  return { ...order, items, history };
}

/* ---------- write ---------- */
async function updateOrder(id, changes, actorUsername) {
  const [current] = await sql`SELECT id, status FROM orders WHERE id = ${id} LIMIT 1`;
  if (!current) throw new Error("Order not found");

  const applied = {};

  if (changes.status !== undefined) {
    if (!STATUSES.includes(changes.status)) throw new Error(`Status must be one of ${STATUSES.join(", ")}`);
    if (changes.status !== current.status) {
      await sql`UPDATE orders SET status = ${changes.status}::order_status WHERE id = ${id}`;
      await sql`
        INSERT INTO order_status_history (order_id, from_status, to_status, note, changed_by)
        VALUES (${id}, ${current.status}::order_status, ${changes.status}::order_status,
                ${changes.note || null}, ${actorUsername})`;
      applied.status = changes.status;
    }
  }

  if (changes.paymentStatus !== undefined) {
    if (!PAYMENT_STATUSES.includes(changes.paymentStatus)) {
      throw new Error(`Payment status must be one of ${PAYMENT_STATUSES.join(", ")}`);
    }
    await sql`UPDATE orders SET payment_status = ${changes.paymentStatus}::payment_status WHERE id = ${id}`;
    applied.paymentStatus = changes.paymentStatus;
  }

  if (changes.trackingNumber !== undefined) {
    const t = String(changes.trackingNumber).trim().slice(0, 120);
    await sql`UPDATE orders SET tracking_number = ${t || null} WHERE id = ${id}`;
    applied.trackingNumber = t;
  }

  if (changes.internalNote !== undefined) {
    const n = String(changes.internalNote).slice(0, 4000);
    await sql`UPDATE orders SET internal_note = ${n || null} WHERE id = ${id}`;
    applied.internalNote = true;      // content itself is not echoed into the audit log
  }

  return applied;
}

/* ---------- dashboard ---------- */
async function dashboardStats() {
  const [totals] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE placed_at::date = CURRENT_DATE)::int AS orders_today,
      COALESCE(SUM(total) FILTER (WHERE placed_at::date = CURRENT_DATE AND status <> 'CANCELLED'), 0) AS sales_today,
      COUNT(*)::int AS orders_total,
      COALESCE(SUM(total) FILTER (WHERE status <> 'CANCELLED'), 0) AS sales_total,
      COUNT(*) FILTER (WHERE status = 'PENDING')::int    AS pending,
      COUNT(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
      COUNT(*) FILTER (WHERE status = 'SHIPPED')::int    AS shipped,
      COUNT(*) FILTER (WHERE status = 'DELIVERED')::int  AS delivered,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')::int  AS cancelled
    FROM orders`;

  const [products] = await sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE stock_quantity = 0)::int AS out_of_stock,
           COUNT(*) FILTER (WHERE stock_quantity > 0 AND stock_quantity <= low_stock_threshold)::int AS low_stock
    FROM products WHERE is_published = true`;

  const recent = await sql`
    SELECT id, reference, customer_name, total, status, placed_at
    FROM orders ORDER BY placed_at DESC LIMIT 8`;

  const bestSellers = await sql`
    SELECT i.product_name, SUM(i.quantity)::int AS units, SUM(i.line_total) AS revenue
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.status <> 'CANCELLED'
    GROUP BY i.product_name ORDER BY units DESC LIMIT 5`;

  const salesSeries = await sql`
    SELECT d::date AS day,
           COALESCE((SELECT SUM(total) FROM orders o
                     WHERE o.placed_at::date = d::date AND o.status <> 'CANCELLED'), 0) AS revenue
    FROM generate_series(CURRENT_DATE - interval '13 days', CURRENT_DATE, interval '1 day') d
    ORDER BY day`;

  return { totals, products, recent, bestSellers, salesSeries };
}

module.exports = {
  STATUSES, PAYMENT_STATUSES, makeReference,
  createOrder, listOrders, getOrder, updateOrder, dashboardStats,
};
