# SHEGLAM PK

An independent online shop selling genuine SHEGLAM cosmetics in Pakistan, with a
built-in admin portal. Cash on delivery only.

- **Shop:** https://www.sheglampk.online
- **Admin:** https://www.sheglampk.online/admin/login
- **Contact:** WhatsApp +44 7862 614763 · hello@sheglampk.online

Two people run it: `umama` (Super Admin) and `ashba` (Admin). Both work from any
device against the same live database.

---

## Contents

- [How it fits together](#how-it-fits-together)
- [Running it locally](#running-it-locally)
- [Environment variables](#environment-variables)
- [Database setup](#database-setup)
- [Deploying](#deploying)
- [The admin portal](#the-admin-portal)
- [Day-to-day tasks](#day-to-day-tasks)
- [Order and email flow](#order-and-email-flow)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [What is not built yet](#what-is-not-built-yet)

---

## How it fits together

```
  Admin portal  ──writes──▶  Neon Postgres  ◀──reads──  /api/*  ──▶  Storefront
                                   │
                                   └── build time ──▶ data/products.json ──▶ static pages
```

**The database is the source of truth.** Nothing about the catalogue is hard-coded.

The storefront is pre-rendered static HTML, so it is fast and works with JavaScript
disabled. `db/export-catalogue.js` writes the catalogue into `data/products.json` at
build time, and `build.js` bakes that into the pages.

Because the pages are generated, **a change made in the portal reaches customers when
the site is rebuilt** — and the portal starts that rebuild itself. Saving a published
product, a stock level, a CSV import or a hero slide calls a Vercel Deploy Hook
(`DEPLOY_HOOK_URL`), and the live shop updates in a minute or two. `lib/rebuild.js`
folds a burst of saves into one build, and the bar at the top of `/admin/products` says
whether the shop is up to date, still updating, or needs **Update shop now**.

A product's URL opened before its page exists lands on a "being prepared" page that
opens the product by itself once the build is live.

| Layer | Where |
|---|---|
| Storefront pages | generated at the repo root by `build.js` |
| Page content | `src/content.js`, `src/pages/` |
| Site config | `data/catalog.js` (name, contact, delivery thresholds) |
| Admin portal | `src/admin/*.html` → served at `/admin/*` |
| API | `api/**` (Vercel serverless functions) |
| Business logic | `lib/**` |
| Database | `db/**`, migrations in `db/migrations/` |
| Deployed output | `dist/` (built by `deploy-prepare.js`, never committed) |

`deploy-prepare.js` copies to an **allow-list**, so a new tooling or credential file
is excluded by default and the build hard-fails if anything sensitive reaches `dist/`.

---

## Running it locally

Requires Node 18+ and a Neon Postgres database.

```bash
npm install
cp .env.example .env.local     # then fill it in — see below
npm run db:migrate             # create the tables
npm run db:passwords           # issue admin passwords -> HANDOVER.txt
npm run build                  # export catalogue, generate pages, assemble dist/
npm run dev                    # http://localhost:5601
```

- Shop: http://localhost:5601
- Admin: http://localhost:5601/admin/login

`npm run dev` serves `dist/` and dispatches `/api/*` to the same handler modules
Vercel runs, so the portal can be exercised end to end before deploying.

**Rebuild after changing** `data/catalog.js`, `src/content.js`, `build.js`, or anything
in `assets/`. On Vercel, product, stock and hero changes made in the admin portal start
that rebuild automatically; locally, run `npm run build` to see them.

---

## Environment variables

Local values go in `.env.local` (gitignored). Production values go in the **Vercel
dashboard**, never in a file. `.env.example` documents every one.

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | **yes** | Neon connection string. Everything fails without it. |
| `MAIL_PROVIDER` | for email | `resend`, `brevo`, `smtp`, or `none` |
| `RESEND_API_KEY` | if resend | From resend.com. ~36 chars, starts `re_` |
| `SMTP_FROM` | for email | Must be on a domain verified with the provider |
| `ORDER_NOTIFICATION_EMAIL` | for email | Where new-order alerts go |
| `SITE_BASE_URL` | for email | Used for the customer's tracking link |
| `ADMIN_BASE_URL` | for email | Used for the "View order" link in the alert |
| `CRON_SECRET` | production | Authenticates the notification retry sweep |
| `DEPLOY_HOOK_URL` | production | Vercel Deploy Hook the portal calls so saved changes reach the live shop. A secret: anyone holding it can redeploy the site |

`MAIL_PROVIDER` defaults to `none`, which is deliberate: **an unconfigured shop still
takes orders.** Notifications are recorded and can be sent later from the portal.

Check the mail setup any time:

```bash
npm run mail:test                    # sends to ORDER_NOTIFICATION_EMAIL
npm run mail:test you@example.com    # or somewhere else
```

It reports what is configured and sends a real email. It never prints a key — only
whether one is present and how long it is.

---

## Database setup

```bash
npm run db:migrate          # apply migrations (transactional, checksummed)
npm run db:seed             # create the two admin accounts
npm run db:passwords        # issue one-time passwords -> HANDOVER.txt
npm run db:seed-settings    # store settings from data/catalog.js
npm run db:seed-hero        # move hero slides from data/hero.json into the database
npm run db:import-pdf       # load the initial catalogue (dry run)
npm run db:import-pdf -- --confirm
npm run db:export           # database -> data/products.json + data/hero.json
```

Migrations run in a transaction each and record a checksum, so an edited migration is
caught rather than silently skipped. Adding a schema change means **a new file** in
`db/migrations/`, never editing an applied one.

`db/clear-demo-data.js` removes seeded demo records. It previews by default, backs up
to `data/backups/` first, and only writes with `--confirm`.

---

## Deploying

Hosted on Vercel, deployed from GitHub `main`. **Every push to `main` deploys.**

### First-time setup

1. **Import the repo** at vercel.com/new. Vercel reads `vercel.json` — do not override
   the build command or output directory.

2. **Create the deploy hook** the portal uses to update the live shop:

   ```bash
   vercel deploy-hooks create shop-rebuild --ref main
   ```

   Its URL is the value for `DEPLOY_HOOK_URL`. Without it every save still works, but
   customers do not see the change until the next push to `main`.

3. **Add the environment variables** (Settings → Environment Variables, Production
   scope, Sensitive). All nine from the table above.

4. **Turn off Deployment Protection** (Settings → Deployment Protection → Vercel
   Authentication → Disabled). Pro accounts enable it by default, and it makes the
   whole shop ask visitors to log into Vercel.

5. **Add the domain** (Settings → Domains): `sheglampk.online` and `www`. Use the DNS
   records Vercel shows you.

6. **Redeploy.** Environment variables are snapshotted at build time — adding them does
   not affect a deployment that already exists.

### Deploying afterwards

```bash
git push origin main          # that is the whole deploy
```

Or from the CLI:

```bash
vercel redeploy <deployment-url> --scope <your-scope>
```

### Verifying a deploy

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://www.sheglampk.online/api/products
```

`200` means the database is connected. `500` almost always means `DATABASE_URL` is
missing or wrong — see [Troubleshooting](#troubleshooting).

A scheduled job (`vercel.json` → `crons`) hits `/api/notifications/retry` every 15
minutes to resend notifications that failed while a provider was down.

---

## The admin portal

`/admin/login`. Both accounts are forced to change their password on first sign-in —
nothing else in the portal works until they do.

| Section | `umama` (Super Admin) | `ashba` (Admin) |
|---|---|---|
| Dashboard | ✓ | ✓ |
| Orders — view, update status, notes, tracking | ✓ | ✓ |
| Orders — delete | ✓ | — |
| Products — view | ✓ | ✓ |
| Products — create, edit, archive, import | ✓ | — |
| Inventory — view / edit stock | ✓ / ✓ | ✓ / — |
| Customers, Analytics | ✓ | ✓ |
| Homepage, Admin Account, Audit Log, Settings | ✓ | — |

**Permissions are enforced on the server, in every request.** The role is read from the
database each time, never from the browser. Hiding a button in the UI is presentation;
the API refuses regardless.

---

## Day-to-day tasks

### Add a product

`/admin/products` → **+ Add New Product**. Fill in name, price, category, shades and
images, set status to **PUBLISHED**, save. The live shop rebuilds and shows it within a
minute or two; the bar at the top of the product list says when it is live.

- **Shades** each have a name, stock and colour. The colour is the swatch customers pick
  from — use the picker, or type a code like `#E83E70`. Left blank, the swatch shows
  that shade's photo instead.
- **Photos**: choose which shade each photo shows. Picking that shade on the product
  page switches to its photo.
- **Stock** for a product with shades is the total of its shades, so set it per shade.

A product **cannot be published without a price or a category**. The API refuses both.

### Edit or retire a product

Edit from the list. To retire one, use **Archive** rather than deleting: order lines
reference products, and archiving keeps past orders reading correctly. Archived
products vanish from the shop but stay in the database.

### Upload images

On the product form, drag files onto the drop zone or use **Upload image**. JPEG, PNG,
WebP or GIF, up to 3MB. SVG is refused — it can carry scripts.

Images are stored in Postgres and served from `/api/media/:id` with a one-year cache.
An image cannot be deleted while a product still uses it.

### Import products from a spreadsheet

`/admin/import` → **Download template** (contains your current catalogue) → edit in
Excel → upload → check the preview → **Import**.

Rows match an existing product on SKU, then slug, then name. Anything unmatched is new.
**Only columns present in the file are changed** — a price-only sheet will not blank
everything else.

The preview shows every row as create / update / error with the reason, and writes
nothing until you confirm.

### Manage stock

`/admin/inventory`. One row per sellable unit — a shaded product is counted per shade,
because that is what actually runs out. Stock is set to an absolute figure, not adjusted
by a delta, so two people counting the same shelf cannot both add their count.

### Change the homepage hero

`/admin/homepage`. Three video slides with headline, subtext and buttons. Videos are
referenced by path — put the file in `assets/video/` and reference it. Saving a slide
rebuilds the live homepage automatically.

### Manage the other admin account

`/admin/users` (Super Admin only). Rename, enable/disable, reset password, sign out all
devices. Nobody can change their own role or status, and the last active Super Admin
cannot be demoted or disabled.

A password reset shows its one-time password **once**. It is not stored readably and is
deliberately kept out of the audit log.

---

## Order and email flow

```
Customer places order
   ↓
POST /api/orders          products, prices, stock all re-read from the database;
   ↓                      anything the browser said about money is ignored
Order + items + customer + status history written, stock decremented
   ↓
Notification rows created, send attempted
   ↓                          ↓
Shop alert              Customer confirmation
sheglamofficialpk@...   their own address
```

**A mail failure never fails an order.** The order is committed first; the notification
records its own outcome and is retried by the cron sweep. The confirmation page only
tells a customer an email was sent if one actually was.

Order references look like `SG-2609-BEAEQ`.

Duplicate protection: the checkout sends an idempotency key, held across a retry. A
double-click, refresh or network retry returns the original order — no second row, no
second email. A unique index on `(order_id, type)` does the same for notifications.

Each order's drawer in `/admin/orders` shows the state of both emails, with **Resend**.

---

## Tests

```bash
npm test
```

Runs six suites against the real database and the real route modules, so the guard,
CSRF and RBAC rules are exercised as deployed:

| Suite | Covers |
|---|---|
| `test-auth.js` | hashing, sessions, CSRF, throttling, cookies |
| `test-api.js` | login, permissions, orders, forced password change |
| `test-media.js` | upload validation and serving |
| `test-import.js` | CSV parsing, analysis, apply |
| `test-orders.js` | the full order and notification workflow |
| `test-catalogue.js` | shade ids and photo links surviving a save, colours, stock totals, retired shades, shop rebuilds |

The suites use the live database. They set temporary passwords on the real accounts to
exercise login, then **put the original credentials back** (`test-helpers.js`) and end
only the sessions the run opened, so a real admin stays signed in with the password
they chose. Products a suite creates are drafts and are deleted afterwards; real
products it updates are restored exactly.

`test-orders.js` forces `MAIL_PROVIDER=none`, so running tests never sends live email.
The suites clear `DEPLOY_HOOK_URL`, and the rebuild tests use a local stand-in for
Vercel, so a run never starts a real build.

---

## Troubleshooting

### `FUNCTION_INVOCATION_FAILED` on any `/api/*` route

`DATABASE_URL` is missing or wrong. `db/client.js` throws while the module loads, before
any error handler exists, so Vercel cannot return JSON.

```bash
vercel logs <deployment-url> | grep -oE "Error: [^\\\\]{0,120}"
```

Vercel marks variables **Sensitive**, so `vercel env pull` returns `[SENSITIVE]` rather
than the value — you cannot read one back to check it. If it looks set but does not
work, replace it:

```bash
vercel env rm DATABASE_URL production --yes
vercel env add DATABASE_URL production < a-file-containing-the-value
vercel redeploy <deployment-url>
```

**Check the hostname carefully.** A single stray character (`ap-southeast-C1` instead of
`ap-southeast-1`) breaks it, and the symptom is the same unhelpful error.

### Variables are set but the site behaves as if they are not

Environment variables are snapshotted at **build time**. Adding one does not affect a
deployment that already exists. Redeploy.

### The whole site asks visitors to log into Vercel

Deployment Protection. Settings → Deployment Protection → Vercel Authentication →
Disabled.

### Email is not arriving

```bash
npm run mail:test
```

Most common causes: the sending domain is not verified with the provider; `SMTP_FROM` is
an address the provider will not send from; the key was copied from the API-keys list
(which shows a truncated preview) rather than the creation dialog.

Failed notifications appear in the order drawer with the provider's reason and a
**Resend** button.

### The homepage shows no products

Homepage sections draw on merchandising flags. If nothing is flagged Featured or
Bestseller, the main section falls back to the catalogue. If the page is genuinely empty,
check that products are **PUBLISHED** and have a price.

### A change made in the portal is not showing on the shop

Look at the bar at the top of `/admin/products`:

- **Updating** — a build is running. Give it a minute or two.
- **Did not update** or **has not run** — press **Update shop now**, and check the
  latest deployment in the Vercel dashboard for a build error.
- **Automatic shop updates are not set up** — `DEPLOY_HOOK_URL` is missing. Create the
  hook (see [First-time setup](#first-time-setup)), add the variable, redeploy.

The build log line `automatic rebuilds: deploy hook configured` confirms Vercel has the
variable.

### A product page 404s

`build.js` empties `product/` on every build, so pages for unpublished or archived
products are removed. A product published moments ago shows a "being prepared" page
until its rebuild finishes. If a published product still has no page after that, press
**Update shop now**.

---

## Security notes

- Passwords are hashed with scrypt. Plain text is never stored, logged, returned by an
  API, or written into the audit trail.
- Session tokens are random bytes; only a SHA-256 hash is stored, so a database leak
  does not hand over live sessions.
- Every state-changing admin request needs a CSRF token.
- Login throttling: 5 failures per username, 20 per IP, 15-minute window.
- The role is read from the database on every request. A request claiming
  `role=SUPER_ADMIN` is ignored.
- Uploads are type-checked from magic bytes, not the filename or declared type, and
  served with `nosniff` and a sandbox CSP.
- Cash on delivery is enforced server-side; a tampered request cannot record an order as
  prepaid.
- Card numbers are never stored — none are ever collected.
- Every denied request is written to the audit log with the actor.

**Never commit** `.env.local`, `HANDOVER.txt`, or `DEPLOY-ENV.txt`. All three are
gitignored. Delete the last two once the credentials are in place.

---

## What is not built yet

- **Video upload** through the portal. Hero videos go in `assets/video/` and are
  referenced by path; Vercel caps a request body at 4.5MB, so video needs blob storage.
- **Category management UI.** Categories are database-driven and drive the navigation,
  but there is no screen to add or rename one.
- **Real-time order arrival.** The orders page polls every 30 seconds rather than pushing.
- **Customer accounts.** Checkout is guest-only by design.

---

## Branding

SHEGLAM PK is an independent stockist. The footer disclaimer in `data/catalog.js` states
that plainly and should not be removed without legal advice. Product names, shades and
sizes are factual; descriptions and photography came from the supplied product list.
