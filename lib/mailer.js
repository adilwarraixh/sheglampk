/* =========================================================
   lib/mailer.js — sending mail, whichever provider is configured

   Chosen by environment, never by anything the browser sends:

     MAIL_PROVIDER=resend   RESEND_API_KEY=...        (HTTP, best on Vercel)
     MAIL_PROVIDER=brevo    BREVO_API_KEY=...         (HTTP)
     MAIL_PROVIDER=smtp     SMTP_HOST/PORT/USER/PASSWORD
     MAIL_PROVIDER=none     records the attempt, sends nothing (the default)

   "none" is the default on purpose. An unconfigured shop must still take
   orders — the notification is recorded as SKIPPED and can be sent later
   once a provider exists, rather than the checkout failing.

   SMTP is implemented directly over TLS rather than pulling in a mail
   library, because the project has no build step and one dependency for
   this is not worth it. It speaks enough of RFC 5321 to authenticate and
   send: EHLO, AUTH LOGIN, MAIL FROM, RCPT TO, DATA.

   Credentials are read from the environment at call time and never
   logged, never stored, and never returned to a caller.
   ========================================================= */
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");

const env = (k, fallback = "") => (process.env[k] || fallback).trim();

function config() {
  const provider = (env("MAIL_PROVIDER") || "none").toLowerCase();
  return {
    provider,
    from: env("SMTP_FROM") || env("MAIL_FROM") || "SHEGLAM PK <no-reply@sheglampk.online>",
    adminRecipient: env("ORDER_NOTIFICATION_EMAIL") || "sheglamofficialpk@gmail.com",
    adminUrl: env("ADMIN_BASE_URL") || env("SITE_BASE_URL") || "",
    resendKey: env("RESEND_API_KEY"),
    brevoKey: env("BREVO_API_KEY"),
    smtp: {
      host: env("SMTP_HOST"),
      port: parseInt(env("SMTP_PORT", "587"), 10),
      user: env("SMTP_USER"),
      password: env("SMTP_PASSWORD"),
      secure: env("SMTP_SECURE", "").toLowerCase() === "true" || parseInt(env("SMTP_PORT", "587"), 10) === 465,
    },
  };
}

/* Is a provider actually usable? Reported to the admin UI so a missing
   key is visible rather than showing up as silent non-delivery. */
function status() {
  const c = config();
  const ready =
    (c.provider === "resend" && !!c.resendKey) ||
    (c.provider === "brevo" && !!c.brevoKey) ||
    (c.provider === "smtp" && !!c.smtp.host && !!c.smtp.user);
  return {
    provider: c.provider,
    ready,
    recipient: c.adminRecipient,
    from: c.from,
    // Names only. Never the values.
    missing: ready ? [] : missingKeys(c),
  };
}

function missingKeys(c) {
  if (c.provider === "none") return ["MAIL_PROVIDER"];
  if (c.provider === "resend") return c.resendKey ? [] : ["RESEND_API_KEY"];
  if (c.provider === "brevo") return c.brevoKey ? [] : ["BREVO_API_KEY"];
  if (c.provider === "smtp") {
    return ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"].filter((k) => !env(k));
  }
  return ["MAIL_PROVIDER"];
}

/* ---------- address helpers ---------- */
const parseAddress = (s) => {
  const m = String(s || "").match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].replace(/^"|"$/g, ""), email: m[2] } : { name: "", email: String(s || "").trim() };
};

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());

/* ---------- providers ---------- */
async function sendViaResend(c, msg) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${c.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: c.from, to: [msg.to], subject: msg.subject,
      html: msg.html, text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(providerError(body, res.status));
  return { messageId: body.id || null, provider: "resend" };
}

async function sendViaBrevo(c, msg) {
  const from = parseAddress(c.from);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": c.brevoKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { email: from.email, name: from.name || undefined },
      to: [{ email: msg.to }],
      subject: msg.subject, htmlContent: msg.html, textContent: msg.text,
      ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(providerError(body, res.status));
  return { messageId: body.messageId || null, provider: "brevo" };
}

/* Keeps provider wording but strips anything that could echo a secret. */
function providerError(body, statusCode) {
  const raw = (body && (body.message || body.error || body.code)) || `HTTP ${statusCode}`;
  return String(raw).slice(0, 300).replace(/[A-Za-z0-9_\-]{32,}/g, "[redacted]");
}

/* ---------- SMTP ---------- */
function smtpSend(c, msg) {
  return new Promise((resolve, reject) => {
    const { host, port, user, password, secure } = c.smtp;
    let socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buffer = "";
    let stage = 0;
    let upgraded = false;
    let settled = false;
    const messageId = `<${crypto.randomUUID()}@${parseAddress(c.from).email.split("@")[1] || "sheglampk.online"}>`;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      try { socket.end(); } catch { /* already closed */ }
      err ? reject(err) : resolve(value);
    };

    const timer = setTimeout(() => finish(new Error("SMTP timed out")), 20000);
    const write = (line) => socket.write(line + "\r\n");

    const steps = [
      () => write(`EHLO ${parseAddress(c.from).email.split("@")[1] || "localhost"}`),
      () => (secure || upgraded ? write("AUTH LOGIN") : write("STARTTLS")),
      () => write(Buffer.from(user).toString("base64")),
      () => write(Buffer.from(password).toString("base64")),
      () => write(`MAIL FROM:<${parseAddress(c.from).email}>`),
      () => write(`RCPT TO:<${msg.to}>`),
      () => write("DATA"),
      () => { socket.write(buildMime(c, msg, messageId)); write("."); },
      () => write("QUIT"),
    ];

    const onLine = (line) => {
      const code = parseInt(line.slice(0, 3), 10);
      // Multi-line replies use "250-"; wait for the final "250 ".
      if (line[3] === "-") return;

      if (code >= 400) {
        // Never surface the raw line: it can contain the auth exchange.
        return finish(new Error(`SMTP refused the message (code ${code})`));
      }

      if (stage === 1 && !secure && !upgraded && code === 220) {
        // STARTTLS accepted: upgrade and start again from EHLO.
        const plain = socket;
        socket = tls.connect({ socket: plain, servername: host }, () => {
          upgraded = true; stage = 0; buffer = "";
          socket.setEncoding("utf8");
          socket.on("data", onData);
          socket.on("error", (e) => finish(new Error("SMTP connection failed")));
          write(`EHLO ${parseAddress(c.from).email.split("@")[1] || "localhost"}`);
          stage = 1;
        });
        return;
      }

      if (stage >= steps.length) { clearTimeout(timer); return finish(null, { messageId, provider: "smtp" }); }
      steps[stage]();
      stage++;
    };

    const onData = (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        onLine(line);
      }
    };

    socket.setEncoding("utf8");
    socket.on("data", onData);
    socket.on("error", () => finish(new Error("Could not reach the mail server")));
    socket.on("close", () => { if (!settled) finish(new Error("Mail server closed the connection")); });
  });
}

/* Headers and a multipart body. Lines beginning with "." are escaped, or
   a description containing one would end the DATA section early. */
function buildMime(c, msg, messageId) {
  const boundary = "sgpk-" + crypto.randomBytes(12).toString("hex");
  const enc = (s) => `=?UTF-8?B?${Buffer.from(String(s)).toString("base64")}?=`;
  const dotStuff = (s) => String(s).replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");

  return [
    `From: ${c.from}`,
    `To: ${msg.to}`,
    `Subject: ${enc(msg.subject)}`,
    msg.replyTo ? `Reply-To: ${msg.replyTo}` : null,
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuff(msg.text),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuff(msg.html),
    "",
    `--${boundary}--`,
    "",
  ].filter((l) => l !== null).join("\r\n");
}

/* ---------- the one entry point ---------- */
async function send(msg) {
  const c = config();
  if (!isEmail(msg.to)) throw new Error("That is not a valid email address.");
  if (!msg.subject || !msg.html) throw new Error("The message is missing a subject or body.");

  if (c.provider === "none") {
    // Deliberately not an error: the order must still succeed.
    return { skipped: true, provider: "none", messageId: null,
             reason: "No mail provider configured (set MAIL_PROVIDER)." };
  }
  if (c.provider === "resend") { if (!c.resendKey) throw new Error("RESEND_API_KEY is not set."); return sendViaResend(c, msg); }
  if (c.provider === "brevo")  { if (!c.brevoKey)  throw new Error("BREVO_API_KEY is not set.");  return sendViaBrevo(c, msg); }
  if (c.provider === "smtp") {
    if (!c.smtp.host || !c.smtp.user || !c.smtp.password) throw new Error("SMTP is not fully configured.");
    return smtpSend(c, msg);
  }
  throw new Error(`Unknown MAIL_PROVIDER "${c.provider}".`);
}

module.exports = { send, status, config, isEmail, parseAddress };
