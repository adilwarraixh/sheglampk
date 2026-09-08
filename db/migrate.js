/* =========================================================
   db/migrate.js — apply pending SQL migrations, in order, once each

   Run:  node db/migrate.js
         node db/migrate.js --status   (show what is applied, change nothing)

   Migrations live in db/migrations/NNN_name.sql and run in filename
   order. Each is recorded in schema_migrations with a checksum, so an
   already-applied file that later changes is reported rather than
   silently ignored.
   ========================================================= */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sql, describeTarget, rawClient } = require("./client.js");

const DIR = path.join(__dirname, "migrations");
const STATUS_ONLY = process.argv.includes("--status");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

/* Neon's HTTP driver sends one statement per call, so split the file.
   This is a deliberately simple splitter: it tracks $$ …$$ bodies so
   PL/pgSQL blocks (which contain semicolons) are not cut in half. */
/* Does this chunk contain real SQL, or only comments and blank lines?
   A chunk usually opens with the section comment that preceded it, so
   testing the first characters would wrongly discard the statement. */
function hasSql(chunk) {
  return chunk
    .split("\n")
    .map((l) => l.replace(/--.*$/, "").trim())
    .some((l) => l.length > 0);
}

function splitStatements(text) {
  const out = [];
  let buf = "";
  let inDollar = false;

  for (const line of text.split("\n")) {
    const stripped = line.replace(/--.*$/, "");
    const dollars = (stripped.match(/\$\$/g) || []).length;
    if (dollars % 2 === 1) inDollar = !inDollar;

    buf += line + "\n";

    if (!inDollar && /;\s*$/.test(stripped)) {
      if (hasSql(buf)) out.push(buf.trim());
      buf = "";
    }
  }
  if (hasSql(buf)) out.push(buf.trim());
  return out;
}

(async () => {
  console.log(`\nMigrations → ${describeTarget()}\n`);

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`;

  const applied = new Map(
    (await sql`SELECT name, checksum FROM schema_migrations`).map((r) => [r.name, r.checksum])
  );

  const files = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
    : [];

  if (!files.length) { console.log("  no migration files found\n"); return; }

  let ran = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(DIR, file), "utf8");
    const checksum = sha(text);

    if (applied.has(file)) {
      const drifted = applied.get(file) !== checksum;
      console.log(`  ${drifted ? "!" : "·"} ${file}  ${drifted ? "ALREADY APPLIED but the file has changed since" : "already applied"}`);
      if (drifted) {
        console.log(`      Editing an applied migration does not re-run it. Add a new`);
        console.log(`      migration file instead, or reset the database.`);
      }
      continue;
    }

    if (STATUS_ONLY) { console.log(`  + ${file}  PENDING`); continue; }

    const statements = splitStatements(text);
    process.stdout.write(`  → ${file}  (${statements.length} statements) `);

    /* One transaction per file: a migration either lands completely or
       not at all, so a failure halfway cannot leave a partial schema. */
    const client = await rawClient();
    try {
      await client.query("BEGIN");
      for (const stmt of statements) await client.query(stmt);
      await client.query("COMMIT");
      await sql`INSERT INTO schema_migrations (name, checksum) VALUES (${file}, ${checksum})`;
      console.log("ok");
      ran++;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      console.log("FAILED (rolled back)");
      console.error(`\n  ${file} failed:\n  ${e.message}\n`);
      process.exit(1);
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (STATUS_ONLY) { console.log("\n  (status only — nothing was applied)\n"); return; }

  const tables = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  console.log(`\n✓ ${ran} migration(s) applied`);
  console.log(`  tables now: ${tables.length}`);
  console.log(`  ${tables.map((t) => t.tablename).join(", ")}\n`);
})().catch((e) => { console.error("\nmigration error:", e.message, "\n"); process.exit(1); });
