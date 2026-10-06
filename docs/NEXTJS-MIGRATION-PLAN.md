# SHEGLAM PK: moving to Next.js (App Router, React, TypeScript)

## 1. Goal

Move the shop and the admin portal to Next.js 16 (App Router, React 19, TypeScript) without customers, Google or the admins seeing any change they did not ask for.

Every existing URL keeps working. Cash on delivery and the WhatsApp workflow stay. Prices are still decided only by `lib/pricing.js` `priceOf`, and checkout still sends `expectedTotal` and handles `409 PRICE_CHANGED`. The database and the current code remain the source of truth.

The work goes in small steps. Each step is checked against the live behaviour before it reaches production, and each step can be undone with one revert.

## 2. Ground rules for every phase

1. **One kind of change per phase.** Phase 1 changes only the host. Later phases change one page family at a time. Intended output changes, such as bug fixes, ship in their own commits, never mixed into a migration step.
2. **Prove parity on previews before merging.** Build two preview deployments against the same Neon dev branch, one minutes after the other: one from current `main` (the "baseline") and one from the migration branch. Compare them with `scripts/parity.mjs`. Production only changes after the report is clean. After the merge, compare production with the report saved before the merge.
3. **Keep server code reusable.** `lib/*`, `db/*` and the 29 request handlers stay CommonJS JavaScript. The 11 node test suites keep calling them directly. TypeScript is used for new code (pages, components, wrappers).
4. **No database schema or data changes in any phase.** `site_rebuilds` is reused with its current columns. If a later decision does need a schema change, it follows backup, then migration on the dev branch, then verification, then a rollback script, then production.
5. **No secrets in the browser.** No `NEXT_PUBLIC_*` variables, no `env` block in `next.config`, and a scan of `.next/static` on every phase that adds client JavaScript.
6. **Never commit** `.env*`, `HANDOVER.txt` or `DEPLOY-ENV.txt`.

## 3. What was checked (facts the plan relies on, and corrections to the proposals)

Checked against the repository on 2026-10-06, live HTTP responses and the current Next.js and Vercel documentation.

- **Handlers.** There are 29 CommonJS handler files under `api/`. Each is `module.exports = handler(...)` and reads `req.query.id` or `req.query.slug`.
  - `lib/http.js` `json()` always sets `Cache-Control: no-store`, so the `s-maxage=60` in `api/products/*.js` never takes effect. Keep that as it is.
  - `readBody` uses `req.body` when the platform has already parsed it, which means its size limits never run today. With `bodyParser: false` they will run.
- **Tests depend on handler paths.** `test-api.js:52-59`, `test-orders.js:60-65`, `test-inbox.js` (`call('/api/...js')`) and `test-media.js:22` load handlers by path. `test-media.js:90,93` contain `/api/media/<id>` *URL values*, which must not be renamed.
- **Committed product pages have a backslash canonical.** The committed `product/*.html` files contain canonicals such as `https://www.sheglampk.online/product\pore-off-primer.html` (Windows build, `build.js:962` uses `path.join`). Vercel's Linux build output is correct.
- **Live response headers (curl, today):**
  - `/admin` returns `X-Frame-Options: SAMEORIGIN` and `Referrer-Policy: strict-origin-when-cross-origin`, because the `/(.*)` rule is last and wins.
  - `/api/admin/session` keeps `DENY` and `no-referrer`, because headers set by the function win.
  - `/assets/*` returns `public, max-age=31536000, immutable`.
  - `/face` returns 404 and `/face.html/` returns 308.
  - Phase 1 must reproduce exactly this. The admin header fix is a separate commit in Phase 2.
- **Next.js version.** The latest stable release is **16.3.8**, not 16.2.x as the proposals said. Pin the exact version `npm view next version` reports on the day.
- **Next.js routing order (documented).**
  1. Headers.
  2. Redirects.
  3. `beforeFiles` rewrites.
  4. Public files and static pages.
  5. `afterFiles` rewrites.
  6. Dynamic routes.
  7. `fallback` rewrites.
  
  A fallback rewrite therefore cannot shadow `pages/api/admin/orders/[id]`. This is why the plan does not use an App Router catch-all in Phase 1.
- **Next.js does not serve `public/index.html` at `/`.** An `afterFiles` rewrite is needed.
- **Public folder caching.** Next's default for public files is `Cache-Control: public, max-age=0`. The `/assets` immutable header has to be declared again and then checked on the preview.
- **Revalidation in Next 16.**
  - `revalidateTag` requires a second argument: `'max'`, or `{ expire: 0 }` for webhooks.
  - `updateTag` only works inside Server Actions.
  - After `revalidatePath`, the *next request* regenerates the page and is served the fresh result. A database error at that moment therefore reaches the visitor; it is not covered by serving a stale page. The value-first proposal claimed the opposite.
- **Not-found pages.** `global-not-found.js` is still experimental. With two root layouts, the plan uses a catch-all page that calls `notFound()` inside the shop route group.
- **Previous attempt.** The worktree `.wt-next` (branch `next/host`, excluded through `.git/info/exclude`) already contains the staged `api/ → handlers/` rename and 29 `pages/api` wrappers using `{ bodyParser: false, responseLimit: false }`. Nothing is committed there yet. Phase 1 continues from it.
- **Turbopack root.** That worktree sits inside another checkout that has its own `package-lock.json`. Next 16 may then pick the parent folder as the workspace root. Set `turbopack.root` and `outputFileTracingRoot` explicitly.
- **Rollback on Hobby.** Instant Rollback on the Hobby plan only reaches the immediately previous production deployment. After the merge, every admin save triggers a deploy-hook build, which is a new production deployment and uses up that slot. **`git revert` is therefore the primary rollback.** Instant Rollback is only a fallback while no hook build has run, and after any rollback the chosen deployment must be promoted again.
- **No logo image.** There is no `assets/img/logo.png`, so a "fixed brand og:image" needs an image from the owner.

Ideas rejected from the proposals:
- Hand-built `/_next/image` URLs in `templates.js`: they depend on an undocumented internal URL format.
- Passing build facts through `next.config` `env`: this breaks the "no `env` inlining" rule.
- Putting the revalidation secret in the hook URL's query string: it ends up in request logs.
- Dropping the committed snapshot fallback.
- Building ISR on top of the string renderer that is later deleted: that work would be thrown away.
- An App Router catch-all route in Phase 1.

## 4. Architecture decisions

| Decision | Why | Rejected |
|---|---|---|
| **Gradual migration in the same repo and Vercel project.** Next.js first serves today's generated files from `public/`; page families then move to App Router routes one at a time. | No domain or project swap. Pages not yet moved stay byte-identical. Every step is a revert away. | A separate Next project with a domain cutover (one big switch). A proxy to a second legacy deployment (two copies of env vars and crons). |
| **Handlers move from `api/` to `handlers/` at the same folder depth, and are mounted by two-line `pages/api/**.ts` wrappers** (`export { default } from …; export const config = { api: { bodyParser: false, responseLimit: false } }`). | The Pages Router passes the same Node `req`/`res` objects with `req.query` including `[id]` and `[slug]`, so no handler code changes. `bodyParser: false` lets `readBody` apply its own limits (about 4.4 MB for uploads, 4 MB + 64 KB for imports, 20 KB for forms, 4 KB for track); Next's 1 MB default would reject uploads and imports. Same folder depth means every `../lib` require still works. Vercel documents a root `api/` folder for non-Next frameworks only. | App Router route handlers with a Request/Response adapter: new code on the checkout path. Leaving `api/` at the root: functions could be duplicated or dropped. |
| **404s: until the 404 page is ported, a `fallback` rewrite `/:path*` → `/api/not-found`** returns the generated `404.html` with status 404. | Nothing in `app/` is needed for Phase 1, and the rewrite cannot shadow any dynamic API route. | `app/[...missing]/route.ts` in Phase 1. |
| **Header rules move from `vercel.json` to `next.config.ts`, copied in the same order** (the last match wins, as on Vercel today). | Framework-native, and `next start` reproduces them locally for parity checks. The fallback, if Vercel overrides `/assets` caching, is to keep only that block in `vercel.json`. | Rewriting the rules from scratch. |
| **The deploy hook and the build-time snapshot stay** until the optional freshness phase. Pages are static and read `data/products.json`, which the unchanged export step writes at build time. | `exported_at`, the admin's rebuild states, the hourly cron, the database-outage fallback and the stop on schema errors (SQLSTATE 42xxx) all keep working. | Rendering from the database on every request: an outage would take the shop down. |
| **Two root layouts in route groups:** `app/(shop)` (fonts, TikTok pixel in `<head>`) and `app/(admin)` (neither). Once the 404 is ported, unknown paths go through `app/(shop)/[...missing]/page.tsx` → `notFound()` → `(shop)/not-found.tsx`. | The pixel stays in `<head>` on storefront pages and can never reach the admin. No experimental flags are needed. | A single root layout, which would move the pixel into `<body>`. `global-not-found` (experimental). |
| **`.html` URLs come from literal route folders** such as `app/(shop)/privacy.html/page.tsx`, chosen by a spike at the start of Phase 3. `deploy-prepare.js` works out which legacy files to skip from those folder names. | One source of truth, no list to keep in sync, and extensionless URLs stay 404. Spike fallback: `app/(shop)/[page]/page.tsx` with a parameter list and `dynamicParams = false`, ported together with the 404 page. | Clean routes plus rewrites or redirects (duplicate URLs, redirect loops). Switching to clean URLs (SEO churn). |
| **Keep `assets/css/style.css` and `assets/js/app.js` as they are.** React server components render the same ids, classes and data attributes. A client component loads `products.js`, `catalog.js`, `templates.js` and `app.js`, in that order, after hydration. Links stay plain `<a>` (full page loads). | About 1,600 lines of cart, checkout, 409 handling, WhatsApp and TikTok behaviour keep working. Exactly one PageView per page load. React never re-renders nodes that `app.js` has bound. | Rewriting `app.js` before cutover. `next/link` soft navigation. |
| **Product cards, stars and review items stay `templates.js` strings** inside React. | `app.js` re-renders grids with the same functions, so there is one markup source and nothing can drift. They become TSX only when `app.js` is retired (Phase 10). | A TSX card plus a test that compares it with the string version. |
| **`data/catalog.js` gets an explicit-input factory, `create({settings, products, photos})`**, inside the existing UMD wrapper. | Removes state set at module load (the `SITE` mutation, reading `products.json` at require time). The browser path and the vm-based tests (`test-new-in.js`, `test-admin.js`) stay unchanged. | Re-deriving feeds and collections in TypeScript (two copies that would drift). |
| **Fix known defects in the old code first (Phase 2)**, each in its own commit. | Ports then copy correct behaviour, and parity reports never mix intended and accidental changes. | Fixing bugs during the port. |
| **SEO templates stay as they are.** `seo_title` and `seo_description` remain unused; sitemap `lastmod` stays the build date. | The migration must not move rankings. Using the database SEO fields is a separate owner decision. | Switching to the database SEO fields during the migration. |
| **Admin: client components calling the unchanged `/api/admin/**`**, with `guard()` as the only access control. It can start any time after Phase 1. | It carries no SEO risk and uses the same tested API. The CSRF header contract is unchanged. | Server Actions (which would bypass the `X-CSRF-Token` contract the tests check). Auth in `proxy.ts`/Edge (scrypt and the Neon driver need Node). |
| **Optional on-demand freshness (Phase 7)**, done only once storefront pages are React, through a `getShop()` swap and one route handler. | The ISR plumbing is built once, on the final code. `lib/rebuild.js` needs a two-line change and its 14 callers stay as they are. | ISR on the string renderer (thrown away later). A self-call through `VERCEL_URL`. A secret in the URL. |

## 5. URLs and SEO

- **Every current path keeps its status and bytes**: `/`, `/index.html`, the 4 category pages, 3 feeds, `/collections.html`, 4 `/collection-*.html` pages, `/search.html`, the 9 content pages, `/product/<slug>.html`, `/sitemap.xml`, `/robots.txt`, `/assets/**`, `/data/{products,catalog,templates}.js`, `/api/**` (including `/api/media/<id>`, which stays immutable), the two cron paths, and `/admin` plus the 14 clean `/admin/*` URLs.
- **Extensionless variants** (`/face`, `/product/x`) stay 404. `/x.html/` keeps its 308 to `/x.html`. Nothing new becomes indexable.
- **Canonical and `og:url`** stay exactly `https://www.sheglampk.online/` for home (both `/` and `/index.html`) and `https://www.sheglampk.online/<file>` elsewhere, joined with `/` (Phase 2 fixes the root cause of the backslash). In React they come from `metadataBase` plus `alternates.canonical`.
- **Intended SEO changes, all in Phase 2:**
  - `og:image` and the Product JSON-LD `image` become absolute (`https://www.sheglampk.online/api/media/N`). Today they resolve to `/product/api/media/N`, which returns 404.
  - Zero published products no longer crash the build.
- **sitemap.xml and robots.txt** keep the same URL set, order and priorities (1.0 / 0.8 / 0.7), and the same three robots lines. In Phase 6 they become route handlers that return byte-identical strings, not Next's `sitemap.ts`/`robots.ts`, whose output format differs (for example `User-Agent`).
- **Query contracts** (`?sub`, `?finish`, `?min`, `?max`, `?sort`, `?stock=1`, `?q`) stay with `app.js`. Server components never read `searchParams`, so pages stay static.
- **JSON-LD per page type** is unchanged: OnlineStore + WebSite SearchAction; BreadcrumbList + ItemList; ItemList; FAQPage; Product + BreadcrumbList, with aggregateRating only when there are approved reviews.
- **Admin:** clean URLs throughout. When a page is ported, `/admin/<x>.html` redirects to `/admin/<x>`.

## 6. Phases

### Phase 1: Next.js serves the unchanged site (one session, branch `next/host`, preview on the dev database)

**Scope.**
- Switch Vercel to the Next.js framework. `build.js` keeps generating every page; `deploy-prepare.js` writes them to `public/` instead of `dist/`.
- Move the handlers and mount them through `pages/api`.
- Move headers and rewrites into `next.config.ts`; add the fallback 404 handler and the parity tooling.
- No `app/` folder, no React pages, no database change.

**Deliverables.** See the checklist in section 8.

**Verification.**
1. `npm test` (route check plus the 11 suites) against the dev branch.
2. Local `npm run build && npx next start`, then a smoke test.
3. A baseline preview from `main` and a Next preview built back to back on the same dev branch. `parity.mjs` must show identical status, body hash and security headers for all 47 sitemap URLs, `index.html`, `404.html`, `robots.txt`, `sitemap.xml`, `/data/*.js`, all 15 admin URLs plus their `.html` files, sample `/assets` and `/api/media` files, and these probes:
   - `/face` and `/product/x` return 404;
   - `/face.html/` returns 308;
   - `/nope` and `/product/nope.html` return 404 with the legacy body, for both GET and HEAD;
   - `/api/admin/session` returns 401 JSON;
   - `/api/nope` returns 404.
4. A functional smoke test on the preview (checklist step 16).
5. In the deployment details: functions run in `sin1`, and only `pages/api` functions are listed.
6. After the merge: production compared with the saved production baseline, both crons visible in the logs, and no new 5xx errors for 24 hours.

**Rollback.** No data is touched. Primary: `git revert -m 1 <merge>` and push. Secondary: Instant Rollback to the recorded legacy deployment, which only works if no deploy-hook build has run since the merge; promote afterwards.

**What changes live.** Nothing visible. Two side effects:
- `readBody` limits now actually apply. No real form comes close to them; an oversized body gets the existing generic 500.
- The admin's "publishing" window grows by however long `next build` takes. Measure it and raise `PUBLISH_SECONDS` if needed.

### Phase 2: Fix known defects in the legacy code (intended changes, one commit each)

**Deliverables.**
- **`build.js:962`:** build the file key as `"product/" + slug + ".html"`, so the canonical and `og:url` can never contain `\`.
- **`build.js:435/455/969/778/976`:** make `og:image` and the JSON-LD images absolute. When there are no products, leave `og:image` out instead of throwing. Use a fixed brand image once the owner provides one.
- **`next.config.ts`:** move the `/(.*)` header rule first, so `/admin*` gets `DENY` and `no-referrer`.
- **`src/admin/login.html:48`:** accept `?next` only if it matches `^/admin(/|\?|$)` and does not start with `//`. This fixes the open redirect.
- **`assets/js/app.js`:**
  - delete the duplicate accordion binding at lines 874-877;
  - delete the `.radio` handler at lines 1117-1123, which throws a TypeError on the fixed COD box;
  - reset `checkoutKey` whenever the cart contents or `expectedTotal` change;
  - honour reduced motion in the hero's observer, visibility and mouseleave handlers;
  - read the page context with `(document.querySelector('[data-page]') || document.body).dataset` (lines 21-22, 793, 989). This makes no difference today and lets React pages put the context on `<main>`.
- **`scripts/parity-allow.json`:** list each of these intended differences.

**Verification.**
- `npm test`, and parity baseline vs fixed preview showing only the allow-listed differences.
- A crawler assertion that fails on any relative URL or `\` in a canonical, `og:*` or JSON-LD URL.
- Manual checks:
  - accordions open and close;
  - clicking the COD box logs no console error;
  - fail a submit, edit the cart, resubmit: a new `idempotencyKey` is sent;
  - `/admin/login?next=https://example.com` lands on `/admin`;
  - `curl -I /admin` shows `DENY`.
- A sharing debugger shows the product image.

**Rollback.** Revert the individual commit.

**What changes live.** Shared links show images, product-page accordions work, the admin cannot be framed, the login redirect is closed, and an edited cart can no longer replay an old order.

### Phase 3: React shell and the 9 content pages

**Deliverables.**
- **Spike first.** `app/(shop)/privacy.html/page.tsx` on a preview must return 200 `text/html`, with `/privacy` returning 404 and a cache HIT on the second request. If it does not, switch to the `[page]` fallback described in section 4.
- **`data/catalog.js`:** add `create({settings, products, photos})`.
- **`lib/shop.ts`** (`server-only`, wrapped in React `cache()`): reads `data/products.json` and the photo filenames, then calls `create()`. Add `types/shop.d.ts` for the shapes.
- **`app/(shop)/layout.tsx`:** fonts and preconnects, `style.css?v=<sha1>`, favicon, theme-color, the inline `SGPK_PHOTOS` script plus the image-error capture script, the TikTok pixel, and `metadataBase`.
- **`components/shop/{Header,Footer,Newsletter,Overlays,ShopPage,JsonLd}.tsx`:** ported from `build.js:91-427` with identical ids, classes and aria attributes, and plain `<a>` links with base `/`. `ShopPage` renders `<main id="main" data-page data-base="/" data-slug>`.
- **`components/shop/LegacyScripts.tsx`** (`'use client'`): in `useEffect`, append the four scripts with `async=false` and their `?v` hashes.
- **Content pages** (privacy, terms, size-guide first; then about, contact, faq with FAQPage JSON-LD, shipping, returns, track-order) ported from `src/content.js`. `generateMetadata` reproduces each title, description, canonical, `og:*` and twitter tag.
- **`deploy-prepare.js`** skips root files whose folder exists under `app/(shop)`.
- **`scripts/parity.mjs --normalize`:** compares title, meta, canonical, `og:*`, JSON-LD (deep-equal), the set of ids and classes, resolved links and visible text.
- **One Playwright spec** (dev dependency) for the shared chrome.

**Verification.**
- `npm test`, and `next build` including the type check.
- Normalized parity of the ported pages against the generated legacy files (build.js still writes them at build).
- Playwright on mobile emulation:
  - zero hydration or console errors;
  - newsletter, contact and track submit;
  - cart drawer and quantity;
  - Escape closes every overlay;
  - WhatsApp float href.
- TikTok Pixel Helper shows one PageView per load.
- Lighthouse mobile, median of 3, against the baseline: LCP within +10%, CLS within +0.02, TBT within +100 ms, HTML size within +30%. A page family that fails stays on the legacy route until fixed.

**Rollback.** Remove the page folder, or revert the commit; the legacy file is copied again.

**What changes live.** Nothing intended.

### Phase 4: Listing pages

Covers the 4 categories, 3 feeds, `collections.html`, the 4 collections and `search.html`.

**Deliverables.**
- The listing body with `#listing data-feed/data-collection/data-sort`, `#filterGroups`, `#chips`, `#sortSelect`, `#grid` and `#loadMore`.
- Grids render `T.card()` strings in the same order as today.
- ItemList (first 30) and BreadcrumbList JSON-LD.
- One commit per page family.

**Verification.**
- Normalized parity.
- Playwright: `?sub=` deep links from the mega menu; `?sort`, `?min`, `?max` and `?stock=1` round-trips; chips; View more; quick view shade swap; wishlist; header search and `search.html?q=`; the back button after `replaceState`.
- Lighthouse budget on `face.html` and `sale.html`.

**Rollback.** Remove the folder.

**What changes live.** Nothing intended.

### Phase 5: Product pages and the 404 page

**Deliverables.**
- **`app/(shop)/product/[file]/page.tsx`:**
  - `generateStaticParams` returns `${slug}.html` for every PUBLISHED product;
  - `dynamicParams = false`;
  - gallery, shades with `#shade`, stock line, quantity, buttons, 4 accordions, approved reviews (via `T.reviewItem`), related products, recently viewed;
  - Product JSON-LD with the offer price taken from the snapshot (`priceOf().final` at export), plus BreadcrumbList; `og:type product`.
- **`app/(shop)/not-found.tsx`:** the legacy 404 body, noindex and no canonical, plus a client component that polls for a just-published product (GET `/api/products/<slug>`, then HEAD every 15 s, up to 40 times).
- **`app/(shop)/[...missing]/page.tsx`:** calls `notFound()`.
- Delete the fallback rewrite and `pages/api/not-found.ts`. `deploy-prepare.js` stops copying `product/` and `404.html`.

**Verification.**
- Parity on every product URL: identical canonical, deep-equal JSON-LD, and an offer price equal to the snapshot.
- `/product/x.html`, `/product/x` and unpublished slugs return 404 with noindex, for GET and HEAD.
- `/api/admin/orders/<id>` and `/api/products/<slug>` still reach their handlers (the catch-all must not shadow them).
- Publishing a draft in the preview admin shows the "being published" state.
- Rich Results Test on two URLs.
- Playwright:
  - shade choice updates the stock line;
  - adding without a shade sends you to `#shade`;
  - Buy now and COD create a dev order;
  - changing a price in the dev admin between add and submit gives a 409, then the confirm goes through;
  - the success screen and WhatsApp text use the server's figures;
  - posting a review sends `kind=review` with the slug.

**Rollback.** Revert the commit; the legacy `product/` folder, `404.html` and the fallback rewrite come back.

**What changes live.** Nothing intended.

### Phase 6: Home page, then retire HTML generation

**Deliverables.**
- `app/(shop)/page.tsx`, plus `app/(shop)/index.html/page.tsx` re-exporting it with canonical `/`. Remove the `/` rewrite.
- Hero markup: the first slide has `src` and `preload=auto`; the others carry `data-src` and `data-src-mobile`; CTA hrefs are root-absolute.
- `app/sitemap.xml/route.ts` and `app/robots.txt/route.ts` (force-static, byte-identical strings). The sitemap builder moves from `build.js:1071-1088` to `lib/sitemap.js`.
- `app/data/products.js/route.ts`, returning the same `window.SGPK_SETTINGS=…;window.SGPK_PRODUCTS=…;` bytes.
- Delete `build.js` and `src/content.js`. Build becomes `node db/export-catalogue.js && node deploy-prepare.js && next build`. `deploy-prepare.js` keeps copying `assets/`, `data/{catalog,templates}.js` and `src/admin`, and keeps its leak scan.
- `git rm --cached` the root `*.html` files, `product/`, `sitemap.xml`, `robots.txt` and `data/products.js`. **Keep `data/products.json` and `data/hero.json` committed** as the fallback when the database is down at build time.

**Verification.**
- Full parity: production vs preview.
- robots and sitemap byte-identical, apart from the date.
- Outage drill: a preview whose `DATABASE_URL` cannot be reached still builds from the committed snapshot.
- Schema drill: a deliberate 42xxx error on a throwaway dev branch fails the build.
- Hero checks: only the active video plays; reduced motion stops autoplay; the mobile file is used at 900 px and below.
- Lighthouse on home.

**Rollback.** `git revert`; the generator and the committed outputs come back.

**What changes live.** None for customers.

### Phase 7 (recommended, gated): admin saves go live in seconds

**Deliverables.**
- **`lib/shop.ts` `getShop()`:**
  - reads `snapshot(new Date())` and the hero slides from the database, deduplicated per render with `cache()`;
  - on a transient error (any SQLSTATE except 42xxx) it falls back to the build-time `data/products.json`, traced into the function, and logs the error. `// ponytail:` this may show build-time data during an outage; checkout still prices on the server.
  - Product pages switch to `dynamicParams = true`, so new products render on their first request.
  - The 404 poller is removed.
- **`app/api/revalidate/route.ts`** (POST only):
  - checks the `x-revalidate-secret` header against `REVALIDATE_SECRET` with `timingSafeEqual`, and refuses when the secret is unset;
  - calls `revalidatePath('/', 'layout')`;
  - calls `markExported()`;
  - uses `after()` to GET every sitemap URL plus `/data/products.js`, so the regeneration happens on that request and not on a visitor's.
- **`lib/rebuild.js`:**
  - `callHook` sends `x-revalidate-secret`, and `x-vercel-protection-bypass` when set;
  - `PUBLISH_SECONDS` drops to 15 when `REVALIDATE_SECRET` is set;
  - `DEPLOY_HOOK_URL` becomes `https://www.sheglampk.online/api/revalidate` in production and the branch alias on preview;
  - the 14 callers are unchanged.
- **`test-catalogue.js`:** one case checking that the header is sent and never appears in error text.

**Gate on the preview.**
- A price edit is visible on the product page, its category, home and `/data/products.js` within 10 s, and checkout returns 200, not 409.
- Publishing makes the URL return 200 at once and adds it to the sitemap; unpublishing returns 404 and removes it from the grids and the sitemap.
- Settings, review approval and hero edits show.
- The admin banner goes queued, then live.
- A manual call to `/api/cron/refresh` revalidates instead of deploying.
- Unknown paths are not cached as 200.
- With the database blocked, pages still render.

**Rollback.** Point `DEPLOY_HOOK_URL` back to the saved Vercel deploy hook and unset `REVALIDATE_SECRET`, so pages are static per deploy again. Then `git revert`.

**What changes live.** Saves, stock changes, settings and sold-out checkouts appear within seconds. Saves no longer trigger builds.

### Phase 8: Admin shell and the simple pages (can start any time after Phase 1)

**Deliverables.**
- `app/(admin)/admin/layout.tsx`: `admin.css`, robots noindex/nofollow, no pixel. If Next overrides `no-store` on static admin pages, add `export const dynamic = 'force-dynamic'`.
- `lib/admin-client.ts`: ports `Admin.api`, `boot`, `esc`, `money` (`Rs.`, en-PK, 0 decimals) and `when` (en-GB). A 401 goes to `/admin/login?next=<same-origin /admin path>`; a 403 with `mustChangePassword` goes to `/admin/password`. Login and password use plain `fetch`, so there is no redirect loop.
- `AdminShell`: nav from `session.nav`, and a visible "no access" state on 403.
- Pages: login, password, dashboard, customers, analytics, audit (render the before and after values instead of `[object Object]`), inventory, inbox, settings, users (the one-time password rendered as text) and homepage.
- In the same commit as each page: delete its rewrite and `.html` file, and add a redirect `/admin/<x>.html` → `/admin/<x>`.

**Verification.**
- The API suites are unchanged.
- Playwright with dev SUPER_ADMIN and ADMIN accounts:
  - `?next` validation;
  - a forced password change does not loop;
  - every non-GET request carries `X-CSRF-Token`;
  - ADMIN sees 8 nav items and a no-access state on settings;
  - the rebuild toast appears;
  - the subscriber CSV has a BOM.
- Headers on `/admin*`: `no-store`, noindex, `DENY`, `no-referrer`.
- A secret scan of `.next/static`.

**Rollback.** Revert the page's commit.

**What changes live.** The admin looks the same; forbidden pages now say so.

### Phase 9: Admin orders, products list, import and product editor

**Deliverables.**
- **Orders:** the drawer and `?open=`; polling every 30 s while the drawer is closed and the tab is visible; notification resend; delete only with `orders:delete`.
- **Products list:** the `?saved` and `?deleted` notices, and a rebuild banner polling every 15 s.
- **Import:** analyse (POST) and apply (PUT), up to 4 MB.
- **Product editor:**
  - React keys are the shade id or `new-N`, never the array index;
  - image-to-shade links are kept by key and saved as the shade name;
  - `datetime-local` to ISO conversion stays in the browser;
  - the canvas eyedropper;
  - uploads through `/api/admin/upload`;
  - a read-only mode without `products:update`.

**Verification.**
- Make the same edits on two copies of a product, once in the legacy editor and once in the React editor. `GET /api/admin/products/<id>` and the audit `changes` must be identical.
- A sale entered for 10:00 PKT is stored as 05:00Z.
- A shade that has orders is retired, not deleted.

**Rollback.** Revert per page.

### Phase 10 (optional): replace `app.js` with React, one behaviour at a time

Write a Playwright end-to-end suite against the current `app.js` first. It covers:
- checkout success, the 409 path and the failure path;
- `ordersEnabled=false`;
- `localStorage` migration from numeric ids;
- the honeypot;
- the review minimums;
- filters, search and the hero.

Then port one module per commit and delete its code from `app.js`. Keep:
- the `sgpk_cart`, `sgpk_wishlist` and `sgpk_recent` storage contracts;
- the request bodies;
- the WhatsApp message formats;
- the TikTok event mapping.

Cards become TSX here, using `getImageProps()` for optimized images.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A root `api/` folder next to Next.js could duplicate or drop functions, checkout included | Rename it to `handlers/`. The build log must list only `pages/api` functions. |
| The 1 MB default body parser rejects uploads and imports | `bodyParser: false` on every wrapper, enforced by `test-routes.js`. Upload a 2.8 MB file and analyse a 3.5 MB CSV on the preview. |
| Header precedence differs from Vercel's static serving (public files default to `max-age=0`) | The baseline is real responses, not configuration. If `/assets` loses `immutable`, keep that one block in `vercel.json`. |
| A preview admin save rebuilds production, or a preview emails real customers (the dev branch is a copy of production) | Before the first preview: no `DEPLOY_HOOK_URL` and no mail provider keys in Preview scope; `DATABASE_URL` points at a dev branch of Neon project royal-forest-55498845. Do not call `/api/notifications/retry` on a preview that has mail configured. |
| Rollback after the merge: on Hobby, every deploy-hook build after the merge uses up the Instant Rollback slot | `git revert` is the primary rollback. Merge at a quiet hour and avoid admin saves for 30 minutes. Promote the chosen deployment after any Instant Rollback. |
| Turbopack picks the wrong workspace root in the nested `.wt-next` worktree | `turbopack.root` and `outputFileTracingRoot` set to `__dirname`. Remove the worktree after the merge. Exclude `.wt-*` in `tsconfig`. |
| Turbopack and CommonJS or the Neon driver bundling | Fall back to `serverExternalPackages: ['@neondatabase/serverless']` or `next build --webpack`. Never use the Edge runtime (the mailer needs net and tls; scrypt needs Node). |
| `db/client.js` throws at import when `DATABASE_URL` is missing | Local builds use `.env.local`. On Vercel the variable is present. |
| `IS_PROD` is true under `next start`, so login over plain `http://localhost` sets Secure cookies | Test admin login with `next dev`. |
| `.html` dynamic or literal segments may not prerender or serve as `text/html` | Spike at the start of Phase 3, with the documented fallbacks. |
| Hydration conflicts with `app.js` | Load it after hydration; plain `<a>` only; fail Playwright on any hydration warning; cards stay as shared strings. |
| Slower pages on mobile (React runtime plus RSC payload) | Lighthouse and HTML-size budget per page family. A family that fails stays on the legacy route. |
| The product editor unlinks photos from shades, or shifts sale times by 5 hours | Stable keys, time conversion in the browser, and the same edits compared between the legacy and React editors. |
| Admin password lock loop | `/api/admin/session` stays unguarded, and the password page uses plain `fetch`. |
| A database outage during an on-demand regeneration (Phase 7) | Warm requests right after the save; fall back to the build snapshot on transient errors; outage drill as part of the gate. |
| Stale generated files mislead people | Phase 6 untracks them. Until then, the parity report decides what is live. |

## 8. Phase 1 checklist (precise)

1. **Before any code (owner, Vercel dashboard, Production and Preview scopes):**
   - No Framework or Output Directory override exists; note the Node.js version.
   - Preview `DATABASE_URL` points at a dev branch of royal-forest-55498845.
   - Preview has no `DEPLOY_HOOK_URL` and no `RESEND_API_KEY`, `BREVO_API_KEY` or `SMTP_*`.
   - `CRON_SECRET` exists for Preview.
   - Turn on Protection Bypass for Automation and put the secret in `.env.local` as `VERCEL_AUTOMATION_BYPASS_SECRET`.
   - Record the current production deployment id and URL.
2. Work in the worktree `.wt-next` (branch `next/host`). Confirm the staged rename (`api/` → `handlers/`, 29 files) and the 29 wrappers in `pages/api/**`: correct relative depth, `export { default } from '…/handlers/…js'`, and `export const config = { api: { bodyParser: false, responseLimit: false } }`.
3. Change the handler path strings:
   - `test-api.js:52-59`
   - `test-orders.js:60-65`
   - `test-inbox.js` (lines 67, 116-131, 139, 174: `/api/…js` → `/handlers/…js`)
   - `test-media.js:22` only. Leave the URL values at lines 90 and 93.
4. `package.json`:
   - add `next` (exact current 16.3.x), `react` and `react-dom` (19.2.x, matching Next's peer range); add `typescript`, `@types/node` and `@types/react` as devDependencies;
   - `build` = `node db/export-catalogue.js && node build.js && node deploy-prepare.js && next build`;
   - `dev` = `node build.js && node deploy-prepare.js && next dev`;
   - `start` = `next start`;
   - prefix `test` with `node test-routes.js &&`;
   - set `engines.node` to the major production uses today (Next 16 needs at least 20.9).
5. `tsconfig.json`: Next defaults plus `allowJs: true`, `checkJs: false`, `strict: true`; exclude `node_modules`, `.next`, `public`, `dist`, `.wt-*`.
6. `next.config.ts`:
   - `poweredByHeader: false`;
   - `turbopack.root` and `outputFileTracingRoot` set to `__dirname`;
   - `headers()`: the 6 rules from `vercel.json`, verbatim and in the same order;
   - `rewrites()`: `{ afterFiles: [ '/' → '/index.html', plus the 15 admin rewrites ], fallback: [ '/:path*' → '/api/not-found' ] }`;
   - `outputFileTracingIncludes: { '/api/not-found': ['./public/404.html'] }`.
7. `pages/api/not-found.ts`: read `public/404.html` once (`path.join(process.cwd(), 'public', '404.html')`) and answer with status 404, `Content-Type: text/html; charset=utf-8` and `Cache-Control: public, max-age=0, must-revalidate`. HEAD gets no body. Config `bodyParser: false`.
8. `deploy-prepare.js`: change `OUT` (line 15) from `dist` to `public`, and update the console messages. The allow-list, deny list and leak scan are unchanged.
9. `.gitignore`: add `public/`, `.next/`, `next-env.d.ts` and `*.tsbuildinfo`.
10. `vercel.json`:
    - `framework: "nextjs"`, `buildCommand: "npm run build"`, keep `installCommand`;
    - remove `outputDirectory`, `cleanUrls`, `trailingSlash`, `rewrites` and `headers`;
    - keep `regions: ["sin1"]` and both crons unchanged.
11. `test-routes.js` (no database, about 25 lines): every `handlers/**/*.js` has exactly one `pages/api/<same path>.ts` that re-exports it with `bodyParser: false`, and every wrapper points at an existing handler (`not-found.ts` is the one exception).
12. `scripts/parity.mjs` (Node fetch, no dependencies):
    - inputs: base A, base B (optional), `--save` and `--allow scripts/parity-allow.json`;
    - URL set: base A's sitemap plus fixed probes (section 6, Phase 1);
    - records status, `Location`, `Cache-Control`, `X-Robots-Tag`, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`, `Content-Type` and the body sha256;
    - sends `x-vercel-protection-bypass`;
    - exits non-zero on any difference that is not allow-listed.
    
    Start the allow-list with `x-nextjs-*`, `x-vercel-*`, `Age`, `Date` and `ETag`, plus `Cache-Control` on HTML only if it moves between `public, max-age=0` and `public, max-age=0, must-revalidate`.
13. Delete `dev-server.js` and `server.js`. Change `.claude/launch.json` to one configuration (`npm run dev`, port 3000). Update the README's local-run and deploy paragraphs.
14. Local checks:
    - `npm test` (route check plus the 11 suites, against the dev branch);
    - `npm run build`: the build lists 30 `pages/api` routes;
    - `npx next start`: `/`, `/index.html`, `/face.html`, `/product/<slug>.html` and `/admin/orders` return 200; `/nope` and `/product/nope.html` return 404 with the legacy body; `/api/admin/session` returns 401 JSON; `/face.html/` returns 308.
    
    Commit: `chore: serve the existing site through Next.js (no output change)`.
15. Save the production baseline with `node scripts/parity.mjs https://www.sheglampk.online --save parity-prod-before.json`. Build the legacy preview with `git push origin main:refs/heads/parity-baseline`, then push `next/host`. Make no dev-database edits between the two builds.
16. Run `node scripts/parity.mjs <baseline-preview> <next-preview>`; it must be clean. Then a smoke test on the Next preview:
    - admin login with a dev test account; a non-GET without `X-CSRF-Token` gets 403; ADMIN gets 403 on settings;
    - a product save reports rebuild `not-configured`;
    - upload a 2.8 MB JPEG; analyse a 3.5 MB CSV; the subscriber CSV has a BOM;
    - a COD order with a stale `expectedTotal` gets 409, and resubmitting the quoted total gets 200;
    - the forms honeypot works; `/api/track` returns 404 for a wrong reference;
    - `/api/media/<id>` returns 200, then 304 with `If-None-Match`;
    - `curl -H "Authorization: Bearer $CRON_SECRET"` on `/api/cron/refresh` works (call `/api/notifications/retry` only if Preview has no mail keys);
    - the deployment shows region `sin1`; record the build duration.
17. Open a pull request with the parity report attached. Merge only after the owner agrees, at a quiet hour, with no admin saves for 30 minutes. After the merge:
    - run `node scripts/parity.mjs https://www.sheglampk.online` against `parity-prod-before.json`;
    - confirm the `:05` and `*/15` cron runs in the logs;
    - watch for 5xx errors for 24 hours;
    - raise `PUBLISH_SECONDS` in `lib/rebuild.js` if the extra build time pushes go-live past 120 s;
    - delete the `parity-baseline` branch and run `git worktree remove .wt-next`.
    
    Rollback: `git revert -m 1 <merge>` and push. Use Instant Rollback to the recorded deployment only if no deploy-hook build has run since the merge, then promote.
