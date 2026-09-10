/* =========================================================
   SHEGLAM PK — catalog & site configuration
   SINGLE SOURCE OF TRUTH. Everything (pages, sitemap, search,
   filters, cart) is derived from this file.

   Works in the browser (window.SGPK) and in Node (require).
   After editing this file run:  node build.js
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SGPK = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------
     SITE CONFIG — edit these before you go live
     --------------------------------------------------------- */
  const SITE = {
    name: "SHEGLAM PK",
    legalName: "SHEGLAM PK",
    domain: "https://sheglampk.com",
    tagline: "Bold, affordable, high-quality beauty — delivered across Pakistan",

    // Shown in the footer. Keeps you clearly positioned as a reseller,
    // not as the brand itself. Do not remove without legal advice.
    disclaimer:
      "SHEGLAM PK is an independent stockist retailing genuine SHEGLAM products in Pakistan. " +
      "We are not affiliated with, endorsed by, or operated by SHEGLAM or Roadget Business Pte. Ltd. " +
      "All product names and trademarks are the property of their respective owners.",

    currency: "PKR",
    freeShippingOver: 3500,
    flatShipping: 250,
    codFee: 0,
    returnDays: 7,

    address: "Lahore, Pakistan",
    email: "hello@sheglampk.com",
    phoneShow: "+92 322 0305000",
    phoneTel: "+923220305000",
    whatsapp: "923220305000",
    instagram: "https://www.instagram.com/sheglampk",
    facebook: "https://www.facebook.com/sheglampk",
    tiktok: "https://www.tiktok.com/@sheglampk",

    /* ---- Order capture -------------------------------------------------
       Where orders, contact messages, newsletter signups and reviews are
       sent. Until this is filled in, orders reach you ONLY if the customer
       taps "Confirm on WhatsApp" — the checkout tells them so.

       WEB3FORMS (recommended, free, no account password):
         1. Go to https://web3forms.com
         2. Enter the email address you want orders sent to
         3. They email you an access key — paste it below
            orderEndpoint:  "https://api.web3forms.com/submit"
            orderAccessKey: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

       FORMSPREE:
            orderEndpoint:  "https://formspree.io/f/xxxxxxx"
            orderAccessKey: ""      (not used)

       The access key is designed to be public — it ships in the page source
       either way, and it can only submit to your own inbox. It is not a
       password. Verify it with:  node test-endpoint.js
    -------------------------------------------------------------------- */
    orderEndpoint: "",
    orderAccessKey: "",

    /* ---- Orders API (admin portal order tracking) ----------------------
       Email tells you an order happened; it cannot be listed, filtered or
       marked "Shipped". For that, orders also POST to a Google Apps Script
       that appends them to a spreadsheet you own — free, no server.

       Setup is in tools/orders-apps-script.gs (about 5 minutes).
       Then paste the deployed Web App URL and your chosen key here:

         ordersApi:    "https://script.google.com/macros/s/AKfy…/exec"
         ordersApiKey: "a-long-random-string-you-invent"

       Leave blank and everything still works — orders just arrive by email
       and WhatsApp only, and the admin Orders tab stays manual.
    -------------------------------------------------------------------- */
    ordersApi: "",
    ordersApiKey: "",

    /* ---- Analytics: paste IDs to switch on ---- */
    ga4: "",        // "G-XXXXXXXXXX"
    metaPixel: "",  // "1234567890"

    /* ---- Product images -------------------------------------------------
       "local"  → assets/img/products/<slug>.jpg   (use this once you have
                  photographed your own stock — run `node check-images.js`)
       "studio" → generated on-brand tiles, no photography needed
       "stock"  → category-matched stock photography (placeholder only)
    -------------------------------------------------------------------- */
    imageMode: "local",
  };

  /* ---------------------------------------------------------
     TAXONOMY
     --------------------------------------------------------- */
  const CATEGORIES = [
    {
      key: "face", label: "Face", page: "face.html",
      blurb: "Primers, foundation, blush, contour and everything that builds the base.",
      sub: ["Primer", "Foundation", "Concealer", "Powder", "Blush", "Highlighter", "Contour & Bronzer", "Setting Spray"],
    },
    {
      key: "eyes", label: "Eyes", page: "eyes.html",
      blurb: "Mascara, liner, shadow sticks and brow gels that hold all day.",
      sub: ["Mascara", "Eyeliner", "Eyeshadow", "Brows", "Eye Primer"],
    },
    {
      key: "lips", label: "Lips", page: "lips.html",
      blurb: "Blur pens, glosses, tints and peel-off stains in every finish.",
      sub: ["Lip Tint", "Lip Gloss", "Lip Liner", "Lip Balm"],
    },
    {
      key: "tools", label: "Tools & Others", page: "tools.html",
      blurb: "Brushes, sponges and the bits that make the rest work harder.",
      sub: ["Brushes", "Sponges", "Accessories"],
    },
  ];

  const FINISHES = ["Matte", "Natural", "Dewy", "Radiant", "Shimmer", "Satin"];


  /* =========================================================
     PRODUCTS — loaded from data/products.json
     =========================================================
     Product data lives in JSON, not in this file, so the admin
     portal can safely rewrite it without touching code, comments
     or config. Edit products in the admin portal (or the JSON
     directly), then run: node build.js
     ========================================================= */
  let RAW = [];
  if (typeof module !== "undefined" && module.exports) {
    try {
      RAW = require("./products.json").products || [];
    } catch (e) {
      console.error("[sgpk] could not read data/products.json —", e.message);
      RAW = [];
    }
  } else {
    RAW = (typeof self !== "undefined" && self.SGPK_PRODUCTS) || [];
  }


  /* =========================================================
     CUSTOMER REVIEWS
     =========================================================
     GENUINE REVIEWS ONLY. Keyed by product slug.

     Reviews submitted through the site are emailed to you (see
     SITE.orderEndpoint). When one arrives from a real customer,
     paste it in here and rebuild — that is how this fills up.

     Format:
       "product-slug": [
         { a: "Ayesha K.",        // reviewer name, as they gave it
           r: 5,                  // rating 1-5
           s: "Golden",           // shade bought, or "" — powers the shade filter
           t: "What they wrote.",
           d: "2026-08-02",       // YYYY-MM-DD
           v: 1 },                // 1 = you confirmed an order exists for them
       ],

     Do not write entries yourself. Inventing reviews — or marking
     v:1 on one you have not verified against a real order — is
     illegal advertising under Pakistan's Consumer Protection Acts
     and grounds for removal from Meta, Google and TikTok commerce.
     See README → "Getting real reviews" for how to collect these fast.
     ========================================================= */
  const REVIEWS = {
    // "color-bloom-liquid-blush": [
    //   { a: "", r: 5, s: "", t: "", d: "", v: 1 },
    // ],
  };

  /* ---------------------------------------------------------
     CURATED COLLECTIONS (campaign landing pages)
     --------------------------------------------------------- */
  const COLLECTIONS = [
    {
      slug: "camera-on-complexion",
      title: "The Camera On Edit",
      sub: "Blur, set, lock",
      blurb: "The three-step base that survives flash photography, mehndi lights and a full day of heat.",
      tint: "#171717",
      match: (p) => /^Camera On/.test(p.name) || p.sub === "Setting Spray",
    },
    {
      slug: "blush-bar",
      title: "The Blush Bar",
      sub: "Liquid, cream, powder",
      blurb: "Every blush texture in the range, from a sheer glassy stick to a full-pigment liquid.",
      tint: "#e83e70",
      match: (p) => p.sub === "Blush" || p.sub === "Highlighter",
    },
    {
      slug: "peel-and-reveal",
      title: "Peel & Reveal Lips",
      sub: "Stains that survive chai",
      blurb: "Peel-off stains, blur pens and glossy tints built to outlast a long lunch.",
      tint: "#b32a55",
      match: (p) => p.category === "lips",
    },
    {
      slug: "under-2000",
      title: "Everything Under Rs. 2,000",
      sub: "Build a kit for less",
      blurb: "A full face of makeup that leaves change from a five thousand rupee note.",
      tint: "#3d3d3d",
      match: (p) => p.price < 2000,
    },
  ];

  /* ---------------------------------------------------------
     PROMOS — rotating announcement bar
     --------------------------------------------------------- */
  const PROMOS = [
    "Free delivery on orders over Rs. 3,500 — nationwide",
    "Cash on delivery available in every city",
    "100% genuine SHEGLAM stock — sealed and batch-checked",
    "Easy 7-day returns on unopened items",
  ];

  /* ---------------------------------------------------------
     FAQ
     --------------------------------------------------------- */
  const FAQ = [
    {
      group: "Orders & Delivery",
      items: [
        { q: "How long does delivery take?", a: "Orders are dispatched within 1–2 working days. Delivery takes 2–3 days in Lahore, Karachi and Islamabad, and 3–5 days for other cities. You will get a tracking number by WhatsApp as soon as your parcel is booked." },
        { q: "Do you offer cash on delivery?", a: "Yes — and it is the only payment method we accept. Cash on delivery is available across Pakistan at no extra charge. You pay the courier when the parcel arrives, never in advance." },
        { q: "What does delivery cost?", a: "Flat Rs. 250 nationwide, and free on every order over Rs. 3,500." },
        { q: "Can I change or cancel my order?", a: "Yes, as long as it has not been dispatched. Message us on WhatsApp with your order reference and we will sort it out." },
        { q: "How do I track my order?", a: "Use the Track Order page with the reference number from your confirmation, or send the reference to us on WhatsApp." },
      ],
    },
    {
      group: "Products",
      items: [
        { q: "Are these genuine SHEGLAM products?", a: "Yes. Every item is sourced sealed, and we check batch codes on arrival. If you ever receive something you believe is not genuine, send us photos and we will refund you in full." },
        { q: "Are SHEGLAM products cruelty-free?", a: "SHEGLAM is certified cruelty-free through the Leaping Bunny Programme and states that over 90% of its range is vegan. Individual product pages list full ingredients so you can check before buying." },
        { q: "How do I pick the right foundation shade?", a: "Message us on WhatsApp with a photo in natural daylight, ideally with your jaw and neck visible, and we will recommend a shade. If it turns out wrong, we will exchange it." },
        { q: "Do products have an expiry date?", a: "Yes, printed on the packaging. We do not stock anything with less than 12 months of shelf life remaining." },
      ],
    },
    {
      group: "Returns & Refunds",
      items: [
        { q: "What is your return policy?", a: "Unopened items in original packaging can be returned within 7 days of delivery. For hygiene reasons we cannot accept opened cosmetics unless the product is faulty or you received the wrong item." },
        { q: "I received the wrong or a damaged item.", a: "Send us photos on WhatsApp within 48 hours of delivery and we will arrange a free replacement or a full refund, including delivery charges." },
        { q: "How long do refunds take?", a: "Once we receive the returned item, refunds are processed within 3–5 working days by bank transfer, Easypaisa or JazzCash." },
      ],
    },
  ];

  /* =========================================================
     DERIVED DATA — do not edit below unless changing behaviour
     ========================================================= */

  const slugify = (s) =>
    String(s).toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const money = (n) => "Rs. " + Number(n).toLocaleString("en-US");

  const discountPct = (p) => (p.oldPrice ? Math.round((1 - p.price / p.oldPrice) * 100) : 0);

  /* =========================================================
     IMAGES
     =========================================================
     EDITORIAL_POOL is licence-free lifestyle photography used ONLY for
     heroes and category tiles — never as a product shot. Photos showing
     another brand's packaging have been deliberately excluded: putting a
     Clinique lipstick on a SHEGLAM product page misleads the customer and
     uses another company's trade dress.

     Product images come from imageFor() below, which never falls back to
     stock photography. See README → "Product photography".
     ========================================================= */
  const EDITORIAL_POOL = [
    "1596462502278-27bfdc403348", // makeup flat lay
    "1512496015851-a90fb38ba796", // palette and brushes
    "1522335789203-aabd1fc54bc9", // compacts and powder
    "1487412947147-5cebf100ffc2", // eye makeup, model
    "1631730359585-38a4935cbec4", // dropper bottles
    "1607602132700-068258431c6c", // complexion bottles
    "1512207846876-bb54ef5056fe", // gold-toned accessories
    "1598440947619-2c35fc9aa908", // assorted bottles
    "1503236823255-94609f598e71", // loose powder and brush
    "1625093742435-6fa192b6fb10", // nude lipstick
    "1596704017254-9b121068fb31", // lip palette
    "1617897903246-719242758050", // oil dropper
    "1608248543803-ba4f8c70ae0b", // neutral packaging
  ];

  function photoFor(index, w) {
    const id = EDITORIAL_POOL[Math.abs(index) % EDITORIAL_POOL.length];
    return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&h=${Math.round(w * 1.2)}&q=80`;
  }

  /* ---- Studio tile ----------------------------------------------------
     A generated on-brand product tile, drawn from the product's own shade
     colours. Used until real photography is dropped in. It is obviously a
     graphic rather than a photo, which is the honest way to show a product
     you have not yet photographed — a customer is never shown an item that
     is not what will arrive.
  --------------------------------------------------------------------- */
  const CAT_TINT = {
    face: "#f0c9b4", eyes: "#8a6047", lips: "#e83e70", tools: "#c9c9c9",
  };

  function studioTile(p, w, variant) {
    const v = variant || 0;
    const tint = (p.shades && p.shades.length && p.shades[v % p.shades.length].hex) || CAT_TINT[p.category];
    const safeTint = /^#[0-9a-f]{6}$/i.test(tint || "") ? tint : "#d8b79a";

    /* Illustration matched to the product TYPE, tinted with the product's own
       shade. A lipstick reads as a lipstick and a palette as a palette, so a
       grid of these looks like a designed catalogue rather than a wall of
       identical placeholders. No product name: a card is ~200px wide, so tile
       text renders at ~8px and reads as a smudge — the name sits beneath the
       image anyway. Replaced automatically as soon as a real photo exists. */
    const cap = `<rect x="214" y="96" width="72" height="62" rx="12" fill="${safeTint}" opacity=".9"/>`;
    const SHAPES = {
      // tall bottle with a pump — bases and complexion
      Primer:      `<rect x="178" y="152" width="144" height="252" rx="24" fill="url(#g2)"/>${cap}<rect x="236" y="72" width="28" height="30" rx="6" fill="${safeTint}" opacity=".75"/>`,
      Foundation:  `<path d="M182 190h136v190a24 24 0 0 1-24 24H206a24 24 0 0 1-24-24Z" fill="url(#g2)"/><rect x="222" y="120" width="56" height="74" rx="8" fill="${safeTint}" opacity=".85"/><rect x="210" y="96" width="80" height="30" rx="8" fill="${safeTint}" opacity=".7"/>`,
      // fine-mist bottle
      "Setting Spray": `<rect x="184" y="176" width="132" height="230" rx="20" fill="url(#g2)"/><rect x="224" y="118" width="52" height="60" rx="8" fill="${safeTint}" opacity=".85"/><rect x="206" y="92" width="88" height="30" rx="10" fill="${safeTint}" opacity=".7"/><circle cx="316" cy="104" r="5" fill="${safeTint}" opacity=".5"/><circle cx="336" cy="92" r="4" fill="${safeTint}" opacity=".35"/>`,
      // squeeze tube with a doe-foot
      Concealer:   `<path d="M200 196h100l-10 196a20 20 0 0 1-20 18h-40a20 20 0 0 1-20-18Z" fill="url(#g2)"/><rect x="226" y="112" width="48" height="88" rx="10" fill="${safeTint}" opacity=".85"/>`,
      // round pressed compact
      Powder:      `<circle cx="250" cy="286" r="112" fill="url(#g2)"/><circle cx="250" cy="286" r="72" fill="${safeTint}" opacity=".45"/><rect x="150" y="150" width="200" height="26" rx="13" fill="${safeTint}" opacity=".6"/>`,
      Blush:       `<circle cx="250" cy="284" r="106" fill="url(#g2)"/><circle cx="250" cy="284" r="64" fill="${safeTint}" opacity=".5"/><rect x="158" y="156" width="184" height="24" rx="12" fill="${safeTint}" opacity=".55"/>`,
      Highlighter: `<circle cx="250" cy="284" r="106" fill="url(#g2)"/><path d="M250 200a84 84 0 0 1 0 168 60 60 0 0 0 0-168Z" fill="#fff" opacity=".28"/><rect x="158" y="156" width="184" height="24" rx="12" fill="${safeTint}" opacity=".55"/>`,
      "Contour & Bronzer": `<rect x="192" y="168" width="116" height="240" rx="26" fill="url(#g2)"/><rect x="216" y="108" width="68" height="62" rx="10" fill="${safeTint}" opacity=".85"/>`,
      // slim tall tube
      Mascara:     `<rect x="212" y="182" width="76" height="226" rx="16" fill="url(#g2)"/><rect x="222" y="82" width="56" height="104" rx="12" fill="${safeTint}" opacity=".9"/><rect x="243" y="60" width="14" height="28" rx="5" fill="${safeTint}" opacity=".6"/>`,
      // tapered pen
      Eyeliner:    `<path d="M232 168h36v190l-18 52-18-52Z" fill="url(#g2)"/><rect x="228" y="86" width="44" height="86" rx="10" fill="${safeTint}" opacity=".9"/>`,
      Brows:       `<path d="M234 176h32v168l-16 46-16-46Z" fill="url(#g2)"/><rect x="230" y="96" width="40" height="84" rx="9" fill="${safeTint}" opacity=".9"/>`,
      "Eye Primer":`<rect x="206" y="186" width="88" height="216" rx="18" fill="url(#g2)"/><rect x="224" y="110" width="52" height="80" rx="10" fill="${safeTint}" opacity=".85"/>`,
      // flat palette with pans
      Eyeshadow:   `<rect x="140" y="196" width="220" height="176" rx="18" fill="url(#g2)"/><g fill="${safeTint}" opacity=".55"><circle cx="192" cy="252" r="26"/><circle cx="250" cy="252" r="26"/><circle cx="308" cy="252" r="26"/><circle cx="192" cy="318" r="26"/><circle cx="250" cy="318" r="26"/><circle cx="308" cy="318" r="26"/></g><rect x="140" y="168" width="220" height="30" rx="12" fill="${safeTint}" opacity=".4"/>`,
      // bullet
      Lipstick:    `<rect x="206" y="238" width="88" height="170" rx="14" fill="url(#g2)"/><path d="M216 238v-92a34 34 0 0 1 68 0v92Z" fill="${safeTint}" opacity=".92"/><path d="M216 152c14-22 54-22 68 0v18h-68Z" fill="#fff" opacity=".18"/>`,
      // gloss tube with wand
      "Lip Gloss": `<rect x="204" y="200" width="92" height="206" rx="20" fill="url(#g2)"/><rect x="228" y="104" width="44" height="100" rx="10" fill="${safeTint}" opacity=".9"/><ellipse cx="250" cy="96" rx="16" ry="24" fill="${safeTint}" opacity=".6"/>`,
      "Lip Tint":  `<rect x="208" y="204" width="84" height="202" rx="18" fill="url(#g2)"/><rect x="230" y="110" width="40" height="98" rx="9" fill="${safeTint}" opacity=".9"/>`,
      "Lip Liner": `<path d="M234 180h32v170l-16 48-16-48Z" fill="url(#g2)"/><rect x="230" y="100" width="40" height="82" rx="9" fill="${safeTint}" opacity=".9"/>`,
      // squat pot
      "Lip Balm":  `<rect x="176" y="240" width="148" height="132" rx="22" fill="url(#g2)"/><rect x="168" y="196" width="164" height="52" rx="18" fill="${safeTint}" opacity=".85"/>`,
      // tools
      Brushes:     `<path d="M236 300h28v104a14 14 0 0 1-28 0Z" fill="${safeTint}" opacity=".85"/><rect x="232" y="272" width="36" height="34" rx="6" fill="${safeTint}" opacity=".6"/><path d="M250 116c26 34 34 92 18 156h-36c-16-64-8-122 18-156Z" fill="url(#g2)"/>`,
      Sponges:     `<path d="M250 132c58 0 96 62 96 122 0 62-42 106-96 106s-96-44-96-106c0-60 38-122 96-122Z" fill="url(#g2)"/>`,
      Accessories: `<rect x="150" y="212" width="200" height="152" rx="24" fill="url(#g2)"/><path d="M198 212v-24a52 52 0 0 1 104 0v24" fill="none" stroke="${safeTint}" stroke-width="14" opacity=".8"/>`,
    };
    const shape = SHAPES[p.sub] || SHAPES.Primer;

    /* Gallery slots nudge the illustration so the four thumbnails differ. */
    const V = [
      "",
      `<g transform="translate(250 280) scale(.88) translate(-250 -280)">`,
      `<g transform="translate(250 280) rotate(-6) translate(-250 -280)">`,
      `<g transform="translate(250 280) scale(1.06) translate(-250 -280)">`,
    ][v % 4];
    const shapes = [V ? V + shape + "</g>" : shape];

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 600" width="500" height="600">` +
      `<defs>` +
      `<linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${safeTint}" stop-opacity=".3"/>` +
      `</linearGradient>` +
      `<linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${safeTint}"/><stop offset="1" stop-color="${safeTint}" stop-opacity=".6"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<rect width="500" height="600" fill="url(#g1)"/>` +
      `<ellipse cx="250" cy="412" rx="128" ry="19" fill="#171717" opacity=".07"/>` +
      shapes[v % shapes.length] +
      /* Sized to stay legible on a ~200px card (≈13px on screen) */
      `<text x="250" y="506" text-anchor="middle" font-family="Poppins,Helvetica,Arial,sans-serif"` +
      ` font-size="32" font-weight="800" letter-spacing="-0.5" fill="#171717" opacity=".8">SHEGLAM<tspan font-size="19">.PK</tspan></text>` +
      `<text x="250" y="536" text-anchor="middle" font-family="Poppins,Helvetica,Arial,sans-serif"` +
      ` font-size="19" fill="#6f6f6f">photo coming soon</text>` +
      `</svg>`;
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  /* ---- Which products actually have a photo on disk? -------------------
     Resolved at BUILD time by reading the folder, so a product without a
     photo gets its studio tile baked straight into the HTML and renders
     correctly with JavaScript disabled. build.js passes the same list to
     the browser as window.SGPK_PHOTOS so client-side re-renders match.
  --------------------------------------------------------------------- */
  /* Stored as full filenames ("blush.jpg", "primer.webp") so whatever
     extension is actually on disk is the one the page requests. */
  let PHOTOS = null;
  if (typeof module !== "undefined" && module.exports) {
    try {
      const fs = require("fs"), path = require("path");
      PHOTOS = fs
        .readdirSync(path.join(__dirname, "..", "assets", "img", "products"))
        .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f));
    } catch { PHOTOS = []; }
  } else {
    PHOTOS = (typeof self !== "undefined" && self.SGPK_PHOTOS) || [];
  }

  function photoFile(slug) {
    for (let i = 0; i < PHOTOS.length; i++) {
      const f = PHOTOS[i];
      const dot = f.lastIndexOf(".");
      if (dot > 0 && f.slice(0, dot) === slug) return f;
    }
    return null;
  }

  /* Product image resolution. Never returns stock photography.

     An explicit URL from the database wins: images are now filed per
     product AND shade, so matching a filename against the product slug
     no longer finds them. photoFile() stays as the fallback for photos
     dropped into the folder by hand. */
  function imageFor(p, w, variant) {
    if (p.images && p.images.length) {
      const i = Math.min(variant || 0, p.images.length - 1);
      return String(p.images[i]).replace(/^\//, "");
    }
    if (p.image) return String(p.image).replace(/^\//, "");
    if (SITE.imageMode === "local") {
      const f = photoFile(p.slug);
      if (f) return `assets/img/products/${f}`;
    }
    return studioTile(p, w, variant);
  }

  let _id = -1;
  const usedSlugs = {};

  const PRODUCTS = RAW.map((r) => {
    _id++;
    /* A product keeps its slug for life once set: changing it would break
       existing product URLs and any photo already filed under it. */
    let slug = r.slug || slugify(r.name);
    if (usedSlugs[slug]) slug = `${slug}-${_id}`;
    usedSlugs[slug] = 1;

    const cat = CATEGORIES.find((c) => c.key === r.category);
    const shades = r.shades && r.shades.length ? r.shades : null;
    const stock = shades
      ? shades.reduce((s, x) => s + (+x.stock || 0), 0)
      : (r.stock == null ? 20 : +r.stock);

    const p = {
      id: _id,
      slug,
      name: r.name,
      category: r.category,
      categoryLabel: cat ? cat.label : r.category,
      sub: r.sub,
      price: +r.price || 0,
      oldPrice: r.oldPrice ? +r.oldPrice : null,
      finish: r.finish,
      size: r.size,
      shades,
      stock,
      inStock: stock > 0,
      isNew: !!r.isNew,
      isBestSeller: !!r.isBestSeller,
      isFeatured: !!r.isFeatured,
      desc: r.desc,
      shortDesc: r.shortDesc || null,
      sku: r.sku || "SGPK-" + String(1000 + _id),
      /* Carried before imageFor() runs, because that is what it reads. */
      images: r.images && r.images.length ? r.images : null,
      seoTitle: r.seoTitle || null,
      seoDescription: r.seoDescription || null,
    };
    p.discount = discountPct(p);
    p.reviews = REVIEWS[slug] || [];
    p.reviewCount = p.reviews.length;
    p.rating = p.reviewCount
      ? Math.round((p.reviews.reduce((s, x) => s + x.r, 0) / p.reviewCount) * 10) / 10
      : 0;
    p.image = imageFor(p, 500, 0);
    p.imageLarge = imageFor(p, 900, 0);
    /* Rendered if the real photo is missing or fails to load, so the grid
       never shows a broken tile or somebody else's product. */
    p.tile = studioTile(p, 500, 0);
    p.gallery = [0, 1, 2, 3].map((i) => imageFor(p, 900, i));
    p.galleryTiles = [0, 1, 2, 3].map((i) => studioTile(p, 900, i));
    return p;
  });

  const byId = (id) => PRODUCTS.find((p) => p.id === +id) || null;
  const bySlug = (s) => PRODUCTS.find((p) => p.slug === s) || null;

  /* Collection membership resolved once, so the browser never runs match() */
  const COLLECTIONS_RESOLVED = COLLECTIONS.map((c) => ({
    slug: c.slug, title: c.title, sub: c.sub, blurb: c.blurb, tint: c.tint,
    page: `collection-${c.slug}.html`,
    ids: PRODUCTS.filter(c.match).map((p) => p.id),
  }));

  /* Named product feeds used by pages */
  const FEEDS = {
    all: () => PRODUCTS.slice(),
    new: () => PRODUCTS.filter((p) => p.isNew),
    best: () => PRODUCTS.filter((p) => p.isBestSeller),
    sale: () => PRODUCTS.filter((p) => p.oldPrice),
    face: () => PRODUCTS.filter((p) => p.category === "face"),
    eyes: () => PRODUCTS.filter((p) => p.category === "eyes"),
    lips: () => PRODUCTS.filter((p) => p.category === "lips"),
    tools: () => PRODUCTS.filter((p) => p.category === "tools"),
  };

  return {
    SITE, CATEGORIES, FINISHES, PRODUCTS, COLLECTIONS: COLLECTIONS_RESOLVED,
    PROMOS, FAQ, FEEDS,
    slugify, money, discountPct, byId, bySlug, photoFor, studioTile,
    PHOTOS,
  };
});
