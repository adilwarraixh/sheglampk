/* =========================================================
   lib/admin-data.js — reads behind the remaining admin screens

   Inventory, customers, analytics and the audit log. Each function is
   reached only through guard() with its own permission, so the caller
   decides who may see what; nothing here re-checks, and nothing here
   should be called from a public route.

   Customer records are personal data. The shapes below return only what
   the screens actually display, and never assemble a full profile
   export.
   ========================================================= */
const { sql } = require("../db/client.js");

/* ---------- inventory ---------- */
async function inventory({ q, level, limit = 50, offset = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  offset = Math.max(parseInt(offset, 10) || 0, 0);
  const term = q && String(q).trim() ? `%${String(q).trim().toLowerCase()}%` : null;
  const low = level === "low", out = level === "out", ok = level === "ok";

  /* One row per sellable unit: a product with shades is counted per shade,
     because that is the thing that actually runs out. */
  const rows = await sql`
    SELECT p.id AS product_id, v.id AS variant_id,
           p.name, p.slug, p.status,
           coalesce(v.variant_name, '—') AS variant_name,
           coalesce(v.sku, p.sku) AS sku,
           coalesce(v.stock_quantity, p.stock_quantity) AS stock,
           p.low_stock_threshold AS threshold,
           c.name AS category_name,
           (SELECT url FROM product_images i
             WHERE i.product_id = p.id ORDER BY i.is_primary DESC, i.position LIMIT 1) AS image,
           count(*) OVER () AS total_count
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.status <> 'ARCHIVED'
       AND (${term}::text IS NULL OR lower(p.name) LIKE ${term}
                                  OR lower(coalesce(v.sku, p.sku, '')) LIKE ${term}
                                  OR lower(coalesce(v.variant_name,'')) LIKE ${term})
       AND (${out} = false OR coalesce(v.stock_quantity, p.stock_quantity) = 0)
       AND (${low} = false OR (coalesce(v.stock_quantity, p.stock_quantity) > 0
                           AND coalesce(v.stock_quantity, p.stock_quantity) <= p.low_stock_threshold))
       AND (${ok}  = false OR coalesce(v.stock_quantity, p.stock_quantity) > p.low_stock_threshold)
     ORDER BY coalesce(v.stock_quantity, p.stock_quantity) ASC, p.name, v.position
     LIMIT ${limit} OFFSET ${offset}`;

  const total = rows.length ? Number(rows[0].total_count) : 0;
  const [counts] = await sql`
    SELECT
      count(*) FILTER (WHERE coalesce(v.stock_quantity, p.stock_quantity) = 0)::int AS out_of_stock,
      count(*) FILTER (WHERE coalesce(v.stock_quantity, p.stock_quantity) > 0
                         AND coalesce(v.stock_quantity, p.stock_quantity) <= p.low_stock_threshold)::int AS low_stock,
      count(*)::int AS units
      FROM products p LEFT JOIN product_variants v ON v.product_id = p.id
     WHERE p.status <> 'ARCHIVED'`;

  return { rows: rows.map(({ total_count, ...r }) => r), total, limit, offset, counts };
}

/* Stock is set to an absolute figure, not adjusted by a delta: two admins
   counting the same shelf must not double-apply. */
async function setStock({ productId, variantId, quantity }) {
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 0, 0), 1000000);
  if (variantId) {
    const v = await sql`
      UPDATE product_variants SET stock_quantity = ${qty} WHERE id = ${variantId}
      RETURNING product_id, variant_name, stock_quantity`;
    if (!v.length) throw new Error("Variant not found");
    // Keep the product total consistent with its shades.
    await sql`
      UPDATE products p SET stock_quantity = COALESCE(
          (SELECT sum(x.stock_quantity)::int FROM product_variants x WHERE x.product_id = p.id), 0),
        updated_at = now()
       WHERE p.id = ${v[0].product_id}`;
    return { variantId, quantity: v[0].stock_quantity, name: v[0].variant_name };
  }
  const p = await sql`
    UPDATE products SET stock_quantity = ${qty}, updated_at = now()
     WHERE id = ${productId} RETURNING id, name, stock_quantity`;
  if (!p.length) throw new Error("Product not found");
  return { productId, quantity: p[0].stock_quantity, name: p[0].name };
}

/* ---------- customers ---------- */
async function customers({ q, limit = 25, offset = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  offset = Math.max(parseInt(offset, 10) || 0, 0);
  const term = q && String(q).trim() ? `%${String(q).trim().toLowerCase()}%` : null;

  const rows = await sql`
    SELECT c.id, c.name, c.phone, c.email, c.city, c.created_at,
           count(o.id)::int AS order_count,
           coalesce(sum(o.total) FILTER (WHERE o.status <> 'CANCELLED'), 0) AS lifetime_value,
           max(o.placed_at) AS last_order_at,
           count(*) OVER () AS total_count
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id
     WHERE (${term}::text IS NULL OR lower(c.name) LIKE ${term}
                                  OR lower(coalesce(c.phone,'')) LIKE ${term}
                                  OR lower(coalesce(c.email,'')) LIKE ${term}
                                  OR lower(coalesce(c.city,'')) LIKE ${term})
     GROUP BY c.id, c.name, c.phone, c.email, c.city, c.created_at
     ORDER BY max(o.placed_at) DESC NULLS LAST, c.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`;

  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { customers: rows.map(({ total_count, ...r }) => r), total, limit, offset };
}

async function customerDetail(id) {
  const rows = await sql`
    SELECT id, name, phone, email, city, address, created_at FROM customers WHERE id = ${id} LIMIT 1`;
  if (!rows.length) return null;
  const orders = await sql`
    SELECT id, reference, status, payment_status, total, placed_at
      FROM orders WHERE customer_id = ${id} ORDER BY placed_at DESC LIMIT 50`;
  return { customer: rows[0], orders };
}

/* ---------- analytics ---------- */
async function analytics({ days = 30 } = {}) {
  const window = Math.min(Math.max(parseInt(days, 10) || 30, 7), 365);

  const [totals] = await sql`
    SELECT
      count(*)::int AS orders,
      count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
      coalesce(sum(total) FILTER (WHERE status <> 'CANCELLED'), 0) AS revenue,
      coalesce(avg(total) FILTER (WHERE status <> 'CANCELLED'), 0) AS average_order,
      count(DISTINCT customer_id)::int AS customers
      FROM orders WHERE placed_at > now() - (${window} || ' days')::interval`;

  const series = await sql`
    SELECT d::date AS day,
           coalesce(sum(o.total) FILTER (WHERE o.status <> 'CANCELLED'), 0) AS revenue,
           count(o.id)::int AS orders
      FROM generate_series(now()::date - (${window - 1} || ' days')::interval, now()::date, '1 day') d
      LEFT JOIN orders o ON o.placed_at::date = d::date
     GROUP BY d ORDER BY d`;

  const bestSellers = await sql`
    SELECT i.product_name, sum(i.quantity)::int AS units,
           coalesce(sum(i.line_total), 0) AS revenue
      FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.placed_at > now() - (${window} || ' days')::interval AND o.status <> 'CANCELLED'
     GROUP BY i.product_name ORDER BY units DESC LIMIT 10`;

  const byCity = await sql`
    SELECT coalesce(shipping_city, 'Unknown') AS city, count(*)::int AS orders,
           coalesce(sum(total), 0) AS revenue
      FROM orders WHERE placed_at > now() - (${window} || ' days')::interval AND status <> 'CANCELLED'
     GROUP BY shipping_city ORDER BY orders DESC LIMIT 10`;

  const byStatus = await sql`
    SELECT status::text AS status, count(*)::int AS n FROM orders
     WHERE placed_at > now() - (${window} || ' days')::interval
     GROUP BY status ORDER BY n DESC`;

  const lowStock = await sql`
    SELECT p.name, coalesce(v.variant_name,'—') AS variant_name,
           coalesce(v.stock_quantity, p.stock_quantity) AS stock, p.low_stock_threshold AS threshold
      FROM products p LEFT JOIN product_variants v ON v.product_id = p.id
     WHERE p.status = 'PUBLISHED'
       AND coalesce(v.stock_quantity, p.stock_quantity) <= p.low_stock_threshold
     ORDER BY stock ASC LIMIT 15`;

  return { window, totals, series, bestSellers, byCity, byStatus, lowStock };
}

/* ---------- audit log ---------- */
async function auditLog({ q, action, actor, limit = 50, offset = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  offset = Math.max(parseInt(offset, 10) || 0, 0);
  const term = q && String(q).trim() ? `%${String(q).trim().toLowerCase()}%` : null;
  const act = action || null, who = actor || null;

  const rows = await sql`
    SELECT id, actor_username, action, target_type, target_id, result, ip, detail, created_at,
           count(*) OVER () AS total_count
      FROM audit_logs
     WHERE (${act}::text IS NULL OR action = ${act})
       AND (${who}::text IS NULL OR actor_username = ${who})
       AND (${term}::text IS NULL OR lower(coalesce(actor_username,'')) LIKE ${term}
                                  OR lower(action) LIKE ${term}
                                  OR lower(coalesce(target_type,'')) LIKE ${term}
                                  OR lower(detail::text) LIKE ${term})
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`;

  const total = rows.length ? Number(rows[0].total_count) : 0;
  const actions = (await sql`SELECT DISTINCT action FROM audit_logs ORDER BY action`).map((r) => r.action);
  const actors = (await sql`
    SELECT DISTINCT actor_username FROM audit_logs
     WHERE actor_username IS NOT NULL ORDER BY actor_username`).map((r) => r.actor_username);

  return { entries: rows.map(({ total_count, ...r }) => r), total, limit, offset, actions, actors };
}

module.exports = { inventory, setStock, customers, customerDetail, analytics, auditLog };
