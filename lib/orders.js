/* =========================================================
   lib/orders.js — order reads and writes

   All values go through the tagged-template driver, so they are sent as
   bound parameters. No SQL is ever built by string concatenation.
   ========================================================= */
const crypto = require("crypto");
const { sql } = require("../db/client.js");
const { requestRebuild } = require("./rebuild.js");
const { priceOf } = require("./pricing.js");
const { shopSettings, shippingFor } = require("./site-admin.js");

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
const GONE = "One of the items is no longer available. Please refresh and try again.";
const label = (i) => `${i.name}${i.variantName ? " — " + i.variantName : ""}`;

/* The order an idempotency key already produced, in the shape createOrder returns. */
async function priorOrder(key) {
  const [p] = await sql`
    SELECT id, reference, placed_at, subtotal, shipping_fee, discount, total
      FROM orders WHERE idempotency_key = ${key} LIMIT 1`;
  return p ? { id: p.id, reference: p.reference, placedAt: p.placed_at,
               subtotal: Number(p.subtotal), shippingFee: Number(p.shipping_fee),
               discount: Number(p.discount), total: Number(p.total), duplicate: true } : null;
}

/* Another order took the stock between our read and our write. Say which
   item, with what is left now. */
async function soldOutError(priced) {
  const vIds = priced.filter((i) => i.variantId).map((i) => i.variantId);
  const pIds = priced.filter((i) => !i.variantId).map((i) => i.productId);
  const [v, p] = await Promise.all([
    vIds.length ? sql`SELECT id::text AS id, stock_quantity FROM product_variants WHERE id = ANY(${vIds}::bigint[])` : [],
    pIds.length ? sql`SELECT id::text AS id, stock_quantity FROM products WHERE id = ANY(${pIds}::bigint[])` : [],
  ]);
  const left = new Map([...v.map((r) => ["v" + r.id, r.stock_quantity]), ...p.map((r) => ["p" + r.id, r.stock_quantity])]);
  for (const i of priced) {
    const n = left.get(i.variantId ? "v" + i.variantId : "p" + i.productId) || 0;
    if (n < i.qty) return new Error(n > 0 ? `Only ${n} left of ${label(i)}.` : `${label(i)} has just sold out.`);
  }
  return new Error("Part of your order has just sold out. Please refresh and try again.");
}

/* ---------- create (called by the public checkout) ---------- */
async function createOrder(input) {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw new Error("An order needs at least one item");
  if (!input.customerName || !input.customerPhone || !input.shippingAddress) {
    throw new Error("Name, phone and address are required");
  }

  /* An idempotency key lets a retried request return the order it already
     created instead of making a second one. A double-clicked Place Order,
     a browser refresh mid-request or a flaky mobile connection all land
     here. The unique index is what actually enforces it; this is the fast
     path that avoids even trying. */
  const idempotencyKey = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()
    ? input.idempotencyKey.trim().slice(0, 100) : null;
  if (idempotencyKey) {
    const prior = await priorOrder(idempotencyKey);
    if (prior) return prior;
  }

  /* One line per thing bought. A cart can hold the same shade twice (two
     tabs, an old saved cart); checked line by line, each copy passed the
     stock check on its own and together they oversold. */
  const wanted = [], byKey = new Map();
  for (const raw of items) {
    const variantId = raw.variantId != null && raw.variantId !== "" ? String(raw.variantId) : null;
    const productId = !variantId && raw.productId != null && raw.productId !== "" ? String(raw.productId) : null;
    if (!/^\d{1,18}$/.test(variantId || productId || "")) throw new Error(GONE);
    const key = variantId ? "v" + variantId : "p" + productId;
    const qty = Math.max(1, Math.min(99, parseInt(raw.quantity, 10) || 1));
    const line = byKey.get(key);
    if (line) line.qty = Math.min(99, line.qty + qty);
    else { const l = { key, variantId, productId, qty }; byKey.set(key, l); wanted.push(l); }
  }

  /* Everything the order depends on, read at once: the products, their
     shades and the shop's settings. */
  const vIds = wanted.filter((w) => w.variantId).map((w) => w.variantId);
  const pIds = wanted.filter((w) => w.productId).map((w) => w.productId);
  const [vRows, pRows, settings] = await Promise.all([
    vIds.length ? sql`
      SELECT v.id::text AS variant_id, v.variant_name, v.sku, v.stock_quantity AS variant_stock, v.is_available,
             p.id::text AS product_id, p.name, p.slug, p.price, p.sale_price, p.sale_starts_at, p.sale_ends_at,
             (SELECT url FROM product_images i WHERE i.product_id = p.id
               ORDER BY (i.variant_id = v.id) IS TRUE DESC, i.is_primary DESC, i.position LIMIT 1) AS image_url
        FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.id = ANY(${vIds}::bigint[]) AND p.is_published` : [],
    pIds.length ? sql`
      SELECT p.id::text AS product_id, p.name, p.slug, p.sku, p.price, p.sale_price, p.sale_starts_at, p.sale_ends_at,
             p.stock_quantity AS product_stock,
             (SELECT count(*)::int FROM product_variants v
               WHERE v.product_id = p.id AND v.is_available) AS shade_count,
             (SELECT url FROM product_images i WHERE i.product_id = p.id
               ORDER BY i.is_primary DESC, i.position LIMIT 1) AS image_url
        FROM products p WHERE p.id = ANY(${pIds}::bigint[]) AND p.is_published` : [],
    shopSettings(),
  ]);

  // The "Accept new orders" switch in Settings.
  if (!settings.ordersEnabled)
    throw new Error("We are not taking orders on the website right now. Please message us on WhatsApp and we will help you directly.");

  /* Prices are recomputed here from the database, by priceOf() — the same
     function the shop's pages are built with, so the customer pays what
     they were shown. A tampered client cannot set its own price — the
     browser only chooses what and how many. */
  const vById = new Map(vRows.map((r) => [r.variant_id, r]));
  const pById = new Map(pRows.map((r) => [r.product_id, r]));
  const priced = wanted.map((w) => {
    const row = w.variantId ? vById.get(w.variantId) : pById.get(w.productId);
    if (!row) throw new Error(GONE);
    /* A product sold in shades cannot be bought without one — the order
       would not say which shade to pack. A cart saved before the product
       had shades, or a shade renamed since, sends exactly that. */
    if (!w.variantId && row.shade_count > 0)
      throw new Error(`Please choose a shade for ${row.name} and add it to your cart again.`);
    const { final } = priceOf(row);
    if (final === null) throw new Error(`${row.name} is not on sale right now.`);
    if (w.variantId && row.is_available === false)
      throw new Error(`${row.name} — ${row.variant_name} is not available right now.`);

    const line = {
      productId: row.product_id, variantId: w.variantId,
      name: row.name, variantName: w.variantId ? row.variant_name : null, sku: row.sku,
      slug: row.slug, imageUrl: row.image_url,
      unit: money(final), qty: w.qty, lineTotal: money(money(final) * w.qty),
    };
    // A friendly answer now; the database enforces it at the write below.
    const available = w.variantId ? row.variant_stock : row.product_stock;
    if (available < w.qty)
      throw new Error(available > 0 ? `Only ${available} left of ${label(line)}.` : `${label(line)} has just sold out.`);
    return line;
  });

  /* Every figure below is derived here, from the database prices above and
     the delivery charges in Settings. Nothing the browser sent about money
     is used, and discount is only whatever the server itself applies. */
  const subtotal = money(priced.reduce((s, i) => s + i.lineTotal, 0));
  const shippingFee = money(shippingFor(subtotal, settings));
  const discount = money(0);
  const tax = money(0);                       // no sales tax applied at present
  const total = money(subtotal + shippingFee + tax - discount);

  /* What was bought, at the price charged — returned so the confirmation
     and its WhatsApp message show the server's figures, not the page's. */
  const lines = priced.map((i) => ({ sku: i.sku, name: i.name, shade: i.variantName, qty: i.qty, price: i.unit }));

  /* Shop pages are static HTML built before the order, so one can still
     show a price (or a delivery charge) that has since changed. The
     checkout sends the total the customer was shown; if this order would
     cost anything else, nothing is written and the customer is shown the
     real total to confirm. A request without the figure (a page built
     before this check) is priced as is. */
  if (input.expectedTotal !== undefined && input.expectedTotal !== null) {
    const shown = Number(input.expectedTotal);
    if (!Number.isFinite(shown) || money(shown) !== total) {
      const e = new Error("The prices in your cart have changed since this page was loaded.");
      e.code = "PRICE_CHANGED";
      e.quote = { subtotal, shippingFee, total, items: lines };
      throw e;
    }
  }

  const phone = String(input.customerPhone).trim();
  const name = input.customerName, email = input.customerEmail || null;
  const city = input.shippingCity || null, address = input.shippingAddress;
  /* product_slug and image_url are snapshots too: an order must still show
     what was bought after the product is renamed, archived or deleted. */
  const itemRows = JSON.stringify(priced.map((i) => ({
    product_id: Number(i.productId), variant_id: i.variantId ? Number(i.variantId) : null,
    product_name: i.name, variant_name: i.variantName, sku: i.sku,
    unit_price: i.unit, quantity: i.qty, line_total: i.lineTotal,
    product_slug: i.slug || null, image_url: i.imageUrl || null,
  })));
  const shadeTake = JSON.stringify(priced.filter((i) => i.variantId).map((i) => ({ id: Number(i.variantId), qty: i.qty })));
  const productTake = JSON.stringify(priced.filter((i) => !i.variantId).map((i) => ({ id: Number(i.productId), qty: i.qty })));
  const shadedProducts = [...new Set(priced.filter((i) => i.variantId).map((i) => i.productId))];
  const allProducts = [...new Set(priced.map((i) => i.productId))];

  /* Everything the order writes, in one transaction: the customer, the
     order, its lines, the stock it takes and its first history entry.
     Either all of it lands or none of it does. Stock is taken by
     subtracting, and the database refuses a result below zero
     (migration 007): when two customers race for the last unit, the
     second order rolls back entirely instead of overselling. */
  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = makeReference();
    let res;
    try {
      res = await sql.transaction([
        /* Lock the products first, in id order — the same order a product
           save takes (product, then shades). Two checkouts for one product
           queue here instead of deadlocking each other or a save, and every
           statement after this sees the earlier order's committed stock, so
           the product total below is never computed from a stale snapshot. */
        sql`SELECT id FROM products WHERE id = ANY(${allProducts}::bigint[]) ORDER BY id FOR UPDATE`,
        /* Reuse a customer record when the phone matches, so order history
           accumulates against one person rather than fragmenting. */
        sql`UPDATE customers SET name = ${name}, email = ${email}, city = ${city}, address = ${address}
             WHERE id = (SELECT id FROM customers WHERE phone = ${phone} ORDER BY id LIMIT 1)`,
        sql`INSERT INTO customers (name, email, phone, city, address)
            SELECT ${name}, ${email}, ${phone}, ${city}, ${address}
             WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = ${phone})`,
        sql`INSERT INTO orders (reference, customer_id, customer_name, customer_email, customer_phone,
                                shipping_city, shipping_address, shipping_state, shipping_postal_code,
                                shipping_country, payment_method, payment_status, status,
                                subtotal, shipping_fee, discount, tax_amount, total, customer_note,
                                idempotency_key)
            VALUES (${reference}, (SELECT id FROM customers WHERE phone = ${phone} ORDER BY id LIMIT 1),
                    ${name}, ${email}, ${phone}, ${city}, ${address},
                    ${input.shippingState || null}, ${input.shippingPostalCode || null},
                    ${input.shippingCountry || "Pakistan"},
                    ${input.paymentMethod || "Cash on Delivery"}, 'UNPAID'::payment_status, 'PENDING'::order_status,
                    ${subtotal}, ${shippingFee}, ${discount}, ${tax}, ${total}, ${input.customerNote || null},
                    ${idempotencyKey})
            RETURNING id, reference, placed_at`,
        sql`INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_name, sku,
                                     unit_price, quantity, line_total, product_slug, image_url)
            SELECT o.id, x.product_id, x.variant_id, x.product_name, x.variant_name, x.sku,
                   x.unit_price, x.quantity, x.line_total, x.product_slug, x.image_url
              FROM orders o,
                   jsonb_to_recordset(${itemRows}::jsonb) AS x(product_id bigint, variant_id bigint,
                     product_name text, variant_name text, sku text, unit_price numeric,
                     quantity int, line_total numeric, product_slug text, image_url text)
             WHERE o.reference = ${reference}`,
        sql`UPDATE product_variants v SET stock_quantity = v.stock_quantity - d.qty
              FROM jsonb_to_recordset(${shadeTake}::jsonb) AS d(id bigint, qty int)
             WHERE v.id = d.id
         RETURNING v.id::text AS id, v.stock_quantity`,
        sql`UPDATE products p SET stock_quantity = p.stock_quantity - d.qty
              FROM jsonb_to_recordset(${productTake}::jsonb) AS d(id bigint, qty int)
             WHERE p.id = d.id
         RETURNING p.id::text AS id, p.stock_quantity`,
        // A product sold in shades shows their total (lib/stock.js).
        sql`UPDATE products p SET stock_quantity = s.total
              FROM (SELECT product_id, sum(stock_quantity)::int AS total FROM product_variants
                     WHERE product_id = ANY(${shadedProducts}::bigint[]) AND is_available
                     GROUP BY product_id) s
             WHERE p.id = s.product_id AND p.stock_quantity <> s.total`,
        sql`INSERT INTO order_status_history (order_id, from_status, to_status, note, changed_by)
            SELECT id, NULL, 'PENDING'::order_status, 'Order placed by customer', 'system'
              FROM orders WHERE reference = ${reference}`,
      ]);
    } catch (e) {
      const m = String((e && e.message) || "");
      /* A collision on the idempotency key means a concurrent request beat
         us to it — return that order rather than failing the customer. */
      if (/orders_idempotency_key_idx/.test(m) && idempotencyKey) {
        const prior = await priorOrder(idempotencyKey);
        if (prior) return prior;
      }
      if (/orders_reference_key/.test(m)) continue;          // astronomically rare: try another reference
      // Nothing was written; another transaction won a lock race. Try again.
      if (e.code === "40P01" || e.code === "40001" || /deadlock detected|could not serialize/i.test(m)) continue;
      if (/stock_nonneg/.test(m)) throw await soldOutError(priced);
      if (/foreign key/i.test(m)) throw new Error(GONE);     // a product deleted mid-checkout
      throw e;
    }

    // Statement order above: 0 lock, 1–2 customer, 3 order, 4 lines, 5 shades, 6 products, 7 totals, 8 history.
    const order = res[3][0];
    /* Pages say "in stock" until they are rebuilt. When this order took the
       last one, rebuild so the next customer sees it sold out instead of
       finding out at checkout. requestRebuild never throws: the order is
       already placed and nothing here may fail it. */
    // Shade and product ids come from different tables and can coincide, hence the prefixes.
    const emptied = new Set([
      ...res[5].filter((r) => r.stock_quantity === 0).map((r) => "v" + r.id),
      ...res[6].filter((r) => r.stock_quantity === 0).map((r) => "p" + r.id),
    ]);
    const soldOut = priced.filter((i) => emptied.has(i.variantId ? "v" + i.variantId : "p" + i.productId)).map(label);
    if (soldOut.length) await requestRebuild(`sold out: ${soldOut.join(", ")}`, { by: "checkout" });

    return { id: order.id, reference: order.reference, placedAt: order.placed_at, subtotal, shippingFee, discount, total, items: lines };
  }
  throw new Error("We could not place your order just now. Please try again.");
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
           (SELECT COALESCE(SUM(quantity),0) FROM order_items i WHERE i.order_id = o.id) AS item_count,
           count(*) OVER () AS total_count
    FROM orders o
    WHERE (${st}::text IS NULL OR o.status = ${st}::order_status)
      AND (${term}::text IS NULL OR
           lower(o.reference) LIKE ${term} OR
           lower(o.customer_name) LIKE ${term} OR
           lower(o.customer_phone) LIKE ${term} OR
           lower(COALESCE(o.shipping_city,'')) LIKE ${term})
    ORDER BY o.placed_at DESC
    LIMIT ${lim} OFFSET ${off}`;

  /* Past the last page the window count has no row to ride on; ask once. */
  const total = rows.length ? Number(rows[0].total_count)
    : off === 0 ? 0
    : (await sql`
        SELECT count(*)::int AS n FROM orders o
         WHERE (${st}::text IS NULL OR o.status = ${st}::order_status)
           AND (${term}::text IS NULL OR lower(o.reference) LIKE ${term} OR lower(o.customer_name) LIKE ${term}
                OR lower(o.customer_phone) LIKE ${term} OR lower(COALESCE(o.shipping_city,'')) LIKE ${term})`)[0].n;

  return { orders: rows.map(({ total_count, ...r }) => r), total, limit: lim, offset: off };
}

async function getOrder(id) {
  const [[order], items, history] = await Promise.all([
    sql`SELECT * FROM orders WHERE id = ${id} LIMIT 1`,
    sql`SELECT * FROM order_items WHERE order_id = ${id} ORDER BY id`,
    sql`SELECT from_status, to_status, note, changed_by, created_at
          FROM order_status_history WHERE order_id = ${id} ORDER BY created_at, id`,
  ]);
  if (!order) return null;
  return { ...order, items, history };
}

/* ---------- write ---------- */
async function updateOrder(id, changes, actorUsername) {
  const [current] = await sql`SELECT id, status FROM orders WHERE id = ${id} LIMIT 1`;
  if (!current) throw new Error("Order not found");

  /* Validated first, then written together: a status change and its
     history entry can never be recorded one without the other. */
  const applied = {}, writes = [];

  if (changes.status !== undefined) {
    if (!STATUSES.includes(changes.status)) throw new Error(`Status must be one of ${STATUSES.join(", ")}`);
    if (changes.status !== current.status) {
      writes.push(sql`UPDATE orders SET status = ${changes.status}::order_status WHERE id = ${id}`);
      writes.push(sql`
        INSERT INTO order_status_history (order_id, from_status, to_status, note, changed_by)
        VALUES (${id}, ${current.status}::order_status, ${changes.status}::order_status,
                ${changes.note || null}, ${actorUsername})`);
      applied.status = changes.status;
      applied.previousStatus = current.status;
    }
  }

  if (changes.paymentStatus !== undefined) {
    if (!PAYMENT_STATUSES.includes(changes.paymentStatus)) {
      throw new Error(`Payment status must be one of ${PAYMENT_STATUSES.join(", ")}`);
    }
    writes.push(sql`UPDATE orders SET payment_status = ${changes.paymentStatus}::payment_status WHERE id = ${id}`);
    applied.paymentStatus = changes.paymentStatus;
  }

  if (changes.trackingNumber !== undefined) {
    const t = String(changes.trackingNumber).trim().slice(0, 120);
    writes.push(sql`UPDATE orders SET tracking_number = ${t || null} WHERE id = ${id}`);
    applied.trackingNumber = t;
  }

  if (changes.internalNote !== undefined) {
    const n = String(changes.internalNote).slice(0, 4000);
    writes.push(sql`UPDATE orders SET internal_note = ${n || null} WHERE id = ${id}`);
    applied.internalNote = true;      // content itself is not echoed into the audit log
  }

  if (writes.length) await sql.transaction(writes);
  return applied;
}

/* ---------- dashboard ---------- */
async function dashboardStats() {
  // Independent questions, asked at once rather than one after another.
  const [[totals], [products], recent, bestSellers, salesSeries] = await Promise.all([
    sql`
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
    FROM orders`,
    sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE stock_quantity = 0)::int AS out_of_stock,
           COUNT(*) FILTER (WHERE stock_quantity > 0 AND stock_quantity <= low_stock_threshold)::int AS low_stock
    FROM products WHERE is_published = true`,
    sql`
    SELECT id, reference, customer_name, total, status, placed_at
    FROM orders ORDER BY placed_at DESC LIMIT 8`,
    sql`
    SELECT i.product_name, SUM(i.quantity)::int AS units, SUM(i.line_total) AS revenue
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.status <> 'CANCELLED'
    GROUP BY i.product_name ORDER BY units DESC LIMIT 5`,
    sql`
    SELECT d::date AS day,
           COALESCE((SELECT SUM(total) FROM orders o
                     WHERE o.placed_at::date = d::date AND o.status <> 'CANCELLED'), 0) AS revenue
    FROM generate_series(CURRENT_DATE - interval '13 days', CURRENT_DATE, interval '1 day') d
    ORDER BY day`,
  ]);

  return { totals, products, recent, bestSellers, salesSeries };
}

module.exports = {
  STATUSES, PAYMENT_STATUSES, makeReference,
  createOrder, listOrders, getOrder, updateOrder, dashboardStats,
};
