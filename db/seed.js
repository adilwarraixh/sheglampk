/* =========================================================
   db/seed.js — create exactly the two admin accounts

   Run:  node db/seed.js

   Passwords are read from the environment, hashed with scrypt, and the
   plaintext is discarded. It is never written to a file, a log, the
   database, or any API response.

   Required environment variables:
     SEED_UMAMA_PASSWORD
     SEED_ASHBA_PASSWORD

   Set them in .env.local for local use, and in Vercel → Settings →
   Environment Variables for production. Re-running is safe: existing
   accounts are left alone unless --reset-passwords is passed.
   ========================================================= */
const { sql, describeTarget } = require("./client.js");
const { hashPassword, checkStrength, audit } = require("../lib/auth.js");

const RESET = process.argv.includes("--reset-passwords");

const ACCOUNTS = [
  { username: "umama", displayName: "Umama", role: "SUPER_ADMIN", envVar: "SEED_UMAMA_PASSWORD" },
  { username: "ashba", displayName: "Ashba", role: "ADMIN",       envVar: "SEED_ASHBA_PASSWORD" },
];

(async () => {
  console.log(`\nSeeding admin accounts → ${describeTarget()}\n`);

  /* Fail before touching anything if the inputs are unusable. */
  const problems = [];
  for (const a of ACCOUNTS) {
    const pw = process.env[a.envVar];
    if (!pw) { problems.push(`${a.envVar} is not set`); continue; }
    const weak = checkStrength(pw);
    if (weak.length) problems.push(`${a.envVar} ${weak.join(", and ")}`);
  }
  if (problems.length) {
    console.error("Cannot seed:\n");
    problems.forEach((p) => console.error("  ✗ " + p));
    console.error(`
  Set them and run again. For example, in .env.local:

    SEED_UMAMA_PASSWORD=<a strong password>
    SEED_ASHBA_PASSWORD=<a different strong password>

  At least 10 characters, with a letter and a number.
  Do not commit that file — .env.local is gitignored.
`);
    process.exit(1);
  }

  for (const a of ACCOUNTS) {
    const password = process.env[a.envVar];
    const existing = await sql`SELECT id, role, status FROM users WHERE username = ${a.username} LIMIT 1`;

    if (existing.length && !RESET) {
      console.log(`  · ${a.username.padEnd(6)} already exists (${existing[0].role}) — left unchanged`);
      continue;
    }

    const { salt, hash } = hashPassword(password);

    if (existing.length) {
      await sql`
        UPDATE users
        SET password_hash = ${hash}, password_salt = ${salt},
            password_changed_at = now(), must_change_password = false
        WHERE id = ${existing[0].id}`;
      await audit({
        actorUsername: "system", action: "SEED_PASSWORD_RESET",
        targetType: "user", targetId: existing[0].id, detail: { username: a.username },
      });
      console.log(`  ↻ ${a.username.padEnd(6)} password reset`);
    } else {
      const [row] = await sql`
        INSERT INTO users (username, display_name, password_hash, password_salt, role, status, password_changed_at)
        VALUES (${a.username}, ${a.displayName}, ${hash}, ${salt}, ${a.role}::admin_role, 'ACTIVE'::admin_status, now())
        RETURNING id`;
      await audit({
        actorUsername: "system", action: "SEED_USER_CREATED",
        targetType: "user", targetId: row.id, detail: { username: a.username, role: a.role },
      });
      console.log(`  + ${a.username.padEnd(6)} created as ${a.role}`);
    }
  }

  /* The brief allows exactly these two accounts. Flag anything else. */
  const all = await sql`SELECT username, role, status FROM users ORDER BY role, username`;
  console.log(`\n  accounts now (${all.length}):`);
  all.forEach((u) => console.log(`    ${u.username.padEnd(8)} ${u.role.padEnd(12)} ${u.status}`));

  const unexpected = all.filter((u) => !ACCOUNTS.some((a) => a.username === u.username));
  if (unexpected.length) {
    console.log(`\n  ⚠ unexpected account(s): ${unexpected.map((u) => u.username).join(", ")}`);
    console.log(`    The brief specifies only umama and ashba.`);
  }

  const supers = all.filter((u) => u.role === "SUPER_ADMIN" && u.status === "ACTIVE");
  if (supers.length !== 1) {
    console.log(`\n  ⚠ expected exactly one active SUPER_ADMIN, found ${supers.length}`);
  }

  console.log(`\n✓ done. Passwords were hashed and the plaintext discarded.\n`);
})().catch((e) => { console.error("\nseed failed:", e.message, "\n"); process.exit(1); });
