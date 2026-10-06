/* /api/admin/collections — the shop's curated collections (Super Admin)

   GET                         every collection, who is in it now, and the
                               products/categories/subcategories to pick from
   POST   { …fields }          create
   PATCH  ?id=  { …fields }    update
   DELETE ?id=                 delete (its page leaves the shop)

   Fields: slug, title, subtitle, blurb, tint, position, isActive,
   ruleCategoryId, ruleSubcategories[], rulePriceUnder, productIds[].
   Every change is audited with before → after and rebuilds the shop. */
const C = require("../../lib/collections.js");
const P = require("../../lib/products-admin.js");
const R = require("../../lib/rebuild.js");
const auth = require("../../lib/auth.js");
const { ok, fail, guard, handler, methods, readBody, clientIp } = require("../../lib/http.js");

const PERM = "collections:manage";

async function record(req, session, action, id, detail) {
  await auth.audit({ actorId: session.user.id, actorUsername: session.user.username,
    action, targetType: "collection", targetId: String(id), detail, ip: clientIp(req) });
  return R.requestRebuild(`collection ${detail.slug || ""}`.trim(), { by: session.user.username });
}

async function write(req, res, id) {
  const session = await guard(req, res, PERM);
  if (!session) return;
  if (id !== null && !(Number.isInteger(id) && id > 0)) return fail(res, 400, "Invalid collection id");
  const body = await readBody(req, 100000);
  let result;
  try { result = await C.save(body, id); }
  catch (e) {
    if (e instanceof C.InputError) return fail(res, 400, e.message);
    throw e;
  }
  if (!result) return fail(res, 404, "Collection not found");
  const { before, after } = result;
  const rebuild = await record(req, session, id ? "COLLECTION_UPDATED" : "COLLECTION_CREATED", after.id,
    { slug: after.slug, changes: P.changes(C.auditView(before), C.auditView(after)) });
  return ok(res, { collection: after, rebuild });
}

module.exports = handler(async (req, res) =>
  methods(req, res, {
    GET: async () => {
      const session = await guard(req, res, PERM);
      if (!session) return;
      return ok(res, await C.adminView());
    },
    POST: async () => write(req, res, null),
    PATCH: async () => write(req, res, Number((req.query || {}).id || 0)),
    DELETE: async () => {
      const session = await guard(req, res, PERM);
      if (!session) return;
      const id = Number((req.query || {}).id || 0);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, "Invalid collection id");
      const gone = await C.remove(id);
      if (!gone) return fail(res, 404, "Collection not found");
      const rebuild = await record(req, session, "COLLECTION_DELETED", id, { slug: gone.slug, title: gone.title });
      return ok(res, { deleted: gone, rebuild });
    },
  })
);
