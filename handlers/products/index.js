/* GET /api/products — the public catalogue
   Only PUBLISHED products are ever returned; lib/catalogue.js enforces
   that, so no caller can widen it by passing a parameter. */
const { publishedProducts, activeCategories, subcategoriesFor } = require("../../lib/catalogue.js");
const { ok, methods, handler } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const q = req.query || {};
      const data = await publishedProducts({
        category: q.category, subcategory: q.subcategory,
        q: q.q, flag: q.flag, limit: q.limit, offset: q.offset,
      });

      // The nav needs these too; one request instead of three on first load.
      const extras = q.withMeta === "1"
        ? { categories: await activeCategories(), subcategories: await subcategoriesFor(q.category) }
        : {};

      /* Short shared cache: a catalogue edit shows up within the minute,
         while a burst of traffic does not hit the database per visitor. */
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
      return ok(res, { ...data, ...extras });
    },
  })
);
