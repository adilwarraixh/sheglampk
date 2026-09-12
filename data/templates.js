/* =========================================================
   SHEGLAM PK — shared render templates
   Pure string builders with no DOM access, so the Node build
   script and the browser runtime produce IDENTICAL markup.
   Loaded as window.SGPKT in the browser, require()d in build.js.
   ========================================================= */
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("./catalog.js") : root.SGPK
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SGPKT = api;
})(typeof self !== "undefined" ? self : this, function (SGPK) {
  "use strict";

  const { money } = SGPK;

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  /* Product image paths are stored relative to the site root. Pages in a
     subfolder (product/*.html) need the base prefix or the browser resolves
     them against the subfolder and 404s. Data URIs are already complete. */
  const imgSrc = (src, base) =>
    !src || /^(data:|https?:|\/)/.test(src) ? src : (base || "") + src;

  /* A shade swatch. The colour is typed in the admin portal and lands in a
     style attribute, so only a strict #rgb / #rrggbb value is used. A shade
     with no colour shows its own photo instead, and one with neither shows
     a neutral — never the literal "background:null" that left swatches
     blank. */
  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  function swatchStyle(s, base) {
    const hex = s && String(s.hex || "").trim();
    if (hex && HEX.test(hex)) return `background:${hex}`;
    if (s && s.image && /^[\w\/.\-]+$/.test(s.image))
      return `background:#f3f3f4 url('${imgSrc(s.image, base)}') center/cover`;
    return "background:#e9e9ec";
  }

  /* ---------- Icon set ---------- */
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    cart: '<path d="M6 8h12l-1.2 12H7.2L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    heart: '<path d="M12 20.5S3.5 15 3.5 9.2A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 8.5 2.2c0 5.8-8.5 11.3-8.5 11.3Z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
    chevron: '<polyline points="6 9 12 15 18 9"/>',
    chevronR: '<polyline points="9 6 15 12 9 18"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    truck: '<path d="M1 4h13v11H1z"/><path d="M14 8h4l3 3v4h-7z"/><circle cx="5.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>',
    refresh: '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/>',
    shield: '<path d="M12 3l7 3v6c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V6l7-3Z"/>',
    chat: '<path d="M21 12a8 8 0 1 1-3.3-6.4"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
    filter: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/>',
    box: '<path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/>',
    leaf: '<path d="M20 4C10 4 4 9 4 17v3"/><path d="M20 4c0 9-5 13-13 13"/>',
  };

  const icon = (name, size = 20, sw = 1.6) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  const BRAND_SVG = {
    whatsapp: '<path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.6-6.1c-.25-.13-1.5-.74-1.73-.82-.23-.09-.4-.13-.57.12-.17.25-.65.82-.8.99-.15.17-.29.19-.54.06a6.7 6.7 0 0 1-1.97-1.21 7.4 7.4 0 0 1-1.36-1.7c-.14-.24 0-.37.11-.5l.37-.43c.12-.15.16-.25.25-.42.08-.17.04-.31-.02-.44-.06-.12-.57-1.38-.79-1.89-.2-.49-.41-.42-.57-.43h-.48a.94.94 0 0 0-.68.31 2.83 2.83 0 0 0-.89 2.1c0 1.24.9 2.44 1.03 2.6.13.18 1.78 2.72 4.32 3.81.6.26 1.07.42 1.44.53.6.2 1.15.17 1.59.1.48-.07 1.5-.61 1.71-1.2.21-.6.21-1.1.15-1.2-.06-.11-.23-.17-.48-.3Z"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="17.4" cy="6.6" r="1.2" fill="currentColor"/>',
    facebook: '<path fill="currentColor" d="M13.8 9.2H17l-.6 3.6h-2.6V21h-3.7v-8.2H8v-3.6h2.1V7.4c0-2.4 1.4-3.8 3.6-3.8h2.6v3.4h-1.7c-.6 0-.8.3-.8.9v1.3Z"/>',
    tiktok: '<path fill="currentColor" d="M16.5 3c.3 2.1 1.6 3.4 3.6 3.6v2.6c-1.3.1-2.5-.3-3.6-1v5.9c0 4.7-4.4 6.9-8 4.6-2.3-1.5-2.9-4.7-1.4-7 1.2-1.9 3.4-2.6 5.5-2.1v2.8c-.4-.1-.8-.2-1.2-.2-1.3 0-2.3 1-2.3 2.3s1 2.3 2.3 2.3 2.4-1 2.4-2.4V3h2.7Z"/>',
  };
  const brandIcon = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${BRAND_SVG[name] || ""}</svg>`;

  /* ---------- Logo ----------
     Set as live text so it stays crisp at any size, loads with no extra
     request, and inherits the site's font. The sparkle sits over the G,
     matching the supplied artwork.

     To use the original PNG instead, drop it at assets/img/logo.png —
     build.js detects it and swaps this out automatically.
  */
  const SPARKLE =
    '<svg class="logo__spark" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="currentColor" d="M12 0c0 6.6 5.4 12 12 12-6.6 0-12 5.4-12 12 0-6.6-5.4-12-12-12C6.6 12 12 6.6 12 0Z"/></svg>';

  function logo(base, hasImage, opts) {
    const o = opts || {};
    const inner = hasImage
      ? `<img class="logo__img" src="${base}assets/img/logo.png" alt="SHEGLAM.PK" width="180" height="40">`
      : `<span class="logo__word">SHE<span class="logo__g">${SPARKLE}G</span>LAM<span class="logo__tld">.PK</span></span>`;
    return `<a class="logo${o.cls ? " " + o.cls : ""}" href="${base}index.html" aria-label="SHEGLAM.PK home">${inner}</a>`;
  }

  /* ---------- Small pieces ---------- */
  function stars(rating, size) {
    let out = "";
    for (let i = 1; i <= 5; i++) out += `<span class="${i <= Math.round(rating) ? "" : "off"}">&#9733;</span>`;
    return `<span class="stars"${size ? ` style="font-size:${size}px"` : ""}>${out}</span>`;
  }

  function priceBlock(p) {
    if (!p.oldPrice) return `<span class="price">${money(p.price)}</span>`;
    return `<span class="price">${money(p.price)}</span>
      <span class="price--old">${money(p.oldPrice)}</span>
      <span class="price--off">-${p.discount}%</span>`;
  }

  function swatchRow(p, max = 5, base = "") {
    if (!p.shades || !p.shades.length) return "";
    const shown = p.shades.slice(0, max)
      .map((s) => `<span class="card__swatch" style="${swatchStyle(s, base)}" title="${esc(s.name)}"></span>`)
      .join("");
    const more = p.shades.length > max
      ? `<span class="card__swatch--more">+${p.shades.length - max}</span>` : "";
    return `<div class="card__shades">${shown}${more}</div>`;
  }

  function flags(p) {
    let out = "";
    if (!p.inStock) out += `<span class="flag flag--out">Sold out</span>`;
    if (p.oldPrice) out += `<span class="flag flag--sale">-${p.discount}%</span>`;
    if (p.isNew) out += `<span class="flag flag--new">New</span>`;
    if (p.isBestSeller && !p.isNew) out += `<span class="flag flag--best">Bestseller</span>`;
    return out ? `<div class="card__flags">${out}</div>` : "";
  }

  /* ---------- Product card ---------- */
  function card(p, base = "") {
    const href = `${base}product/${p.slug}.html`;
    // The image already carries a Bestseller/New flag, so this line is kept
    // for the offer message rather than repeating the badge.
    const promo = p.oldPrice ? `<p class="card__promo">Save ${money(p.oldPrice - p.price)}</p>` : "";
    const rating = p.reviewCount
      ? `<div class="card__rating">${stars(p.rating)} <span>${p.rating} (${p.reviewCount})</span></div>` : "";
    /* Keyed by slug. p.id is the product's position in this build's
       catalogue and moves when a product is unpublished, so a cart saved
       against it could later point at a different product. */
    const key = esc(p.slug);
    return `<article class="card" data-id="${key}">
  <div class="card__media">
    <a href="${href}" aria-label="${esc(p.name)}">
      <img src="${imgSrc(p.image, base)}" alt="${esc(p.name)}" loading="lazy" width="500" height="600"
           data-tile="${p.tile}" data-fallback="${esc(p.name.charAt(0))}">
    </a>
    ${flags(p)}
    <button class="card__wish js-wish" data-id="${key}" aria-label="Save ${esc(p.name)} to wishlist">${icon("heart", 17)}</button>
    <button class="card__quick js-quick" data-id="${key}">Quick view</button>
  </div>
  ${promo}
  <h3 class="card__name"><a href="${href}">${esc(p.name)}</a></h3>
  ${swatchRow(p, 5, base)}
  ${rating}
  <div class="card__prices">${priceBlock(p)}</div>
  <button class="card__cta js-add" data-id="${key}" ${p.inStock ? "" : "disabled"}>${p.inStock ? "Add to Cart" : "Sold out"}</button>
</article>`;
  }

  const grid = (products, base = "", cls = "grid") =>
    `<div class="${cls}">${products.map((p) => card(p, base)).join("\n")}</div>`;

  /* ---------- Reviews ---------- */
  function reviewItem(r) {
    return `<article class="review" data-rating="${r.r}" data-shade="${esc(r.s || "")}">
  <div class="review__top">
    ${stars(r.r)}
    <span class="review__who">${esc(r.a)}</span>
    ${r.v ? `<span class="review__verified">Verified purchase</span>` : ""}
    <span class="review__date">${esc(r.d)}</span>
  </div>
  ${r.s ? `<div class="review__shade">Shade: ${esc(r.s)}</div>` : ""}
  <p class="review__text">${esc(r.t)}</p>
</article>`;
  }

  function crumbs(items) {
    const parts = items.map((it, i) =>
      i === items.length - 1
        ? `<span aria-current="page">${esc(it.label)}</span>`
        : `<a href="${it.href}">${esc(it.label)}</a><span class="sep">/</span>`
    );
    return `<nav class="crumbs container" aria-label="Breadcrumb">${parts.join("")}</nav>`;
  }

  return { esc, imgSrc, swatchStyle, icon, brandIcon, logo, stars, priceBlock, swatchRow, flags, card, grid, reviewItem, crumbs, money };
});
