import type { Metadata } from "next";
import ShopPage, { PageHead, Crumbs, Icon } from "@/components/shop/ShopPage";
import { SITE, pageMeta } from "@/lib/shop";

export const metadata: Metadata = pageMeta({
  title: `Shade & Size Guide | ${SITE.name}`,
  description: "How to pick a foundation, concealer and contour shade for South Asian skin tones, plus what the product sizes mean.",
  path: "/size-guide",
});

export default function SizeGuide() {
  const wa = `https://wa.me/${SITE.whatsapp}`;
  return (
    <ShopPage page="size-guide">
      <PageHead title="Shade & size guide" sub="How to pick the right shade the first time — and what the sizes on our labels mean." />
      <Crumbs items={[{ label: "Home", href: "/" }, { label: "Shade guide" }]} />
      <div className="container--narrow prose">
        <div className="note"><strong>Skip all this if you like.</strong> Send a photo of your bare face in daylight to{" "}
          <a href={wa} target="_blank" rel="noopener">WhatsApp</a> and we will just tell you which shade to buy.</div>

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

        <div className="note">Buying between two shades? Go with the <strong>deeper</strong> one. Most foundations oxidise slightly and settle a touch darker after 20 minutes, and a shade slightly too deep reads far better than one too light.</div>

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
        <p><a className="btn btn--wa" href={wa} target="_blank" rel="noopener" style={{ marginTop: "8px" }}><Icon name="whatsapp" size={18} brand /> Ask for a shade match</a></p>
      </div>
    </ShopPage>
  );
}
