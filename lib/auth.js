/* =========================================================
   lib/auth.js — password hashing, sessions, CSRF, throttling

   Security decisions worth knowing:

   · Passwords use scrypt (memory-hard). Never stored or logged in
     plaintext, never returned by any API, never sent to the browser.
   · The session cookie holds a random token; the database stores only
     its SHA-256. A leaked database therefore cannot be replayed as a
     live session.
   · The role is read from the database on every request. Nothing the
     browser sends can influence it — that is the privilege-escalation
     defence required by the brief.
   · Login failures are counted per username AND per IP, so guessing is
     throttled from either direction.
   ========================================================= */
const crypto = require("crypto");
const { sql } = require("../db/client.js");

/* ---------- password hashing ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(String(password).normalize("NFKC"), Buffer.from(salt, "hex"), SCRYPT.keylen, {
      N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024,
    })
    .toString("hex");
  return { salt, hash };
}

/* Constant-time compare: a wrong password must not be identifiable by
   how long the check took. */
function verifyPassword(password, saltHex, expectedHex) {
  try {
    const { hash } = hashPassword(password, saltHex);
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(expectedHex, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* Rejects the passwords that actually get broken, without being precious. */
const COMMON = [
  "password", "password1", "password123", "12345678", "123456789",
  "qwerty123", "admin123", "letmein", "welcome1", "sheglam", "sheglampk",
  "umama123", "ashba123", "adminadmin",
];

function checkStrength(password) {
  const p = String(password || "");
  const problems = [];
  if (p.length < 10) problems.push("must be at least 10 characters");
  if (!/[a-z]/i.test(p)) problems.push("needs at least one letter");
  if (!/[0-9]/.test(p)) problems.push("needs at least one number");
  if (COMMON.includes(p.toLowerCase())) problems.push("is too common — pick something unguessable");
  if (/^(.)\1+$/.test(p)) problems.push("cannot be one repeated character");
  return problems;
}

/* ---------- sessions ---------- */
const SESSION_COOKIE = "sgpk_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;          // 12 hours
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function createSession(userId, { ip, userAgent } = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  const csrf = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await sql`
    INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at)
    VALUES (${sha256(token)}, ${userId}, ${csrf}, ${ip || null}, ${(userAgent || "").slice(0, 300)}, ${expires})`;

  return { token, csrf, expires };
}

/* Resolves a cookie value to the live user. Returns null for anything
   expired, revoked, unknown, or belonging to a disabled account. */
async function getSession(token) {
  if (!token || typeof token !== "string" || token.length < 32) return null;

  const rows = await sql`
    SELECT s.token_hash, s.csrf_token, s.expires_at,
           u.id, u.username, u.display_name, u.role, u.status, u.must_change_password
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)}
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
    LIMIT 1`;

  if (!rows.length) return null;
  const r = rows[0];
  if (r.status !== "ACTIVE") return null;            // disabling locks out live sessions

  // Cheap keep-alive; not awaited on the critical path
  sql`UPDATE sessions SET last_seen_at = now() WHERE token_hash = ${r.token_hash}`.catch(() => {});

  return {
    user: {
      id: r.id, username: r.username, displayName: r.display_name,
      role: r.role, mustChangePassword: r.must_change_password,
    },
    csrf: r.csrf_token,
    expiresAt: r.expires_at,
  };
}

const revokeSession = (token) =>
  sql`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${sha256(token)}`;

const revokeAllSessions = (userId) =>
  sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;

const purgeExpiredSessions = () =>
  sql`DELETE FROM sessions WHERE expires_at < now() - interval '7 days'`;

/* ---------- cookie ---------- */
function sessionCookie(token, { secure = true, maxAgeMs = SESSION_TTL_MS } = {}) {
  // SameSite=Lax already blocks the cookie on cross-site POSTs, which is
  // the CSRF vector; the explicit token below is defence in depth.
  return [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    secure ? "Secure" : null,
  ].filter(Boolean).join("; ");
}

const clearCookie = ({ secure = true } = {}) =>
  `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;

function readCookie(header, name = SESSION_COOKIE) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/* ---------- login throttling ---------- */
const MAX_PER_USER = 5;
const MAX_PER_IP = 20;
const WINDOW = "15 minutes";

async function isThrottled(username, ip) {
  const [byUser] = await sql`
    SELECT count(*)::int AS n FROM login_attempts
    WHERE username = ${username} AND success = false
      AND created_at > now() - interval '15 minutes'`;
  if (byUser.n >= MAX_PER_USER) {
    return { throttled: true, reason: `Too many failed attempts. Try again in ${WINDOW}.` };
  }
  if (ip) {
    const [byIp] = await sql`
      SELECT count(*)::int AS n FROM login_attempts
      WHERE ip = ${ip} AND success = false
        AND created_at > now() - interval '15 minutes'`;
    if (byIp.n >= MAX_PER_IP) {
      return { throttled: true, reason: `Too many failed attempts from this network. Try again in ${WINDOW}.` };
    }
  }
  return { throttled: false };
}

const recordAttempt = (username, ip, success) =>
  sql`INSERT INTO login_attempts (username, ip, success) VALUES (${username || null}, ${ip || null}, ${success})`;

/* ---------- audit ---------- */
async function audit({ actorId = null, actorUsername, action, targetType = null, targetId = null, detail = {}, result = "SUCCESS", ip = null }) {
  try {
    await sql`
      INSERT INTO audit_logs (actor_user_id, actor_username, action, target_type, target_id, detail, result, ip)
      VALUES (${actorId}, ${actorUsername || "system"}, ${action}, ${targetType},
              ${targetId == null ? null : String(targetId)}, ${JSON.stringify(detail)}, ${result}, ${ip})`;
  } catch (e) {
    // Never let audit failure break the operation it was recording
    console.error("[audit] failed:", e.message);
  }
}

/* ---------- login ---------- */
/* Always returns the same message on failure, so an attacker cannot
   learn which usernames exist. */
const GENERIC = "Invalid username or password.";

async function login(rawUsername, password, { ip, userAgent } = {}) {
  const username = String(rawUsername || "").trim().toLowerCase();

  const t = await isThrottled(username, ip);
  if (t.throttled) {
    await audit({ actorUsername: username || "unknown", action: "LOGIN_THROTTLED", result: "DENIED", ip });
    return { ok: false, error: t.reason };
  }

  const rows = await sql`
    SELECT id, username, display_name, password_hash, password_salt, role, status, must_change_password
    FROM users WHERE username = ${username} LIMIT 1`;

  const user = rows[0];
  const passwordOk = user ? verifyPassword(password, user.password_salt, user.password_hash) : false;

  if (!user || !passwordOk) {
    await recordAttempt(username, ip, false);
    await audit({
      actorUsername: username || "unknown", action: "LOGIN_FAILED", result: "FAILURE", ip,
      detail: { reason: user ? "bad_password" : "unknown_user" },
    });
    return { ok: false, error: GENERIC };
  }

  if (user.status !== "ACTIVE") {
    await recordAttempt(username, ip, false);
    await audit({ actorId: user.id, actorUsername: username, action: "LOGIN_DISABLED_ACCOUNT", result: "DENIED", ip });
    return { ok: false, error: "This account has been disabled." };
  }

  await recordAttempt(username, ip, true);
  const session = await createSession(user.id, { ip, userAgent });
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
  await audit({ actorId: user.id, actorUsername: username, action: "LOGIN", ip });

  return {
    ok: true,
    session,
    user: {
      id: user.id, username: user.username, displayName: user.display_name,
      role: user.role, mustChangePassword: user.must_change_password,
    },
  };
}

module.exports = {
  SESSION_COOKIE, SESSION_TTL_MS,
  hashPassword, verifyPassword, checkStrength,
  createSession, getSession, revokeSession, revokeAllSessions, purgeExpiredSessions,
  sessionCookie, clearCookie, readCookie,
  isThrottled, recordAttempt, audit, login,
};
