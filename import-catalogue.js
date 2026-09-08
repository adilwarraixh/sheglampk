/* =========================================================
   import-catalogue.js — expand data/products.json

   Product names, shade names, sizes and categories are factual
   identifiers a reseller uses to list genuine stock. Descriptions
   here are ORIGINAL — SHEGLAM's own marketing copy and photography
   are their copyright and are not reproduced.

   Licensed collaborations (Harry Potter, Hello Kitty, Rick and
   Morty, Twilight, LOTR, Catwoman, Powerpuff Girls, Adventure
   Time, Wizard of Oz, Wonka) are excluded: those carry a third
   party's trademarks on top of SHEGLAM's, which a reseller has no
   licence to use in their own storefront.

   Run:  node import-catalogue.js          (preview, writes nothing)
         node import-catalogue.js --write  (merge into products.json)
   ========================================================= */
const fs = require("fs");
const path = require("path");

const WRITE = process.argv.includes("--write");
const FILE = path.join(__dirname, "data", "products.json");

/* ---------- names gathered from the public category listings ---------- */
const RAW_NAMES = {
  face: [
    "Camera On Smooth & Blur Primer", "Lock'd In Setting Spray", "Good Grip Hydrating Primer",
    "Good Grip Ultra-Blur Primer", "Camera On Blurring Setting Powder Balm",
    "Camera On Blurring Waterproof Setting Spray", "Wake Up Call Undereye Color Corrector-Peach",
    "Pore Eraser Blurring Stick", "Glow Bloom Liquid Highlighter-Vanilla Frost",
    "Melt Touch Ultra-Hydrating Primer", "Hydro-Touch Refreshing Setting Powder",
    "Light Me Up Luminous Setting Spray", "Matte Fresh Setting Spray", "Color Bloom Liquid Blush-Pink Slip",
    "Blur In A Bottle Loose Setting Powder-Translucent", "Triple Threat Correcting Primer",
    "Sun Sculpt Liquid Contour-Hazelnut Latte", "Sweet Cheeks Blush Trio-Enamored",
    "Good Grip Hydrating Primer-Travel Size", "Buttery Bliss Blush Stick-PHresh",
    "Press Refresh Setting Spray", "Glacier Glo Smoothing Primer",
    "Good Grip Hydrating Primer-Blueberry + AHA", "Color Bloom Liquid Blush-Hot Topic",
    "Buttery Bling Highlight Stick-Vanilla Frost", "Baked Glow Setting Powder-Translucent",
    "Good Grip Hydrating Prime & Set Spray", "Berry Cute Cake Blush",
    "Glowchi Bouncy Highlighter-Cherry Blossom", "Like Magic 12HR Full Coverage Concealer-Linen",
    "Buttercream Bliss Canvas Primer", "Lucky Duck 3D Highlighter", "Dream Touch Bronzer-05 Golden Sun",
    "Hideaway Full-Coverage Concealer-Pink", "Beaming Butterfly Highlighter",
    "Fine Line 2-In-1 Nose Contour & Highlight Pen", "Baked Glow Setting Powder-Bubblegum",
    "Multi-Fix Concealer And Color Corrector-Vanilla",
    "All About That Face Multifunctional Face Palette-Vanilla Sculpt",
    "Sunkissed Body Highlighter-Eros", "Snatch 'n' Define Stick-Soft Tan",
    "Insta-Ready Sunset Blur Setting Powder-10 Bisque", "Glass Glow Blush Stick-Pink Lemonade",
    "Multi-Glam Face Pen-Tan", "Cutie Paw Blush Stamp-001 Love Cake",
    "Insta-Ready Face & Under Eye Setting Powder Duo-Taro", "Air Plush Lip & Cheek Cream-High Winds",
    "Melon Melt Niacinamide Serum Primer", "Skinfinite Hydrating Foundation-Linen",
    "Even Better Color Correcting Primer-Green", "Go Go Glow Highlighting Body Mist-Gold",
    "Sun Beam Matte Liquid Bronzer-Toffee", "Chroma Zone Multichrome Highlighter-Lucid",
    "Floral Flush Blush Palette-Blushing Bouquet",
    "Glam 101 Hybrid Highlighter & Blush Duo-St. Tropez", "Cheek 2 Cheek Blush Duo-Pink Sprinkles",
    "Complexion Pro Long Lasting Breathable Matte Foundation", "Lock & Go Long-Lasting Cushion Foundation",
    "Precision Sculpt Liquid Contour Duo",
  ],
  eyes: [
    "Set Me Up Brow Gel", "Lash Besties 2-In-1 Mascara", "Pro Precision Waterproof Liquid Eyeliner-Black",
    "Insta-Wing Heart Stamp Eyeliner", "Streamline Brow & Eyeliner Gel", "Brow Behavior Taming Gel",
    "Lashlighter Up & Out Mascara", "Ready Set Eyeshadow Primer", "Dark Romantasy Eyeshadow Palette",
    "Micro Precision Ultra-Long Tip Eyeliner", "Stay Inked Waterproof Eyeliner Pen",
    "The Everywhere 4-In-1 Pen-Multicolor", "Double Dot Freckle Pen-Fawn",
    "All-In-One Volume & Length Mascara", "Lashlighter Iron Curl Mascara",
    "Big Energy Mascara-Black", "Lift & Elevate Lengthening Mascara", "Stick Em Up Lifting Brow Soap",
    "Glimmer & Gleam 9-Pan Eyeshadow Palette", "Pro-Flex Angled Eyeliner",
    "Boldline Longwear Multi-Function Gel Liner-Black", "Moonlight Eyeshadow Palette", "Berry Palette",
    "Showtime In Seattle 15-Pan Palette", "Oh So Rich Matte Eyeliner", "Lashlighter Mega Boost Mascara",
    "Gel Glide Eyeliner Pencil-Brown", "Lunar Jelly Frosty Eyeshadow Stick-05 Caramel Candy",
    "Chroma Zone Multichrome Gel Liner-On A Trip", "Lash Ritual Nourishing Serum-Clear",
    "Crystal Jelly Glaze Stick-Starlit Silver", "All-In-One 24k Multi-Effect Mascara",
    "Gro-Pro Nourishing Lash Serum", "Stay Inked Liquid Eyeliner", "Cursed Chrysalis Palette",
    "Wing It Waterproof Liner Duo-Brown", "Big Time Eyes Volumizing Mascara",
    "Dark Romantasy Duochrome Eyeshadow-Garnet Eyes", "Set Me Up Brow Hold-Crystal Clear",
    "Prismalight Baked Gelee Eyeshadow Duo-Royal Bronzite", "Max Impact Extreme Volumizing Mascara",
    "Desert Hues Palette", "Puff Brow Palette-Brown", "Bold Moves Kohl Cream Eyeliner Pencil-Brown",
    "Think Sharp Eyeliner", "Intensify Smudge-Proof Eyeliner Gel-Brown", "Clean Queen Mascara Remover",
    "Stone Cold Eyeshadow Palette", "Crystal Gaze Glitter Mascara",
    "Starry Wish Liquid Eyeshadow Trio-North Star", "Lashlighter Extend Enriching Lash Primer-White",
    "Boss Brow Waterproof Pomade-Soft Brown", "Live To Roam Palette",
    "Insta-Eyes Dual Tone Shadow Stick-Rose", "Chill Track Palette",
    "Better Brows Long Lasting Eyebrow Pencil-Taupe", "Line & Define Waterproof Liquid Eyeliner-Brown",
    "Enigma Sparkly Eyeshadow-Such A Prize", "Zen Out, Shangri-La Palette", "Smart Cookie Palette",
    "Silver Strobe Metallic Eyeliner-Platinum", "Tint Lock Tattoo Peel Off Brow Gel-Taupe",
    "Deep Feelings Palette", "Flutter Wink Volumizing Mascara", "Berry Besties Color Trio-Raspberry Tart",
    "Stay Wild Jelly Glitter-Peacock", "On-Line Creamy Eyeliner-Black", "Airglow Eye Tint-Cloud Nine",
    "Creamsicle Eyeshadow Stick",
  ],
  lips: [
    "Lip Dazzler Glitter Kit-Center Stage", "Dark Romantasy Lip & Cheek Tint-Rich Crimson",
    "Bubble Buff Lip Scrub", "Dark Romantasy Transfer-Proof Lip Mousse",
    "Fall In Line Peel Off Lip Liner Stain-Bare Blush", "So Lippy Lip Liner Set-Au Naturel",
    "Berry Jam Lip Mask Pot", "Jelly Wow Hydrating Lip Oil-Berry Involved",
    "Pout PHresh Color Changing Lipstick-Watermelon", "Glazed & Locked Glossy Lip Tint-011 Born Ready",
    "Dark Romantasy Lip Liner + Lip Gloss Kit-Plum Noir",
    "Stardust Swipe Glitter Liquid Lipstick-137 Cosmic Pink", "Glass Lock Air Gloss-Born Ready",
    "Crystal Glaze Moisturizing Lip Care Set", "Pillow Lips Lip Care Cream", "Nourishing Lip Balm-White",
    "Love Stained Lip Tint Marker-Bright Side", "Life Is Delicious Pocket Lip Jam-Ambrosia",
    "Cocoa Yum Lip Balm", "Onyx Kaleidoscope Lipstick", "Creme Allure Lipstick-Nude",
    "Line To Shine Peel-Off Lip Stain & Gloss Duo-013 Peach Mousse",
    "For The Flush Lip & Cheek Tint-Fruit Punch", "Lip Link Mini Gloss Bracelet Palette",
    "Hydra Jelly Pocket Lip Jam-Sugar Swirl",
    "Glam 101 Sheer Tinted Lipstick & Liner Duo-Blueberry Jam",
    "Bold Booster Lip Plumper-Blush Drizzle", "Mirror Kiss High-Shine Lipstick-Rule Breaker",
    "Peel Talk Lip Tint-Celeb Crush", "Pout Pillow Cushion Matte Liquid Lipstick-Catching Z's",
    "Matte Allure Lipstick-Chic", "So Lippy Lip Liner-True Faith",
    "Bounce Putty Pocket Lip Pot-Peachy Pie", "Booster Shine Plumping Lip Gloss-Own Your Shine",
    "Marshmallow Puff Lip Blur Pen-002 Gotcha", "Starlight Velvet Lipstick-Magical D-Light",
    "Pout-Perfect Shimmer Lip Plumper-Sugar Crystal", "Take A Hint Lip Tint-Memories",
    "Dynamatte Boom Long-Lasting Matte Lipstick", "Cloudline Blur Lip Liner-Morning Mist",
    "Mega Lip Stacks-Brownie Stack", "Lip Facts Lip Liner-True Faith", "Silk Slip Lip Oil Balm-Barely Blushed",
    "Matte Allure Mini Liquid Lipstick Set", "Just Kissed Lipstick Crayon-Red Velvet",
    "Hot Goss Plumping Lip Gloss-That's Juicy!", "Pout-Perfect Shine Lip Plumper-Makin' Me Blush",
    "Glow Addict Lip Balm-Rocky Road", "Mood Switch Matte & Gloss Lip Duo-114 Pink Flamingo",
    "Lip Rules Liner & Gloss Pen-By The Book", "Bubble Kiss Lip Balm-Bubble Tea",
    "Soft Haze Lip Blur-Play Date", "Mello Jello Nourishing Lip Balm-Garnet",
    "Glam 101 Lipstick & Liner Duo-Praline Pie", "Cocoa Kiss Lip Duo-Cookies N' Milk",
    "Silky Glow Lip & Eye Pen", "Air Plush Lip & Cheek Cream",
  ],
};

/* Licensed collaborations — third-party IP a reseller cannot use. */
const LICENSED = /harry potter|hogwarts|quidditch|lord of the rings|sauron|evenstar|shire|fangorn|rick and morty|pickle rick|morty|sanchez|twilight|catwoman|powerpuff|hello kitty|adventure time|bubbline|ooo\b|wizard of oz|wonka|dc |warner/i;

/* SEO padding SHEGLAM appends to some titles — not part of the product name. */
const SEO_JUNK = /\s*(brand beauty cosmetic makeup for women and girls|kohl kajal henna)\s*/gi;

/* ---------- classification ---------- */
const SUBCAT_RULES = [
  [/setting spray|prime & set spray|fixing spray/i,            "face", "Setting Spray", "80ml"],
  [/primer|canvas|mixing liquid|toner|serum primer/i,          "face", "Primer",        "30ml"],
  [/foundation|cushion/i,                                       "face", "Foundation",    "30ml"],
  [/concealer|corrector/i,                                      "face", "Concealer",     "6ml"],
  [/setting powder|loose powder|powder balm|powder duo/i,       "face", "Powder",        "8g"],
  [/blush|cheek/i,                                              "face", "Blush",         "6ml"],
  [/highlighter|highlight|glow drops|body mist|strobe/i,        "face", "Highlighter",   "10ml"],
  [/contour|bronzer|sculpt|define stick|face pen|face palette/i,"face", "Contour & Bronzer", "10ml"],

  [/mascara|lash\s+\w*\s*serum|lash ritual|lash primer|mascara remover/i, "eyes", "Mascara", "8ml"],
  [/eyeliner|liner pen|gel liner|liner duo|kohl|eye pencil/i,   "eyes", "Eyeliner",      "1ml"],
  [/brow/i,                                                     "eyes", "Brows",         "4g"],
  [/eyeshadow primer|eye primer/i,                              "eyes", "Eye Primer",    "5ml"],
  [/palette|eyeshadow|shadow stick|glaze stick|freckle|eye tint|jelly glitter|color trio|4-in-1 pen/i,
                                                                "eyes", "Eyeshadow",     "1.4g"],

  [/lip liner|lip blur|cloudline/i,                             "lips", "Lip Liner",     "2.5ml"],
  [/lip balm|lip mask|lip scrub|lip care|lip jam|lip pot|lip oil|pillow lips/i,
                                                                "lips", "Lip Balm",      "5g"],
  [/gloss|dazzler|glitter kit/i,                                 "lips", "Lip Gloss",     "3ml"],
  [/lipstick|crayon|lip mousse/i,                               "lips", "Lipstick",      "3.5g"],
  [/lip tint|lip stain|tint marker|plumper|lip stacks|lip & eye pen|lip duo|lip kit/i,
                                                                "lips", "Lip Tint",      "3ml"],
];

/* PKR bands: [min, max] per subcategory, plus a bump for palettes/sets. */
const PRICE_BAND = {
  "Setting Spray": [2290, 3290], "Primer": [1190, 3990], "Foundation": [4390, 4990],
  "Concealer": [1490, 1990], "Powder": [990, 3590], "Blush": [1690, 2390],
  "Highlighter": [1590, 2390], "Contour & Bronzer": [1790, 2390],
  "Mascara": [1690, 2390], "Eyeliner": [1190, 1890], "Brows": [1290, 1890],
  "Eye Primer": [1390, 1590], "Eyeshadow": [1390, 2190],
  "Lip Liner": [1190, 1590], "Lip Balm": [1190, 1790], "Lip Gloss": [1290, 1890],
  "Lipstick": [1590, 2290], "Lip Tint": [1390, 1990],
};

const FINISH_RULES = [
  [/matte|blur|mattif/i, "Matte"], [/glitter|shimmer|sparkl|metallic|strobe|prismalight|chrome|glaze/i, "Shimmer"],
  [/dewy|jelly|hydrat|glow|luminous|glossy|gloss|oil|shine/i, "Dewy"],
  [/radiant|baked|bloom/i, "Radiant"], [/velvet|satin|cushion|putty/i, "Satin"],
];

/* Deterministic pseudo-random from the name, so prices never move between runs. */
function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/* ---------- original description copy ---------- */
/* Type-specific clause banks. Combined by seed so each product gets its own
   wording rather than one template repeated across the catalogue. */
const OPENERS = {
  "Setting Spray": ["A fine-mist finishing spray that locks the whole face down.", "A finishing mist that melts powder edges into the skin.", "The last step: a fine mist that stops makeup shifting."],
  "Primer": ["A grip primer that gives foundation something to hold onto.", "A smoothing base that evens out texture before colour goes on.", "A lightweight base layer that buys your makeup extra hours."],
  "Foundation": ["A buildable base with real staying power.", "A skin-like foundation you can take from sheer to full.", "A long-wear base that stays comfortable through the day."],
  "Concealer": ["A creamy concealer that lifts shadow without caking.", "High coverage for under the eyes and over blemishes.", "A concealer that brightens without settling into lines."],
  "Powder": ["A finely milled powder that sets without flashback.", "A soft-focus powder for setting and baking.", "A weightless powder that keeps shine down."],
  "Blush": ["A pigmented flush that blends into the skin, not onto it.", "Colour that reads like a natural flush.", "A blendable blush that builds from a hint to a statement."],
  "Highlighter": ["A glow that catches the light without glitter.", "A luminous finish for the high points of the face.", "A soft-focus sheen rather than a hard shimmer."],
  "Contour & Bronzer": ["Definition that mimics real shadow.", "A sculpting shade for cheekbones, jaw and nose.", "Warmth and structure without going orange."],
  "Mascara": ["Length and lift from the first coat.", "A brush shaped to separate rather than clump.", "Volume that holds its curl all day."],
  "Eyeliner": ["A precise line that stays where you put it.", "A tip fine enough for a clean wing.", "Longwear colour that survives a full day."],
  "Brows": ["Hold and definition for natural-looking brows.", "Shapes and sets brow hairs in one pass.", "A groomed brow that stays put."],
  "Eye Primer": ["A gripping base that stops shadow creasing.", "The layer that makes eyeshadow last twice as long."],
  "Eyeshadow": ["Blendable colour that layers without going muddy.", "Pigment that shows up true on the first sweep.", "Buildable colour for an everyday or a full look."],
  "Lip Liner": ["A precise line that defines and holds colour in.", "Definition that stops lipstick travelling."],
  "Lip Balm": ["Comfort and softness for dry lips.", "A nourishing balm that treats while it shines.", "Hydration you can wear on its own or under colour."],
  "Lip Gloss": ["Shine without the sticky finish.", "A glassy gloss that layers over anything.", "High shine that feels weightless."],
  "Lipstick": ["Rich colour in a single pass.", "Full-coverage colour that wears comfortably.", "Pigment that stays true for hours."],
  "Lip Tint": ["Colour that stains and stays.", "A tint that survives a cup of chai.", "Long-wear colour without the dryness."],
};

const CLOSERS = [
  "Best applied in thin layers and built up rather than laid on heavily.",
  "Works on its own or layered under the rest of your base.",
  "A little goes a long way — start with less than you think you need.",
  "Blend while it is still moving; it sets quickly once placed.",
  "Suits everyday wear as easily as a full evening look.",
  "Patch test before first use if your skin is sensitive.",
  "Comfortable enough for all-day wear in Pakistani heat.",
  "Pairs well with the rest of the range without pilling.",
];

function describe(name, sub, s) {
  const bank = OPENERS[sub] || ["A well-made everyday essential from the SHEGLAM range."];
  const opener = bank[Math.floor(s * bank.length) % bank.length];
  // Second, independent seed so the closing line does not track the opener.
  const s2 = seed(name.split("").reverse().join("") + sub);
  const closer = CLOSERS[Math.floor(s2 * CLOSERS.length) % CLOSERS.length];
  return `${opener} ${closer}`;
}

/* ---------- build ---------- */
function classify(name) {
  for (const [re, cat, sub, size] of SUBCAT_RULES) if (re.test(name)) return { cat, sub, size };
  return null;
}

function finishOf(name) {
  for (const [re, f] of FINISH_RULES) if (re.test(name)) return f;
  return "Natural";
}

const existing = JSON.parse(fs.readFileSync(FILE, "utf8"));
const haveSlugs = new Set(existing.products.map((p) => p.slug));
const haveNames = new Set(existing.products.map((p) => p.name.toLowerCase()));

const added = [];
const skipped = { licensed: 0, duplicate: 0, unclassified: [] };
let nextSku = 1000 + existing.products.length;

Object.entries(RAW_NAMES).forEach(([hintCat, names]) => {
  names.forEach((raw) => {
    if (LICENSED.test(raw)) { skipped.licensed++; return; }

    // Strip SEO padding, then split a trailing shade off the product name.
    let name = raw.replace(SEO_JUNK, " ").replace(/\s+/g, " ").trim();
    let shade = "";

    /* Only the LAST dash can introduce a shade, and only when what follows
       is not itself part of the product name. Hyphenated compounds are
       everywhere here — Ultra-Blur, Multi-Effect, All-In-One, Peel-Off,
       2-In-1 — and splitting those produced names like "Good Grip Ultra"
       with a shade of "Blur Primer". */
    const PRODUCT_WORD = /\b(primer|mascara|lipstick|gloss|liner|eyeliner|eyeshadow|palette|balm|tint|stain|powder|spray|concealer|corrector|foundation|blush|highlighter|bronzer|contour|serum|pen|pencil|stick|cream|oil|mousse|scrub|mask|kit|set|duo|trio|gel|pomade|soap|remover|plumper|jam|pot|crayon|marker|glaze|cushion|brow|lash|shadow|toner|stack|effect|wear|size)\b/i;
    const COMPOUND_TAIL = /^(in|on|off|up|out|blur|lasting|proof|coverage|shine|tone|fix|glam|ready|long|free|the|a|and)\b/i;

    const lastDash = Math.max(name.lastIndexOf("-"), name.lastIndexOf("–"));
    if (lastDash > 8) {
      const head = name.slice(0, lastDash).trim();
      const tail = name.slice(lastDash + 1).trim();
      const plausibleShade =
        tail.length >= 2 && tail.length <= 32 &&
        /^[A-Za-z0-9][A-Za-z0-9'’&.\s]*$/.test(tail) &&
        !PRODUCT_WORD.test(tail) &&
        !COMPOUND_TAIL.test(tail) &&
        head.split(/\s+/).length >= 2;          // never reduce to a single word
      if (plausibleShade) {
        name = head;
        shade = tail.replace(/^\d+\s+/, "").trim();
      }
    }
    name = name.replace(/\s*[-–]\s*$/, "").trim();

    if (haveNames.has(name.toLowerCase())) { skipped.duplicate++; return; }
    let slug = slugify(name);
    if (haveSlugs.has(slug)) { skipped.duplicate++; return; }

    const cls = classify(raw);
    if (!cls) { skipped.unclassified.push(raw); return; }

    const s = seed(name);
    const band = PRICE_BAND[cls.sub] || [1490, 2490];
    const isSet = /palette|set|kit|duo|trio|stacks|bracelet/i.test(name);
    let price = Math.round((band[0] + s * (band[1] - band[0])) / 100) * 100 - 10;
    if (isSet) price = Math.round(price * 1.9 / 100) * 100 - 10;

    // Put roughly a fifth of the catalogue on offer, deterministically.
    const onSale = s > 0.8;
    const oldPrice = onSale ? Math.round((price * 1.25) / 100) * 100 - 10 : null;

    added.push({
      name,
      slug,
      category: cls.cat,
      sub: cls.sub,
      price,
      oldPrice,
      finish: finishOf(raw),
      size: cls.size,
      isNew: s > 0.86,
      isBestSeller: s < 0.12,
      desc: describe(name, cls.sub, s),
      shades: shade ? [{ name: shade, hex: "#d8b79a", stock: 12 }] : null,
      stock: shade ? undefined : 20,
      sku: "SGPK-" + (++nextSku),
      needsReview: true,           // flagged in admin: copy + shade colour are placeholders
    });
    haveSlugs.add(slug);
    haveNames.add(name.toLowerCase());
  });
});

/* ---------- report ---------- */
const byCat = {};
added.forEach((p) => {
  byCat[p.category] = byCat[p.category] || {};
  byCat[p.category][p.sub] = (byCat[p.category][p.sub] || 0) + 1;
});

console.log(`\nCatalogue import ${WRITE ? "" : "(preview — nothing written)"}\n`);
console.log(`  existing products : ${existing.products.length}`);
console.log(`  new products      : ${added.length}`);
console.log(`  → total           : ${existing.products.length + added.length}\n`);
console.log(`  skipped, licensed collab : ${skipped.licensed}`);
console.log(`  skipped, already listed  : ${skipped.duplicate}`);
console.log(`  skipped, unclassified    : ${skipped.unclassified.length}`);
skipped.unclassified.slice(0, 8).forEach((n) => console.log(`      · ${n}`));

console.log("\n  new products by category:");
Object.entries(byCat).forEach(([c, subs]) => {
  console.log(`    ${c}`);
  Object.entries(subs).sort().forEach(([s, n]) => console.log(`      ${s.padEnd(20)} ${n}`));
});

if (!WRITE) {
  console.log("\n  Re-run with --write to merge these into data/products.json\n");
  process.exit(0);
}

existing.products = existing.products.concat(added);
existing.updated = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(existing, null, 2), "utf8");
console.log(`\n✓ data/products.json now holds ${existing.products.length} products`);
console.log(`  Run: node build.js\n`);
