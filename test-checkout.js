/* =========================================================
   test-checkout.js — the checkout cannot oversell, writes all or nothing,
   and charges the delivery set in Settings

   Run:  node test-checkout.js     (against the dev branch; refuses production)

   Works on throwaway products and test phone numbers, removed at the end.
   Settings it changes are put back. Never starts a shop rebuild.
   ========================================================= */
process.env.DEPLOY_HOOK_URL = "";      // set before db/client.js loads .env.local

const { sql } = require("./db/client.js");
const P = require("./lib/products-admin.js");
const O = require("./lib/orders.js");

let pass = 0, fail = 0;
const results = [];
function check(name, condition, detail = "") {
  if (condition) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
}
const PHONES = ["03009998893", "03009998894", "03009998895"];
const buyer = (phone) => ({ customerName: "Test Buyer", customerPhone: phone, shippingAddress: "House 1, Street 2, Test Town" });
const attempt = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

(async () => {
  const tag = "zzco" + Date.now().toString(36);
  const [cat] = await sql`SELECT id FROM categories WHERE is_active ORDER BY position LIMIT 1`;
  const settingsBefore = await sql`SELECT key, value FROM settings`;
  const created = [];

  const product = async (extra) => {
    const p = await P.createProduct({ name: `Test Checkout ${tag} ${created.length}`, sku: `TST-${tag}-${created.length}`,
      status: "PUBLISHED", categoryId: cat.id, price: 1000, ...extra });
    created.push(p.id);
    return p;
  };
  const shadeOf = async (pid, name) => (await sql`SELECT id, stock_quantity FROM product_variants WHERE product_id = ${pid} AND variant_name = ${name}`)[0];
  const ordersFor = async (phone) => (await sql`SELECT count(*)::int AS n FROM orders WHERE customer_phone = ${phone}`)[0].n;
  const customersFor = async (phone) => (await sql`SELECT count(*)::int AS n FROM customers WHERE phone = ${phone}`)[0].n;

  try {
    console.log("\n=== TWO CUSTOMERS, ONE LAST UNIT ===");
    const lip = await product({ variants: [{ name: "Rose", stock: 1 }, { name: "Nude", stock: 5 }],
      images: [{ url: `/assets/img/${tag}-main.png` }, { url: `/assets/img/${tag}-rose.png`, shade: "Rose" }] });
    const rose = await shadeOf(lip.id, "Rose");
    const [a, b] = await Promise.all([
      attempt(O.createOrder({ ...buyer(PHONES[0]), items: [{ variantId: rose.id, quantity: 1 }] })),
      attempt(O.createOrder({ ...buyer(PHONES[1]), items: [{ variantId: rose.id, quantity: 1 }] })),
    ]);
    const winners = [a, b].filter((r) => r.ok), losers = [a, b].filter((r) => !r.ok);
    check("exactly one order succeeds", winners.length === 1 && losers.length === 1, `${winners.length} won`);
    check("the other is told it has sold out", losers[0] && /sold out|left/i.test(losers[0].e.message), losers[0] && losers[0].e.message);
    check("stock is 0, never negative", (await shadeOf(lip.id, "Rose")).stock_quantity === 0);
    const loserPhone = a.ok ? PHONES[1] : PHONES[0];
    check("the losing order left no order behind", (await ordersFor(loserPhone)) === 0);
    check("and no customer record (all or nothing)", (await customersFor(loserPhone)) === 0);
    const [{ total: lipStock }] = await sql`SELECT stock_quantity AS total FROM products WHERE id = ${lip.id}`;
    check("product total follows its shades (0 + 5)", lipStock === 5, String(lipStock));
    const [line] = await sql`SELECT image_url FROM order_items i JOIN orders o ON o.id = i.order_id
                              WHERE o.reference = ${winners[0].v.reference}`;
    check("the order line keeps the shade's own photo", /rose\.png$/.test(line.image_url || ""), line.image_url);

    console.log("\n=== TWO CUSTOMERS, TWO SHADES OF ONE PRODUCT, AT ONCE ===");
    const duo = await product({ variants: [{ name: "Alpha", stock: 5 }, { name: "Beta", stock: 5 }] });
    const [alpha, beta] = [await shadeOf(duo.id, "Alpha"), await shadeOf(duo.id, "Beta")];
    const both = await Promise.all([
      attempt(O.createOrder({ ...buyer(PHONES[0]), items: [{ variantId: alpha.id, quantity: 1 }] })),
      attempt(O.createOrder({ ...buyer(PHONES[1]), items: [{ variantId: beta.id, quantity: 1 }] })),
    ]);
    check("both orders go through", both.every((r) => r.ok), both.filter((r) => !r.ok).map((r) => r.e.message).join("; "));
    const [{ stock_quantity: duoTotal }] = await sql`SELECT stock_quantity FROM products WHERE id = ${duo.id}`;
    check("the product total is exact (10 − 2 = 8), not computed from a stale snapshot", duoTotal === 8, String(duoTotal));
    await sql`DELETE FROM orders WHERE customer_phone = ANY(${PHONES.slice(0, 2)})`;
    await sql`DELETE FROM customers WHERE phone = ANY(${PHONES.slice(0, 2)})`;

    console.log("\n=== THE SAME SHADE TWICE IN ONE CART ===");
    const nude = await shadeOf(lip.id, "Nude");             // 5 in stock
    const dup = await attempt(O.createOrder({ ...buyer(PHONES[2]),
      items: [{ variantId: nude.id, quantity: 3 }, { variantId: nude.id, quantity: 3 }] }));
    check("two lines of 3 against 5 in stock are refused", !dup.ok && /Only 5 left/.test(dup.e.message), dup.ok ? "accepted" : dup.e.message);
    check("nothing taken", (await shadeOf(lip.id, "Nude")).stock_quantity === 5);
    const merged = await O.createOrder({ ...buyer(PHONES[2]), items: [{ variantId: nude.id, quantity: 2 }, { variantId: nude.id, quantity: 1 }] });
    const lines = await sql`SELECT quantity FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.reference = ${merged.reference}`;
    check("two lines of the same shade become one line of 3", lines.length === 1 && lines[0].quantity === 3, JSON.stringify(lines));
    check("3 taken from stock", (await shadeOf(lip.id, "Nude")).stock_quantity === 2);

    console.log("\n=== DELIVERY AND ORDERING FOLLOW SETTINGS ===");
    const plain = await product({ price: 1500, stockQuantity: 50 });
    await sql`INSERT INTO settings (key, value) VALUES ('free_shipping_over', '1000'::jsonb), ('flat_shipping', '300'::jsonb)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    let o = await O.createOrder({ ...buyer(PHONES[2]), items: [{ productId: plain.id, quantity: 1 }] });
    check("free delivery from the threshold in Settings (1500 ≥ 1000)", o.shippingFee === 0 && o.total === 1500, `${o.shippingFee} / ${o.total}`);
    await sql`UPDATE settings SET value = '5000'::jsonb WHERE key = 'free_shipping_over'`;
    o = await O.createOrder({ ...buyer(PHONES[2]), items: [{ productId: plain.id, quantity: 1 }] });
    check("the delivery charge in Settings (Rs 300)", o.shippingFee === 300 && o.total === 1800, `${o.shippingFee} / ${o.total}`);
    await sql`INSERT INTO settings (key, value) VALUES ('orders_enabled', 'false'::jsonb)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    const off = await attempt(O.createOrder({ ...buyer(PHONES[2]), items: [{ productId: plain.id, quantity: 1 }] }));
    check("'Accept new orders' off refuses the order", !off.ok && /not taking orders/i.test(off.e.message), off.ok ? "accepted" : off.e.message);
  } finally {
    await sql`DELETE FROM settings`;
    for (const s of settingsBefore) await sql`INSERT INTO settings (key, value) VALUES (${s.key}, ${JSON.stringify(s.value)}::jsonb)`;
    await sql`DELETE FROM orders WHERE customer_phone = ANY(${PHONES})`;
    await sql`DELETE FROM customers WHERE phone = ANY(${PHONES})`;
    for (const id of created) await sql`DELETE FROM products WHERE id = ${id}`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM products WHERE sku LIKE ${"TST-" + tag + "%"}`;
    const after = await sql`SELECT key, value FROM settings ORDER BY key`;
    check("cleaned up, settings restored", n === 0 &&
      JSON.stringify(after) === JSON.stringify(settingsBefore.slice().sort((x, y) => x.key.localeCompare(y.key))), `${n} products left`);
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\ntest error:", e.message, "\n", e.stack); process.exit(1); });
