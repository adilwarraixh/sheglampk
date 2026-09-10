-- =========================================================
-- 004_order_notifications.sql — email notifications and order idempotency
--
-- Extends the existing orders tables rather than duplicating them.
-- order_items already carries product_name, sku, variant_name, unit_price
-- and line_total snapshots, so archiving a product cannot rewrite history.
-- =========================================================

-- ---------- idempotency ----------
-- A double-clicked Place Order, a browser retry or a flaky connection
-- must not produce two orders. The client sends a key; the unique index
-- makes a replay collide, and the API returns the original order instead
-- of creating another.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_idx
  ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ---------- fields the notification email reports ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_state       text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_postal_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_country     text NOT NULL DEFAULT 'Pakistan';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount           numeric(12,2) NOT NULL DEFAULT 0;

-- ---------- notifications ----------
DO $$ BEGIN
  CREATE TYPE notification_status AS ENUM ('PENDING','SENDING','SENT','FAILED','SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS email_notifications (
  id                  bigserial PRIMARY KEY,
  order_id            bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type                text NOT NULL,                    -- 'admin_new_order' | 'customer_confirmation'
  recipient           text NOT NULL,
  subject             text,
  status              notification_status NOT NULL DEFAULT 'PENDING',
  provider            text,
  provider_message_id text,
  attempt_count       int  NOT NULL DEFAULT 0,
  max_attempts        int  NOT NULL DEFAULT 5,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  last_attempt_at     timestamptz,
  error_message       text,                             -- safe diagnostic only; never credentials
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One notification of each type per order. This is what stops a retry,
-- a double submit or a queue redelivery emailing the shop twice about
-- the same order; a deliberate resend bumps attempt_count instead.
CREATE UNIQUE INDEX IF NOT EXISTS email_notifications_order_type_idx
  ON email_notifications (order_id, type);

-- The retry sweep asks exactly this question.
CREATE INDEX IF NOT EXISTS email_notifications_due_idx
  ON email_notifications (status, next_attempt_at)
  WHERE status IN ('PENDING','FAILED');

-- Orders list filters and sorts on these.
CREATE INDEX IF NOT EXISTS orders_placed_at_idx ON orders (placed_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx    ON orders (status, placed_at DESC);
