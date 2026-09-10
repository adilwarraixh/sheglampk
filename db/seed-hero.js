/* db/seed-hero.js — move the hero slides from data/hero.json into the
   database, once. After this the admin portal is the place they are
   edited, and data/hero.json is regenerated from the database at build. */
const fs = require("fs");
const path = require("path");
const { sql, describeTarget } = require("./client.js");

(async () => {
  console.log(`\nHero seed → ${describeTarget()}`);
  const [existing] = await sql`SELECT count(*)::int n FROM hero_slides`;
  if (existing.n > 0) { console.log(`  ${existing.n} slides already in the database — nothing to do.\n`); return; }

  const src = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "hero.json"), "utf8"));
  const slides = src.slides || [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    await sql`
      INSERT INTO hero_slides
        (position, is_enabled, eyebrow, headline, subtext, cta_label, cta_href,
         cta2_label, cta2_href, video_url, video_mobile_url, poster_url)
      VALUES (${i}, ${s.enabled !== false}, ${s.eyebrow || null}, ${s.headline || "Slide"},
              ${s.sub || null}, ${s.ctaLabel || null}, ${s.ctaHref || null},
              ${s.cta2Label || null}, ${s.cta2Href || null},
              ${s.video || null}, ${s.videoMobile || null}, ${s.poster || null})`;
  }
  console.log(`  ${slides.length} slides imported.\n`);
})().catch((e) => { console.error("\n✗", e.message, "\n"); process.exit(1); });
