/* POST /api/forms — the newsletter box, the contact form and the review form

   Public, so: a honeypot field for bots, a per-IP hourly limit, input
   checked in lib/inbox.js, and only a plain answer back. Everything is
   stored first; the email to the shop about a new message or review is a
   courtesy that may fail without losing anything — the Inbox in the admin
   portal is the record. The reply never claims an email was sent. */
const inbox = require("../lib/inbox.js");
const mailer = require("../lib/mailer.js");
const { sql } = require("../db/client.js");
const { ok, fail, readBody, takeSlot, methods, handler, clientIp } = require("../lib/http.js");

const PER_HOUR = 10;                      // per IP, per kind of form
const EMAILS_PER_HOUR = 20;               // to the shop, from all forms together
const KINDS = ["newsletter", "contact", "review"];

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Tell the shop, but never hold the customer up for long or fail them.
   The forms share the mail provider with order emails, so past a ceiling
   they stop emailing (everything is still in the Inbox) rather than use
   up the quota new-order emails depend on. */
async function tellShop(subject, lines, replyTo) {
  const c = mailer.config();
  const text = lines.join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${
    lines.map((l) => `<p style="margin:0 0 8px">${esc(l).replace(/\n/g, "<br>")}</p>`).join("")}
    <p style="margin-top:16px;color:#777">It is also in the admin portal under Inbox.</p></div>`;
  try {
    // Inside the try: the message is already saved, so nothing here may fail the customer.
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM login_attempts
       WHERE username IN ('__contact__', '__review__') AND created_at > now() - interval '1 hour'`;
    if (n > EMAILS_PER_HOUR) return;
    await Promise.race([
      mailer.send({ to: c.adminRecipient, subject, text, html, replyTo }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 6000)),
    ]);
  } catch (e) {
    console.error("[forms] could not email the shop:", e.message);
  }
}

module.exports = handler(async (req, res) =>
  methods(req, res, {
    POST: async () => {
      const body = await readBody(req, 20000);
      const kind = KINDS.includes(body.kind) ? body.kind : null;
      if (!kind) return fail(res, 400, "Unknown form.");

      // A field people cannot see: only bots fill it. Answer as if it worked.
      if (body.website) return ok(res, { received: true });

      if (!(await takeSlot("__" + kind + "__", clientIp(req), PER_HOUR))) {
        return fail(res, 429, "That is a lot of messages in a short time. Please try again later, or message us on WhatsApp.");
      }

      let saved;
      try {
        if (kind === "newsletter") saved = await inbox.subscribe(body.email, body.source);
        else if (kind === "contact") saved = await inbox.saveContact(body);
        else saved = await inbox.submitReview(body);
      } catch (e) {
        if (e instanceof inbox.InputError) return fail(res, 400, e.message);
        throw e;
      }

      if (kind === "contact") {
        await tellShop(`Website message from ${saved.name}`,
          [`From: ${saved.name} <${saved.email}>${saved.phone ? " · " + saved.phone : ""}`, "", saved.message], saved.email);
      } else if (kind === "review") {
        await tellShop(`New review to approve — ${saved.product_name} (${saved.rating}★)`,
          [`${saved.author_name} rated ${saved.product_name} ${saved.rating}/5${saved.shade ? " (" + saved.shade + ")" : ""}.`,
           saved.order_reference ? `Order reference given: ${saved.order_reference}` : "No order reference given.",
           "", saved.body, "", "It is not on the shop until you approve it in the admin portal."]);
      }

      return ok(res, kind === "newsletter" ? { subscribed: true } : { received: true });
    },
  })
);
