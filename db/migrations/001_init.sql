-- =========================================================
-- 001_init.sql — SHEGLAM PK production schema
--
-- Design notes that matter:
--  · usernames are stored lower-case with a CHECK, so logins are
--    case-insensitive without needing the citext extension
--  · sessions store a HASH of the token, never the token itself, so a
--    database leak cannot be replayed as a valid session
--  · audit_logs denormalise the actor's username so the trail survives
--    even if the user row is later changed
--  · money is numeric(12,2), never float — no rounding drift on totals
-- =========================================================

-- ---------- enums ----------
DO $$ BEGIN CREATE TYPE admin_role   AS ENUM ('SUPER_ADMIN','ADMIN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE admin_status AS ENUM ('ACTIVE','DISABLED');   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE order_status AS ENUM
  ('PENDING','CONFIRMED','PROCESSING','PACKED','SHIPPED','DELIVERED','CANCELLED','REFUNDED');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('UNPAID','PAID','REFUNDED','FAILED');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE stock_status AS ENUM ('IN_STOCK','LOW_STOCK','OUT_OF_STOCK');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- admin users ----------
CREATE TABLE IF NOT EXISTS users (
  id                  bigserial PRIMARY KEY,
  username            text        NOT NULL UNIQUE
                        CHECK (username = lower(username) AND length(username) BETWEEN 3 AND 32),
  display_name        text        NOT NULL,
  password_hash       text        NOT NULL,
  password_salt       text        NOT NULL,
  role                admin_role  NOT NULL,
  status              admin_status NOT NULL DEFAULT 'ACTIVE',
  -- forces a password change on next login; used after a Super Admin reset
  must_change_password boolean    NOT NULL DEFAULT false,
  last_login_at       timestamptz,
  password_changed_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------- sessions ----------
CREATE TABLE IF NOT EXISTS sessions (
  -- sha256 of the cookie value; the raw token exists only in the browser
  token_hash   text        PRIMARY KEY,
  user_id      bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text        NOT NULL,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_idx    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

-- ---------- login throttling ----------
CREATE TABLE IF NOT EXISTS login_attempts (
  id         bigserial PRIMARY KEY,
  username   text,
  ip         text,
  success    boolean     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_lookup_idx
  ON login_attempts(username, created_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx
  ON login_attempts(ip, created_at DESC);

-- ---------- audit trail ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id              bigserial PRIMARY KEY,
  actor_user_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  actor_username  text        NOT NULL,          -- kept even if the user changes
  action          text        NOT NULL,
  target_type     text,
  target_id       text,
  detail          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  result          text        NOT NULL DEFAULT 'SUCCESS',   -- SUCCESS | DENIED | FAILURE
  ip              text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_actor_idx   ON audit_logs(actor_username, created_at DESC);

-- ---------- catalogue ----------
CREATE TABLE IF NOT EXISTS categories (
  id          bigserial PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  parent_id   bigint REFERENCES categories(id) ON DELETE SET NULL,
  position    int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collections (
  id          bigserial PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  subtitle    text,
  blurb       text,
  tint        text,
  position    int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id                bigserial PRIMARY KEY,
  slug              text NOT NULL UNIQUE,
  sku               text UNIQUE,
  name              text NOT NULL,
  brand             text NOT NULL DEFAULT 'SHEGLAM',
  category_id       bigint REFERENCES categories(id) ON DELETE SET NULL,
  subcategory       text,
  short_description text,
  description       text,
  finish            text,
  size              text,
  price             numeric(12,2) NOT NULL CHECK (price >= 0),
  sale_price        numeric(12,2) CHECK (sale_price IS NULL OR sale_price >= 0),
  cost_price        numeric(12,2),                  -- admin-only, never exposed publicly
  currency          text NOT NULL DEFAULT 'PKR',
  stock_quantity    int  NOT NULL DEFAULT 0,
  low_stock_threshold int NOT NULL DEFAULT 5,
  is_published      boolean NOT NULL DEFAULT true,
  is_featured       boolean NOT NULL DEFAULT false,
  is_bestseller     boolean NOT NULL DEFAULT false,
  is_new_arrival    boolean NOT NULL DEFAULT false,
  tags              text[] NOT NULL DEFAULT '{}',
  ingredients       text,
  seo_title         text,
  seo_description   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- a sale price that is not actually lower is a data error, not a discount
  CONSTRAINT sale_below_price CHECK (sale_price IS NULL OR sale_price < price)
);
CREATE INDEX IF NOT EXISTS products_category_idx  ON products(category_id);
CREATE INDEX IF NOT EXISTS products_published_idx ON products(is_published);
CREATE INDEX IF NOT EXISTS products_name_idx      ON products(lower(name));

CREATE TABLE IF NOT EXISTS product_variants (
  id             bigserial PRIMARY KEY,
  product_id     bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku            text UNIQUE,
  variant_name   text NOT NULL,                    -- e.g. the shade name
  option_name    text NOT NULL DEFAULT 'Shade',
  hex            text,
  price          numeric(12,2),                    -- null = inherit the product price
  stock_quantity int NOT NULL DEFAULT 0,
  position       int NOT NULL DEFAULT 0,
  is_available   boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS variants_product_idx ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS product_images (
  id         bigserial PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id bigint REFERENCES product_variants(id) ON DELETE SET NULL,
  url        text NOT NULL,
  alt        text,
  position   int  NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS images_product_idx ON product_images(product_id);

CREATE TABLE IF NOT EXISTS product_collections (
  product_id    bigint NOT NULL REFERENCES products(id)    ON DELETE CASCADE,
  collection_id bigint NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, collection_id)
);

-- ---------- customers & orders ----------
CREATE TABLE IF NOT EXISTS customers (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  email       text,
  phone       text NOT NULL,
  city        text,
  address     text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone);

CREATE TABLE IF NOT EXISTS orders (
  id               bigserial PRIMARY KEY,
  reference        text NOT NULL UNIQUE,           -- customer-facing, e.g. SG-2609-4K2FH
  customer_id      bigint REFERENCES customers(id) ON DELETE SET NULL,
  customer_name    text NOT NULL,                  -- snapshot at time of order
  customer_email   text,
  customer_phone   text NOT NULL,
  shipping_city    text,
  shipping_address text NOT NULL,
  payment_method   text NOT NULL,
  payment_status   payment_status NOT NULL DEFAULT 'UNPAID',
  status           order_status   NOT NULL DEFAULT 'PENDING',
  subtotal         numeric(12,2) NOT NULL,
  shipping_fee     numeric(12,2) NOT NULL DEFAULT 0,
  discount         numeric(12,2) NOT NULL DEFAULT 0,
  total            numeric(12,2) NOT NULL,
  currency         text NOT NULL DEFAULT 'PKR',
  customer_note    text,
  internal_note    text,                           -- admin only, never shown to the customer
  tracking_number  text,
  placed_at        timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_placed_idx ON orders(placed_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id           bigserial PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   bigint REFERENCES products(id)         ON DELETE SET NULL,
  variant_id   bigint REFERENCES product_variants(id) ON DELETE SET NULL,
  -- names and prices are snapshotted: editing a product later must not
  -- rewrite what a customer was actually charged
  product_name text NOT NULL,
  variant_name text,
  sku          text,
  unit_price   numeric(12,2) NOT NULL,
  quantity     int NOT NULL CHECK (quantity > 0),
  line_total   numeric(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_status_history (
  id          bigserial PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status   order_status NOT NULL,
  note        text,
  changed_by  text,                                -- username, or 'system'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_history_order_idx ON order_status_history(order_id, created_at);

-- ---------- homepage ----------
CREATE TABLE IF NOT EXISTS hero_slides (
  id            bigserial PRIMARY KEY,
  position      int  NOT NULL DEFAULT 0,
  is_enabled    boolean NOT NULL DEFAULT true,
  eyebrow       text,
  headline      text NOT NULL,
  subtext       text,
  cta_label     text,
  cta_href      text,
  cta2_label    text,
  cta2_href     text,
  video_url     text,
  video_mobile_url text,
  poster_url    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- key/value settings ----------
CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- ---------- keep updated_at honest ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','products','customers','orders'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %1$s_touch ON %1$s;
       CREATE TRIGGER %1$s_touch BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION touch_updated_at();', t);
  END LOOP;
END $$;
