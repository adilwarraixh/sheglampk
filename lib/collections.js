/* =========================================================
   lib/collections.js — the shop's curated collections

   A collection shows its hand-picked products, plus — when it has rules —
   every published product matching ALL of them: a category, any one of
   some subcategories, a price under a figure. Rules keep a collection
   like "Everything Under Rs 2,000" true as prices change; picks let the
   admin choose by hand. membersOf() is the one place membership is
   decided; the catalogue export and the admin preview both call it.

   The title, colour and slug end up in the shop's HTML and file names, so
   they are checked here and again by constraints (migration 009).
   ========================================================= */
const { sql } = require("../db/client.js");
const { priceOf } = require("./pricing.js");

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TINT = /^#[0-9a-fA-F]{6}$/;
const line = (s, max) => String(s == null ? "" : s).replace(/\0/g, "").replace(/\s+/g, " ").trim().slice(0, max);

class InputError extends Error {}
const refuse = (m) => { throw new InputError(m); };

const hasRules = (c) => c.rule_category_id != null || (c.rule_subcategories || []).length > 0 || c.rule_price_under != null;

/* p: a product row with category_id, subcategory and the price columns. */
function matchesRules(c, p, now = new Date()) {
  if (!hasRules(c)) return false;
  if (c.rule_category_id != null && String(p.category_id) !== String(c.rule_category_id)) return false;
  const subs = c.rule_subcategories || [];
  if (subs.length && !subs.some((s) => s.toLowerCase() === String(p.subcategory || "").toLowerCase())) return false;
  // The price the customer pays now — a sale counts, as it always has.
  if (c.rule_price_under != null && !(priceOf(p, now).final < Number(c.rule_price_under))) return false;
  return true;
}

/* "Every product whose name starts with…" stands on its own, like a pick. */
const namedIn = (c, p) => !!c.include_name_prefix
  && String(p.name || "").toLowerCase().startsWith(c.include_name_prefix.toLowerCase());

/* In the order the products come in (the shop's: newest first). */
const membersOf = (c, products, now = new Date()) =>
  products.filter((p) => c.picks.includes(Number(p.id)) || namedIn(c, p) || matchesRules(c, p, now));

async function list({ activeOnly = false } = {}) {
  const rows = await sql`
    SELECT c.id, c.slug, c.title, c.subtitle, c.blurb, c.tint, c.position, c.is_active,
           c.rule_category_id, c.rule_subcategories, c.rule_price_under, c.include_name_prefix, c.updated_at,
           coalesce((SELECT array_agg(pc.product_id ORDER BY pc.product_id)
                       FROM product_collections pc WHERE pc.collection_id = c.id), '{}') AS picks
      FROM collections c
     WHERE (${!activeOnly} OR c.is_active)
     ORDER BY c.position, c.id`;
  return rows.map((r) => ({
    ...r, id: Number(r.id), picks: (r.picks || []).map(Number),
    rule_category_id: r.rule_category_id == null ? null : Number(r.rule_category_id),
    rule_price_under: r.rule_price_under == null ? null : Number(r.rule_price_under),
  }));
}

/* What the admin page needs: every collection with who is in it now,
   and the products, categories and subcategories to choose from. */
async function adminView() {
  const [collections, products, categories] = await Promise.all([
    list(),
    sql`SELECT p.id, p.name, p.status, p.category_id, p.subcategory, p.price, p.sale_price,
               p.sale_starts_at, p.sale_ends_at, c.name AS category
          FROM products p LEFT JOIN categories c ON c.id = p.category_id
         -- archived ones too while a collection still picks them, or saving would drop them
         WHERE p.status <> 'ARCHIVED'
            OR EXISTS (SELECT 1 FROM product_collections pc WHERE pc.product_id = p.id)
         ORDER BY p.published_at DESC NULLS LAST, p.id DESC`,
    sql`SELECT id, name, slug FROM categories ORDER BY position, name`,
  ]);
  const now = new Date();
  const published = products.filter((p) => p.status === "PUBLISHED");
  return {
    collections: collections.map((c) => ({ ...c, members: membersOf(c, published, now).map((p) => Number(p.id)) })),
    products: products.map((p) => ({
      id: Number(p.id), name: p.name, status: p.status, category: p.category,
      category_id: p.category_id == null ? null : Number(p.category_id),
      subcategory: p.subcategory, price: priceOf(p, now).final,
    })),
    categories: categories.map((c) => ({ ...c, id: Number(c.id) })),
    subcategories: [...new Set(products.map((p) => p.subcategory).filter(Boolean))].sort(),
  };
}

function clean(b) {
  const slug = line(b.slug, 60).toLowerCase();
  if (!SLUG.test(slug)) refuse("The web address can use lower-case letters, numbers and single hyphens, e.g. eid-edit.");
  const title = line(b.title, 80);
  if (!title) refuse("Give the collection a title.");
  const tint = line(b.tint, 7) || null;
  if (tint && !TINT.test(tint)) refuse("The colour must look like #e83e70.");
  const priceRaw = b.rulePriceUnder;
  const priceUnder = priceRaw === "" || priceRaw == null ? null : Number(priceRaw);
  if (priceUnder !== null && !(Number.isFinite(priceUnder) && priceUnder > 0 && priceUnder < 10000000))
    refuse("The price rule must be a positive amount in rupees.");
  const catRaw = b.ruleCategoryId;
  const ruleCategoryId = catRaw === "" || catRaw == null ? null : Number(catRaw);
  if (ruleCategoryId !== null && !Number.isInteger(ruleCategoryId)) refuse("Unknown category.");
  const position = Number.isInteger(Number(b.position)) ? Math.min(Math.max(Number(b.position), 0), 1000) : 0;
  const namePrefix = line(b.includeNamePrefix, 60) || null;
  if (namePrefix && namePrefix.length < 2) refuse("A name to match needs at least two letters.");
  return {
    includeNamePrefix: namePrefix,
    slug, title, tint,
    subtitle: line(b.subtitle, 80) || null,
    blurb: line(b.blurb, 300) || null,
    position,
    isActive: b.isActive !== false,
    ruleCategoryId,
    ruleSubcategories: [...new Set((Array.isArray(b.ruleSubcategories) ? b.ruleSubcategories : [])
      .map((s) => line(s, 60)).filter(Boolean))].slice(0, 20),
    rulePriceUnder: priceUnder,
    picks: [...new Set((Array.isArray(b.productIds) ? b.productIds : [])
      .map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500),
  };
}

/* The fields an audit entry compares, in the admin's terms. */
const auditView = (c) => c && ({
  slug: c.slug, title: c.title, subtitle: c.subtitle, blurb: c.blurb, tint: c.tint,
  position: c.position, isActive: c.is_active, ruleCategoryId: c.rule_category_id,
  ruleSubcategories: c.rule_subcategories || [], rulePriceUnder: c.rule_price_under,
  includeNamePrefix: c.include_name_prefix || null, productIds: c.picks,
});

const one = async (id) => (await list()).find((c) => c.id === Number(id)) || null;

/* Create (no id) or update, with its picks, in one transaction. An update
   works on the id throughout, so a collection deleted meanwhile is simply
   not found (404) rather than having its picks land elsewhere. */
async function save(input, id = null) {
  const d = clean(input);
  const before = id ? await one(id) : null;
  if (id && !before) return null;
  const subs = d.ruleSubcategories.length ? d.ruleSubcategories : null;
  try {
    await sql.transaction(id ? [
      sql`UPDATE collections SET slug = ${d.slug}, title = ${d.title}, subtitle = ${d.subtitle}, blurb = ${d.blurb},
              tint = ${d.tint}, position = ${d.position}, is_active = ${d.isActive},
              rule_category_id = ${d.ruleCategoryId}, rule_subcategories = ${subs}::text[],
              rule_price_under = ${d.rulePriceUnder}, include_name_prefix = ${d.includeNamePrefix}, updated_at = now()
            WHERE id = ${id}`,
      sql`DELETE FROM product_collections WHERE collection_id = ${id} AND product_id <> ALL(${d.picks}::bigint[])`,
      sql`INSERT INTO product_collections (product_id, collection_id)
          SELECT p.id, c.id FROM products p, collections c
           WHERE p.id = ANY(${d.picks}::bigint[]) AND c.id = ${id}
          ON CONFLICT DO NOTHING`,
    ] : [
      // A new collection: its picks find it by its (unique) slug.
      sql`INSERT INTO collections (slug, title, subtitle, blurb, tint, position, is_active,
                                   rule_category_id, rule_subcategories, rule_price_under, include_name_prefix)
          VALUES (${d.slug}, ${d.title}, ${d.subtitle}, ${d.blurb}, ${d.tint}, ${d.position}, ${d.isActive},
                  ${d.ruleCategoryId}, ${subs}::text[], ${d.rulePriceUnder}, ${d.includeNamePrefix})`,
      sql`INSERT INTO product_collections (product_id, collection_id)
          SELECT p.id, c.id FROM products p, collections c
           WHERE p.id = ANY(${d.picks}::bigint[]) AND c.slug = ${d.slug}
          ON CONFLICT DO NOTHING`,
    ]);
  } catch (e) {
    if (e.code === "23505") refuse("Another collection already uses that web address.");
    if (e.code === "23503") refuse("That category no longer exists.");
    throw e;
  }
  const after = id ? await one(id) : (await list()).find((c) => c.slug === d.slug);
  return after ? { before, after } : null;
}

async function remove(id) {
  const [row] = await sql`DELETE FROM collections WHERE id = ${id} RETURNING id, slug, title, is_active`;
  return row || null;
}

module.exports = { InputError, list, adminView, membersOf, matchesRules, save, remove, auditView };
