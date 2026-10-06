/* =========================================================
   lib/pricing.js — the one place a selling price is decided

   products.price is the regular price and is never changed by a sale.
   products.sale_price is the reduced price, or null when there is no
   sale; removing it is all it takes to end one.

   The checkout used to read products.price while the shop displayed the
   sale price, so customers were charged the regular price for items shown
   on sale. Every caller now asks priceOf() — the checkout, the catalogue
   export the shop is built from, and the public API — so what the shop
   shows and what an order costs come from the same answer.

   Shade prices (product_variants.price) are deliberately not used: the
   shop shows one price per product, and charging a shade price it never
   displayed is the same bug again.
   ========================================================= */

/* Accepts a products row ({ price, sale_price }). Money columns arrive from
   the driver as strings, so everything is converted here. */
function priceOf(p) {
  const regular = p.price == null ? null : Number(p.price);
  const sale = p.sale_price == null ? null : Number(p.sale_price);
  // The database already refuses a sale that is not below the regular
  // price; checked again so a bad row can never raise what is charged.
  const onSale = regular != null && sale != null && sale < regular;
  return {
    regular,
    sale: onSale ? sale : null,
    final: onSale ? sale : regular,          // what the customer pays
    onSale,
    save: onSale ? regular - sale : 0,
    percentOff: onSale ? Math.round((1 - sale / regular) * 100) : 0,
  };
}

module.exports = { priceOf };
