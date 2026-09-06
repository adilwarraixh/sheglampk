/* =========================================================
   SHEGLAM PK — admin authentication

   Shared by admin-server.js and set-admin-password.js.
   Zero dependencies: password hashing uses Node's built-in
   scrypt, which is a real password KDF (deliberately slow and
   memory-hard), not a plain hash like SHA-256.

   The password itself is never stored — only a random salt and
   the scrypt output. data/admin-auth.json must never be
   committed or deployed.
   ========================================================= */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const AUTH_FILE = path.join(__dirname, "data", "admin-auth.json");

/* scrypt cost. N=16384 takes roughly 100ms here — slow enough to
   make guessing expensive, fast enough that logging in feels instant. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hash(password, saltHex) {
  return crypto
    .scryptSync(String(password).normalize("NFKC"), Buffer.from(saltHex, "hex"), SCRYPT.keylen, {
      N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
      maxmem: 256 * 1024 * 1024,
    })
    .toString("hex");
}

function exists() {
  return fs.existsSync(AUTH_FILE);
}

function load() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")); } catch { return null; }
}

function save(username, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const record = {
    username: String(username || "admin").trim() || "admin",
    salt,
    hash: hash(password, salt),
    algo: "scrypt",
    params: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keylen: SCRYPT.keylen },
    updated: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(record, null, 2), "utf8");
  try { fs.chmodSync(AUTH_FILE, 0o600); } catch { /* best effort on Windows */ }
  return record;
}

/* The username is not a secret, so a plain compare is fine there. The
   password comparison is constant-time so a wrong guess cannot be
   narrowed down by how long the check takes. */
function verify(username, password) {
  const rec = load();
  if (!rec) return false;

  let passOk = false;
  try {
    const candidate = Buffer.from(hash(password, rec.salt), "hex");
    const stored = Buffer.from(rec.hash, "hex");
    passOk = candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  } catch {
    passOk = false;
  }

  return String(username || "") === String(rec.username) && passOk;
}

/* Rejects the passwords that actually get broken, without being precious. */
const COMMON = [
  "password", "password1", "12345678", "123456789", "qwerty123", "admin123",
  "letmein", "welcome1", "iloveyou", "sheglam", "sheglampk", "adminadmin",
];

function checkStrength(password) {
  const p = String(password || "");
  const problems = [];
  if (p.length < 10) problems.push("must be at least 10 characters");
  if (!/[a-z]/i.test(p)) problems.push("needs at least one letter");
  if (!/[0-9]/.test(p)) problems.push("needs at least one number");
  if (COMMON.includes(p.toLowerCase())) problems.push("is too common — pick something unguessable");
  if (/^(.)\1+$/.test(p)) problems.push("cannot be the same character repeated");
  return problems;
}

module.exports = { AUTH_FILE, exists, load, save, verify, checkStrength, hash };
