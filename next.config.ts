/* Next.js hosts the shop exactly as the static deployment did (Phase 1 of
   docs/NEXTJS-MIGRATION-PLAN.md): build.js + deploy-prepare.js still write
   every page into public/, and pages/api mounts the handlers unchanged.
   The routing and headers below are vercel.json's, in the same order. */
import type { NextConfig } from "next";
import { existsSync, readdirSync } from "fs";

/* Clean addresses. build.js writes each page as a file (face.html,
   product/<slug>.html) into public/, but customers, Google and every link
   use /face and /product/<slug>. The list comes from the files actually
   built, so an unknown address is never guessed at: it gets the 404 page.
   Pages ported to React live at the clean address themselves, and a
   React route wins over the rewrite to its old file. */
const htmlIn = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)) : [];
const PAGES = htmlIn("public").filter((p) => p !== "index" && p !== "404");
const PRODUCTS = htmlIn("public/product");
// Pages React renders itself (app/(shop)/<name>/page.tsx); their old .html addresses redirect too.
const SHOP_APP = "app/(shop)";
const REACT_PAGES = existsSync(SHOP_APP)
  ? readdirSync(SHOP_APP).filter((d) => /^[a-z0-9-]+$/.test(d) && existsSync(`${SHOP_APP}/${d}/page.tsx`))
  : [];

const ADMIN_PAGES = [
  "login", "orders", "password", "products", "product", "inventory", "customers",
  "analytics", "audit", "users", "homepage", "settings", "import", "inbox", "collections",
];

const h = (pairs: Record<string, string>) => Object.entries(pairs).map(([key, value]) => ({ key, value }));
const ADMIN_HEADERS = h({
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
});

const config: NextConfig = {
  poweredByHeader: false,
  trailingSlash: false,

  // Old .html addresses move permanently (308), keeping any ?query.
  async redirects() {
    return [
      { source: "/index.html", destination: "/", permanent: true },
      ...PAGES.concat(REACT_PAGES).map((p) => ({ source: `/${p}.html`, destination: `/${p}`, permanent: true })),
      ...PRODUCTS.map((s) => ({ source: `/product/${s}.html`, destination: `/product/${s}`, permanent: true })),
    ];
  },

  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        { source: "/", destination: "/index.html" },
        { source: "/admin", destination: "/admin/index.html" },
        ...ADMIN_PAGES.map((p) => ({ source: `/admin/${p}`, destination: `/admin/${p}.html` })),
        ...PAGES.map((p) => ({ source: `/${p}`, destination: `/${p}.html` })),
        ...PRODUCTS.map((s) => ({ source: `/product/${s}`, destination: `/product/${s}.html` })),
      ],
      // Anything else gets the shop's own 404 page, with status 404.
      fallback: [{ source: "/:path*", destination: "/api/not-found" }],
    };
  },

  // When several rules set the same header, the last one wins, as on Vercel.
  async headers() {
    return [
      { source: "/assets/:path*", headers: h({ "Cache-Control": "public, max-age=31536000, immutable" }) },
      { source: "/admin", headers: ADMIN_HEADERS },
      { source: "/admin/:path*", headers: ADMIN_HEADERS },
      { source: "/api/:path*", headers: h({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }) },
      // The handler sets its own caching: a year on an image, an hour on a redirect to Blob.
      { source: "/api/media/:path*", headers: h({
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "all",
      }) },
      { source: "/:path*", headers: h({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      }) },
    ];
  },

  // The 404 route reads the generated page at run time.
  outputFileTracingIncludes: { "/api/not-found": ["./public/404.html"] },

  // This folder, not a parent checkout that has its own lockfile.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
};

export default config;
