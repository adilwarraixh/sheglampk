/* =========================================================
   lib/inbox.js — what customers send the shop

   Newsletter sign-ups, contact messages and product reviews. These used to
   post to a third-party form service that was never configured, so every
   one was lost while the customer was told it had arrived. They are now
   stored (migration 008) and shown in the admin portal's Inbox.

   Everything here is public input: lengths are capped, emails checked, and
   a review is never shown on the shop until an admin approves it. Nothing
   a customer sends can mark a review as a verified purchase.
   ========================================================= */
const { sql } = require("../db/client.js");

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PK_MOBILE = /^(\+92|0)?3\d{2}[\s-]?\d{7}$/;
const ORDER_REF = /^SG-\d{4}-[A-Z0-9]{5}$/;
// NUL is dropped: Postgres cannot store it, and no person types one.
const line = (s, max) => String(s == null ? "" : s).replace(/\0/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const block = (s, max) => String(s == null ? "" : s).replace(/\0/g, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

class InputError extends Error {}
const refuse = (m) => { throw new InputError(m); };

/* ---------- public ---------- */
async function subscribe(rawEmail, source) {
  const email = line(rawEmail, 160).toLowerCase();
  if (!EMAIL.test(email)) refuse("Please enter a valid email address.");
  // Where they signed up: a page path, nothing else (it ends up in a CSV export).
  const src = line(source, 80);
  const safeSource = /^[\w\/.-]{1,80}$/.test(src) ? src : null;
  // Signing up again after unsubscribing is a fresh yes.
  const [r] = await sql`
    INSERT INTO subscribers (email, source) VALUES (${email}, ${safeSource})
    ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL
    RETURNING (xmax = 0) AS created`;
  return { email, created: r.created };
}

async function saveContact(input) {
  const name = line(input.name, 80), email = line(input.email, 160).toLowerCase();
  const phone = line(input.phone, 20), message = block(input.message, 4000);
  if (name.length < 2) refuse("Please enter your name.");
  if (!EMAIL.test(email)) refuse("Please enter a valid email address.");
  if (phone && !PK_MOBILE.test(phone.replace(/\s/g, ""))) refuse("Enter a valid mobile number, or leave it blank.");
  if (message.length < 10) refuse("Please tell us a bit more.");
  const [row] = await sql`
    INSERT INTO contact_messages (name, email, phone, message)
    VALUES (${name}, ${email}, ${phone || null}, ${message})
    RETURNING id, name, email, phone, message, created_at`;
  return row;
}

async function submitReview(input) {
  const slug = line(input.slug, 120);
  const [product] = await sql`
    SELECT p.id, p.name, (SELECT array_agg(variant_name) FROM product_variants v
                            WHERE v.product_id = p.id AND v.is_available) AS shades
      FROM products p WHERE p.slug = ${slug} AND p.status = 'PUBLISHED' LIMIT 1`;
  if (!product) refuse("That product is not on sale any more.");

  const name = line(input.name, 60), text = block(input.text, 2000);
  const rating = Number(input.rating);
  const shade = line(input.shade, 120);
  const ref = line(input.orderReference, 20).toUpperCase();
  if (name.length < 2) refuse("Please add your name.");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) refuse("Please choose a rating from 1 to 5.");
  if (text.length < 10) refuse("Please write a few words about the product.");
  // Only a shade the product actually has; anything else is dropped rather than shown.
  const shadeOk = shade && (product.shades || []).some((s) => s.toLowerCase() === shade.toLowerCase());
  if (ref && !ORDER_REF.test(ref)) refuse("Your order reference looks like SG-2610-AB3CD. Leave it blank if you do not have it.");

  const [row] = await sql`
    INSERT INTO reviews (product_id, product_slug, author_name, rating, shade, body, order_reference)
    VALUES (${product.id}, ${slug}, ${name}, ${rating}, ${shadeOk ? shade : null}, ${text}, ${ref || null})
    RETURNING id, product_slug, author_name, rating, shade, body, order_reference, created_at`;
  return { ...row, product_name: product.name };
}

/* ---------- admin ---------- */
const page = (limit, offset, def = 50) => ({
  limit: Math.min(Math.max(parseInt(limit, 10) || def, 1), 200),
  offset: Math.max(parseInt(offset, 10) || 0, 0),
});

async function counts() {
  const [c] = await sql`
    SELECT (SELECT count(*) FROM contact_messages WHERE handled_at IS NULL)::int AS open_messages,
           (SELECT count(*) FROM reviews WHERE status = 'PENDING')::int AS pending_reviews,
           (SELECT count(*) FROM subscribers WHERE unsubscribed_at IS NULL)::int AS subscribers`;
  return c;
}

async function listMessages({ show = "open", limit, offset } = {}) {
  const p = page(limit, offset);
  const all = show === "all";
  const rows = await sql`
    SELECT id, name, email, phone, message, created_at, handled_at, handled_by, count(*) OVER () AS total_count
      FROM contact_messages
     WHERE (${all} OR handled_at IS NULL)
     ORDER BY created_at DESC LIMIT ${p.limit} OFFSET ${p.offset}`;
  return { messages: rows.map(({ total_count, ...r }) => r), total: rows.length ? Number(rows[0].total_count) : 0, ...p };
}

async function setHandled(id, handled, username) {
  const [row] = await sql`
    UPDATE contact_messages
       SET handled_at = CASE WHEN ${!!handled} THEN coalesce(handled_at, now()) END,
           handled_by = CASE WHEN ${!!handled} THEN coalesce(handled_by, ${username}) END
     WHERE id = ${id} RETURNING id, name, handled_at`;
  return row || null;
}

const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

async function listReviews({ status = "PENDING", limit, offset } = {}) {
  const p = page(limit, offset);
  const st = REVIEW_STATUSES.includes(status) ? status : null;
  const rows = await sql`
    SELECT r.id, r.product_slug, p.name AS product_name, r.author_name, r.rating, r.shade, r.body,
           r.order_reference, r.status, r.verified, r.created_at, r.reviewed_at, r.reviewed_by,
           -- the order the reference points at, if it exists and is for this product
           (SELECT o.status::text FROM orders o JOIN order_items i ON i.order_id = o.id
             WHERE o.reference = r.order_reference AND i.product_id = r.product_id LIMIT 1) AS order_status,
           count(*) OVER () AS total_count
      FROM reviews r LEFT JOIN products p ON p.id = r.product_id
     WHERE (${st}::text IS NULL OR r.status = ${st}::review_status)
     ORDER BY r.created_at DESC LIMIT ${p.limit} OFFSET ${p.offset}`;
  return { reviews: rows.map(({ total_count, ...r }) => r), total: rows.length ? Number(rows[0].total_count) : 0, ...p };
}

/* Approve, reject or put back to pending; optionally mark verified. Returns
   whether the shop's pages change, so the caller can rebuild only then. */
async function moderateReview(id, { status, verified }, username) {
  if (status !== undefined && !REVIEW_STATUSES.includes(status)) refuse("Unknown review status.");
  const [row] = await sql`
    WITH old AS (SELECT status, verified FROM reviews WHERE id = ${id})
    UPDATE reviews SET
      status   = coalesce(${status || null}::review_status, status),
      verified = coalesce(${verified === undefined ? null : !!verified}::boolean, verified),
      reviewed_at = now(), reviewed_by = ${username}
     WHERE id = ${id}
    RETURNING id, product_slug, author_name, status, verified,
              (SELECT status FROM old) AS previous_status, (SELECT verified FROM old) AS previous_verified,
              EXISTS (SELECT 1 FROM products p WHERE p.id = reviews.product_id AND p.status = 'PUBLISHED') AS on_shop`;
  if (!row) return null;
  // Reviews only show on published products; a change to any other needs no rebuild.
  const shown = (s) => s === "APPROVED";
  row.shopChanges = row.on_shop && (shown(row.status) !== shown(row.previous_status)
    || (shown(row.status) && row.verified !== row.previous_verified));
  return row;
}

async function subscribersCsv() {
  const rows = await sql`
    SELECT email, source, created_at FROM subscribers WHERE unsubscribed_at IS NULL ORDER BY created_at`;
  /* Opened in Excel, a cell starting = + - @ (or a tab/CR) runs as a
     formula. These values come from the public form, so such a cell is
     prefixed with ' to keep it text. */
  const q = (v) => {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return ["email,source,signed_up"].concat(rows.map((r) => [r.email, r.source, new Date(r.created_at).toISOString()].map(q).join(","))).join("\n");
}

/* Approved reviews for the shop, keyed by the product's slug as it is now,
   in the shape data/catalog.js already renders. Joined by product id, so a
   renamed product keeps its reviews, and a deleted product's never pass to
   a new one that happens to get the same slug. */
async function approvedReviews() {
  const rows = await sql`
    SELECT p.slug, r.author_name, r.rating, r.shade, r.body, r.verified, r.created_at
      FROM reviews r JOIN products p ON p.id = r.product_id
     WHERE r.status = 'APPROVED' ORDER BY r.created_at DESC`;
  const out = {};
  for (const r of rows) {
    (out[r.slug] = out[r.slug] || []).push({
      a: r.author_name, r: r.rating, s: r.shade || "", t: r.body,
      d: new Date(r.created_at).toISOString().slice(0, 10), v: r.verified ? 1 : 0,
    });
  }
  return out;
}

module.exports = {
  InputError, subscribe, saveContact, submitReview,
  counts, listMessages, setHandled, listReviews, moderateReview, subscribersCsv, approvedReviews,
  REVIEW_STATUSES,
};
