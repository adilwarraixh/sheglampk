-- =========================================================
-- 008_sale_dates_and_inbox.sql — scheduled sales; newsletter, contact and
-- reviews kept instead of lost
--
-- Sales can now start and end on their own. Both dates are optional: no
-- start means "from now", no end means "until removed". lib/pricing.js
-- decides whether a sale is running, and the checkout, the shop and the
-- admin all ask it.
--
-- The newsletter box, the contact form and the review form posted to a
-- third-party form service that was never configured, so every submission
-- was dropped while the customer was told it had been received. They are
-- stored here now, and the admin portal shows them.
-- =========================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_starts_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_ends_at   timestamptz;
ALTER TABLE products DROP CONSTRAINT IF EXISTS sale_window_order;
ALTER TABLE products ADD CONSTRAINT sale_window_order
  CHECK (sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_ends_at > sale_starts_at);

-- ---------- newsletter ----------
CREATE TABLE IF NOT EXISTS subscribers (
  id              bigserial PRIMARY KEY,
  email           text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 5 AND 160),
  source          text,                         -- the page they signed up from
  created_at      timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_idx ON subscribers (email);

-- ---------- contact form ----------
CREATE TABLE IF NOT EXISTS contact_messages (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL,
  phone       text,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  handled_at  timestamptz,                     -- set when someone has replied
  handled_by  text
);
CREATE INDEX IF NOT EXISTS contact_messages_open_idx ON contact_messages (handled_at, created_at DESC);

-- ---------- product reviews ----------
DO $$ BEGIN
  CREATE TYPE review_status AS ENUM ('PENDING','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS reviews (
  id              bigserial PRIMARY KEY,
  product_id      bigint REFERENCES products(id) ON DELETE SET NULL,
  product_slug    text NOT NULL,               -- kept if the product is later deleted
  author_name     text NOT NULL,
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  shade           text,
  body            text NOT NULL,
  order_reference text,                        -- optional; lets the shop confirm a purchase
  status          review_status NOT NULL DEFAULT 'PENDING',
  -- "Verified purchase" is only ever set by an admin who has checked the order.
  verified        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,
  reviewed_by     text
);
CREATE INDEX IF NOT EXISTS reviews_status_idx  ON reviews (status, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_product_idx ON reviews (product_id, status);
