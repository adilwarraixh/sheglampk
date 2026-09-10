-- =========================================================
-- 003_media.sql — uploaded images
--
-- Vercel's filesystem is read-only at runtime, so an upload cannot be
-- written into assets/. It would work locally and fail silently in
-- production, which is the worst of both. Blob storage would mean another
-- service and another credential to manage; at ~110KB per product photo
-- and a catalogue this size, Postgres holds them comfortably.
--
-- Bytes live here; /api/media/:id serves them with a long cache. Move to
-- object storage later by changing that route and backfilling — the URLs
-- products reference do not have to change.
-- =========================================================

CREATE TABLE IF NOT EXISTS media (
  id           bigserial PRIMARY KEY,
  sha256       text NOT NULL UNIQUE,          -- dedupe: same bytes, one row
  filename     text NOT NULL,                 -- original name, for the admin's benefit only
  mime         text NOT NULL,                 -- what WE detected, never what was claimed
  extension    text NOT NULL,
  byte_size    int  NOT NULL CHECK (byte_size > 0),
  width        int,
  height       int,
  bytes        bytea NOT NULL,
  uploaded_by  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_created_idx ON media (created_at DESC);
