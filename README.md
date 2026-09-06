# SHEGLAM PK

A static storefront for retailing genuine SHEGLAM cosmetics in Pakistan. Built as plain
HTML/CSS/JS with a small Node build step — no framework, no hosting runtime, no monthly bill.

---

## Run it

```bash
node build.js
```

```bash
node server.js
```

Then open <http://localhost:5599>.

`build.js` regenerates every page from the catalog. **Run it after any content change** or the
site will still show the old data.

---

## Admin portal

```bash
node admin-server.js
```

Then open <http://localhost:5600>.

**First run** shows a "Create your admin login" screen — pick a username and password and you
are in. After that it asks you to sign in.

### The login

- The password is stored as a **salted scrypt hash** in `data/admin-auth.json`. The password
  itself is never written anywhere. scrypt is deliberately slow (~40ms per guess here), so
  offline cracking is expensive even if that file leaked.
- Minimum 10 characters, with a letter and a number; obvious passwords are rejected.
- Sessions are random 256-bit tokens in an **HttpOnly, SameSite=Strict** cookie, so no other
  site in your browser can drive the API. They expire after 8 hours idle, and restarting the
  server signs you out.
- **Five wrong attempts locks sign-in for 15 minutes**, correct password included. The error
  never says whether it was the username or the password that was wrong.
- Every `/api/*` route except the auth endpoints returns 401 without a session, and any page
  load redirects to the login.

Forgotten the password? There is no recovery by design — reset it:

```bash
node set-admin-password.js
```

`data/admin-auth.json` is in `.gitignore`. Never commit or deploy it.

> ⚠ The login is defence in depth, not a licence to expose this. `admin-server.js` still binds
> to `127.0.0.1` only. Do not deploy it or forward port 5600.

- **Dashboard** — product and order counts, order value, and what needs attention:
  sold-out shades, low stock, missing photos. Shade-level stock is tracked separately, because
  a sold-out shade never shows up in a product's total.
- **Products** — add, edit and delete products, with shades, hex swatches, per-shade stock,
  prices, sale prices and badges. Search and filter by category, stock or status.
- **Orders** — list, search and filter orders; open one to see the full address and line items,
  change its status (Received → Confirmed → Packed → Shipped → Delivered), add a tracking
  number and an internal note, or message the customer on WhatsApp in one click.

### The admin portal is not part of your website

It runs on your computer, at `localhost:5600`. It is deliberately excluded from the deployed
site (`deploy-prepare.js` copies from an allow-list and fails the build if anything from
`admin/` slips in), and there is no URL on your live domain that reaches it. That is on purpose:
a static host cannot run it anyway — it needs to write files, and Vercel's filesystem is
read-only — and if it *were* published, anyone could find the login page.

To use it, start it on your machine. To manage products from another device, that needs a
hosted backend and a database, which is a different build (see *What still needs a backend*).

### Three buttons, three different things

| Button | What it does |
|--------|--------------|
| **Save** | Writes `data/products.json`. Nothing else changes. |
| **Build preview** | Saves, then rebuilds the site on this computer. Check it at `localhost:5599`. |
| **Publish live** | Saves, rebuilds, then **commits and pushes** — your host redeploys and customers see the change in a minute or two. |

Every save takes a timestamped backup into `data/backups/` (20 kept), and invalid data is
rejected before anything is written.

A save that would empty the catalogue, or delete more than half of it at once, is refused —
that is almost always a bug or a truncated payload rather than something you meant.

### Making orders show up here

Email tells you an order happened; it cannot be listed, filtered or marked "Shipped". For that,
orders also post to a Google Apps Script that appends them to a spreadsheet you own — free, no
server, and you keep the data.

Setup is in **`tools/orders-apps-script.gs`** — about five minutes. Then set `ordersApi` and
`ordersApiKey` in `data/catalog.js`, rebuild, and press **Sync from site** in the Orders tab.

Until that is set up the portal still works — use **Import** to paste an order in by hand.

---

## How it fits together

```
data/products.json   ← PRODUCTS: edited by the admin portal (or by hand)
data/products.js     ← GENERATED from the JSON for the browser — do not edit
data/catalog.js      ← config, taxonomy, reviews, collections, FAQ
data/templates.js    ← shared markup builders (used by BOTH Node and the browser)
src/content.js       ← the written pages: home, about, FAQ, shipping, returns, terms…
build.js             ← generates all 84 pages + sitemap.xml + robots.txt
check-images.js      ← product photography checklist
test-endpoint.js     ← verifies order delivery actually works
admin-server.js      ← LOCAL ONLY: admin API + auth. never deploy
admin-auth.js        ← scrypt password hashing / session helpers
set-admin-password.js ← set or reset the admin login
admin/index.html     ← the admin portal UI
admin/login.html     ← sign-in / first-run setup
data/admin-auth.json ← salted password hash. NEVER commit or deploy
data/orders.json     ← local order store, written by the admin server
tools/photo-import.html   ← drag-and-drop photo cropper / renamer
tools/orders-apps-script.gs ← paste into Google Apps Script for order sync
assets/css/style.css ← all styling
assets/js/app.js     ← cart, filters, checkout, reviews, search
server.js            ← local preview only (not needed in production)
```

**Do not deploy:** `admin-server.js`, `admin-auth.js`, `set-admin-password.js`, `admin/`,
`data/admin-auth.json`, `data/orders.json`, `data/backups/`, `server.js`.
The public site is the built HTML plus `assets/`, `data/catalog.js`, `data/products.js` and
`product/`.

Everything else in the root — `index.html`, `face.html`, `product/*.html` — is **generated
output**. Do not edit those by hand; your changes will be wiped on the next build.

### Why there is a build step

Product grids, the header and the footer are baked into the HTML rather than injected by
JavaScript. Google indexes real content, and the shop still works if a script fails to load.
`data/templates.js` is shared by the build and the browser, so a product card is defined once.

---

## Brand

### Colours

Set once at the top of `assets/css/style.css`:

| Role | Colour | Hex |
|------|--------|-----|
| Background | White | `#FFFFFF` |
| Text | Deep Black | `#171717` |
| Solid button background | Bold Beauty Pink | `#E83E70` |
| Solid button label | White | `#FFFFFF` |
| Outline button | Deep Black | `#171717` |
| Shadow | Soft Black 10% | `#0000001A` |

Pink is reserved for actions — buttons, prices on offer, active nav, badges. The announcement
bar and newsletter band are Deep Black so the pink keeps its impact. Change `--pink` in
`:root` and it updates everywhere.

### Logo

The wordmark renders as live text (`SHEGLAM.PK`, with the sparkle over the G), so it stays
sharp at any size and costs no extra request.

To use your original artwork instead, save it as **`assets/img/logo.png`** and rebuild —
`build.js` detects the file and swaps it in across the header and footer automatically.
Export at roughly 360×80px with a transparent background.

---

## ⚠ Before you go live

### 1. Make orders actually reach you

Until this is done, an order reaches you **only** if the customer taps "Confirm on WhatsApp".
The checkout tells them that, but it is a leak — do this first.

**Setup (about a minute):**

1. Open <https://web3forms.com> and enter the email address you want orders sent to.
   No password, no account to manage — they email you an access key.
2. Paste both values into `data/catalog.js`:
   ```js
   orderEndpoint:  "https://api.web3forms.com/submit",
   orderAccessKey: "the-key-they-emailed-you",
   ```
3. Verify it before trusting it with a real order:
   ```bash
   node test-endpoint.js
   ```
   It sends one clearly-marked `[TEST]` submission and reports whether it was accepted, with
   the likely cause if not. Check your inbox — then rebuild:
   ```bash
   node build.js
   ```

**Formspree** works too: set `orderEndpoint` to your form URL (`https://formspree.io/f/xxxxxxx`)
and leave `orderAccessKey` empty. The site detects the provider from the URL and uses the right
field names for each.

**Is the access key a secret?** No. It ships in the page source either way and can only submit
to your own inbox — Web3Forms designed it to be public. It is not a password.

**What you receive.** Orders arrive as a readable summary — reference, customer, phone, full
address, payment method, itemised list with shades, and the total. If the customer gave an
email, replies go straight to them.

**If sending fails.** A failed submission (customer offline, flaky mobile data, endpoint down)
is queued in the browser and retried automatically on the next page load and whenever the
connection returns. The customer is told their order is saved and still nudged toward WhatsApp.
Nothing is silently dropped.

### 2. Add your product photos

Products with no photo show a generated **studio tile** — a clean, on-brand graphic in the
product's own shade colour, marked "photo coming soon". Nothing is broken and no other brand's
product is ever shown, but tiles do not sell as well as real photographs.

**Use the import tool.** Start the server and open:

```
http://localhost:5599/tools/photo-import.html
```

Drag in photos straight off your phone or camera. For each one it:

- matches the file to a product (fuzzy — `IMG_2026 Lashlighter Up Out Mascara.jpg` lands on
  `lashlighter-up-out-mascara`), with a dropdown to correct anything it gets wrong
- centre-crops to portrait and resizes to exactly 1000×1200
- compresses to JPEG and renames to the exact filename the site expects

Then "Download all renamed", move the files into `assets/img/products/`, and:

```bash
node check-images.js   # confirms they are all seen, flags any too small or wrong shape
node build.js
```

**Shooting tip:** a phone on a plain white surface next to a window beats a light box. Shoot
portrait, fill about two-thirds of the frame, and keep the same background across every shot so
the grid looks consistent.

`.jpg`, `.png`, `.webp` and `.avif` all work — the build uses whichever extension it finds.

Prefer to do it by hand? `node check-images.js` prints every missing filename grouped by
category, so you can shoot a whole set in one sitting.

### 3. Fill in your real details

In `data/catalog.js` → `SITE`: `domain`, `email`, `phoneShow`, `phoneTel`, `whatsapp`,
`instagram`, `facebook`, `tiktok`. The WhatsApp number drives every order button, so get it
right.

### 4. Add analytics

Set `ga4` and `metaPixel` in `data/catalog.js`. Both stay completely inert until you add an ID.
Add-to-cart, checkout and purchase events are already wired up.

---

## Getting real reviews

The `REVIEWS` object in `data/catalog.js` is empty, and product pages show an honest
"Be the first to review" state. That is the correct starting point for a new shop.

**Do not write reviews yourself.** Inventing customer feedback — or marking `v: 1` (verified)
on a review you have not matched to a real order — is illegal advertising under Pakistan's
Consumer Protection Acts, and it is grounds for removal from Meta, Google and TikTok commerce.
It is also the single most common reason small beauty pages get reported.

Genuine reviews are not hard to collect:

1. **Ask on delivery day.** Send one WhatsApp message 3–4 days after delivery: *"Hi [name],
   your order arrived on [date] — how are you finding the [product]? If you have 30 seconds,
   a line or two really helps other customers."* Expect roughly a 20–30% reply rate.
2. **Offer something small.** Rs. 200 off the next order for a review with a photo. Legal, as
   long as the review itself is honest and you never make the discount conditional on it being
   positive.
3. **Reuse what you already have.** Existing praise in your Instagram DMs or WhatsApp is real
   feedback. Ask the customer's permission, then add it with their name as they gave it.
4. **The on-site form works.** "Write a review" on any product page emails the review to you
   (once `orderEndpoint` is set).

When a genuine one arrives, add it to `REVIEWS` keyed by product slug and rebuild:

```js
const REVIEWS = {
  "color-bloom-liquid-blush": [
    { a: "Ayesha K.", r: 5, s: "Pink Slip",
      t: "So pigmented — one drop does both cheeks.",
      d: "2026-09-14", v: 1 },
  ],
};
```

`a` name · `r` rating 1–5 · `s` shade bought (drives the shade filter) · `t` their words ·
`d` date · `v` 1 only if you have confirmed a matching order.

Ratings, the star breakdown, filters and pagination all appear automatically once a product
has reviews.

---

## Editing the catalog

Everything lives in the `RAW` array in `data/catalog.js`:

```js
{ n: "Product Name", c: "face", s: "Blush", p: 1990, o: 2490, f: "Matte", z: "6ml",
  best: 1, isNew: 1,
  sh: [S("Pink Slip", "#e88fa0"), S("On Call", "#d9607a", 3)],
  d: "Two honest sentences about what it does and who it suits." },
```

| Key | Meaning |
|-----|---------|
| `n` | Product name |
| `c` | Category: `face`, `eyes`, `lips`, `tools` |
| `s` | Subcategory — must match one in `CATEGORIES` |
| `p` | Price in PKR |
| `o` | Original price (optional — creates the sale badge) |
| `f` | Finish: Matte, Natural, Dewy, Radiant, Shimmer, Satin |
| `z` | Size shown on the page |
| `sh` | Shades: `S(name, hex, stock)` — stock defaults to 12 |
| `d` | Description — **write a unique one per product** |

Slug, SKU, discount %, images and rating are derived automatically. Adding a product and
rebuilding puts it into its category page, search, the sitemap and any matching collection
with no other edits.

Write real descriptions. Sixty products sharing one template sentence is duplicate content,
and Google will treat most of those pages as worthless.

---

## What is built

- 60 products across Face, Eyes, Lips and Tools, with shade variants and per-shade stock
- Faceted filtering (category, finish, price, availability) with URL sync and chips
- Six sort orders, 20-per-page with "View more"
- Product pages: gallery, shade picker, quantity, accordions, related items, recently viewed
- Reviews: rating breakdown, filter by rating/shade, sort, pagination, submission form
- Cart drawer with variants, free-delivery progress, wishlist
- Two-step checkout: validation, COD/Easypaisa/JazzCash/bank, order reference, WhatsApp handoff
- Order tracking by reference
- Search with a live dropdown and a full results page
- Real policy pages: FAQ, shipping (cost and timeline tables), returns, shade guide, privacy,
  terms
- Curated collection landing pages
- Product/ItemList/FAQ/Breadcrumb/OnlineStore structured data, sitemap, robots.txt, 404 page

## What still needs a backend

Honest limits of a static site — these cannot be fixed with more front-end code:

- **Customer accounts.** Cart and wishlist live in the browser, so they do not follow a
  customer from phone to laptop. The account icon says "coming soon".
- **Live inventory.** Stock counts are baked in at build time. If you sell out, edit the
  catalog and rebuild.
- **Order tracking across devices.** Lookup reads local storage, so it only works on the
  device that placed the order. The page says so and points to WhatsApp.
- **Card payments.** COD and manual transfer only. A card gateway needs a server.

When you outgrow these, Shopify or a Next.js app with a database is the next step. The catalog
in `data/catalog.js` will port straight across.

---

## Branding note

This site is built as an **independent stockist**, not as SHEGLAM itself. The footer carries a
disclaimer stating there is no affiliation — `SITE.disclaimer` in `data/catalog.js`.

Keep it. Selling genuine imported stock as a reseller is normal retail; presenting yourself as
the brand's official operation is a trademark problem.

The stock photography used for the homepage hero and category tiles is licence-free and was
filtered to exclude images showing other brands' packaging — putting a competitor's product on
your page misleads customers and uses their trade dress. If you add more editorial imagery to
`EDITORIAL_POOL`, apply the same rule.

---

## Deploying

Any static host works — upload the whole folder (minus `server.js`). Netlify, Cloudflare Pages,
Vercel and GitHub Pages are all free at this scale.

Set `404.html` as the not-found page in your host's settings, and point your domain at it.
Update `SITE.domain` and rebuild so canonical URLs and the sitemap are correct.
