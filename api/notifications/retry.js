/* /api/notifications/retry — send whatever is due.

   Meant for a scheduler (Vercel Cron) so a notification that failed while
   the shop was mid-outage still goes out. Protected by a shared secret in
   CRON_SECRET, or by a signed-in admin session, because otherwise anyone
   could drive the mail provider.

   Idempotent: it only picks up rows that are PENDING/FAILED, under their
   attempt budget, and past their backoff — a SENT notification is never
   re-sent by this route. */
const notify = require("../../lib/order-emails.js");
const mailer = require("../../lib/mailer.js");
const auth = require("../../lib/auth.js");
const { ok, fail, methods, handler, cronSecretMatches } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => run(req, res),
    POST: async () => run(req, res),
  })
);

async function run(req, res) {
  let authorised = cronSecretMatches(req);
  if (!authorised) {
    const session = await auth.getSession(auth.readCookie(req.headers.cookie));
    authorised = !!(session && session.user && !session.user.mustChangePassword);
  }
  if (!authorised) return fail(res, 401, "Not authorised");

  const results = await notify.sendDue({ limit: (req.query || {}).limit });
  return ok(res, {
    attempted: results.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    mail: mailer.status(),
  });
}
