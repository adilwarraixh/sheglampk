/* =========================================================
   db/issue-temp-passwords.js — hand the accounts over safely

   Generates a strong random password for each admin, stores only its
   scrypt hash, and marks the account must_change_password. The plaintext
   is written to HANDOVER.txt (gitignored) and printed nowhere else, so it
   never reaches a chat log, a commit or a build.

   Each password is single use: the portal refuses every request except
   the password change until the owner sets their own.

   Run:  node db/issue-temp-passwords.js
   ========================================================= */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sql, describeTarget } = require("./client.js");
const auth = require("../lib/auth.js");

const OUT = path.join(__dirname, "..", "HANDOVER.txt");

/* Ambiguous characters removed — these get read off a screen and retyped. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function tempPassword(len = 16) {
  const bytes = crypto.randomBytes(len * 2);
  let out = "";
  for (let i = 0; out.length < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  // Guarantee it satisfies checkStrength regardless of what randomness gave us
  if (!/[0-9]/.test(out)) out = out.slice(0, -1) + "7";
  if (!/[a-z]/i.test(out)) out = "a" + out.slice(1);
  return out;
}

(async () => {
  console.log(`\nTarget: ${describeTarget()}`);

  const users = await sql`SELECT id, username, display_name, role FROM users ORDER BY username`;
  if (!users.length) {
    console.error("\n✗ No admin accounts exist yet. Run: node db/seed.js\n");
    process.exit(1);
  }

  const issued = [];
  for (const u of users) {
    const pw = tempPassword();
    const { salt, hash } = auth.hashPassword(pw);

    await sql`
      UPDATE users
         SET password_hash = ${hash}, password_salt = ${salt},
             must_change_password = true, password_changed_at = now()
       WHERE id = ${u.id}`;

    // Kill every existing session so an old cookie cannot outlive the reset
    await auth.revokeAllSessions(u.id);

    await auth.audit({
      actorUsername: "system", action: "TEMP_PASSWORD_ISSUED",
      targetType: "user", targetId: String(u.id),
      detail: { username: u.username },
    });

    issued.push({ ...u, pw });
  }

  const body = [
    "SHEGLAM PK — admin portal handover",
    `Issued ${new Date().toISOString()}`,
    "",
    "These passwords are TEMPORARY and single use. Signing in with one",
    "forces an immediate password change; nothing else in the portal works",
    "until that is done. Give each person only their own line, in person or",
    "through a password manager — not over email or WhatsApp.",
    "",
    "Delete this file once both accounts have set their own passwords.",
    "",
    ...issued.map((u) =>
      `  ${u.display_name} (${u.role === "SUPER_ADMIN" ? "Super Admin" : "Admin"})\n` +
      `    username: ${u.username}\n` +
      `    password: ${u.pw}\n`
    ),
    "Sign in at: <your-site>/admin/login",
    "",
  ].join("\n");

  fs.writeFileSync(OUT, body, { encoding: "utf8" });

  console.log(`\n✓ Temporary passwords issued for: ${issued.map((u) => u.username).join(", ")}`);
  console.log("  All existing sessions revoked.");
  console.log(`  Written to HANDOVER.txt (gitignored) — not printed here on purpose.\n`);
})().catch((e) => { console.error("\n✗", e.message, "\n"); process.exit(1); });
