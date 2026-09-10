/* =========================================================
   db/mail-test.js — check the mail configuration, then send a real email

   Run:  node db/mail-test.js              (send to ORDER_NOTIFICATION_EMAIL)
         node db/mail-test.js you@example.com

   Reports what is configured, what is missing, and what the provider
   actually said. Never prints a key — only whether one is present and
   how long it is.
   ========================================================= */
require("../db/client.js");            // loads .env.local when running locally
const mailer = require("../lib/mailer.js");

const present = (name) => {
  const v = (process.env[name] || "").trim();
  return v ? `set (${v.length} chars)` : "NOT SET";
};

(async () => {
  const status = mailer.status();

  console.log("\n=== Mail configuration ===");
  console.log(`  MAIL_PROVIDER            ${process.env.MAIL_PROVIDER || "(not set — defaults to none)"}`);
  console.log(`  RESEND_API_KEY           ${present("RESEND_API_KEY")}`);
  console.log(`  BREVO_API_KEY            ${present("BREVO_API_KEY")}`);
  console.log(`  SMTP_HOST                ${process.env.SMTP_HOST || "NOT SET"}`);
  console.log(`  SMTP_USER                ${present("SMTP_USER")}`);
  console.log(`  SMTP_PASSWORD            ${present("SMTP_PASSWORD")}`);
  console.log(`  SMTP_FROM                ${process.env.SMTP_FROM || "(not set — using the default)"}`);
  console.log(`  ORDER_NOTIFICATION_EMAIL ${status.recipient}`);
  console.log(`  ADMIN_BASE_URL           ${process.env.ADMIN_BASE_URL || "(not set — the email will have no admin link)"}`);

  console.log("\n=== Status ===");
  console.log(`  provider : ${status.provider}`);
  console.log(`  ready    : ${status.ready ? "yes" : "no"}`);
  if (!status.ready) {
    console.log(`  missing  : ${status.missing.join(", ")}`);
    console.log("\n  Nothing will be sent until those are set.");
    console.log("  Orders still work — notifications are recorded and can be sent later.\n");
    process.exit(1);
  }

  const to = process.argv[2] || status.recipient;
  console.log(`\n=== Sending a test email to ${to} ===`);

  const stamp = new Date().toLocaleString("en-GB");
  try {
    const result = await mailer.send({
      to,
      subject: `SHEGLAM PK — mail test (${stamp})`,
      html: `<!doctype html><html><body style="margin:0;background:#f6f6f7;padding:24px;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
          <tr><td style="background:#171717;padding:20px 24px;color:#fff;font-weight:700;font-size:18px;">
            SHEGLAM<span style="color:#e83e70;">.PK</span></td></tr>
          <tr><td style="padding:24px;color:#171717;">
            <h1 style="font-size:19px;margin:0 0 10px;">Mail is working</h1>
            <p style="font-size:14px;line-height:1.65;margin:0 0 14px;">
              If you are reading this, order notifications will reach this inbox.</p>
            <p style="font-size:13px;color:#6f6f6f;line-height:1.7;margin:0;">
              Provider: ${status.provider}<br>
              From: ${status.from}<br>
              Sent: ${stamp}
            </p>
          </td></tr>
        </table></body></html>`,
      text: `SHEGLAM PK — mail test\n\nIf you are reading this, order notifications will reach this inbox.\n\nProvider: ${status.provider}\nFrom: ${status.from}\nSent: ${stamp}\n`,
    });

    if (result.skipped) {
      console.log(`  Not sent: ${result.reason}\n`);
      process.exit(1);
    }
    console.log(`  ✓ Accepted by ${result.provider}`);
    if (result.messageId) console.log(`    message id: ${result.messageId}`);
    console.log(`\n  Check ${to} — including spam, for the first one.`);
    console.log("  If it does not arrive, the provider's dashboard will say why.\n");
  } catch (e) {
    console.error(`\n  ✗ ${e.message}\n`);
    console.error("  Common causes:");
    console.error("    - the sending domain is not verified yet with the provider");
    console.error("    - SMTP_FROM is an address the provider will not let you send from");
    console.error("    - the API key was revoked, or belongs to a different account");
    console.error("    - for Gmail SMTP: an App Password is required, not the account password\n");
    process.exit(1);
  }
})();
