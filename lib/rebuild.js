/* =========================================================
   lib/rebuild.js — bring the live shop up to date after a change

   Product pages, grids and the homepage are static HTML generated from
   the database at build time. Saving in the portal changes the database
   at once, but customers only see the change after the site is rebuilt.
   This asks Vercel for that rebuild through a Deploy Hook, whose URL is
   kept in the DEPLOY_HOOK_URL environment variable.

   Saves come in bursts — a dozen stock edits in a minute — so requests
   coalesce: while a requested build has not yet read the catalogue, it
   will pick up any further change anyway, and no second build is
   started. db/export-catalogue.js stamps exported_at as a production
   build begins reading, which is what closes that window.

   Nothing here throws. A failed rebuild request must never fail the save
   that caused it; the result says what happened so the portal can tell
   the admin the truth.
   ========================================================= */
const { sql } = require("../db/client.js");

/* A build that was asked for but never read the catalogue — refused by
   Vercel, or failed before the export — must not swallow every later
   request, so a pending request expires. */
const PENDING_MINUTES = 10;

/* After a build has read the catalogue it still has to finish and go
   live, which takes about a minute. */
const PUBLISH_SECONDS = 120;

function hookUrl() {
  const url = String(process.env.DEPLOY_HOOK_URL || "").trim();
  if (/^https:\/\/\S+$/i.test(url)) return url;
  // The test suite stands in for Vercel with a local server.
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/\S*$/i.test(url)) return url;
  return null;
}

const configured = () => !!hookUrl();

/* The hook URL is a credential — anyone holding it can deploy the site —
   so it never appears in an error message or a log line. */
async function callHook(url, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchImpl(url, { method: "POST", signal: ctrl.signal });
    return res.ok ? { ok: true } : { ok: false, error: `Vercel refused the rebuild (HTTP ${res.status})` };
  } catch (e) {
    return { ok: false, error: e && e.name === "AbortError" ? "Vercel did not answer in time" : "Could not reach Vercel" };
  } finally {
    clearTimeout(timer);
  }
}

async function requestRebuild(reason, { by = null, fetchImpl = globalThis.fetch } = {}) {
  const url = hookUrl();
  if (!url) return { status: "not-configured" };

  let claimed;
  try {
    await sql`INSERT INTO site_rebuilds (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
    /* Deciding and recording happen in one statement, so two saves that
       land together cannot both start a build, and neither can skip a
       build the other has not actually covered. */
    claimed = await sql`
      UPDATE site_rebuilds
         SET requested_at = now(), requested_by = ${by},
             reason = ${String(reason || "").slice(0, 200) || null},
             trigger_status = 'PENDING', trigger_error = NULL
       WHERE id = 1
         AND NOT (coalesce(trigger_status, '') IN ('PENDING', 'QUEUED')
                  AND coalesce(requested_at > now() - make_interval(mins => ${PENDING_MINUTES}::int), false)
                  AND (exported_at IS NULL OR exported_at < requested_at))
       RETURNING requested_at`;
  } catch (e) {
    /* No state table (the migration has not run). Rebuild anyway, just
       without coalescing: a missing optimisation must not cost the update. */
    console.error("[rebuild] state unavailable:", e.message);
    const r = await callHook(url, fetchImpl);
    return r.ok ? { status: "queued" } : { status: "failed", error: r.error };
  }

  if (!claimed.length) return { status: "queued", coalesced: true };

  const r = await callHook(url, fetchImpl);
  try {
    await sql`
      UPDATE site_rebuilds
         SET trigger_status = ${r.ok ? "QUEUED" : "FAILED"}, trigger_error = ${r.ok ? null : r.error}
       WHERE id = 1`;
  } catch (e) {
    console.error("[rebuild] could not record the result:", e.message);
  }
  return r.ok ? { status: "queued" } : { status: "failed", error: r.error };
}

/* What the portal shows: is the live shop behind the database? */
async function rebuildStatus() {
  const isConfigured = configured();
  let row;
  try {
    [row] = await sql`
      SELECT requested_at, requested_by, reason, trigger_status, trigger_error, exported_at,
             extract(epoch FROM now() - requested_at)::int AS requested_ago,
             extract(epoch FROM now() - exported_at)::int  AS exported_ago
        FROM site_rebuilds WHERE id = 1`;
  } catch (e) {
    return { configured: isConfigured, state: isConfigured ? "unknown" : "not-configured" };
  }

  const detail = row ? {
    requestedAt: row.requested_at, requestedBy: row.requested_by, reason: row.reason,
    exportedAt: row.exported_at, error: row.trigger_error,
  } : {};

  if (!isConfigured) return { configured: false, state: "not-configured", ...detail };
  if (!row || !row.requested_at) return { configured: true, state: "live", ...detail };

  const covered = row.exported_at && new Date(row.exported_at) >= new Date(row.requested_at);
  let state;
  if (covered) state = row.exported_ago < PUBLISH_SECONDS ? "publishing" : "live";
  else if (row.trigger_status === "FAILED") state = "failed";
  else state = row.requested_ago > PENDING_MINUTES * 60 ? "stuck" : "queued";
  return { configured: true, state, ...detail };
}

/* Called by db/export-catalogue.js as a production build starts reading
   the catalogue. Stamped before the read rather than after, so a change
   saved while the export is running counts as not yet covered. */
async function markExported() {
  await sql`
    INSERT INTO site_rebuilds (id, exported_at) VALUES (1, now())
    ON CONFLICT (id) DO UPDATE SET exported_at = now()`;
}

module.exports = { requestRebuild, rebuildStatus, markExported, configured, PENDING_MINUTES };
