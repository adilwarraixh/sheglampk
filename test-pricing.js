/* =========================================================
   test-pricing.js — a sale never touches the regular price, and the
   checkout charges exactly what the shop shows

   Run:  node test-pricing.js

   Works on a throwaway product and orders under a test phone number, all
   removed at the end. Never starts a shop rebuild.
   ========================================================= */
process.env.DEPLOY_HOOK_URL = "";      // set before db/client.js loads .env.local

const { sql } = require("./db/client.js");
const P = require("./lib/products-admin.js");
const O = require("./lib/orders.js");
const I = require("./lib/product-import.js");
const { priceOf } = require("./lib/pricing.js");
const { snapshot } = require("./db/export-catalogue.js");

let pass = 0, fail = 0;
const results = [];
function check(name, condition, detail = "") {
  if (condition) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
}

const PHONE = "03009998890";

(async () => {
  const tag = "zzprice" + Date.now().toString(36);
  const [cat] = await sql`SELECT id FROM categories WHERE is_active ORDER BY position LIMIT 1`;
  let product = null;

  /* The body the portal's form sends: both price fields, every time. */
  const form = (extra) => ({
    name: `Test Price ${tag}`, sku: `TST-${tag}`, status: "PUBLISHED", categoryId: cat.id,
    price: 2000, salePrice: null, stockQuantity: 10, ...extra,
  });
  const row = async () => (await sql`SELECT price, sale_price, stock_quantity FROM products WHERE id = ${product.id}`)[0];
  const shown = async () => (await snapshot()).products.find((p) => p.dbId === Number(product.id));
  const buyer = { customerName: "Test Buyer", customerPhone: PHONE, shippingAddress: "House 1, Street 2, Test Town" };
  const ordersPlaced = async () => (await sql`SELECT count(*)::int AS n FROM orders WHERE customer_phone = ${PHONE}`)[0].n;

  try {
    console.log("\n=== A PRODUCT AT ITS REGULAR PRICE ===");
    product = await P.createProduct(form());
    let r = await row();
    check("regular price stored", Number(r.price) === 2000 && r.sale_price === null, JSON.stringify(r));
    check("customers pay the regular price", priceOf(r).final === 2000 && !priceOf(r).onSale);

    console.log("\n=== PUT ON SALE ===");
    await P.updateProduct(product.id, form({ salePrice: 1500 }));
    r = await row();
    check("regular price unchanged by the sale (2000)", Number(r.price) === 2000, r.price);
    check("sale price stored separately (1500)", Number(r.sale_price) === 1500, r.sale_price);
    const pr = priceOf(r);
    check("final price is the sale price", pr.final === 1500);
    check("saving Rs 500, 25% off", pr.save === 500 && pr.percentOff === 25, JSON.stringify(pr));
    const onShop = await shown();
    check("shop shows 1500 with 2000 struck through", onShop && onShop.price === 1500 && onShop.oldPrice === 2000,
      onShop && `${onShop.price} / ${onShop.oldPrice}`);

    console.log("\n=== THE CHECKOUT CHARGES WHAT THE SHOP SHOWS ===");
    // 1500 is under the free-delivery threshold, so Rs 250 delivery.
    const sale = await O.createOrder({ ...buyer, items: [{ productId: product.id, quantity: 1 }], expectedTotal: 1750 });
    const [line] = await sql`SELECT unit_price, line_total FROM order_items WHERE order_id = ${sale.id}`;
    check("order line charged the sale price", Number(line.unit_price) === 1500, line.unit_price);
    check("order total = sale price + delivery", sale.subtotal === 1500 && sale.shippingFee === 250 && sale.total === 1750,
      `${sale.subtotal} + ${sale.shippingFee} = ${sale.total}`);
    check("the order reports the lines it charged", Array.isArray(sale.items) && sale.items[0].price === 1500);

    console.log("\n=== A STALE PAGE CANNOT CHARGE A SURPRISE ===");
    const before = await ordersPlaced(), stockBefore = (await row()).stock_quantity;
    let refusal = null;
    try { await O.createOrder({ ...buyer, items: [{ productId: product.id, quantity: 1 }], expectedTotal: 2250 }); }
    catch (e) { refusal = e; }
    check("a different total from the one shown is refused", refusal && refusal.code === "PRICE_CHANGED", refusal && refusal.message);
    check("the refusal carries the real total to show", refusal && refusal.quote && refusal.quote.total === 1750);
    check("nothing was written", (await ordersPlaced()) === before && (await row()).stock_quantity === stockBefore);

    console.log("\n=== A SALE PRICE AT OR ABOVE THE REGULAR PRICE ===");
    let refused = false;
    try { await P.updateProduct(product.id, form({ salePrice: 2000 })); } catch (e) { refused = /lower than the regular/i.test(e.message); }
    check("refused", refused);
    r = await row();
    check("and the product is unchanged", Number(r.price) === 2000 && Number(r.sale_price) === 1500, JSON.stringify(r));

    console.log("\n=== SALE REMOVED ===");
    await P.updateProduct(product.id, form({ salePrice: null }));
    r = await row();
    check("regular price still 2000", Number(r.price) === 2000, r.price);
    check("sale price cleared", r.sale_price === null, String(r.sale_price));
    check("final price back to 2000 without re-entering it", priceOf(r).final === 2000);
    const offShop = await shown();
    check("shop shows 2000, nothing struck through", offShop && offShop.price === 2000 && offShop.oldPrice === null,
      offShop && `${offShop.price} / ${offShop.oldPrice}`);
    const full = await O.createOrder({ ...buyer, items: [{ productId: product.id, quantity: 1 }], expectedTotal: 2250 });
    check("checkout charges 2000 again", full.subtotal === 2000 && full.total === 2250, `${full.subtotal} / ${full.total}`);

    console.log("\n=== A SCHEDULED SALE ===");
    const hours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
    await P.updateProduct(product.id, form({ salePrice: 1500, saleStartsAt: hours(24), saleEndsAt: hours(48) }));
    r = await sql`SELECT price, sale_price, sale_starts_at, sale_ends_at FROM products WHERE id = ${product.id}`.then((x) => x[0]);
    check("before it starts: not on sale, regular price charged", priceOf(r).saleState === "scheduled" && priceOf(r).final === 2000);
    const early = await O.createOrder({ ...buyer, items: [{ productId: product.id, quantity: 1 }], expectedTotal: 2250 });
    check("checkout charges 2000 before the sale starts", early.subtotal === 2000, String(early.subtotal));
    const sched = await shown();
    check("the shop shows 2000 with nothing struck through", sched && sched.price === 2000 && sched.oldPrice === null);
    check("once it starts, 1500", priceOf(r, new Date(Date.now() + 25 * 3600e3)).final === 1500);
    check("once it ends, back to 2000", priceOf(r, new Date(Date.now() + 49 * 3600e3)).final === 2000
      && priceOf(r, new Date(Date.now() + 49 * 3600e3)).saleState === "ended");
    await P.updateProduct(product.id, form({ salePrice: 1500, saleStartsAt: hours(-1), saleEndsAt: hours(1) }));
    const running = await O.createOrder({ ...buyer, items: [{ productId: product.id, quantity: 1 }], expectedTotal: 1750 });
    check("while it runs, checkout charges 1500", running.subtotal === 1500, String(running.subtotal));
    let bad = false;
    try { await P.updateProduct(product.id, form({ salePrice: 1500, saleStartsAt: hours(5), saleEndsAt: hours(2) })); }
    catch (e) { bad = /end after it starts/.test(e.message); }
    check("a sale that ends before it starts is refused", bad);
    bad = false;
    try { await P.updateProduct(product.id, form({ salePrice: null, saleEndsAt: hours(5) })); }
    catch (e) { bad = /need a sale price/.test(e.message); }
    check("sale dates without a sale price are refused", bad);

    console.log("\n=== A SPREADSHEET IMPORT AND A SCHEDULED SALE ===");
    const sheet = (sale) => `Name,SKU,Sale Price\n"Test Price ${tag}",TST-${tag},${sale}\n`;
    await P.updateProduct(product.id, form({ salePrice: 1500, saleStartsAt: hours(24), saleEndsAt: hours(48) }));
    await I.apply(sheet(1500));
    r = await sql`SELECT price, sale_price, sale_starts_at, sale_ends_at FROM products WHERE id = ${product.id}`.then((x) => x[0]);
    check("the same sale price keeps its schedule", priceOf(r).saleState === "scheduled" && Number(r.sale_price) === 1500);
    await P.updateProduct(product.id, form({ salePrice: 1500, saleStartsAt: hours(-48), saleEndsAt: hours(-24) }));
    await I.apply(sheet(1200));
    r = await sql`SELECT price, sale_price, sale_starts_at, sale_ends_at FROM products WHERE id = ${product.id}`.then((x) => x[0]);
    check("a new sale price after the old sale ended starts now, not inside the old window",
      priceOf(r).onSale && priceOf(r).final === 1200 && r.sale_ends_at === null, JSON.stringify(r));
    await P.updateProduct(product.id, form({ salePrice: null }));

    console.log("\n=== PAST ORDERS KEEP THE PRICE PAID ===");
    const [old] = await sql`SELECT unit_price FROM order_items WHERE order_id = ${sale.id}`;
    check("the sale-time order still shows 1500", Number(old.unit_price) === 1500, old.unit_price);
  } finally {
    await sql`DELETE FROM orders WHERE customer_phone = ${PHONE}`;
    await sql`DELETE FROM customers WHERE phone = ${PHONE}`;
    if (product) await sql`DELETE FROM products WHERE id = ${product.id}`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM products WHERE sku = ${"TST-" + tag}`;
    check("cleaned up", n === 0, `${n} left`);
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\ntest error:", e.message, "\n", e.stack); process.exit(1); });
