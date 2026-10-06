/* /api/cron/daily — rebuild the shop once a day

   Shop pages are static HTML, and some of what they say depends on the
   date: a product stops being New a month after it was first published
   (lib/catalogue.js). Without this, that label would only change the next
   time somebody happened to save a product. Vercel Cron calls this daily
   (vercel.json), authenticated by CRON_SECRET. */
const R = require("../../lib/rebuild.js");
const { ok, fail, methods, handler, cronSecretMatches } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      if (!cronSecretMatches(req)) return fail(res, 401, "Not authorised");
      const rebuild = await R.requestRebuild("daily refresh of date-based labels (New)", { by: "cron" });
      return ok(res, { rebuild });
    },
  })
);
