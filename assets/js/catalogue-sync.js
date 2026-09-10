/* =========================================================
   catalogue-sync.js — keep the storefront current without a rebuild

   build.js bakes the catalogue into the HTML, which is what makes the
   site fast and readable with JavaScript off. But a baked page is only
   as current as the last deploy, and publishing a product must not
   require one.

   So: render the baked grid immediately, then ask the API what the
   catalogue actually is now. If it differs, swap the grids over. The
   pre-rendered markup is the floor; the database is the truth.

   Runs after app.js and touches only grid contents, so nothing here can
   break cart, search or checkout if the request fails.
   ========================================================= */
(function () {
  "use strict";

  var D = window.SGPK, T = window.SGPKT;
  if (!D || !T) return;                       // catalogue never loaded; nothing to sync

  var BASE = (document.body && document.body.dataset.base) || "";
  var PAGE = (document.body && document.body.dataset.page) || "";

  /* Grids that hold a plain product list. Curated sections (collections,
     "recently viewed") are left alone — they have their own rules. */
  var FEEDS = {
    index: null, face: "face", lips: "lips", eyes: "eyes", tools: "tools",
    "new": "new", best: "best", sale: "sale",
  };

  function money(n) {
    return "Rs. " + Number(n || 0).toLocaleString("en-PK");
  }

  /* Build the same card markup the server rendered, so a synced grid is
     indistinguishable from a baked one. */
  function cardFor(p, index) {
    var href = BASE + "product/" + p.slug + ".html";
    var img = (p.image || (p.images && p.images[0]) || "").replace(/^\//, "");
    var src = BASE + img;
    var flags = "";
    if (p.is_new_arrival) flags += '<span class="flag flag--new">New</span>';
    else if (p.is_bestseller) flags += '<span class="flag flag--best">Bestseller</span>';

    var priceHtml = p.salePrice
      ? '<span class="price">' + money(p.salePrice) + '</span><span class="price price--old">' + money(p.price) + "</span>"
      : '<span class="price">' + money(p.price) + "</span>";

    var swatches = "";
    if (p.variants && p.variants.length > 1) {
      swatches = '<div class="card__shades">' + p.variants.slice(0, 5).map(function (v) {
        return '<span class="card__swatch" style="background:' + (v.hex || "#e9e9ec") + '" title="' + esc(v.name) + '"></span>';
      }).join("") + (p.variants.length > 5 ? '<span class="card__swatch--more">+' + (p.variants.length - 5) + "</span>" : "") + "</div>";
    }

    return '<article class="card" data-id="' + esc(p.slug) + '" data-slug="' + esc(p.slug) + '">' +
      '<div class="card__media"><a href="' + href + '" aria-label="' + esc(p.name) + '">' +
      '<img src="' + esc(src) + '" alt="' + esc(p.name) + '" loading="lazy" width="500" height="600" ' +
      'data-fallback="' + esc(p.name.charAt(0)) + '"></a>' +
      (flags ? '<div class="card__flags">' + flags + "</div>" : "") +
      "</div>" +
      '<div class="card__body">' +
      '<h3 class="card__name"><a href="' + href + '">' + esc(p.name) + "</a></h3>" +
      swatches +
      '<div class="card__prices">' + priceHtml + "</div>" +
      (p.inStock
        ? '<button class="card__cta js-add" data-slug="' + esc(p.slug) + '">Add to Cart</button>'
        : '<button class="card__cta" disabled>Out of Stock</button>') +
      "</div></article>";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* A cheap signature of what is on the page now, so an unchanged
     catalogue causes no DOM work and no flicker. */
  function signature(list) {
    return list.map(function (p) {
      return p.slug + ":" + p.price + ":" + (p.salePrice || "") + ":" + (p.inStock ? 1 : 0);
    }).join("|");
  }

  function syncGrid(grid, products) {
    if (!products.length) {
      grid.innerHTML = '<p class="empty">No products in this section yet.</p>';
      return;
    }
    grid.innerHTML = products.map(cardFor).join("");
    // app.js binds add-to-cart and wishlist by delegation on document, so
    // replaced cards stay interactive without rebinding anything here.
    document.dispatchEvent(new CustomEvent("sgpk:catalogue-synced", { detail: { count: products.length } }));
  }

  function run() {
    var grid = document.querySelector(".grid");
    if (!grid) return;                                  // page has no product grid

    var params = new URLSearchParams();
    params.set("limit", "60");
    var feed = FEEDS[PAGE];
    if (feed === "face" || feed === "lips" || feed === "eyes") params.set("category", feed);
    else if (feed === "new") params.set("flag", "new");
    else if (feed === "best") params.set("flag", "bestseller");
    else if (feed === "sale") params.set("flag", "sale");

    fetch(BASE + "api/products?" + params.toString(), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.products)) return;   // keep the baked grid
        var live = data.products;
        // Only touch the DOM when the answer actually differs.
        if (signature(live) === signature(readBaked(grid))) return;
        syncGrid(grid, live);
      })
      .catch(function () { /* offline or API down: the baked grid stands */ });
  }

  /* Read the baked cards back into the same shape as the API response so
     the two can be compared without special-casing. */
  function readBaked(grid) {
    return Array.prototype.slice.call(grid.querySelectorAll(".card")).map(function (el) {
      var a = el.querySelector("a[href*='product/']");
      var slug = a ? (a.getAttribute("href") || "").split("/").pop().replace(".html", "") : "";
      var priceEl = el.querySelector(".price");
      var oldEl = el.querySelector(".price--old");
      var price = priceEl ? Number((priceEl.textContent || "").replace(/[^0-9]/g, "")) : 0;
      var old = oldEl ? Number((oldEl.textContent || "").replace(/[^0-9]/g, "")) : 0;
      return {
        slug: slug,
        price: old || price,
        salePrice: old ? price : null,
        inStock: !el.querySelector("button[disabled]"),
      };
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
