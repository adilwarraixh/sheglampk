/* =========================================================
   SHEGLAM PK — the home page's content
   home() returns the inner HTML of <main>; build.js wraps it in the
   shared header/footer/overlay chrome. The other content pages (about,
   contact, faq, …) are React: app/(shop)/<page>/page.tsx.
   ========================================================= */
const D = require("../data/catalog.js");
const T = require("../data/templates.js");

const { SITE, FEEDS, COLLECTIONS, money } = D;
const { esc, icon, card } = T;

/* ---------- shared bits ---------- */
const sechead = (tag, title, link) => `
<div class="sechead">
  <div>${tag ? `<span class="sechead__tag">${esc(tag)}</span>` : ""}<h2 class="sechead__title">${esc(title)}</h2></div>
  ${link ? `<a class="viewall" href="${link[1]}">${esc(link[0])} ${icon("chevronR", 15)}</a>` : ""}
</div>`;

/* =========================================================
   HOME
   ========================================================= */
function home() {
  /* The main grid must never render empty. Merchandising flags come from
     the admin, and a new shop has no bestsellers yet — the homepage was
     shipping with no products in its HTML at all, visible only to
     JavaScript-enabled visitors once the catalogue synced. Falling back to
     the catalogue keeps the page honest for crawlers and JS-off readers. */
  const flaggedBest = FEEDS.best();
  const best = (flaggedBest.length ? flaggedBest : FEEDS.all()).slice(0, 10);
  const bestHead = flaggedBest.length
    ? ["Worth the hype", "Bestsellers", ["View all", "best-sellers.html"]]
    : ["Shop the range", "Our products", null];

  const fresh = FEEDS.new().slice(0, 5);
  const onSale = FEEDS.sale().slice(0, 5);

  /* Hero content comes from data/hero.json so it can be edited in the admin
     without touching code. Disabled slides are dropped at build time. */
  const HERO = require("../data/hero.json");
  const slides = (HERO.slides || []).filter((s) => s.enabled !== false);

  /* The supplied clips are 576x1024 (9:16 portrait). Stretching those across
     a 16:9 desktop hero would crop away ~90% of the frame, so the video keeps
     its own portrait frame beside the copy on desktop and goes full-bleed on
     mobile, where 9:16 is native. Nothing is ever cropped destructively. */
  const posterFor = (s, i) =>
    s.poster ||
    "data:image/svg+xml," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 1024">` +
          `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
          `<stop offset="0" stop-color="#fdf4f7"/><stop offset="1" stop-color="#f2cdd9"/>` +
          `</linearGradient></defs><rect width="576" height="1024" fill="url(#g)"/></svg>`
      );

  return `
<section class="hero" id="hero">
  ${slides
    .map(
      (s, i) => `
  <div class="hero__slide${i === 0 ? " is-active" : ""}" data-slide="${esc(s.id || "slide-" + (i + 1))}">
    <div class="container hero__inner">
      <div class="hero__copy">
        ${s.eyebrow ? `<span class="hero__eyebrow">${esc(s.eyebrow)}</span>` : ""}
        <h1 class="hero__title">${esc(s.headline || "").replace(/\n/g, "<br>")}</h1>
        ${s.sub ? `<p class="hero__sub">${esc(s.sub)}</p>` : ""}
        <div class="hero__btns">
          ${s.ctaLabel ? `<a class="btn btn--primary btn--lg" href="${esc(s.ctaHref || "#")}">${esc(s.ctaLabel)}</a>` : ""}
          ${s.cta2Label ? `<a class="btn btn--outline btn--lg" href="${esc(s.cta2Href || "#")}">${esc(s.cta2Label)}</a>` : ""}
        </div>
      </div>
      <div class="hero__art">
        <video
          class="hero__video"
          ${i === 0 ? 'preload="auto"' : 'preload="none"'}
          data-src="${esc(s.video)}"
          ${s.videoMobile ? `data-src-mobile="${esc(s.videoMobile)}"` : ""}
          ${i === 0 ? `src="${esc(s.video)}"` : ""}
          poster="${posterFor(s, i)}"
          muted playsinline loop disablepictureinpicture
          tabindex="-1" aria-hidden="true"
          style="object-position:${esc(s.focal || "center")}"></video>
      </div>
    </div>
  </div>`
    )
    .join("")}
  <button class="hero__arrow hero__arrow--prev" id="heroPrev" aria-label="Previous slide">${icon("chevronR", 18, 2)}</button>
  <button class="hero__arrow hero__arrow--next" id="heroNext" aria-label="Next slide">${icon("chevronR", 18, 2)}</button>
  <div class="hero__dots" id="heroDots" role="tablist" aria-label="Hero slides"></div>
</section>

<section class="services">
  <div class="container services__grid">
    <div class="service">${icon("truck", 24)}<div><strong>Free delivery over ${money(SITE.freeShippingOver)}</strong><span>Flat ${money(SITE.flatShipping)} nationwide otherwise</span></div></div>
    <div class="service">${icon("shield", 24)}<div><strong>100% genuine stock</strong><span>Sealed and batch-checked</span></div></div>
    <div class="service">${icon("refresh", 24)}<div><strong>${SITE.returnDays}-day returns</strong><span>On unopened items</span></div></div>
    <div class="service">${icon("chat", 24)}<div><strong>Shade help on WhatsApp</strong><span>Ask before you buy</span></div></div>
  </div>
</section>

${/* The "Shop by category" tiles are gone. They used stock photography
      showing other brands' products — Bobbi Brown, tarte, NARS — which has
      no place on a SHEGLAM stockist's homepage, and the counts exposed
      empty categories. The header nav already covers category browsing. */ ""}

<section class="section section--alt">
  <div class="container">
    ${sechead(bestHead[0], bestHead[1], bestHead[2])}
    <div class="grid">${best.map((p) => card(p, "")).join("")}</div>
  </div>
</section>

<section class="section">
  <div class="container">
    ${sechead("Curated edits", "Collections", ["All collections", "collections.html"])}
    <div class="colgrid">
      ${COLLECTIONS.slice(0, 2)
        .map(
          (c) => `
      <a class="colcard" href="${c.page}" style="background:linear-gradient(140deg,${c.tint},${c.tint}cc)">
        <span>${esc(c.sub)}</span><h3>${esc(c.title)}</h3><p>${esc(c.blurb)}</p>
        <em>Shop ${c.ids.length} product${c.ids.length === 1 ? "" : "s"}</em>
      </a>`
        )
        .join("")}
    </div>
  </div>
</section>

${fresh.length ? `
<section class="section section--warm">
  <div class="container">
    ${sechead("Just landed", "New in", ["View all", "new-in.html"])}
    <div class="grid">${fresh.map((p) => card(p, "")).join("")}</div>
  </div>
</section>` : ""}

${onSale.length ? `
<section class="section">
  <div class="container">
    ${sechead("Limited time", "On sale", ["All offers", "sale.html"])}
    <div class="grid">${onSale.map((p) => card(p, "")).join("")}</div>
  </div>
</section>` : ""}

<section class="section section--alt">
  <div class="container">
    ${sechead("Why shop with us", "Buying makeup online in Pakistan, without the guesswork")}
    <div class="valuegrid">
      <div class="valuecard">
        <div class="valuecard__icon">${icon("shield", 22)}</div>
        <h3>Genuine, or your money back</h3>
        <p>Every batch is checked on arrival. If you ever receive something you believe is not genuine, send us photos and we refund you in full — no argument.</p>
      </div>
      <div class="valuecard">
        <div class="valuecard__icon">${icon("chat", 22)}</div>
        <h3>Shade matching before you buy</h3>
        <p>Send a daylight photo on WhatsApp and we will recommend a foundation or concealer shade. If it still comes out wrong, we exchange it.</p>
      </div>
      <div class="valuecard">
        <div class="valuecard__icon">${icon("box", 22)}</div>
        <h3>Real stock, real dispatch times</h3>
        <p>We only list what is physically on our shelf. Nothing is dropshipped, so orders leave within one to two working days.</p>
      </div>
    </div>
  </div>
</section>`;
}

module.exports = { home };
