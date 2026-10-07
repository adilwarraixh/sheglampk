/* The document every React shop page shares: fonts, the stylesheet, the
   favicon, the photo list and image fallback that must run while the page
   parses, and the TikTok Pixel — the same <head> generated pages have. */
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { C, D, SITE, V } from "@/lib/shop";
import LegacyScripts from "@/components/shop/LegacyScripts";

export const metadata: Metadata = { metadataBase: new URL(SITE.domain) };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#e83e70" };

const HEAD_SCRIPT = `window.SGPK_PHOTOS=${C.scriptJson(D.PHOTOS || [])};
addEventListener("error",function(e){
  var el=e.target;
  if(!el||el.tagName!=="IMG"||el.dataset.failed)return;
  el.dataset.failed="1";
  if(el.dataset.tile)el.src=el.dataset.tile;
},true);`;
// The pixel snippet as TikTok supplies it, without its <script> wrapper.
const PIXEL = (String(C.TIKTOK_PIXEL).match(/<script>([\s\S]*)<\/script>/) || [])[1] || "";

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href={C.FAVICON} />
        <link rel="apple-touch-icon" href={C.FAVICON} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="preconnect" href="https://images.unsplash.com" />
        <link rel="stylesheet" href={C.FONT} />
        <link rel="stylesheet" href={`/assets/css/style.css?v=${V.css}`} />
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT }} />
        {PIXEL ? <script dangerouslySetInnerHTML={{ __html: PIXEL }} /> : null}
      </head>
      <body>
        {children}
        <LegacyScripts v={V} />
      </body>
    </html>
  );
}
