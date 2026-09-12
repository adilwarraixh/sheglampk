/* =========================================================
   test-helpers.js — keep the suites from disturbing real accounts

   The suites run against the live database, and they have to set known
   passwords to exercise login. These are the accounts somebody actually
   signs into, so every suite snapshots the credential columns before it
   starts and puts them back afterwards.

   That keeps both properties:
     - a test run leaves no usable credential behind, because the
       passwords it set are discarded with the rows they were written to
     - the password the owner chose still works when they next sign in

   An account created during a run has no snapshot, so it is given an
   unrecoverable value rather than being left with a known one.
   ========================================================= */
const crypto = require("crypto");
const path = require("path");

const ROOT = __dirname.split(String.fromCharCode(92)).join("/");
const { sql } = require(ROOT + "/db/client.js");
const auth = require(ROOT + "/lib/auth.js");

async function snapshotCredentials() {
  const users = await sql`SELECT id, password_hash, password_salt, must_change_password FROM users`;
  /* Sessions opened from now on belong to the run. Remembered on the
     snapshot so restore can end those and leave a real admin signed in. */
  const [{ now }] = await sql`SELECT now() AS now`;
  users.startedAt = now;
  return users;
}

async function restoreCredentials(snapshot) {
  const byId = new Map((snapshot || []).map((u) => [String(u.id), u]));
  for (const u of await sql`SELECT id FROM users`) {
    const prior = byId.get(String(u.id));
    if (prior) {
      await sql`
        UPDATE users SET password_hash = ${prior.password_hash},
                         password_salt = ${prior.password_salt},
                         must_change_password = ${prior.must_change_password}
         WHERE id = ${u.id}`;
    } else {
      const { salt, hash } = auth.hashPassword(crypto.randomBytes(32).toString("hex"));
      await sql`
        UPDATE users SET password_hash = ${hash}, password_salt = ${salt},
                         must_change_password = true WHERE id = ${u.id}`;
    }
  }
  // Sessions opened during the run are not the owner's; end those — only
  // those — so running the tests does not sign a real admin out.
  if (snapshot && snapshot.startedAt) {
    await sql`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND created_at >= ${snapshot.startedAt}`;
  } else {
    await sql`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL`;
  }
  await sql`DELETE FROM login_attempts`;
}

module.exports = { snapshotCredentials, restoreCredentials };
