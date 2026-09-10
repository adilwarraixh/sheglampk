/* GET /api/products/:slug — one published product, plus related items */
const { productBySlug, relatedProducts } = require("../../lib/catalogue.js");
const { ok, fail, methods, handler } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const slug = String((req.query && req.query.slug) || "").trim();
      if (!slug) return fail(res, 400, "No product specified");

      const product = await productBySlug(slug);
      // Unpublished and archived products are indistinguishable from
      // missing ones here — the public API must not confirm they exist.
      if (!product) return fail(res, 404, "Product not found");

      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
      return ok(res, { product, related: await relatedProducts(product, 4) });
    },
  })
);
