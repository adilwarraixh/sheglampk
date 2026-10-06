/* /api/admin/inbox — contact messages, reviews and newsletter subscribers

   GET    ?tab=messages&show=open|all   messages            (inbox:view)
   GET    ?tab=reviews&status=PENDING   reviews             (inbox:view)
   GET    ?export=subscribers           subscriber CSV      (subscribers:export, Super Admin)
   PATCH  { type: "message", id, handled }                  (inbox:handle)
   PATCH  { type: "review", id, status, verified }          (reviews:moderate, Super Admin)

   Reviews appear on the shop only once approved, so approving (or
   withdrawing) one rebuilds the shop. */
const inbox = require("../../lib/inbox.js");
const R = require("../../lib/rebuild.js");
const auth = require("../../lib/auth.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../lib/http.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const q = req.query || {};
      if (q.export === "subscribers") {
        const session = await guard(req, res, "subscribers:export");
        if (!session) return;
        const csv = await inbox.subscribersCsv();
        await auth.audit({ actorId: session.user.id, actorUsername: session.user.username,
          action: "SUBSCRIBERS_EXPORTED", targetType: "subscribers", ip: clientIp(req) });
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="sheglampk-subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.setHeader("Cache-Control", "no-store");
        return res.end("﻿" + csv);
      }

      const session = await guard(req, res, "inbox:view");
      if (!session) return;
      const [counts, data] = await Promise.all([
        inbox.counts(),
        q.tab === "reviews"
          ? inbox.listReviews({ status: q.status, limit: q.limit, offset: q.offset })
          : inbox.listMessages({ show: q.show, limit: q.limit, offset: q.offset }),
      ]);
      return ok(res, { counts, ...data, reviewStatuses: inbox.REVIEW_STATUSES });
    },

    PATCH: async () => {
      const body = await readBody(req);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, "Invalid id");

      if (body.type === "message") {
        const session = await guard(req, res, "inbox:handle");
        if (!session) return;
        const row = await inbox.setHandled(id, !!body.handled, session.user.username);
        if (!row) return fail(res, 404, "Message not found");
        await auth.audit({ actorId: session.user.id, actorUsername: session.user.username,
          action: body.handled ? "MESSAGE_HANDLED" : "MESSAGE_REOPENED", targetType: "contact_message",
          targetId: String(id), detail: { from: row.name }, ip: clientIp(req) });
        return ok(res, { message: row, counts: await inbox.counts() });
      }

      if (body.type === "review") {
        const session = await guard(req, res, "reviews:moderate");
        if (!session) return;
        let row;
        try { row = await inbox.moderateReview(id, { status: body.status, verified: body.verified }, session.user.username); }
        catch (e) { if (e instanceof inbox.InputError) return fail(res, 400, e.message); throw e; }
        if (!row) return fail(res, 404, "Review not found");
        await auth.audit({ actorId: session.user.id, actorUsername: session.user.username,
          action: "REVIEW_MODERATED", targetType: "review", targetId: String(id),
          detail: { product: row.product_slug, author: row.author_name,
                    changes: { status: [row.previous_status, row.status], verified: [row.previous_verified, row.verified] } },
          ip: clientIp(req) });
        const rebuild = row.shopChanges
          ? await R.requestRebuild(`review ${row.status.toLowerCase()} on “${row.product_slug}”`, { by: session.user.username })
          : { status: "not-needed" };
        return ok(res, { review: row, rebuild, counts: await inbox.counts() });
      }

      return fail(res, 400, "Unknown item type");
    },
  })
);
