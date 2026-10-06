/* =========================================================
   lib/pricing.js — the one place a selling price is decided

   products.price is the regular price and is never changed by a sale.
   products.sale_price is the reduced price, or null when there is no
   sale; removing it is all it takes to end one. A sale can also be
   scheduled: sale_starts_at / sale_ends_at (migration 008), both optional
   — no start means "from now", no end means "until removed".

   The checkout used to read products.price while the shop displayed the
   sale price, so customers were charged the regular price for items shown
   on sale. Every caller now asks priceOf() — the checkout, the catalogue
   export the shop is built from, the public API and the admin — so what
   the shop shows and what an order costs come from the same answer.

   Shade prices (product_variants.price) are deliberately not used: the
   shop shows one price per product, and charging a shade price it never
   displayed is the same bug again.
   ========================================================= */

/* Accepts a products row ({ price, sale_price, sale_starts_at, sale_ends_at }).
   Money columns arrive from the driver as strings, so everything is
   converted here. `now` is when the price applies: the moment of ordering
   at the checkout, the moment of building for the shop's pages. */
function priceOf(p, now = new Date()) {
  const regular = p.price == null ? null : Number(p.price);
  const sale = p.sale_price == null ? null : Number(p.sale_price);
  const starts = p.sale_starts_at ? new Date(p.sale_starts_at) : null;
  const ends = p.sale_ends_at ? new Date(p.sale_ends_at) : null;
  // The database already refuses a sale that is not below the regular
  // price; checked again so a bad row can never raise what is charged.
  const priced = regular != null && sale != null && sale < regular;
  const saleState = !priced ? "none"
    : starts && now < starts ? "scheduled"
    : ends && now >= ends ? "ended"
    : "active";
  const onSale = saleState === "active";
  return {
    regular,
    sale: onSale ? sale : null,
    final: onSale ? sale : regular,          // what the customer pays
    onSale,
    saleState,                               // none | scheduled | active | ended
    saleStartsAt: starts, saleEndsAt: ends,
    save: onSale ? regular - sale : 0,
    percentOff: onSale ? Math.round((1 - sale / regular) * 100) : 0,
  };
}

module.exports = { priceOf };
