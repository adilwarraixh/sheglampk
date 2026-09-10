/* =========================================================
   lib/order-emails.js — what the order emails say, and getting them sent

   Two separate messages, and they must stay separate:

     admin_new_order        → the shop. Everything needed to fulfil,
                              including the customer's contact details
                              and a link into the admin portal.
     customer_confirmation  → the customer. What they bought and what
                              happens next. No internal notes, no admin
                              link, no other customer's anything.

   Delivery model: the email_notifications row IS the queue. Sending is
   attempted inline right after the order commits, and a failure only
   marks the row — the order is already saved and visible in the portal.
   Anything still pending or failed is picked up by the retry sweep.

   The unique index on (order_id, type) is what makes this idempotent: a
   double submit, a retry or a redelivery cannot create a second
   notification row, so the shop cannot be emailed twice about one order.
   ========================================================= */
const { sql } = require("../db/client.js");
const mailer = require("./mailer.js");

const money = (n, currency = "PKR") =>
  (currency === "PKR" ? "Rs. " : currency + " ") +
  Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const esc = (s) => String(s === null || s === undefined ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const when = (d) => new Date(d).toLocaleString("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

/* Table layout and inline styles throughout: Outlook ignores <style>
   blocks and most flexbox, so anything clever here breaks in the one
   client the shop is most likely to read it in. */
function shell(title, bodyHtml) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f6f6f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#171717;">
${bodyHtml}
</table>
</td></tr></table>
</body></html>`;
}

const header = (heading, sub) => `
<tr><td style="background:#171717;padding:22px 26px;">
  <div style="font-size:19px;font-weight:700;color:#ffffff;letter-spacing:.5px;">SHEGLAM<span style="color:#e83e70;">.PK</span></div>
</td></tr>
<tr><td style="padding:26px 26px 6px;">
  <div style="font-size:21px;font-weight:700;">${esc(heading)}</div>
  ${sub ? `<div style="font-size:14px;color:#6f6f6f;margin-top:5px;">${esc(sub)}</div>` : ""}
</td></tr>`;

const row = (label, value) => `
<tr>
  <td style="padding:5px 0;font-size:13.5px;color:#6f6f6f;width:150px;vertical-align:top;">${esc(label)}</td>
  <td style="padding:5px 0;font-size:13.5px;">${value}</td>
</tr>`;

const section = (title, inner) => `
<tr><td style="padding:18px 26px 0;">
  <div style="font-size:12px;font-weight:700;letter-spacing:.8px;color:#8a8a8a;text-transform:uppercase;padding-bottom:8px;border-bottom:1px solid #e9e9ec;">${esc(title)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">${inner}</table>
</td></tr>`;

function itemsTable(items, currency) {
  const head = `
    <tr style="background:#f6f6f7;">
      <th align="left"  style="padding:9px 10px;font-size:11.5px;color:#6f6f6f;text-transform:uppercase;letter-spacing:.5px;">Product</th>
      <th align="center" style="padding:9px 6px;font-size:11.5px;color:#6f6f6f;text-transform:uppercase;">Qty</th>
      <th align="right" style="padding:9px 10px;font-size:11.5px;color:#6f6f6f;text-transform:uppercase;">Total</th>
    </tr>`;
  const body = items.map((i) => `
    <tr>
      <td style="padding:11px 10px;font-size:13.5px;border-top:1px solid #e9e9ec;">
        <b>${esc(i.product_name)}</b>
        ${i.variant_name ? `<div style="color:#6f6f6f;font-size:12.5px;">${esc(i.variant_name)}</div>` : ""}
        ${i.sku ? `<div style="color:#8a8a8a;font-size:11.5px;">SKU ${esc(i.sku)}</div>` : ""}
        <div style="color:#8a8a8a;font-size:12px;">${esc(money(i.unit_price, currency))} each</div>
      </td>
      <td align="center" style="padding:11px 6px;font-size:13.5px;border-top:1px solid #e9e9ec;">${i.quantity}</td>
      <td align="right" style="padding:11px 10px;font-size:13.5px;border-top:1px solid #e9e9ec;white-space:nowrap;">${esc(money(i.line_total, currency))}</td>
    </tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${head}${body}</table>`;
}

function totalsTable(o) {
  const c = o.currency || "PKR";
  const line = (l, v, strong) => `
    <tr>
      <td style="padding:4px 0;font-size:${strong ? "15px" : "13.5px"};${strong ? "font-weight:700;" : "color:#6f6f6f;"}">${esc(l)}</td>
      <td align="right" style="padding:4px 0;font-size:${strong ? "15px" : "13.5px"};${strong ? "font-weight:700;" : ""}white-space:nowrap;">${esc(v)}</td>
    </tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${line("Subtotal", money(o.subtotal, c))}
    ${Number(o.discount) ? line("Discount", "− " + money(o.discount, c)) : ""}
    ${line("Delivery", Number(o.shipping_fee) ? money(o.shipping_fee, c) : "Free")}
    ${Number(o.tax_amount) ? line("Tax", money(o.tax_amount, c)) : ""}
    <tr><td colspan="2" style="border-top:2px solid #171717;padding-top:6px;"></td></tr>
    ${line("Total", money(o.total, c), true)}
  </table>`;
}

const addressBlock = (o) => [
  o.customer_name, o.shipping_address, o.shipping_city, o.shipping_state,
  o.shipping_postal_code, o.shipping_country,
].filter(Boolean).map(esc).join("<br>");

/* ---------- admin notification ---------- */
function adminEmail(order, items, adminUrl) {
  const c = order.currency || "PKR";
  const link = adminUrl ? `${adminUrl.replace(/\/$/, "")}/admin/orders?open=${order.id}` : null;

  const html = shell(`New order ${order.reference}`, `
    ${header("New order received", `${order.reference} · ${when(order.placed_at)}`)}
    ${link ? `<tr><td style="padding:14px 26px 0;">
      <a href="${esc(link)}" style="display:inline-block;background:#e83e70;color:#ffffff;text-decoration:none;
        padding:11px 22px;border-radius:8px;font-size:14px;font-weight:600;">View order in the admin portal</a>
    </td></tr>` : ""}

    ${section("Customer", `
      ${row("Name", esc(order.customer_name))}
      ${row("Phone", `<a href="tel:${esc(order.customer_phone)}" style="color:#e83e70;text-decoration:none;">${esc(order.customer_phone)}</a>`)}
      ${row("Email", order.customer_email ? `<a href="mailto:${esc(order.customer_email)}" style="color:#e83e70;text-decoration:none;">${esc(order.customer_email)}</a>` : "—")}
    `)}

    ${section("Delivery address", `<tr><td style="font-size:13.5px;line-height:1.7;">${addressBlock(order)}</td></tr>
      ${order.customer_note ? row("Customer note", esc(order.customer_note)) : ""}`)}

    <tr><td style="padding:18px 26px 0;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.8px;color:#8a8a8a;text-transform:uppercase;padding-bottom:8px;border-bottom:1px solid #e9e9ec;">Items</div>
    </td></tr>
    <tr><td style="padding:8px 26px 0;">${itemsTable(items, c)}</td></tr>
    <tr><td style="padding:14px 26px 0;">${totalsTable(order)}</td></tr>

    ${section("Order", `
      ${row("Status", `<b>${esc(order.status)}</b>`)}
      ${row("Payment", esc(order.payment_method))}
      ${row("Payment status", esc(order.payment_status))}
    `)}

    <tr><td style="padding:22px 26px 26px;">
      <div style="background:#f6f6f7;border-radius:8px;padding:13px 15px;font-size:13px;color:#6f6f6f;">
        This order is saved in the database and is already visible in the admin portal.
        Nothing needs to be re-entered.
      </div>
    </td></tr>`);

  const text = [
    `NEW ORDER — ${order.reference}`,
    when(order.placed_at), "",
    `Customer: ${order.customer_name}`,
    `Phone:    ${order.customer_phone}`,
    `Email:    ${order.customer_email || "—"}`, "",
    "Deliver to:",
    [order.shipping_address, order.shipping_city, order.shipping_state, order.shipping_postal_code, order.shipping_country].filter(Boolean).join(", "),
    order.customer_note ? `Note: ${order.customer_note}` : "", "",
    "Items:",
    ...items.map((i) => `  ${i.quantity} x ${i.product_name}${i.variant_name ? " (" + i.variant_name + ")" : ""} — ${money(i.line_total, c)}`),
    "",
    `Subtotal: ${money(order.subtotal, c)}`,
    Number(order.discount) ? `Discount: -${money(order.discount, c)}` : "",
    `Delivery: ${Number(order.shipping_fee) ? money(order.shipping_fee, c) : "Free"}`,
    Number(order.tax_amount) ? `Tax: ${money(order.tax_amount, c)}` : "",
    `TOTAL:    ${money(order.total, c)}`, "",
    `Payment:  ${order.payment_method} (${order.payment_status})`,
    `Status:   ${order.status}`, "",
    link ? `Open in admin: ${link}` : "",
    "This order is already saved in the admin portal.",
  ].filter((l) => l !== "").join("\n");

  return { subject: `New Order Received — ${order.reference}`, html, text };
}

/* ---------- customer confirmation ---------- */
function customerEmail(order, items, siteUrl) {
  const c = order.currency || "PKR";
  const track = siteUrl ? `${siteUrl.replace(/\/$/, "")}/track-order.html` : null;

  const html = shell(`Your order ${order.reference}`, `
    ${header("Thank you for your order", `Order ${order.reference} · ${when(order.placed_at)}`)}
    <tr><td style="padding:8px 26px 0;font-size:14px;line-height:1.65;">
      Hi ${esc(order.customer_name.split(" ")[0] || order.customer_name)}, we have received your order
      and will confirm it on WhatsApp shortly.
    </td></tr>

    <tr><td style="padding:18px 26px 0;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.8px;color:#8a8a8a;text-transform:uppercase;padding-bottom:8px;border-bottom:1px solid #e9e9ec;">What you ordered</div>
    </td></tr>
    <tr><td style="padding:8px 26px 0;">${itemsTable(items, c)}</td></tr>
    <tr><td style="padding:14px 26px 0;">${totalsTable(order)}</td></tr>

    ${section("Delivering to", `<tr><td style="font-size:13.5px;line-height:1.7;">${addressBlock(order)}</td></tr>
      ${row("Phone", esc(order.customer_phone))}`)}

    ${section("Payment", `
      ${row("Method", esc(order.payment_method))}
      <tr><td colspan="2" style="padding-top:6px;font-size:13px;color:#6f6f6f;">
        Pay the courier in cash when your parcel arrives. We never ask for payment in advance.
      </td></tr>`)}

    <tr><td style="padding:20px 26px 26px;">
      <div style="background:#fdf4f7;border-radius:8px;padding:14px 16px;font-size:13.5px;line-height:1.7;">
        <b>What happens next</b><br>
        We confirm your order on WhatsApp, dispatch within 1–2 working days, and send you a tracking
        number once the courier collects it.
        ${track ? `<br><br><a href="${esc(track)}" style="color:#e83e70;">Track your order</a> using reference <b>${esc(order.reference)}</b>.` : ""}
      </div>
      <div style="font-size:12px;color:#8a8a8a;margin-top:14px;line-height:1.6;">
        SHEGLAM PK is an independent stockist of genuine SHEGLAM products in Pakistan.
      </div>
    </td></tr>`);

  const text = [
    `Thank you for your order, ${order.customer_name}.`, "",
    `Order reference: ${order.reference}`,
    `Placed: ${when(order.placed_at)}`, "",
    "What you ordered:",
    ...items.map((i) => `  ${i.quantity} x ${i.product_name}${i.variant_name ? " (" + i.variant_name + ")" : ""} — ${money(i.line_total, c)}`),
    "",
    `Subtotal: ${money(order.subtotal, c)}`,
    `Delivery: ${Number(order.shipping_fee) ? money(order.shipping_fee, c) : "Free"}`,
    `TOTAL:    ${money(order.total, c)}`, "",
    "Delivering to:",
    [order.shipping_address, order.shipping_city, order.shipping_state, order.shipping_postal_code, order.shipping_country].filter(Boolean).join(", "),
    "",
    `Payment: ${order.payment_method}. Pay the courier when the parcel arrives — we never ask for payment in advance.`,
    "",
    "We confirm on WhatsApp and dispatch within 1-2 working days.",
    track ? `Track: ${track} (reference ${order.reference})` : "",
  ].filter((l) => l !== "").join("\n");

  return { subject: `Your SHEGLAM PK order — ${order.reference}`, html, text };
}

/* ---------- queue ---------- */
async function loadOrder(orderId) {
  const rows = await sql`SELECT * FROM orders WHERE id = ${orderId} LIMIT 1`;
  if (!rows.length) return null;
  const order = rows[0];
  order.items = await sql`
    SELECT product_name, variant_name, sku, unit_price, quantity, line_total
      FROM order_items WHERE order_id = ${orderId} ORDER BY id`;
  return order;
}

/* Creates the notification rows for an order. ON CONFLICT DO NOTHING
   against the (order_id, type) unique index is the idempotency: calling
   this twice for one order adds nothing the second time. */
async function queueForOrder(orderId, { customerEmail: toCustomer } = {}) {
  const c = mailer.config();
  const wanted = [{ type: "admin_new_order", recipient: c.adminRecipient }];
  if (toCustomer && mailer.isEmail(toCustomer))
    wanted.push({ type: "customer_confirmation", recipient: toCustomer });

  for (const w of wanted) {
    await sql`
      INSERT INTO email_notifications (order_id, type, recipient, status)
      VALUES (${orderId}, ${w.type}, ${w.recipient}, 'PENDING')
      ON CONFLICT (order_id, type) DO NOTHING`;
  }
  return sql`SELECT id, type, recipient, status FROM email_notifications WHERE order_id = ${orderId}`;
}

/* Attempts one notification. Never throws: the caller is usually the
   checkout, and a mail problem must not surface as a failed order. */
async function attempt(notificationId) {
  const rows = await sql`SELECT * FROM email_notifications WHERE id = ${notificationId} LIMIT 1`;
  if (!rows.length) return { ok: false, error: "Notification not found" };
  const n = rows[0];
  if (n.status === "SENT") return { ok: true, alreadySent: true };

  // Claim it, so two concurrent sweeps cannot both send the same one.
  const claimed = await sql`
    UPDATE email_notifications SET status = 'SENDING', attempt_count = attempt_count + 1,
           last_attempt_at = now(), updated_at = now()
     WHERE id = ${notificationId} AND status <> 'SENDING' AND status <> 'SENT'
     RETURNING id, attempt_count`;
  if (!claimed.length) return { ok: false, error: "Already being sent" };

  const order = await loadOrder(n.order_id);
  if (!order) {
    await sql`UPDATE email_notifications SET status='FAILED', error_message='Order no longer exists', updated_at=now() WHERE id=${notificationId}`;
    return { ok: false, error: "Order no longer exists" };
  }

  const c = mailer.config();
  const built = n.type === "customer_confirmation"
    ? customerEmail(order, order.items, c.adminUrl)
    : adminEmail(order, order.items, c.adminUrl);

  try {
    const result = await mailer.send({
      to: n.recipient, subject: built.subject, html: built.html, text: built.text,
      replyTo: n.type === "admin_new_order" ? (order.customer_email || undefined) : undefined,
    });

    if (result.skipped) {
      await sql`
        UPDATE email_notifications SET status='SKIPPED', subject=${built.subject},
               provider='none', error_message=${result.reason}, updated_at=now()
         WHERE id=${notificationId}`;
      return { ok: false, skipped: true, reason: result.reason };
    }

    await sql`
      UPDATE email_notifications SET status='SENT', subject=${built.subject},
             provider=${result.provider}, provider_message_id=${result.messageId},
             sent_at=now(), error_message=NULL, updated_at=now()
       WHERE id=${notificationId}`;
    return { ok: true, provider: result.provider, messageId: result.messageId };
  } catch (e) {
    /* Back off, and stop retrying once max_attempts is reached so a
       permanently bad address does not retry forever. */
    const attemptNo = claimed[0].attempt_count;
    const delayMinutes = Math.min(60, Math.pow(3, attemptNo));
    const message = String(e.message || "Send failed").slice(0, 500);
    await sql`
      UPDATE email_notifications
         SET status = CASE WHEN attempt_count >= max_attempts THEN 'FAILED' ELSE 'PENDING' END::notification_status,
             subject = ${built.subject}, error_message = ${message},
             next_attempt_at = now() + (${delayMinutes} || ' minutes')::interval, updated_at = now()
       WHERE id = ${notificationId}`;
    return { ok: false, error: message, willRetry: attemptNo < n.max_attempts };
  }
}

/* Fire-and-forget: queue, then try to send, and swallow everything. */
async function notifyNewOrder(orderId, customerEmailAddress) {
  try {
    const rows = await queueForOrder(orderId, { customerEmail: customerEmailAddress });
    const results = [];
    for (const r of rows) {
      if (r.status === "SENT") continue;
      results.push({ type: r.type, ...(await attempt(r.id)) });
    }
    return results;
  } catch (e) {
    console.error("[notify] could not queue order notifications:", e.message);
    return [];
  }
}

/* Everything due, oldest first. Called by the retry endpoint. */
async function sendDue({ limit = 20 } = {}) {
  const due = await sql`
    SELECT id FROM email_notifications
     WHERE status IN ('PENDING','FAILED','SKIPPED')
       AND attempt_count < max_attempts
       AND next_attempt_at <= now()
     ORDER BY created_at LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)}`;
  const results = [];
  for (const d of due) results.push({ id: d.id, ...(await attempt(d.id)) });
  return results;
}

async function forOrder(orderId) {
  return sql`
    SELECT id, type, recipient, status, provider, provider_message_id, attempt_count,
           max_attempts, sent_at, last_attempt_at, error_message, created_at
      FROM email_notifications WHERE order_id = ${orderId} ORDER BY type`;
}

/* Explicit admin resend: clears the attempt budget so a previously
   exhausted notification can go again. */
async function resend(orderId, type) {
  const rows = await sql`
    UPDATE email_notifications
       SET status='PENDING', attempt_count=0, next_attempt_at=now(), error_message=NULL, updated_at=now()
     WHERE order_id=${orderId} AND type=${type} RETURNING id`;
  if (!rows.length) throw new Error("There is no notification of that type for this order.");
  return attempt(rows[0].id);
}

module.exports = {
  adminEmail, customerEmail, queueForOrder, attempt, notifyNewOrder,
  sendDue, forOrder, resend, loadOrder,
};
