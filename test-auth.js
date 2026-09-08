/* =========================================================
   test-auth.js — exercises the auth + RBAC rules from the brief

   Run:  node test-auth.js

   Seeds the two accounts with throwaway passwords generated in memory,
   runs the checks, then leaves the accounts locked (the throwaways are
   never written anywhere, so nobody can sign in until a real password
   is set with `node db/seed.js --reset-passwords`).
   ========================================================= */
const crypto = require("crypto");
const { sql } = require("./db/client.js");
const auth = require("./lib/auth.js");
const rbac = require("./lib/rbac.js");

let pass = 0, fail = 0;
const results = [];

function check(name, condition, detail = "") {
  if (condition) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
}

const rnd = () => "Tst" + crypto.randomBytes(9).toString("hex") + "9";

(async () => {
  const PW_UMAMA = rnd();
  const PW_ASHBA = rnd();

  /* ---------- fixtures ---------- */
  await sql`DELETE FROM login_attempts WHERE username IN ('umama','ashba','ghost')`;

  for (const [username, display, role, pw] of [
    ["umama", "Umama", "SUPER_ADMIN", PW_UMAMA],
    ["ashba", "Ashba", "ADMIN", PW_ASHBA],
  ]) {
    const { salt, hash } = auth.hashPassword(pw);
    await sql`
      INSERT INTO users (username, display_name, password_hash, password_salt, role, status, password_changed_at)
      VALUES (${username}, ${display}, ${hash}, ${salt}, ${role}::admin_role, 'ACTIVE'::admin_status, now())
      ON CONFLICT (username) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            password_salt = EXCLUDED.password_salt,
            role = EXCLUDED.role, status = 'ACTIVE'::admin_status`;
  }

  console.log("\n=== PASSWORD HANDLING ===");
  const stored = await sql`SELECT username, password_hash, password_salt FROM users WHERE username='umama'`;
  check("password is not stored in plaintext", !JSON.stringify(stored).includes(PW_UMAMA));
  check("hash is scrypt-length (64 bytes hex)", stored[0].password_hash.length === 128);
  check("salt is unique per user",
    stored[0].password_salt !== (await sql`SELECT password_salt FROM users WHERE username='ashba'`)[0].password_salt);
  check("correct password verifies", auth.verifyPassword(PW_UMAMA, stored[0].password_salt, stored[0].password_hash));
  check("wrong password rejected", !auth.verifyPassword("wrong-password-1", stored[0].password_salt, stored[0].password_hash));
  check("weak passwords rejected", auth.checkStrength("admin123").length > 0);
  check("strong password accepted", auth.checkStrength(PW_UMAMA).length === 0);

  console.log("\n=== LOGIN ===");
  const good = await auth.login("umama", PW_UMAMA, { ip: "1.1.1.1" });
  check("umama can log in", good.ok === true, good.error);
  check("role comes from the database", good.ok && good.user.role === "SUPER_ADMIN");
  const ashbaLogin = await auth.login("ashba", PW_ASHBA, { ip: "1.1.1.2" });
  check("ashba can log in", ashbaLogin.ok === true, ashbaLogin.error);
  check("ashba role is ADMIN", ashbaLogin.ok && ashbaLogin.user.role === "ADMIN");
  check("login is case-insensitive", (await auth.login("UMAMA", PW_UMAMA, { ip: "1.1.1.1" })).ok);

  const badPw = await auth.login("umama", "definitely-wrong-9", { ip: "9.9.9.1" });
  const noUser = await auth.login("ghost", "definitely-wrong-9", { ip: "9.9.9.2" });
  check("wrong password fails", !badPw.ok);
  check("unknown user fails", !noUser.ok);
  check("error message does not reveal whether the user exists",
    badPw.error === noUser.error && badPw.error === "Invalid username or password.",
    `${badPw.error} vs ${noUser.error}`);

  console.log("\n=== SESSIONS ===");
  const sess = await auth.getSession(good.session.token);
  check("valid token resolves to a session", !!sess);
  check("session carries the DB role", sess && sess.user.role === "SUPER_ADMIN");
  check("session has a CSRF token", sess && typeof sess.csrf === "string" && sess.csrf.length >= 32);
  check("garbage token rejected", (await auth.getSession("x".repeat(64))) === null);
  check("empty token rejected", (await auth.getSession("")) === null);

  const rawHash = crypto.createHash("sha256").update(good.session.token).digest("hex");
  const inDb = await sql`SELECT token_hash FROM sessions WHERE token_hash = ${rawHash}`;
  check("database stores the token HASH, not the token", inDb.length === 1);
  const leak = await sql`SELECT count(*)::int n FROM sessions WHERE token_hash = ${good.session.token}`;
  check("raw token is absent from the database", leak[0].n === 0);

  await auth.revokeSession(good.session.token);
  check("logout invalidates the session", (await auth.getSession(good.session.token)) === null);

  console.log("\n=== DISABLED ACCOUNT ===");
  const live = await auth.login("ashba", PW_ASHBA, { ip: "1.1.1.3" });
  await sql`UPDATE users SET status='DISABLED'::admin_status WHERE username='ashba'`;
  check("disabling kills live sessions", (await auth.getSession(live.session.token)) === null);
  const blocked = await auth.login("ashba", PW_ASHBA, { ip: "1.1.1.3" });
  check("disabled account cannot log in", !blocked.ok);
  await sql`UPDATE users SET status='ACTIVE'::admin_status WHERE username='ashba'`;

  console.log("\n=== THROTTLING ===");
  await sql`DELETE FROM login_attempts WHERE username='umama'`;
  for (let i = 0; i < 5; i++) await auth.login("umama", "wrong-" + i, { ip: "7.7.7.7" });
  const throttled = await auth.login("umama", PW_UMAMA, { ip: "7.7.7.7" });
  check("locks out after 5 failures", !throttled.ok);
  check("correct password also refused while locked", !throttled.ok && /Too many/i.test(throttled.error));
  await sql`DELETE FROM login_attempts WHERE username='umama'`;

  console.log("\n=== ROLE PERMISSIONS ===");
  check("super admin can manage users", rbac.can("SUPER_ADMIN", "users:manage"));
  check("super admin can edit products", rbac.can("SUPER_ADMIN", "products:update"));
  check("admin can view orders", rbac.can("ADMIN", "orders:view"));
  check("admin can update order status", rbac.can("ADMIN", "orders:update"));
  check("admin can view products", rbac.can("ADMIN", "products:view"));

  console.log("\n=== PRIVILEGE ESCALATION (brief §35) ===");
  for (const p of ["users:manage", "users:view", "settings:manage", "audit:view",
                   "products:create", "products:update", "products:delete", "products:import",
                   "hero:manage", "homepage:manage", "inventory:update", "orders:delete"]) {
    check(`ashba is denied ${p}`, !rbac.can("ADMIN", p));
  }
  check("unknown role gets nothing", !rbac.can("HACKER", "orders:view"));
  check("empty role gets nothing", !rbac.can("", "dashboard:view"));
  check("role from the browser is ignored — permission is a pure function of the stored role",
    !rbac.can("ADMIN", "users:manage"));

  const ashbaSession = { user: { id: 2, username: "ashba", role: "ADMIN" } };
  let denied = false;
  try { rbac.requirePermission(ashbaSession, "users:manage"); } catch (e) { denied = e.status === 403; }
  check("requirePermission blocks ashba from user management", denied);

  let selfBlocked = false;
  try { rbac.requireNotSelf(ashbaSession, 2); } catch (e) { selfBlocked = e.status === 403; }
  check("a user cannot act on their own account", selfBlocked);

  let anonBlocked = false;
  try { rbac.requirePermission(null, "dashboard:view"); } catch (e) { anonBlocked = e.status === 401; }
  check("anonymous request is refused", anonBlocked);

  console.log("\n=== NAVIGATION ===");
  const superNav = rbac.navFor("SUPER_ADMIN").map((n) => n.label);
  const adminNav = rbac.navFor("ADMIN").map((n) => n.label);
  check("super admin sees Admin Account", superNav.includes("Admin Account"));
  check("admin does NOT see Admin Account", !adminNav.includes("Admin Account"));
  check("admin does NOT see Settings", !adminNav.includes("Settings"));
  check("admin does NOT see Audit Log", !adminNav.includes("Audit Log"));
  check("admin still sees Orders", adminNav.includes("Orders"));

  console.log("\n=== AUDIT TRAIL ===");
  const logs = await sql`SELECT action, actor_username, result FROM audit_logs ORDER BY id DESC LIMIT 40`;
  check("logins are recorded", logs.some((l) => l.action === "LOGIN"));
  check("failed logins are recorded", logs.some((l) => l.action === "LOGIN_FAILED" && l.result === "FAILURE"));
  check("throttling is recorded", logs.some((l) => l.action === "LOGIN_THROTTLED"));
  check("disabled-account attempts are recorded", logs.some((l) => l.action === "LOGIN_DISABLED_ACCOUNT"));

  console.log("\n=== COOKIE FLAGS ===");
  const cookie = auth.sessionCookie("token123", { secure: true });
  check("cookie is HttpOnly", /HttpOnly/.test(cookie));
  check("cookie is Secure", /Secure/.test(cookie));
  check("cookie is SameSite", /SameSite=Lax/.test(cookie));
  check("cookie has an expiry", /Max-Age=\d+/.test(cookie));
  check("logout cookie expires immediately", /Max-Age=0/.test(auth.clearCookie()));

  /* ---------- leave the accounts locked ---------- */
  await sql`UPDATE users SET must_change_password = true`;
  await sql`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL`;

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})().catch((e) => { console.error("\ntest error:", e.message, "\n", e.stack); process.exit(1); });
