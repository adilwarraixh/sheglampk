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

/* ---------- settings ----------
   What the shop actually runs on. The checkout reads delivery charges and
   "Accept new orders" from here (lib/orders.js); the catalogue export hands
   the rest to the storefront build (db/export-catalogue.js), and saving
   triggers a rebuild so customers see the change. `fallback` applies when a
   setting has never been saved. */
const SETTING_KEYS = {
  free_shipping_over: { label: "Free delivery over (Rs.)", type: "number", min: 0, max: 1000000, fallback: 3500 },
  flat_shipping:      { label: "Delivery charge below that (Rs.)", type: "number", min: 0, max: 100000, fallback: 250 },
  return_days:        { label: "Return window (days)", type: "number", min: 0, max: 365, fallback: 7 },
  low_stock_default:  { label: "Low-stock warning for new products", type: "number", min: 0, max: 10000, fallback: 5 },
  contact_email:      { label: "Contact email (shown on the shop)", type: "email", max: 160, fallback: "hello@sheglampk.online" },
  contact_phone:      { label: "Contact phone (shown on the shop)", type: "text", max: 40, fallback: "+44 7862 614763" },
  whatsapp_number:    { label: "WhatsApp number, with country code", type: "phone", max: 20, fallback: "447862614763" },
  announcement:       { label: "Top announcement bar", type: "text", max: 200, fallback: "" },
  orders_enabled:     { label: "Accept new orders on the website", type: "boolean", fallback: true },
};

/* Every setting as the code uses it, with fallbacks filled in. One query. */
async function shopSettings() {
  const rows = await sql`SELECT key, value FROM settings`;
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const v = (k) => (stored[k] === undefined || stored[k] === null || stored[k] === "" ? SETTING_KEYS[k].fallback : stored[k]);
  return {
    freeShippingOver: Number(v("free_shipping_over")),
    flatShipping: Number(v("flat_shipping")),
    returnDays: Number(v("return_days")),
    lowStockDefault: Number(v("low_stock_default")),
    contactEmail: String(v("contact_email")),
    contactPhone: String(v("contact_phone")),
    whatsapp: String(v("whatsapp_number")).replace(/\D/g, ""),    // wa.me wants digits only
    announcement: String(v("announcement")),
    ordersEnabled: v("orders_enabled") !== false,
  };
}

/* The one place delivery is decided; the storefront mirrors it from the
   same settings, and the checkout refuses a total that disagrees. */
const shippingFor = (subtotal, s) => (subtotal === 0 || subtotal >= s.freeShippingOver ? 0 : s.flatShipping);

async function getSettings() {
  const rows = await sql`SELECT key, value, updated_at, updated_by FROM settings`;
  const stored = rows.reduce((m, r) => { m[r.key] = r; return m; }, {});
  return Object.keys(SETTING_KEYS).map((key) => ({
    key,
    ...SETTING_KEYS[key],
    /* A setting never saved shows the value the shop is actually using, so
       saving the form keeps it rather than writing blank, 0 or "off". */
    value: stored[key] ? stored[key].value : SETTING_KEYS[key].fallback,
    isSet: !!stored[key],
    updatedAt: stored[key] ? stored[key].updated_at : null,
    updatedBy: stored[key] ? stored[key].updated_by : null,
  }));
}

/* Every value is checked before anything is written, then all are saved in
   one transaction: a bad value leaves every setting as it was. Returns the
   settings whose value actually changed, with what they replaced. */
async function saveSettings(values, username) {
  const parsed = Object.keys(values || {}).map((key) => ({ key, value: parseSetting(key, values[key]) }));
  if (!parsed.length) return [];
  const res = await sql.transaction(parsed.map(({ key, value }) => sql`
    WITH old AS (SELECT value FROM settings WHERE key = ${key})
    INSERT INTO settings (key, value, updated_by) VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${username})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
                                    -- "last changed by" stays with whoever last changed THIS value
                                    updated_by = CASE WHEN settings.value = EXCLUDED.value THEN settings.updated_by ELSE EXCLUDED.updated_by END,
                                    updated_at = CASE WHEN settings.value = EXCLUDED.value THEN settings.updated_at ELSE now() END
    RETURNING (SELECT value FROM old) AS previous`));
  return parsed.map((p, i) => ({ ...p, previous: res[i][0] ? res[i][0].previous : null }))
    .filter((c) => JSON.stringify(c.previous) !== JSON.stringify(c.value));
}

function parseSetting(key, rawValue) {
  const def = SETTING_KEYS[key];
  if (!def) throw new Error("Unknown setting");   // never write an arbitrary key

  let value;
  if (def.type === "number") {
    // Blank is not zero: a cleared delivery charge must not quietly make delivery free.
    if (rawValue === "" || rawValue === null || rawValue === undefined || String(rawValue).trim() === "")
      throw new Error(`${def.label} needs a number.`);
    const n = Number(rawValue);
    if (!Number.isFinite(n)) throw new Error(`${def.label} must be a number.`);
    // Rupees, days and counts are whole numbers; a decimal would also break integer columns.
    value = Math.round(Math.min(Math.max(n, def.min), def.max));
  } else if (def.type === "boolean") {
    value = !!rawValue;
  } else if (def.type === "email") {
    value = String(rawValue == null ? "" : rawValue).trim().slice(0, def.max);
    // Printed into the shop's pages and mailto: links, so only plain address characters.
    if (value && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)) throw new Error(`${def.label}: that is not an email address.`);
  } else if (def.type === "phone") {
    /* Stored as international digits, which is what wa.me needs: "+92 300…",
       "0092 300…" and the local "0300…" all become 92300…. */
    value = String(rawValue == null ? "" : rawValue).replace(/\D/g, "").replace(/^00/, "").replace(/^0(?=3)/, "92");
    if (value && (value.length < 11 || value.length > 15 || value.startsWith("0")))
      throw new Error(`${def.label}: use the full international number, e.g. 923001234567.`);
  } else {
    value = String(rawValue == null ? "" : rawValue).trim().slice(0, def.max || 200);
  }
  return value;
}

module.exports = { heroSlides, saveHeroSlide, deleteHeroSlide, getSettings, saveSettings, shopSettings, shippingFor, SETTING_KEYS };
