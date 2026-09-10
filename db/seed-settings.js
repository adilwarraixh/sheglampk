/* db/seed-settings.js — put the site's current configuration into the
   settings table, so the admin form opens with real values.

   Without this the form loads blank, and saving it once writes 0 and ""
   over the working defaults — the shop would silently start offering
   free delivery on everything and a 0-day return window.

   Existing values are never overwritten.
   Run:  node db/seed-settings.js
   ========================================================= */
const { sql, describeTarget } = require("./client.js");
const { SITE } = require("../data/catalog.js");

const DEFAULTS = {
  free_shipping_over: SITE.freeShippingOver,
  flat_shipping: SITE.flatShipping,
  return_days: SITE.returnDays,
  low_stock_default: 5,
  contact_email: SITE.email,
  contact_phone: SITE.phoneShow,
  whatsapp_number: SITE.whatsapp,
  announcement: "100% genuine SHEGLAM stock — sealed and batch-checked",
  orders_enabled: true,
};

(async () => {
  console.log(`\nSettings seed → ${describeTarget()}`);
  let written = 0, kept = 0;
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const existing = await sql`SELECT key FROM settings WHERE key = ${key} LIMIT 1`;
    if (existing.length) { kept++; continue; }
    await sql`INSERT INTO settings (key, value, updated_by)
              VALUES (${key}, ${JSON.stringify(value)}::jsonb, 'seed')`;
    written++;
  }
  console.log(`  ${written} defaults written, ${kept} already set.\n`);
})().catch((e) => { console.error("\n✗", e.message, "\n"); process.exit(1); });
