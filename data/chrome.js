/* =========================================================
   data/chrome.js — the shop's shared page chrome

   The header, newsletter band, footer and overlays (cart, quick view,
   checkout, review), the <head> constants, and the helpers that keep
   page addresses clean and inline JSON safe. build.js renders the pages
   it still generates with these, and the React pages in app/(shop) render
   the same strings, so both kinds of page look and behave identically —
   app.js binds to these ids and classes — until build.js is retired.

   Paths are resolved from the project root (process.cwd()): this file is
   also bundled into the Next.js server, where __dirname is not the source
   folder. Builds always run from the project root.
   ========================================================= */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const D = require("./catalog.js");
const T = require("./templates.js");

const { SITE, CATEGORIES, PRODUCTS, COLLECTIONS, PROMOS, FEEDS, money } = D;
const { esc, icon, brandIcon, card, stars } = T;
const ROOT = process.cwd();

/* Splits a list into columns of at most size items (the mega menu). */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.filter((c) => c.length);
}

/* A file's content hash, for the ?v= on scripts and stylesheets. */
const version = (rel, dir = ROOT) =>
  crypto.createHash("sha1").update(fs.readFileSync(path.join(dir, rel))).digest("hex").slice(0, 10);

/* Pages are still files named x.html here, but every address a customer,
   a crawler or a link sees is clean: /face, /product/<slug>, / for home.
   next.config.ts redirects each old .html address there permanently and
   serves the file behind the clean one. cleanLinks() is the one place a
   page's links, canonical, og:url and JSON-LD URLs are made clean, so no
   template can leak an .html address. */
const cleanPath = (file) => file.replace(/\\/g, "/").replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "");
const DOMAIN_RE = new RegExp(SITE.domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/((?:[a-z0-9-]+/)*)([a-z0-9-]+)\\.html", "g");
const cleanLinks = (html) => html
  .replace(DOMAIN_RE, (m, dir, name) => `${SITE.domain}/${dir}${name === "index" ? "" : name}`)
  .replace(/href="((?:\.\.\/|\/)?(?:[a-z0-9-]+\/)*)([a-z0-9-]+)\.html(?=[?#"])/g,
    (m, pre, name) => `href="${name === "index" ? (pre || "/") : pre + name}`);

/* JSON placed inside a <script> element. A "</script>" or "<!--" in any
   value — a product name, an approved customer review, a collection
   title — would otherwise end the element and run as markup. Escaped,
   it is the same JSON to every parser and stays data. */
const scriptJson = (v, space) => JSON.stringify(v, null, space)
  .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
  .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");


const FONT = "https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap";

/* Drop your logo artwork at assets/img/logo.png and it replaces the text
   wordmark everywhere, automatically. */
const HAS_LOGO = fs.existsSync(path.join(ROOT, "assets", "img", "logo.png"));

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e83e70"/><path fill="#fff" d="M32 12c0 11 9 20 20 20-11 0-20 9-20 20 0-11-9-20-20-20 11 0 20-9 20-20Z"/></svg>`
  );

/* TikTok Pixel, as supplied by TikTok Events Manager. It goes in the <head>
   of every storefront page — the home page included — because TikTok can
   only attribute product views, add-to-carts and orders on pages that load
   it. The admin portal is not built here, so it never loads the pixel. The
   ID is public by design; set SITE.tiktokPixel to "" to switch it off. */
const TIKTOK_PIXEL = /^[A-Z0-9]{10,32}$/.test(SITE.tiktokPixel || "") ? `<!-- TikTok Pixel Code Start -->
<script>
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(
var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script")
;n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};


  ttq.load('${SITE.tiktokPixel}');
  ttq.page();
}(window, document, 'ttq');
</script>
<!-- TikTok Pixel Code End -->` : "";


/* =========================================================
   CHROME
   ========================================================= */

function buildHeader(page, base) {
  const link = (href, label, key, extra = "") =>
    `<a class="nav__link ${extra} ${page === key ? "is-active" : ""}" href="${base}${href}">${label}</a>`;

  const mega = (cat) => `
    <div class="mega">
      <div class="container mega__inner">
        ${chunk(cat.sub, Math.ceil(cat.sub.length / 3)).map((col) => `
          <div class="mega__col">
            <h4>${esc(cat.label)}</h4>
            ${col.map((s) => `<a href="${base}${cat.page}?sub=${encodeURIComponent(s)}">${esc(s)}</a>`).join("")}
          </div>`).join("")}
        <div class="mega__col">
          <h4>Shop by</h4>
          <a href="${base}new-in.html">New arrivals</a>
          <a href="${base}best-sellers.html">Bestsellers</a>
          <a href="${base}sale.html">On sale</a>
          <a href="${base}${cat.page}">All ${esc(cat.label.toLowerCase())}</a>
        </div>
        <div class="mega__promo">
          <span>Free delivery</span>
          <strong>On every order over ${money(SITE.freeShippingOver)}</strong>
          <p>Cash on delivery available nationwide.</p>
          <a class="viewall" href="${base}${cat.page}">Shop now ${icon("chevronR", 15)}</a>
        </div>
      </div>
    </div>`;

  const catNav = CATEGORIES.filter((c) => c.key !== "tools")
    .map((c) => `<li class="has-mega">${link(c.page, `${c.label} ${icon("chevron", 13, 2)}`, c.key, "nav__chev-wrap")}${mega(c)}</li>`)
    .join("");

  return `
<a class="sr-only" href="#main">Skip to content</a>
<header class="header" id="header">
  <div class="topbar">
    <button class="topbar__nav" id="promoPrev" aria-label="Previous announcement">&#8249;</button>
    <p class="topbar__text" id="promoText">${esc(PROMOS[0])}</p>
    <button class="topbar__nav" id="promoNext" aria-label="Next announcement">&#8250;</button>
  </div>

  <div class="brandtabs">
    <div class="brandtabs__pill">
      <a class="brandtabs__tab is-active" href="${base}index.html">SHEGLAM COSMETICS</a>
      <a class="brandtabs__tab" href="${base}tools.html">TOOLS &amp; SETS</a>
    </div>
  </div>

  <div class="container navbar">
    <button class="hamburger" id="hamburger" aria-label="Open menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>

    ${T.logo(base, HAS_LOGO)}

    <nav class="nav" id="nav" aria-label="Primary">
      <ul class="nav__list">
        <li>${link("new-in.html", "New", "new")}</li>
        <li>${link("best-sellers.html", "Best Sellers", "best")}</li>
        ${catNav}
        <li>${link("tools.html", "Tools &amp; Others", "tools")}</li>
        <li>${link("sale.html", "Sale", "sale", "nav__link--sale")}</li>
        <li>${link("collections.html", "Collections", "collections")}</li>
        <li>${link("about.html", "About", "about")}</li>
      </ul>
    </nav>

    <div class="actions">
      <button class="iconbtn" id="searchToggle" aria-label="Search">${icon("search")}</button>
      <div class="region" id="region">
        <button class="iconbtn" id="regionToggle" aria-label="Region and currency">${icon("globe")}</button>
        <div class="region__menu">
          <p>Region</p>
          <button class="is-active">Pakistan &middot; PKR</button>
          <p>Delivery</p>
          <button>Nationwide &middot; 2&ndash;5 days</button>
        </div>
      </div>
      <button class="iconbtn" id="accountBtn" aria-label="Account">${icon("user")}</button>
      <button class="iconbtn" id="wishToggle" aria-label="Wishlist">${icon("heart")}<span class="badge" id="wishCount">0</span></button>
      <button class="iconbtn" id="cartToggle" aria-label="Cart">${icon("cart")}<span class="badge" id="cartCount">0</span></button>
    </div>
  </div>

  <div class="searchbar" id="searchbar" aria-hidden="true">
    <div class="container searchbar__inner">
      <div class="searchbar__field">
        ${icon("search", 19)}
        <input type="search" id="searchInput" placeholder="Search for primer, blush, lip gloss…" aria-label="Search products">
      </div>
      <div class="searchbar__hints">
        <button type="button">primer</button><button type="button">blush</button>
        <button type="button">setting spray</button><button type="button">lip gloss</button>
        <button type="button">concealer</button><button type="button">mascara</button>
      </div>
      <div class="searchres" id="searchRes"></div>
    </div>
  </div>
</header>
<div class="overlay" id="overlay"></div>`;
}

function buildNewsletter(base) {
  return `
<section class="newsletter">
  <div class="container newsletter__inner">
    <h2>Glam With Us</h2>
    <p>Be first to know about new drops, restocks and discounts.</p>
    <form class="newsletter__form" id="newsletterForm" novalidate>
      <input type="email" id="newsletterEmail" placeholder="Enter your email" aria-label="Email address" required>
      <div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
      <button class="btn" type="submit">Subscribe</button>
    </form>
    <p class="formmsg" id="newsletterMsg" role="status"></p>
    <p class="newsletter__fine">By subscribing you agree to receive marketing emails from ${esc(SITE.name)}.
      You can unsubscribe at any time. See our <a href="${base}privacy.html">Privacy Policy</a>.</p>
  </div>
</section>`;
}

function buildFooter(base) {
  const col = (title, links) => `
    <div>
      <h4>${title}</h4>
      <ul class="footer__links">
        ${links.map((l) => `<li><a href="${base}${l[1]}">${l[0]}</a></li>`).join("")}
      </ul>
    </div>`;

  return `
<footer class="footer">
  <div class="container footer__grid">
    <div class="footer__brand">
      ${T.logo(base, HAS_LOGO)}
      <p>${esc(SITE.tagline)}. Genuine stock, honest prices, cash on delivery nationwide.</p>
      <div class="socials">
        <a href="${SITE.instagram}" target="_blank" rel="noopener" aria-label="Instagram">${brandIcon("instagram")}</a>
        <a href="${SITE.facebook}" target="_blank" rel="noopener" aria-label="Facebook">${brandIcon("facebook")}</a>
        <a href="${SITE.tiktok}" target="_blank" rel="noopener" aria-label="TikTok">${brandIcon("tiktok")}</a>
        <a href="https://wa.me/${SITE.whatsapp}" target="_blank" rel="noopener" aria-label="WhatsApp">${brandIcon("whatsapp")}</a>
      </div>
      <div class="footer__pay">
        <span>Cash on Delivery</span>
      </div>
    </div>
    ${col("Shop", [
      ["New In", "new-in.html"], ["Bestsellers", "best-sellers.html"], ["Face", "face.html"],
      ["Eyes", "eyes.html"], ["Lips", "lips.html"], ["Tools &amp; Others", "tools.html"], ["Sale", "sale.html"],
    ])}
    ${col("Help", [
      ["FAQs", "faq.html"], ["Contact Us", "contact.html"], ["Shipping &amp; Delivery", "shipping.html"],
      ["Returns &amp; Refunds", "returns.html"], ["Shade &amp; Size Guide", "size-guide.html"], ["Track Your Order", "track-order.html"],
    ])}
    ${col("About", [
      ["Our Story", "about.html"], ["Collections", "collections.html"],
      ["Privacy Policy", "privacy.html"], ["Terms &amp; Conditions", "terms.html"],
    ])}
  </div>
  <div class="container footer__bottom">
    <p class="footer__legal">${esc(SITE.disclaimer)}</p>
    <div class="footer__copy">
      <span>&copy; ${new Date().getFullYear()} ${esc(SITE.name)}. All rights reserved.</span>
      <span>${esc(SITE.address)} &middot; <a href="mailto:${SITE.email}">${esc(SITE.email)}</a></span>
    </div>
  </div>
</footer>`;
}

function buildOverlays(base) {
  return `
<aside class="drawer" id="cartDrawer" aria-hidden="true" aria-label="Shopping cart">
  <div class="drawer__head">
    <h3>Your Cart</h3>
    <button class="iconbtn" id="cartClose" aria-label="Close cart">${icon("close", 18)}</button>
  </div>
  <div class="drawer__body" id="cartItems"></div>
  <div class="drawer__foot">
    <p class="drawer__ship" id="cartShipNote"></p>
    <div class="drawer__total"><span>Subtotal</span><strong id="cartSubtotal">Rs. 0</strong></div>
    <button class="btn btn--primary btn--block" id="checkoutBtn" disabled>Checkout</button>
    <a class="btn btn--wa btn--block is-disabled" id="cartWa" target="_blank" rel="noopener">
      ${brandIcon("whatsapp", 18)} Order on WhatsApp</a>
  </div>
</aside>

<aside class="drawer" id="wishDrawer" aria-hidden="true" aria-label="Wishlist">
  <div class="drawer__head">
    <h3>Wishlist</h3>
    <button class="iconbtn" id="wishClose" aria-label="Close wishlist">${icon("close", 18)}</button>
  </div>
  <div class="drawer__body" id="wishItems"></div>
</aside>

<div class="modal" id="quickView" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Quick view">
  <div class="modal__box">
    <button class="modal__x" id="qvClose" aria-label="Close">${icon("close", 16)}</button>
    <div class="modal__scroll" id="qvBody"></div>
  </div>
</div>

<div class="modal" id="checkoutModal" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="coTitle">
  <div class="modal__box">
    <button class="modal__x" id="coClose" aria-label="Close checkout">${icon("close", 16)}</button>
    <div class="modal__scroll">
      <div id="coFormState">
        <div class="checkout">
          <div class="checkout__summary">
            <h3>Order Summary</h3>
            <div class="checkout__lines" id="coLines"></div>
            <div class="cototals">
              <div><span>Subtotal</span><span id="coSub">Rs. 0</span></div>
              <div><span>Delivery</span><span id="coShip">Free</span></div>
              <div class="grand"><span>Total</span><span id="coTotal">Rs. 0</span></div>
            </div>
          </div>
          <div class="checkout__form">
            <h3 id="coTitle">Delivery details</h3>
            <p>We deliver nationwide in 2&ndash;5 working days.</p>
            <form id="coForm" novalidate>
              <div class="field">
                <label for="coName">Full name</label>
                <input type="text" id="coName" autocomplete="name" placeholder="e.g. Ayesha Khan">
                <small class="err" data-for="coName"></small>
              </div>
              <div class="field--row">
                <div class="field">
                  <label for="coPhone">Mobile number</label>
                  <input type="tel" id="coPhone" autocomplete="tel" placeholder="0322 0305000">
                  <small class="err" data-for="coPhone"></small>
                </div>
                <div class="field">
                  <label for="coCity">City</label>
                  <input type="text" id="coCity" autocomplete="address-level2" placeholder="Lahore">
                  <small class="err" data-for="coCity"></small>
                </div>
              </div>
              <div class="field">
                <label for="coAddress">Delivery address</label>
                <textarea id="coAddress" rows="3" autocomplete="street-address" placeholder="House / flat, street, area, nearest landmark"></textarea>
                <small class="err" data-for="coAddress"></small>
              </div>
              <div class="field">
                <label for="coEmail">Email <span style="color:var(--menu);font-weight:400">(optional)</span></label>
                <input type="email" id="coEmail" autocomplete="email" placeholder="you@example.com">
                <small class="err" data-for="coEmail"></small>
              </div>
              <div class="field">
                <label for="coNotes">Order notes <span style="color:var(--menu);font-weight:400">(optional)</span></label>
                <textarea id="coNotes" rows="2" placeholder="Anything we should know?"></textarea>
              </div>

              <div class="formerr" id="coError" role="alert" hidden></div>

              <h3 style="margin:22px 0 12px;font-size:15px">Payment method</h3>
              <!-- Cash on delivery is the only method accepted, so this states
                   it rather than offering a choice of one. api/orders.js
                   enforces the same thing server-side. -->
              <div class="radios">
                <div class="radio is-on is-fixed">
                  <span><strong>Cash on Delivery</strong><span>Pay the courier when your parcel arrives. No advance payment, no extra fee.</span></span>
                </div>
              </div>

              <button class="btn btn--primary btn--block btn--lg" type="submit" id="coSubmit">Place order</button>
              <p style="font-size:12.5px;color:var(--muted);margin-top:12px;text-align:center">
                By placing this order you agree to our <a href="${base}terms.html" style="color:var(--rose)">Terms</a>
                and <a href="${base}returns.html" style="color:var(--rose)">Returns Policy</a>.</p>
            </form>
          </div>
        </div>
      </div>

      <div id="coDoneState" style="display:none">
        <div class="confirm">
          <div class="confirm__tick">${icon("check", 30, 2.6)}</div>
          <h3>Order received</h3>
          <p>Thank you! We'll confirm your order on WhatsApp shortly and share tracking once it ships.</p>
          <div class="confirm__ref"><span>Your order reference</span><b id="coRef">SG-0000</b></div>
          <p class="formmsg" id="coWarn" style="display:none;font-size:13.5px;max-width:440px;margin:0 auto 18px;line-height:1.65"></p>
          <div class="confirm__actions">
            <a class="btn btn--wa" id="coWa" target="_blank" rel="noopener">${brandIcon("whatsapp", 18)} Confirm on WhatsApp</a>
            <button class="btn btn--outline" id="coContinue">Continue shopping</button>
          </div>
          <p class="confirm__note">Save your reference — you can look it up any time on the
            <a href="${base}track-order.html" style="color:var(--rose)">Track Order</a> page.</p>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="modal" id="reviewModal" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Write a review">
  <div class="modal__box" style="max-width:520px">
    <button class="modal__x" id="rvClose" aria-label="Close">${icon("close", 16)}</button>
    <div class="modal__scroll" style="padding:32px 28px">
      <h3 style="font-size:19px;margin-bottom:6px">Write a review</h3>
      <p style="font-size:13.5px;color:var(--muted);margin-bottom:20px">We read every review before it appears. Add your order
        reference if you have it, so we can mark yours as a verified purchase.</p>
      <form id="reviewForm" novalidate>
        <div class="field">
          <label>Your rating</label>
          <div class="starpick" id="starpick">
            ${[1, 2, 3, 4, 5].map((n) => `
              <label data-star="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">
                <input type="radio" name="rvStars" value="${n}">
                <span>&#9733;</span>
              </label>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="rvName">Your name</label>
          <input type="text" id="rvName" placeholder="e.g. Ayesha K.">
        </div>
        <div class="field" id="rvShadeField" style="display:none">
          <label for="rvShadeIn">Shade <span style="color:var(--menu);font-weight:400">(optional)</span></label>
          <select id="rvShadeIn"></select>
        </div>
        <div class="field">
          <label for="rvText">Your review</label>
          <textarea id="rvText" rows="4" placeholder="How did it wear? Would you buy it again?"></textarea>
        </div>
        <div class="field">
          <label for="rvOrder">Order reference <span style="color:var(--menu);font-weight:400">(optional)</span></label>
          <input type="text" id="rvOrder" placeholder="SG-2610-ABCDE" autocomplete="off">
        </div>
        <div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <button class="btn btn--primary btn--block" type="submit">Submit review</button>
      </form>
    </div>
  </div>
</div>

<a class="wafloat" href="https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent("Hello " + SITE.name + "! I have a question.")}"
   target="_blank" rel="noopener" aria-label="Chat on WhatsApp">${brandIcon("whatsapp", 24)}<span>Chat with us</span></a>
<button class="backtop" id="backTop" aria-label="Back to top">${icon("chevron", 18, 2)}</button>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`;
}


module.exports = {
  FONT, FAVICON, TIKTOK_PIXEL, HAS_LOGO,
  buildHeader, buildNewsletter, buildFooter, buildOverlays,
  cleanPath, cleanLinks, scriptJson, version,
};
