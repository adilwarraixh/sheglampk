-- 005_site_rebuilds.sql
--
-- Product pages are static HTML built from the database, so a catalogue
-- change reaches customers only when the site is rebuilt. lib/rebuild.js
-- asks Vercel for that rebuild; this single row is how it avoids starting
-- a build for every click.
--
--   requested_at  when a rebuild was last asked for
--   exported_at   when a production build last began reading the catalogue
--
-- While requested_at is newer than exported_at, a build is on its way and
-- will pick up any further change, so another one is not needed.

CREATE TABLE IF NOT EXISTS site_rebuilds (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  requested_at   timestamptz,
  requested_by   text,
  reason         text,
  trigger_status text,          -- PENDING while calling Vercel, then QUEUED or FAILED
  trigger_error  text,          -- a readable reason; never the hook URL
  exported_at    timestamptz
);

INSERT INTO site_rebuilds (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
