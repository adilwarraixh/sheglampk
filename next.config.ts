/* Next.js hosts the shop exactly as the static deployment did (Phase 1 of
   docs/NEXTJS-MIGRATION-PLAN.md): build.js + deploy-prepare.js still write
   every page into public/, and pages/api mounts the handlers unchanged.
   The routing and headers below are vercel.json's, in the same order. */
import type { NextConfig } from "next";

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

  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        { source: "/", destination: "/index.html" },
        { source: "/admin", destination: "/admin/index.html" },
        ...ADMIN_PAGES.map((p) => ({ source: `/admin/${p}`, destination: `/admin/${p}.html` })),
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
