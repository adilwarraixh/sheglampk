/* =========================================================
   lib/users-admin.js — Super Admin manages the other account

   Every function here is reachable only with users:manage, which only
   SUPER_ADMIN holds. On top of that:

     - nobody may act on their own account through this module, so a
       Super Admin cannot quietly promote or unlock themselves
     - the role of the last remaining SUPER_ADMIN cannot be changed and
       that account cannot be disabled, or the portal locks everybody out
     - passwords set here are temporary by construction: the target must
       replace theirs on next sign-in

   Password material never leaves this module. Resets return a one-time
   password to the caller once, and it is never stored in plain text or
   written to the audit detail.
   ========================================================= */
const { sql } = require("../db/client.js");
const auth = require("./auth.js");
const { AuthError } = require("./rbac.js");

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function tempPassword(len = 16) {
  const crypto = require("crypto");
  const bytes = crypto.randomBytes(len * 2);
  let out = "";
  for (let i = 0; out.length < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  if (!/[0-9]/.test(out)) out = out.slice(0, -1) + "7";
  return out;
}

async function listUsers() {
  return sql`
    SELECT u.id, u.username, u.display_name, u.role, u.status,
           u.must_change_password, u.last_login_at, u.password_changed_at, u.created_at,
           (SELECT count(*)::int FROM sessions s
             WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions
      FROM users u ORDER BY u.role, u.username`;
}

async function getUser(id) {
  const rows = await sql`
    SELECT id, username, display_name, role, status, must_change_password,
           last_login_at, password_changed_at, created_at
      FROM users WHERE id = ${id} LIMIT 1`;
  if (!rows.length) return null;
  const user = rows[0];
  user.sessions = await sql`
    SELECT id, ip, user_agent, created_at, expires_at
      FROM sessions WHERE user_id = ${id} AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC`;
  user.recentActivity = await sql`
    SELECT action, target_type, target_id, result, created_at
      FROM audit_logs WHERE actor_id = ${id} ORDER BY created_at DESC LIMIT 20`;
  return user;
}

/* Guards shared by every write below. */
async function assertActionable(actorId, targetId) {
  if (String(actorId) === String(targetId))
    throw new AuthError(403, "You cannot perform this action on your own account.");
  const rows = await sql`SELECT id, username, role, status FROM users WHERE id = ${targetId} LIMIT 1`;
  if (!rows.length) throw new AuthError(404, "That account does not exist.");
  return rows[0];
}

async function countActiveSuperAdmins(excludeId = null) {
  const [r] = await sql`
    SELECT count(*)::int n FROM users
     WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'
       AND (${excludeId}::bigint IS NULL OR id <> ${excludeId})`;
  return r.n;
}

async function setStatus(actorId, targetId, status) {
  if (!["ACTIVE", "DISABLED"].includes(status)) throw new AuthError(400, "Unknown account status.");
  const target = await assertActionable(actorId, targetId);

  if (status === "DISABLED" && target.role === "SUPER_ADMIN" && (await countActiveSuperAdmins(targetId)) === 0)
    throw new AuthError(400, "This is the only active Super Admin. Disabling it would lock everyone out.");

  const rows = await sql`
    UPDATE users SET status = ${status}::admin_status, updated_at = now()
     WHERE id = ${targetId} RETURNING id, username, status`;

  /* Disabling must end the account's live sessions immediately, or the
     person stays signed in until their cookie happens to expire. */
  if (status === "DISABLED") await auth.revokeAllSessions(targetId);
  return rows[0];
}

async function setRole(actorId, targetId, role) {
  if (!["SUPER_ADMIN", "ADMIN"].includes(role)) throw new AuthError(400, "Unknown role.");
  const target = await assertActionable(actorId, targetId);

  if (target.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN" && (await countActiveSuperAdmins(targetId)) === 0)
    throw new AuthError(400, "This is the only Super Admin. Demoting it would leave nobody able to manage the portal.");

  const rows = await sql`
    UPDATE users SET role = ${role}::admin_role, updated_at = now()
     WHERE id = ${targetId} RETURNING id, username, role`;

  /* The role is read from the database on every request, so an open
     session picks the change up on its next call — but revoking is
     clearer than leaving a stale nav on screen. */
  await auth.revokeAllSessions(targetId);
  return rows[0];
}

async function setDisplayName(actorId, targetId, displayName) {
  const name = String(displayName || "").trim().slice(0, 80);
  if (name.length < 2) throw new AuthError(400, "Display name is too short.");
  await assertActionable(actorId, targetId);
  const rows = await sql`
    UPDATE users SET display_name = ${name}, updated_at = now()
     WHERE id = ${targetId} RETURNING id, username, display_name`;
  return rows[0];
}

/* Returns the new password once. The caller shows it to the Super Admin
   and it is never persisted in readable form or logged. */
async function resetPassword(actorId, targetId) {
  const target = await assertActionable(actorId, targetId);
  const password = tempPassword();
  const { salt, hash } = auth.hashPassword(password);
  await sql`
    UPDATE users SET password_hash = ${hash}, password_salt = ${salt},
           must_change_password = true, password_changed_at = now(), updated_at = now()
     WHERE id = ${targetId}`;
  await auth.revokeAllSessions(targetId);
  return { id: target.id, username: target.username, password };
}

async function revokeSessions(actorId, targetId) {
  const target = await assertActionable(actorId, targetId);
  await auth.revokeAllSessions(targetId);
  return { id: target.id, username: target.username };
}

module.exports = { listUsers, getUser, setStatus, setRole, setDisplayName, resetPassword, revokeSessions };
