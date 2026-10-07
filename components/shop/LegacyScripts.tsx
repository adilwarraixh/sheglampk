"use client";
/* The shop's browser code — product data, catalogue, card templates and
   app.js (cart, checkout, search, forms, TikTok events) — added once React
   has taken over the page, in order. Loading it earlier would let app.js
   change the page before React has matched it to the server's HTML. */
import { useEffect } from "react";

export default function LegacyScripts({ v }: { v: Record<string, string> }) {
  useEffect(() => {
    const w = window as unknown as { __sgpkScripts?: boolean };
    if (w.__sgpkScripts) return;          // once, even if React runs effects twice
    w.__sgpkScripts = true;
    for (const src of [
      `/data/products.js?v=${v.products}`, `/data/catalog.js?v=${v.catalog}`,
      `/data/templates.js?v=${v.templates}`, `/assets/js/app.js?v=${v.app}`,
    ]) {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;                    // run in the order added
      document.body.appendChild(s);
    }
  }, [v]);
  return null;
}
