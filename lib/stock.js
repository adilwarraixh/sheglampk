/* =========================================================
   lib/stock.js — a product sold in shades has no stock of its own

   Its stock is what its shades add up to. Orders take stock from the
   shade, while the storefront and the admin lists read the product
   total, so the two only agree if the total is recalculated after every
   write that touches shade stock. Every such write calls this.
   ========================================================= */
const { sql } = require("../db/client.js");

async function syncProductStock(productId) {
  await sql`
    UPDATE products p
       SET stock_quantity = s.total
      FROM (SELECT coalesce(sum(stock_quantity), 0)::int AS total, count(*)::int AS shades
              FROM product_variants
             WHERE product_id = ${productId} AND is_available) s
     WHERE p.id = ${productId} AND s.shades > 0 AND p.stock_quantity <> s.total`;
}

module.exports = { syncProductStock };
