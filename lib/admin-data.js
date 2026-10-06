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
  const [rows, [counts]] = await Promise.all([sql`
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
      -- a retired shade is kept only so old orders resolve; it is not stocked
      LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_available
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
     LIMIT ${limit} OFFSET ${offset}`,
    sql`
    SELECT
      count(*) FILTER (WHERE coalesce(v.stock_quantity, p.stock_quantity) = 0)::int AS out_of_stock,
      count(*) FILTER (WHERE coalesce(v.stock_quantity, p.stock_quantity) > 0
                         AND coalesce(v.stock_quantity, p.stock_quantity) <= p.low_stock_threshold)::int AS low_stock,
      count(*)::int AS units
      FROM products p LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_available
     WHERE p.status <> 'ARCHIVED'`,
  ]);

  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { rows: rows.map(({ total_count, ...r }) => r), total, limit, offset, counts };
}

/* Stock is set to an absolute figure, not adjusted by a delta: two admins
   counting the same shelf must not double-apply. */
async function setStock({ productId, variantId, quantity }) {
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 0, 0), 1000000);
  if (variantId) {
    /* The shade and its product's total change together, and the figure it
       had before is returned for the audit log. */
    const [, v] = await sql.transaction([
      // Product before shade, the order the checkout and product saves lock in.
      sql`SELECT id FROM products WHERE id = (SELECT product_id FROM product_variants WHERE id = ${variantId}) FOR UPDATE`,
      sql`UPDATE product_variants v SET stock_quantity = ${qty}
            FROM (SELECT id, stock_quantity AS previous FROM product_variants WHERE id = ${variantId} FOR UPDATE) o
           WHERE v.id = o.id
       RETURNING v.product_id, v.variant_name, v.stock_quantity, o.previous`,
      sql`UPDATE products p SET stock_quantity = s.total
            FROM (SELECT product_id, sum(stock_quantity)::int AS total FROM product_variants
                   WHERE product_id = (SELECT product_id FROM product_variants WHERE id = ${variantId}) AND is_available
                   GROUP BY product_id) s
           WHERE p.id = s.product_id AND p.stock_quantity <> s.total`,
    ]);
    if (!v.length) throw new Error("Variant not found");
    return { variantId, quantity: v[0].stock_quantity, previous: v[0].previous, name: v[0].variant_name };
  }
  /* A product sold in shades has no stock of its own to set: its total is
     worked out from the shades, and setting it here would just disagree
     with them until the next save. The check is part of the statement, so
     it cannot go stale between a check and the write. */
  const p = await sql`
    UPDATE products p SET stock_quantity = ${qty}, updated_at = now()
      FROM (SELECT id, stock_quantity AS previous FROM products WHERE id = ${productId} FOR UPDATE) o
     WHERE p.id = o.id
       AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_available)
     RETURNING p.id, p.name, p.stock_quantity, o.previous`;
  if (!p.length) {
    const [exists] = await sql`SELECT id FROM products WHERE id = ${productId}`;
    throw new Error(exists ? "This product is stocked per shade. Set the stock on each shade instead." : "Product not found");
  }
  return { productId, quantity: p[0].stock_quantity, previous: p[0].previous, name: p[0].name };
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
  const [rows, orders] = await Promise.all([
    sql`SELECT id, name, phone, email, city, address, created_at FROM customers WHERE id = ${id} LIMIT 1`,
    sql`SELECT id, reference, status, payment_status, total, placed_at
          FROM orders WHERE customer_id = ${id} ORDER BY placed_at DESC LIMIT 50`,
  ]);
  if (!rows.length) return null;
  return { customer: rows[0], orders };
}

/* ---------- analytics ---------- */
async function analytics({ days = 30 } = {}) {
  const window = Math.min(Math.max(parseInt(days, 10) || 30, 7), 365);

  // Six independent questions, asked at once.
  const [[totals], series, bestSellers, byCity, byStatus, lowStock] = await Promise.all([
    sql`
    SELECT
      count(*)::int AS orders,
      count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
      coalesce(sum(total) FILTER (WHERE status <> 'CANCELLED'), 0) AS revenue,
      coalesce(avg(total) FILTER (WHERE status <> 'CANCELLED'), 0) AS average_order,
      count(DISTINCT customer_id)::int AS customers
      FROM orders WHERE placed_at > now() - (${window} || ' days')::interval`,
    sql`
    SELECT d::date AS day,
           coalesce(sum(o.total) FILTER (WHERE o.status <> 'CANCELLED'), 0) AS revenue,
           count(o.id)::int AS orders
      FROM generate_series(now()::date - (${window - 1} || ' days')::interval, now()::date, '1 day') d
      LEFT JOIN orders o ON o.placed_at::date = d::date
     GROUP BY d ORDER BY d`,
    sql`
    SELECT i.product_name, sum(i.quantity)::int AS units,
           coalesce(sum(i.line_total), 0) AS revenue
      FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.placed_at > now() - (${window} || ' days')::interval AND o.status <> 'CANCELLED'
     GROUP BY i.product_name ORDER BY units DESC LIMIT 10`,
    sql`
    SELECT coalesce(shipping_city, 'Unknown') AS city, count(*)::int AS orders,
           coalesce(sum(total), 0) AS revenue
      FROM orders WHERE placed_at > now() - (${window} || ' days')::interval AND status <> 'CANCELLED'
     GROUP BY shipping_city ORDER BY orders DESC LIMIT 10`,
    sql`
    SELECT status::text AS status, count(*)::int AS n FROM orders
     WHERE placed_at > now() - (${window} || ' days')::interval
     GROUP BY status ORDER BY n DESC`,
    sql`
    SELECT p.name, coalesce(v.variant_name,'—') AS variant_name,
           coalesce(v.stock_quantity, p.stock_quantity) AS stock, p.low_stock_threshold AS threshold
      FROM products p LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_available
     WHERE p.status = 'PUBLISHED'
       AND coalesce(v.stock_quantity, p.stock_quantity) <= p.low_stock_threshold
     ORDER BY stock ASC LIMIT 15`,
  ]);

  return { window, totals, series, bestSellers, byCity, byStatus, lowStock };
}

/* ---------- audit log ---------- */
async function auditLog({ q, action, actor, limit = 50, offset = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  offset = Math.max(parseInt(offset, 10) || 0, 0);
  const term = q && String(q).trim() ? `%${String(q).trim().toLowerCase()}%` : null;
  const act = action || null, who = actor || null;

  const [rows, actionRows, actorRows] = await Promise.all([sql`
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
     LIMIT ${limit} OFFSET ${offset}`,
    sql`SELECT DISTINCT action FROM audit_logs ORDER BY action`,
    sql`SELECT DISTINCT actor_username FROM audit_logs
         WHERE actor_username IS NOT NULL ORDER BY actor_username`,
  ]);

  const total = rows.length ? Number(rows[0].total_count) : 0;
  const actions = actionRows.map((r) => r.action);
  const actors = actorRows.map((r) => r.actor_username);

  return { entries: rows.map(({ total_count, ...r }) => r), total, limit, offset, actions, actors };
}

module.exports = { inventory, setStock, customers, customerDetail, analytics, auditLog };
