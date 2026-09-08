/* =========================================================
   db/client.js — the single place a database connection is made

   Uses Neon's HTTP driver, which suits serverless: no pooling to
   manage, no sockets left open between invocations.

   DATABASE_URL is read from the environment only. It is never
   written into a tracked file and never reaches the browser.
   ========================================================= */
const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

/* Load .env.local when running locally. On Vercel the variables are
   already in process.env, so this is a no-op there. */
function loadLocalEnv() {
  const file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadLocalEnv();

const URL = process.env.DATABASE_URL;
if (!URL) {
  throw new Error(
    "DATABASE_URL is not set.\n" +
    "  Local : copy .env.example to .env.local and fill it in\n" +
    "  Vercel: Settings → Environment Variables"
  );
}

/* Tagged-template query. Interpolated values are sent as bound
   parameters, so `sql`SELECT … WHERE id = ${id}`` cannot be injected. */
const sql = neon(URL);

/* Human-readable target, safe to log — credentials stripped. */
function describeTarget() {
  try {
    const u = new global.URL(URL);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/* The HTTP driver above only accepts tagged templates — which is what we
   want for application queries, because values are always bound rather
   than concatenated. Migrations need to send arbitrary DDL text, so they
   use a real Postgres client over WebSocket instead. Nothing outside
   db/migrate.js should use this. */
async function rawClient() {
  const { Client, neonConfig } = require("@neondatabase/serverless");
  if (!neonConfig.webSocketConstructor && typeof WebSocket !== "undefined") {
    neonConfig.webSocketConstructor = WebSocket;   // Node 22+ ships one
  }
  const client = new Client(URL);
  await client.connect();
  return client;
}

module.exports = { sql, describeTarget, rawClient };
