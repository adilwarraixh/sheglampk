/* /api/cron/refresh — keep the date-based parts of the static shop true

   Shop pages are static HTML, and some of what they show changes with the
   clock rather than with an edit: a scheduled sale starts or ends, a
   product stops being New a month after it was published. Vercel Cron
   calls this hourly (vercel.json, authenticated by CRON_SECRET); it
   rebuilds only when such a moment has passed since the last build read
   the catalogue — or, as a catch-all, when that was more than a day ago.

   The checkout always prices at the moment of ordering, so a page that is
   briefly out of date can never charge the wrong price; it would ask the
   customer to confirm the real total instead. */
const { sql } = require("../../db/client.js");
const R = require("../../lib/rebuild.js");
const { NEW_FOR_DAYS } = require("../../lib/catalogue.js");
const { ok, fail, methods, handler, cronSecretMatches } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      if (!cronSecretMatches(req)) return fail(res, 401, "Not authorised");

      /* Housekeeping while here. Every limit reads the last hour at most,
         so a week of attempts is plenty; contact messages go after the
         year the privacy page promises. */
      await Promise.all([
        sql`DELETE FROM login_attempts WHERE created_at < now() - interval '7 days'`,
        sql`DELETE FROM contact_messages WHERE created_at < now() - interval '1 year'`,
      ]).catch((e) => console.error("[cron] housekeeping failed:", e.message));   // never at the cost of the rebuild check

      const [due] = await sql`
        WITH since AS (SELECT coalesce((SELECT exported_at FROM site_rebuilds WHERE id = 1),
                                       now() - interval '2 days') AS t)
        SELECT (SELECT t FROM since) < now() - interval '1 day' AS stale,
               (SELECT count(*)::int FROM products p, since
                 WHERE p.status = 'PUBLISHED' AND (
                       (p.sale_starts_at > since.t AND p.sale_starts_at <= now())
                    OR (p.sale_ends_at   > since.t AND p.sale_ends_at   <= now())
                    OR (NOT p.is_new_arrival
                        AND p.published_at + make_interval(days => ${NEW_FOR_DAYS}::int) > since.t
                        AND p.published_at + make_interval(days => ${NEW_FOR_DAYS}::int) <= now()))) AS crossed`;

      if (!due.stale && !due.crossed) return ok(res, { rebuild: { status: "not-needed" } });
      const reason = due.crossed
        ? `${due.crossed} product${due.crossed === 1 ? "" : "s"} changed by date (sale start/end or no longer New)`
        : "daily refresh";
      return ok(res, { rebuild: await R.requestRebuild(reason, { by: "cron" }) });
    },
  })
);
