/* /api/admin/homepage — hero slides (homepage:manage, Super Admin only) */
const S = require("../../lib/site-admin.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../lib/http.js");
const auth = require("../../lib/auth.js");

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, "homepage:manage");
      if (!session) return;
      return ok(res, { slides: await S.heroSlides() });
    },
    PUT: async () => {
      const session = await guard(req, res, "homepage:manage");
      if (!session) return;
      const body = await readBody(req);
      let slide;
      try { slide = await S.saveHeroSlide(body); }
      catch (e) { return fail(res, 400, e.message); }
      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: body.id ? "HERO_SLIDE_UPDATED" : "HERO_SLIDE_CREATED",
        targetType: "hero_slide", targetId: String(slide.id),
        detail: { headline: slide.headline, enabled: slide.is_enabled }, ip: clientIp(req),
      });
      return ok(res, { slide });
    },
    DELETE: async () => {
      const session = await guard(req, res, "homepage:manage");
      if (!session) return;
      const id = Number((req.query || {}).id || 0);
      let slide;
      try { slide = await S.deleteHeroSlide(id); }
      catch (e) { return fail(res, 400, e.message); }
      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "HERO_SLIDE_DELETED", targetType: "hero_slide", targetId: String(id),
        detail: { headline: slide.headline }, ip: clientIp(req),
      });
      return ok(res, { slide });
    },
  })
);
