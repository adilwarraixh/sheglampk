/* =========================================================
   SHEGLAM PK — static page content
   Each entry returns the inner HTML of <main>. build.js wraps
   these in the shared header/footer/overlay chrome.
   ========================================================= */
const D = require("../data/catalog.js");
const T = require("../data/templates.js");

const { SITE, CATEGORIES, FEEDS, COLLECTIONS, FAQ, PRODUCTS, money, photoFor } = D;
const { esc, icon, brandIcon, card } = T;

/* ---------- shared bits ---------- */
const crumbs = (items) =>
  `<div class="container"><nav class="crumbs" aria-label="Breadcrumb">${items
    .map((it, i) =>
      i === items.length - 1
        ? `<span aria-current="page">${esc(it.label)}</span>`
        : `<a href="${it.href}">${esc(it.label)}</a><span class="sep">/</span>`
    )
    .join("")}</nav></div>`;

const pagehead = (title, sub) => `
<section class="pagehead">
  <div class="container">
    <h1>${esc(title)}</h1>
    ${sub ? `<p>${esc(sub)}</p>` : ""}
  </div>
</section>`;

const sechead = (tag, title, link) => `
<div class="sechead">
  <div>${tag ? `<span class="sechead__tag">${esc(tag)}</span>` : ""}<h2 class="sechead__title">${esc(title)}</h2></div>
  ${link ? `<a class="viewall" href="${link[1]}">${esc(link[0])} ${icon("chevronR", 15)}</a>` : ""}
</div>`;

const accordion = (items) => `
<div class="acc">
  ${items
    .map(
      (it, i) => `
  <div class="acc__item${i === 0 ? " is-open" : ""}">
    <button class="acc__btn" type="button">${esc(it.q)} ${icon("plus", 16)}</button>
    <div class="acc__body"><p>${it.a}</p></div>
  </div>`
    )
    .join("")}
</div>`;

/* =========================================================
   HOME
   ========================================================= */
function home() {
  const best = FEEDS.best().slice(0, 10);
  const fresh = FEEDS.new().slice(0, 5);
  const onSale = FEEDS.sale().slice(0, 5);

  const slides = [
    {
      eyebrow: "Genuine stock · Cash on delivery",
      title: "Bold beauty,<br>honest prices",
      sub: "The full SHEGLAM range, stocked in Pakistan and delivered to your door in 2–5 days.",
      cta: ["Shop bestsellers", "best-sellers.html"],
      cta2: ["New arrivals", "new-in.html"],
      img: photoFor(0, 1000),
    },
    {
      eyebrow: "The Camera On Edit",
      title: "A base that<br>survives the heat",
      sub: "Blurring primer, powder balm and a setting spray built for Pakistani summers.",
      cta: ["Shop the edit", "collection-camera-on-complexion.html"],
      cta2: ["All face makeup", "face.html"],
      img: photoFor(5, 1000),
    },
    {
      eyebrow: "Under Rs. 2,000",
      title: "Build a full kit<br>for less",
      sub: "A complete face of makeup that still leaves change from a five thousand rupee note.",
      cta: ["Shop under Rs. 2,000", "collection-under-2000.html"],
      cta2: ["View sale", "sale.html"],
      img: photoFor(9, 1000),
    },
  ];

  return `
<section class="hero">
  ${slides
    .map(
      (s, i) => `
  <div class="hero__slide${i === 0 ? " is-active" : ""}">
    <div class="container hero__inner">
      <div>
        <span class="hero__eyebrow">${esc(s.eyebrow)}</span>
        <h1 class="hero__title">${s.title}</h1>
        <p class="hero__sub">${esc(s.sub)}</p>
        <div class="hero__btns">
          <a class="btn btn--primary btn--lg" href="${s.cta[1]}">${esc(s.cta[0])}</a>
          <a class="btn btn--outline btn--lg" href="${s.cta2[1]}">${esc(s.cta2[0])}</a>
        </div>
      </div>
      <div class="hero__art">
        <img src="${s.img}" alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} width="1000" height="1200" data-fallback="SG">
      </div>
    </div>
  </div>`
    )
    .join("")}
  <button class="hero__arrow hero__arrow--prev" id="heroPrev" aria-label="Previous slide">${icon("chevronR", 18, 2)}</button>
  <button class="hero__arrow hero__arrow--next" id="heroNext" aria-label="Next slide">${icon("chevronR", 18, 2)}</button>
  <div class="hero__dots" id="heroDots"></div>
</section>

<section class="services">
  <div class="container services__grid">
    <div class="service">${icon("truck", 24)}<div><strong>Free delivery over Rs. 3,500</strong><span>Flat Rs. 250 nationwide otherwise</span></div></div>
    <div class="service">${icon("shield", 24)}<div><strong>100% genuine stock</strong><span>Sealed and batch-checked</span></div></div>
    <div class="service">${icon("refresh", 24)}<div><strong>7-day returns</strong><span>On unopened items</span></div></div>
    <div class="service">${icon("chat", 24)}<div><strong>Shade help on WhatsApp</strong><span>Ask before you buy</span></div></div>
  </div>
</section>

<section class="section">
  <div class="container">
    ${sechead("Shop by category", "Find your thing")}
    <div class="cattiles">
      ${CATEGORIES.map(
        (c, i) => `
      <a class="cattile" href="${c.page}">
        <img src="${photoFor(i * 4 + 2, 600)}" alt="${esc(c.label)}" loading="lazy" width="600" height="600" data-fallback="${esc(c.label.charAt(0))}">
        <div class="cattile__body"><h3>${esc(c.label)}</h3><span>${FEEDS[c.key]().length} products</span></div>
      </a>`
      ).join("")}
    </div>
  </div>
</section>

<section class="section section--alt">
  <div class="container">
    ${sechead("Worth the hype", "Bestsellers", ["View all", "best-sellers.html"])}
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
        <em>Shop ${c.ids.length} products</em>
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

/* =========================================================
   STATIC PAGES
   ========================================================= */
function pages() {
  const out = [];

  /* ---------------- ABOUT ---------------- */
  out.push({
    file: "about.html",
    page: "about",
    title: `About Us | ${SITE.name}`,
    description: "Who we are: an independent Pakistani stockist bringing genuine SHEGLAM makeup to Lahore, Karachi, Islamabad and everywhere in between.",
    body: `
${pagehead("About SHEGLAM PK", "An independent stockist bringing genuine SHEGLAM makeup to Pakistan.")}
${crumbs([{ label: "Home", href: "index.html" }, { label: "About" }])}
<div class="container--narrow prose">
  <p>SHEGLAM PK started because buying good makeup in Pakistan was harder than it needed to be. The products people actually wanted were either unavailable, wildly marked up, or sold by pages that vanished the moment something went wrong.</p>
  <p>We stock the SHEGLAM range ourselves, in Lahore. Everything on this site is physically on our shelf — we do not dropship, and we do not list things we cannot ship the same week. That is why our dispatch times are one to two working days rather than "please allow 3–4 weeks".</p>

  <div class="note"><strong>To be completely clear:</strong> ${esc(SITE.disclaimer)}</div>

  <h2>What we care about</h2>
  <h3>Genuine product, checked on arrival</h3>
  <p>Counterfeit cosmetics are a real problem in this market, and they are not just a waste of money — unregulated formulas end up on your face. We buy sealed stock and check batch codes when it lands. If you ever receive something you believe is not genuine, send us photos and we refund you in full.</p>

  <h3>Prices that make sense</h3>
  <p>Import duty and shipping are real costs and we are not going to pretend otherwise. What we will not do is mark something up four times and call it "premium". Our pricing is posted openly on every product page, and there are no surprise charges at checkout.</p>

  <h3>Help before you buy, not just after</h3>
  <p>Most returns happen because someone guessed a shade. Message us on WhatsApp with a photo in natural light before you order and we will tell you honestly which shade to pick — including telling you when we think a product is not right for you.</p>

  <h2>Delivery across Pakistan</h2>
  <p>We deliver to every city in Pakistan with cash on delivery. Lahore, Karachi and Islamabad typically arrive in 2–3 days; everywhere else is 3–5 days. Orders over Rs. 3,500 ship free, and everything else is a flat Rs. 250.</p>

  <h2>Talk to us</h2>
  <p>We are a small team and we answer our own messages. WhatsApp is fastest — <a href="https://wa.me/${SITE.whatsapp}" target="_blank" rel="noopener">${esc(SITE.phoneShow)}</a> — or email <a href="mailto:${SITE.email}">${esc(SITE.email)}</a>. Full details are on the <a href="contact.html">contact page</a>.</p>
</div>

<section class="section section--alt">
  <div class="container">
    ${sechead("", "Start with the bestsellers", ["View all", "best-sellers.html"])}
    <div class="grid">${FEEDS.best().slice(0, 5).map((p) => card(p, "")).join("")}</div>
  </div>
</section>`,
  });

  /* ---------------- CONTACT ---------------- */
  out.push({
    file: "contact.html",
    page: "contact",
    title: `Contact Us | ${SITE.name}`,
    description: `Get in touch with ${SITE.name}. WhatsApp ${SITE.phoneShow}, email ${SITE.email}, or send us a message — we reply within one working day.`,
    body: `
${pagehead("Contact us", "Questions about an order, a shade or a product? We answer our own messages.")}
${crumbs([{ label: "Home", href: "index.html" }, { label: "Contact" }])}
<div class="container" style="padding:44px 0 64px">
  <div class="contactgrid">
    <div>
      <h2 style="font-size:20px;margin-bottom:10px">Reach us directly</h2>
      <p style="color:var(--muted);font-size:14.5px;line-height:1.7">WhatsApp is by far the fastest — we usually reply within a couple of hours during the day.</p>
      <ul class="contactlist">
        <li>
          <span class="contactlist__icon">${brandIcon("whatsapp", 18)}</span>
          <span><strong>WhatsApp</strong><a href="https://wa.me/${SITE.whatsapp}" target="_blank" rel="noopener">${esc(SITE.phoneShow)}</a></span>
        </li>
        <li>
          <span class="contactlist__icon">${icon("chat", 18)}</span>
          <span><strong>Call us</strong><a href="tel:${SITE.phoneTel}">${esc(SITE.phoneShow)}</a></span>
        </li>
        <li>
          <span class="contactlist__icon">${icon("box", 18)}</span>
          <span><strong>Email</strong><a href="mailto:${SITE.email}">${esc(SITE.email)}</a></span>
        </li>
        <li>
          <span class="contactlist__icon">${icon("truck", 18)}</span>
          <span><strong>Based in</strong><span>${esc(SITE.address)} — online only, no walk-in counter</span></span>
        </li>
      </ul>
      <div class="note" style="margin-top:20px;background:var(--bg-warm);border-left:3px solid var(--brand);padding:14px 18px;border-radius:0 8px 8px 0;font-size:14px">
        <strong>Order enquiry?</strong> Have your order reference ready (it looks like SG-2601-ABCDE) and we can look it up straight away.
      </div>
      <h3 style="font-size:16px;margin:26px 0 10px">Hours</h3>
      <p style="color:var(--muted);font-size:14.5px">Monday to Saturday, 10am – 8pm PKT. Messages sent on Sunday are answered Monday morning.</p>
    </div>

    <div class="formcard">
      <h2 style="font-size:18px;margin-bottom:6px">Send a message</h2>
      <p style="color:var(--muted);font-size:14px;margin-bottom:20px">We reply within one working day.</p>
      <form id="contactForm" novalidate>
        <div class="field">
          <label for="ctName">Your name</label>
          <input type="text" id="ctName" placeholder="Ayesha Khan" autocomplete="name">
          <small class="err" data-for="ctName"></small>
        </div>
        <div class="field">
          <label for="ctEmail">Email</label>
          <input type="email" id="ctEmail" placeholder="you@example.com" autocomplete="email">
          <small class="err" data-for="ctEmail"></small>
        </div>
        <div class="field">
          <label for="ctPhone">Mobile <span style="color:var(--menu);font-weight:400">(optional)</span></label>
          <input type="tel" id="ctPhone" placeholder="0322 0305000" autocomplete="tel">
          <small class="err" data-for="ctPhone"></small>
        </div>
        <div class="field">
          <label for="ctMessage">Message</label>
          <textarea id="ctMessage" rows="5" placeholder="How can we help?"></textarea>
          <small class="err" data-for="ctMessage"></small>
        </div>
        <button class="btn btn--primary btn--block" type="submit">Send message</button>
        <p class="formmsg" id="contactMsg" role="status" style="margin-top:12px;font-size:14px;min-height:1.2em"></p>
      </form>
    </div>
  </div>
</div>`,
  });

  /* ---------------- FAQ ---------------- */
  out.push({
    file: "faq.html",
    page: "faq",
    title: `FAQs — Orders, Delivery, Returns | ${SITE.name}`,
    description: "Answers to the questions we get asked most: delivery times, cash on delivery, returns, shade matching and product authenticity.",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQ.flatMap((g) =>
          g.items.map((it) => ({
            "@type": "Question",
            name: it.q,
            acceptedAnswer: { "@type": "Answer", text: it.a },
          }))
        ),
      },
    ],
    body: `
${pagehead("Frequently asked questions", "Delivery, returns, payments and product questions — answered plainly.")}
${crumbs([{ label: "Home", href: "index.html" }, { label: "FAQs" }])}
<div class="container--narrow prose">
  ${FAQ.map(
    (g) => `
  <div class="faqgroup">
    <h2>${esc(g.group)}</h2>
    ${accordion(g.items.map((it) => ({ q: it.q, a: esc(it.a) })))}
  </div>`
  ).join("")}

  <div class="note" style="margin-top:32px">
    <strong>Still stuck?</strong> Message us on
    <a href="https://wa.me/${SITE.whatsapp}" target="_blank" rel="noopener">WhatsApp</a>
    or use the <a href="contact.html">contact form</a> — a real person will get back to you.
  </div>
</div>`,
  });

  /* ---------------- SHIPPING ---------------- */
  out.push({
    file: "shipping.html",
    page: "shipping",
    title: `Shipping & Delivery | ${SITE.name}`,
    description: "Delivery charges, timelines and courier information for orders across Pakistan. Free delivery over Rs. 3,500, flat Rs. 250 otherwise.",
    body: `
${pagehead("Shipping & delivery", "What it costs, how long it takes, and what happens if something goes wrong.")}
${crumbs([{ label: "Home", href: "index.html" }, { label: "Shipping" }])}
<div class="container--narrow prose">
  <h2>Delivery charges</h2>
  <table>
    <thead><tr><th>Order value</th><th>Delivery charge</th></tr></thead>
    <tbody>
      <tr><td>Rs. 3,500 and above</td><td><strong>Free</strong></td></tr>
      <tr><td>Below Rs. 3,500</td><td>Rs. 250 flat, anywhere in Pakistan</td></tr>
    </tbody>
  </table>
  <p>There is no extra charge for choosing cash on delivery.</p>

  <h2>Delivery timelines</h2>
  <table>
    <thead><tr><th>Destination</th><th>Estimated delivery</th></tr></thead>
    <tbody>
      <tr><td>Lahore</td><td>2–3 working days</td></tr>
      <tr><td>Karachi &amp; Islamabad / Rawalpindi</td><td>2–3 working days</td></tr>
      <tr><td>Faisalabad, Multan, Peshawar, Sialkot, Gujranwala</td><td>3–4 working days</td></tr>
      <tr><td>All other cities and towns</td><td>3–5 working days</td></tr>
      <tr><td>Gilgit-Baltistan &amp; remote areas</td><td>5–8 working days</td></tr>
    </tbody>
  </table>
  <div class="note">Timelines start from dispatch, not from when you place the order. We dispatch within 1–2 working days of receiving an order.</div>

  <h2>Tracking</h2>
  <p>As soon as your parcel is booked with the courier we send the tracking number to your WhatsApp number. You can also look up your order any time on the <a href="track-order.html">Track Order</a> page using the reference from your confirmation.</p>

  <h2>Payment methods</h2>
  <ul>
    <li><strong>Cash on delivery</strong> — pay the courier when the parcel arrives. Available nationwide, no extra fee.</li>
    <li><strong>Easypaisa / JazzCash</strong> — we send account details on WhatsApp once you place the order.</li>
    <li><strong>Bank transfer</strong> — same, details shared on confirmation.</li>
  </ul>

  <h2>If something goes wrong</h2>
  <ul>
    <li><strong>Parcel not arrived in the estimated window?</strong> Message us with your reference and we will chase the courier the same day.</li>
    <li><strong>Damaged in transit?</strong> Send photos within 48 hours of delivery and we will replace it free, including delivery charges.</li>
    <li><strong>Wrong item received?</strong> Same — photos within 48 hours and we make it right at our cost.</li>
    <li><strong>Refused or undelivered COD orders</strong> may mean we ask for advance payment on future orders. We are a small business and courier return charges are real.</li>
  </ul>

  <h2>Questions</h2>
  <p>WhatsApp <a href="https://wa.me/${SITE.whatsapp}" target="_blank" rel="noopener">${esc(SITE.phoneShow)}</a> or email <a href="mailto:${SITE.email}">${esc(SITE.email)}</a>.</p>
</div>`,
  });

  /* ---------------- RETURNS ---------------- */
  out.push({
    file: "returns.html",
    page: "returns",
    title: `Returns & Refunds | ${SITE.name}`,
    description: "Our 7-day return policy for unopened cosmetics, plus how faulty, damaged and incorrect items are handled.",
    body: `
${pagehead("Returns & refunds", "Seven days to change your mind on unopened items — and no time limit on us getting it wrong.")}
${crumbs([{ label: "Home", href: "index.html" }, { label: "Returns" }])}
<div class="container--narrow prose">
  <h2>The short version</h2>
  <ul>
    <li>Unopened, unused items in original packaging: returnable within <strong>7 days</strong> of delivery.</li>
    <li>Opened cosmetics: not returnable, for hygiene reasons — <em>unless</em> the item is faulty or we sent the wrong thing.</li>
    <li>Wrong, damaged or faulty item: we cover everything, including return delivery.</li>
  </ul>

  <h2>Why opened cosmetics cannot be returned</h2>
  <p>Once a lipstick, foundation or mascara has touched skin it cannot be resold safely, and reselling it would be genuinely unsafe for the next customer. This is standard for cosmetics retail everywhere and it is not something we can make an exception on.</p>
  <p>This is exactly why we offer shade matching on WhatsApp before you order. Use it — it is free and it saves everyone the hassle.</p>

  <h2>What we always fix</h2>
  <ul>
    <li><strong>Wrong item sent.</strong> Our mistake, our cost. Full replacement or refund.</li>
    <li><strong>Damaged in transit.</strong> Send photos within 48 hours of delivery.</li>
    <li><strong>Faulty product</strong> — pump not working, seal broken, product separated on arrival.</li>
    <li><strong>Authenticity concern.</strong> Send us photos of the batch code and packaging. If there is any doubt, you get a full refund.</li>
  </ul>

  <h2>How to start a return</h2>
  <ol style="display:grid;gap:10px;margin-bottom:16px;padding-left:20px;list-style:decimal">
    <li>Message us on WhatsApp with your order reference and a photo of the item.</li>
    <li>We confirm whether it qualifies, usually within a few hours.</li>
    <li>For approved returns we arrange collection or share a return address.</li>
    <li>Once the item reaches us, refunds are processed within <strong>3–5 working days</strong>.</li>
  </ol>

  <h2>How refunds are paid</h2>
  <p>Refunds go back by Easypaisa, JazzCash or bank transfer to an account in the name on the order. For cash on delivery orders we cannot refund in cash, so please have one of these ready.</p>

  <h2>Exchanges</h2>
  <p>Shade exchanges on unopened items are free within 7 days — you only cover the delivery of the returning item. Message us and we will hold the replacement shade for you.</p>

  <div class="note"><strong>Consumer rights.</strong> Nothing in this policy limits your rights under Pakistani consumer protection law. If you believe we have got something wrong, tell us and we will look at it again properly.</div>
</div>`,
  });

  /* ---------------- SIZE / SHADE GUIDE ---------------- */
  out.push({
    file: "size-guide.html",
    page: "size-guide",
    title: `Shade & Size Guide | ${SITE.name}`,
    description: "How to pick a foundation, concealer and contour shade for South Asian skin tones, plus what the product sizes mean.",
    body: `
${pagehead("Shade & size guide", "How to pick the right shade the first time — and what the sizes on our labels mean.")}
${crumbs([{ label: "Home", href: "index.html" }, { label: "Shade guide" }])}
<div class="container--narrow prose">
  <div class="note"><strong>Skip all this if you like.</strong> Send a photo of your bare face in daylight to
    <a href="https://wa.me/${SITE.whatsapp}" target="_blank" rel="noopener">WhatsApp</a> and we will just tell you which shade to buy.</div>

  <h2>Finding your foundation shade</h2>
  <h3>1. Work out your depth</h3>
  <p>Depth is simply how light or deep your skin is. Our foundation range runs from Porcelain through to Espresso. Most customers in Pakistan land somewhere between Vanilla and Caramel.</p>
  <table>
    <thead><tr><th>Shade</th><th>Depth</th><th>Typically suits</th></tr></thead>
    <tbody>
      <tr><td>Porcelain</td><td>Very fair</td><td>Fair skin that burns easily</td></tr>
      <tr><td>Linen</td><td>Fair</td><td>Fair to light with neutral undertone</td></tr>
      <tr><td>Vanilla</td><td>Light</td><td>Light skin, common in northern Pakistan</td></tr>
      <tr><td>Golden</td><td>Light-medium</td><td>The most commonly ordered shade</td></tr>
      <tr><td>Sand</td><td>Medium</td><td>Medium skin with warm undertone</td></tr>
      <tr><td>Honey</td><td>Medium-tan</td><td>Tan skin, golden undertone</td></tr>
      <tr><td>Caramel</td><td>Tan</td><td>Deeper tan with warm base</td></tr>
      <tr><td>Espresso</td><td>Deep</td><td>Deep skin, neutral to warm</td></tr>
    </tbody>
  </table>

  <h3>2. Work out your undertone</h3>
  <ul>
    <li><strong>Warm</strong> — veins look green, gold jewellery suits you better, you tan easily. Most South Asian skin is warm or neutral-warm.</li>
    <li><strong>Cool</strong> — veins look blue or purple, silver suits you better, you burn before you tan.</li>
    <li><strong>Neutral</strong> — a mix of both, and both metals look fine on you.</li>
  </ul>

  <h3>3. Test on your jaw, not your hand</h3>
  <p>The skin on your hand is usually a different depth from your face. Swatch along the jawline and check it in daylight — the right shade disappears rather than sitting on top.</p>

  <div class="note">Buying between two shades? Go with the <strong>deeper</strong> one. Most foundations oxidise slightly and settle a touch darker after 20 minutes, and a shade slightly too deep reads far better than one too light.</div>

  <h2>Concealer</h2>
  <p>For under the eyes, go <strong>one shade lighter</strong> than your foundation. For covering blemishes, match your foundation exactly. If your dark circles are strongly blue or grey, use a peach corrector underneath first.</p>

  <h2>Contour &amp; bronzer</h2>
  <p>Contour should look like shadow, not like tan. Choose a shade two steps deeper than your skin with a <em>cool</em> or neutral undertone — Soft Tan for fair to light, Hazelnut Latte for medium, Espresso for deep. Bronzer is the opposite: pick something warm, and use it to add colour back after foundation.</p>

  <h2>Lips</h2>
  <p>Shade names describe the finished colour on medium skin. On deeper skin most tints pull richer and more saturated; on fair skin they read lighter. Peel-off stains develop for about 10 minutes before you peel, so the colour you see going on is not the final result.</p>

  <h2>What the sizes mean</h2>
  <table>
    <thead><tr><th>Format</th><th>Typical size</th><th>Roughly lasts</th></tr></thead>
    <tbody>
      <tr><td>Liquid foundation</td><td>30ml</td><td>3–4 months of daily use</td></tr>
      <tr><td>Concealer</td><td>6ml</td><td>4–6 months</td></tr>
      <tr><td>Liquid blush</td><td>6–10ml</td><td>6+ months — you only need a drop</td></tr>
      <tr><td>Setting spray</td><td>80ml</td><td>2–3 months of daily use</td></tr>
      <tr><td>Lip products</td><td>2–5ml</td><td>3–6 months</td></tr>
      <tr><td>Mascara</td><td>8ml</td><td>Replace after 3 months, opened</td></tr>
    </tbody>
  </table>

  <h2>Still not sure?</h2>
  <p>Message us. We would much rather spend five minutes helping you pick than process a return.</p>
  <p><a class="btn btn--wa" href="https://wa.me/${SITE.whatsapp}" target="_blank" rel="noopener" style="margin-top:8px">${brandIcon("whatsapp", 18)} Ask for a shade match</a></p>
</div>`,
  });

  /* ---------------- TRACK ORDER ---------------- */
  out.push({
    file: "track-order.html",
    page: "track",
    title: `Track Your Order | ${SITE.name}`,
    description: "Look up the status of your SHEGLAM PK order using your order reference.",
    body: `
${pagehead("Track your order", "Enter the reference from your confirmation — it looks like SG-2601-ABCDE.")}
${crumbs([{ label: "Home", href: "index.html" }, { label: "Track order" }])}
<div class="container" style="padding:44px 0 72px">
  <div class="tracker">
    <form id="trackForm">
      <div class="field" style="text-align:left">
        <label for="trackRef">Order reference</label>
        <input type="text" id="trackRef" placeholder="SG-2601-ABCDE" autocomplete="off">
      </div>
      <button class="btn btn--primary btn--block" type="submit">Track order</button>
    </form>
    <div class="tracker__result" id="trackResult"></div>
    <p style="font-size:13.5px;color:var(--muted);margin-top:22px;line-height:1.7">
      Order lookup works on the device you ordered from. Changed device, or lost your reference?
      <a href="https://wa.me/${SITE.whatsapp}" target="_blank" rel="noopener" style="color:var(--rose)">Message us on WhatsApp</a>
      with your name and phone number and we will find it.
    </p>
  </div>
</div>`,
  });

  /* ---------------- PRIVACY ---------------- */
  out.push({
    file: "privacy.html",
    page: "privacy",
    title: `Privacy Policy | ${SITE.name}`,
    description: "What personal data SHEGLAM PK collects, why we collect it, who we share it with, and how to have it deleted.",
    hideNewsletter: true,
    body: `
${pagehead("Privacy policy", `How ${SITE.name} handles your personal information.`)}
${crumbs([{ label: "Home", href: "index.html" }, { label: "Privacy" }])}
<div class="container--narrow prose">
  <p><em>Last updated: ${new Date().toISOString().slice(0, 10)}</em></p>

  <h2>What we collect</h2>
  <ul>
    <li><strong>Order information</strong> — your name, mobile number, delivery address, city, and email if you provide one.</li>
    <li><strong>Contact messages</strong> — anything you send us through the contact form or WhatsApp.</li>
    <li><strong>Newsletter signups</strong> — your email address, if you subscribe.</li>
    <li><strong>Reviews</strong> — the name and text you choose to publish.</li>
    <li><strong>Usage data</strong> — if analytics are enabled, aggregated statistics about pages visited. This does not identify you personally.</li>
  </ul>

  <h2>What stays on your own device</h2>
  <p>Your cart, wishlist, recently viewed products and order history are stored in your browser's local storage. They never leave your device and we cannot see them. Clearing your browser data will erase them.</p>

  <h2>Why we collect it</h2>
  <ul>
    <li>To pack, dispatch and deliver your order.</li>
    <li>To contact you about that order — confirmations, tracking, delivery issues.</li>
    <li>To answer questions you send us.</li>
    <li>To send marketing emails, but only if you subscribed. You can unsubscribe from any email.</li>
  </ul>

  <h2>Who we share it with</h2>
  <p>Only the parties needed to fulfil your order:</p>
  <ul>
    <li><strong>Courier companies</strong> — your name, address and phone number, so they can deliver the parcel.</li>
    <li><strong>Our form and email provider</strong> — order details reach us by email.</li>
  </ul>
  <p>We do not sell your data. We do not share it with advertisers. We do not pass your number to other sellers.</p>

  <h2>Cookies and analytics</h2>
  <p>This site does not set advertising cookies of its own. If website analytics are enabled, they may set cookies to count visits. You can block cookies in your browser settings; the shop will still work.</p>

  <h2>How long we keep it</h2>
  <p>Order records are kept for two years for accounting and warranty purposes. Contact messages are kept for one year. Newsletter subscriptions are kept until you unsubscribe.</p>

  <h2>Your rights</h2>
  <p>You can ask us to show you what we hold about you, correct it, or delete it. Email <a href="mailto:${SITE.email}">${esc(SITE.email)}</a> and we will action it within 30 days. Note that we cannot delete records we are legally required to retain for tax purposes.</p>

  <h2>Children</h2>
  <p>This site is not intended for anyone under 13, and we do not knowingly collect their data.</p>

  <h2>Changes</h2>
  <p>If this policy changes materially we will update the date at the top of this page.</p>

  <h2>Contact</h2>
  <p>Questions about privacy: <a href="mailto:${SITE.email}">${esc(SITE.email)}</a>.</p>
</div>`,
  });

  /* ---------------- TERMS ---------------- */
  out.push({
    file: "terms.html",
    page: "terms",
    title: `Terms & Conditions | ${SITE.name}`,
    description: "The terms that apply when you order from SHEGLAM PK.",
    hideNewsletter: true,
    body: `
${pagehead("Terms & conditions", "The terms that apply when you buy from us.")}
${crumbs([{ label: "Home", href: "index.html" }, { label: "Terms" }])}
<div class="container--narrow prose">
  <p><em>Last updated: ${new Date().toISOString().slice(0, 10)}</em></p>

  <h2>1. Who we are</h2>
  <p>${esc(SITE.name)} is an online retailer based in ${esc(SITE.address)}, selling cosmetics to customers in Pakistan.</p>
  <div class="note">${esc(SITE.disclaimer)}</div>

  <h2>2. Orders</h2>
  <p>Placing an order is an offer to buy. A contract forms when we confirm your order. We may decline an order if an item is out of stock, if the price was listed in error, or if we cannot verify the delivery details.</p>

  <h2>3. Prices</h2>
  <p>All prices are in Pakistani Rupees and include applicable taxes. Delivery charges are shown at checkout before you confirm. We may change prices at any time, but never after your order is confirmed.</p>

  <h2>4. Payment</h2>
  <p>We accept cash on delivery, Easypaisa, JazzCash and bank transfer. For prepayment methods we share account details after you place the order; your order is dispatched once payment clears.</p>

  <h2>5. Delivery</h2>
  <p>Delivery timelines on the <a href="shipping.html">shipping page</a> are estimates, not guarantees. Courier delays, weather and public holidays can affect them. Risk in the goods passes to you on delivery.</p>

  <h2>6. Returns</h2>
  <p>Our <a href="returns.html">returns policy</a> forms part of these terms. In short: unopened items within 7 days; opened cosmetics only if faulty or incorrectly sent.</p>

  <h2>7. Product information</h2>
  <p>We describe products as accurately as we can. Screen colours vary, so shade swatches are indicative rather than exact. Ingredient lists are printed on the packaging and are the authoritative source — always patch test if you have sensitive skin or known allergies.</p>

  <h2>8. Reviews</h2>
  <p>By submitting a review you confirm it reflects your genuine experience and grant us permission to publish it. We remove reviews that are abusive, contain personal data, or are not about the product.</p>

  <h2>9. Acceptable use</h2>
  <p>Do not use this site to defraud, scrape at scale, or interfere with its operation. We may refuse service to anyone abusing the cash on delivery system through repeated refusals.</p>

  <h2>10. Liability</h2>
  <p>Our liability for any order is limited to the amount you paid for it. Nothing here excludes liability that cannot lawfully be excluded, including for death or personal injury caused by our negligence.</p>

  <h2>11. Governing law</h2>
  <p>These terms are governed by the laws of Pakistan, and the courts of Lahore have jurisdiction.</p>

  <h2>12. Contact</h2>
  <p><a href="mailto:${SITE.email}">${esc(SITE.email)}</a> &middot; <a href="https://wa.me/${SITE.whatsapp}" target="_blank" rel="noopener">${esc(SITE.phoneShow)}</a></p>
</div>`,
  });

  /* ---------------- 404 ---------------- */
  out.push({
    file: "404.html",
    page: "404",
    title: `Page not found | ${SITE.name}`,
    description: "The page you were looking for does not exist.",
    hideNewsletter: true,
    body: `
<div class="container notfound">
  <b>404</b>
  <h1>We could not find that page</h1>
  <p>It may have moved, or the link might be out of date.</p>
  <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
    <a class="btn btn--primary" href="index.html">Back to home</a>
    <a class="btn btn--outline" href="best-sellers.html">Shop bestsellers</a>
  </div>
</div>

<section class="section section--alt">
  <div class="container">
    ${sechead("", "Popular right now")}
    <div class="grid">${FEEDS.best().slice(0, 5).map((p) => card(p, "")).join("")}</div>
  </div>
</section>`,
  });

  return out;
}

module.exports = { home, pages };
