/* =========================================================
   lib/site-admin.js — homepage hero and store settings

   Both are Super Admin only (homepage:manage, settings:manage).

   Hero videos and posters are referenced by path, not uploaded through
   the portal — there is no upload endpoint yet, so a URL here is checked
   for shape and for being a same-origin path rather than trusted. That
   stops the field being used to point the homepage at someone else's
   server.
   ========================================================= */
const { sql } = require("../db/client.js");

/* ---------- hero ---------- */
const clean = (s, max = 500) => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t === "" ? null : t.slice(0, max);
};

/* A media path must stay on this site. An absolute URL to elsewhere would
   let the homepage load a third party's file, which is both a privacy leak
   for visitors and something we cannot keep working. */
function mediaPath(value, field) {
  const v = clean(value, 400);
  if (v === null) return null;
  if (/^https?:\/\//i.test(v) || v.startsWith("//"))
    throw new Error(`${field} must be a path on this site, e.g. assets/video/hero-1.mp4`);
  if (v.includes("..")) throw new Error(`${field} cannot contain ".."`);
  return v.replace(/^\/+/, "");
}

async function heroSlides() {
  return sql`
    SELECT id, position, is_enabled, eyebrow, headline, subtext,
           cta_label, cta_href, cta2_label, cta2_href,
           video_url, video_mobile_url, poster_url, updated_at
      FROM hero_slides ORDER BY position, id`;
}

async function saveHeroSlide(slide) {
  const headline = clean(slide.headline, 200);
  if (!headline) throw new Error("A slide needs a headline.");

  const fields = {
    position: Number.isFinite(+slide.position) ? Math.max(0, Math.min(+slide.position, 99)) : 0,
    is_enabled: slide.isEnabled !== false,
    eyebrow: clean(slide.eyebrow, 80),
    headline,
    subtext: clean(slide.subtext, 400),
    cta_label: clean(slide.ctaLabel, 60),
    cta_href: clean(slide.ctaHref, 300),
    cta2_label: clean(slide.cta2Label, 60),
    cta2_href: clean(slide.cta2Href, 300),
    video_url: mediaPath(slide.videoUrl, "Video"),
    video_mobile_url: mediaPath(slide.videoMobileUrl, "Mobile video"),
    poster_url: mediaPath(slide.posterUrl, "Poster"),
  };

  if (slide.id) {
    const rows = await sql`
      UPDATE hero_slides SET
        position = ${fields.position}, is_enabled = ${fields.is_enabled},
        eyebrow = ${fields.eyebrow}, headline = ${fields.headline}, subtext = ${fields.subtext},
        cta_label = ${fields.cta_label}, cta_href = ${fields.cta_href},
        cta2_label = ${fields.cta2_label}, cta2_href = ${fields.cta2_href},
        video_url = ${fields.video_url}, video_mobile_url = ${fields.video_mobile_url},
        poster_url = ${fields.poster_url}, updated_at = now()
       WHERE id = ${slide.id} RETURNING id, headline, is_enabled`;
    if (!rows.length) throw new Error("Slide not found");
    return rows[0];
  }

  const rows = await sql`
    INSERT INTO hero_slides
      (position, is_enabled, eyebrow, headline, subtext, cta_label, cta_href,
       cta2_label, cta2_href, video_url, video_mobile_url, poster_url)
    VALUES (${fields.position}, ${fields.is_enabled}, ${fields.eyebrow}, ${fields.headline},
            ${fields.subtext}, ${fields.cta_label}, ${fields.cta_href}, ${fields.cta2_label},
            ${fields.cta2_href}, ${fields.video_url}, ${fields.video_mobile_url}, ${fields.poster_url})
    RETURNING id, headline, is_enabled`;
  return rows[0];
}

async function deleteHeroSlide(id) {
  const [remaining] = await sql`SELECT count(*)::int n FROM hero_slides WHERE is_enabled`;
  const [target] = await sql`SELECT is_enabled FROM hero_slides WHERE id = ${id}`;
  if (!target) throw new Error("Slide not found");
  // The homepage hero is the first thing a visitor sees; never leave it blank.
  if (target.is_enabled && remaining.n <= 1)
    throw new Error("This is the only enabled slide. Add or enable another before removing it.");
  const rows = await sql`DELETE FROM hero_slides WHERE id = ${id} RETURNING id, headline`;
  return rows[0];
}

/* ---------- settings ---------- */
const SETTING_KEYS = {
  free_shipping_over: { label: "Free delivery over", type: "number", min: 0, max: 1000000 },
  flat_shipping:      { label: "Flat delivery charge", type: "number", min: 0, max: 100000 },
  return_days:        { label: "Return window (days)", type: "number", min: 0, max: 365 },
  low_stock_default:  { label: "Default low-stock threshold", type: "number", min: 0, max: 10000 },
  contact_email:      { label: "Contact email", type: "text", max: 160 },
  contact_phone:      { label: "Contact phone", type: "text", max: 40 },
  whatsapp_number:    { label: "WhatsApp number (country code, no +)", type: "text", max: 20 },
  announcement:       { label: "Top announcement bar", type: "text", max: 200 },
  orders_enabled:     { label: "Accept new orders", type: "boolean" },
};

async function getSettings() {
  const rows = await sql`SELECT key, value, updated_at, updated_by FROM settings`;
  const stored = rows.reduce((m, r) => { m[r.key] = r; return m; }, {});
  return Object.keys(SETTING_KEYS).map((key) => ({
    key,
    ...SETTING_KEYS[key],
    value: stored[key] ? stored[key].value : null,
    updatedAt: stored[key] ? stored[key].updated_at : null,
    updatedBy: stored[key] ? stored[key].updated_by : null,
  }));
}

async function saveSetting(key, rawValue, username) {
  const def = SETTING_KEYS[key];
  if (!def) throw new Error("Unknown setting");   // never write an arbitrary key

  let value;
  if (def.type === "number") {
    const n = Number(rawValue);
    if (!Number.isFinite(n)) throw new Error(`${def.label} must be a number.`);
    value = Math.min(Math.max(n, def.min), def.max);
  } else if (def.type === "boolean") {
    value = !!rawValue;
  } else {
    value = String(rawValue == null ? "" : rawValue).trim().slice(0, def.max || 200);
  }

  await sql`
    INSERT INTO settings (key, value, updated_by) VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${username})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  return { key, value };
}

module.exports = { heroSlides, saveHeroSlide, deleteHeroSlide, getSettings, saveSetting, SETTING_KEYS };
