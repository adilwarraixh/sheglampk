import type { Metadata } from "next";
import ShopPage, { PageHead, Crumbs, Sechead, Cards } from "@/components/shop/ShopPage";
import { D, SITE, pageMeta } from "@/lib/shop";

export const metadata: Metadata = pageMeta({
  title: `About Us | ${SITE.name}`,
  description: "Who we are: an independent Pakistani stockist bringing genuine SHEGLAM makeup to Lahore, Karachi, Islamabad and everywhere in between.",
  path: "/about",
});

export default function About() {
  return (
    <ShopPage page="about">
      <PageHead title="About SHEGLAM PK" sub="An independent stockist bringing genuine SHEGLAM makeup to Pakistan." />
      <Crumbs items={[{ label: "Home", href: "/" }, { label: "About" }]} />
      <div className="container--narrow prose">
        <p>SHEGLAM PK started because buying good makeup in Pakistan was harder than it needed to be. The products people actually wanted were either unavailable, wildly marked up, or sold by pages that vanished the moment something went wrong.</p>
        <p>We stock the SHEGLAM range ourselves, in Lahore. Everything on this site is physically on our shelf — we do not dropship, and we do not list things we cannot ship the same week. That is why our dispatch times are one to two working days rather than &quot;please allow 3–4 weeks&quot;.</p>

        <div className="note"><strong>To be completely clear:</strong> {SITE.disclaimer}</div>

        <h2>What we care about</h2>
        <h3>Genuine product, checked on arrival</h3>
        <p>Counterfeit cosmetics are a real problem in this market, and they are not just a waste of money — unregulated formulas end up on your face. We buy sealed stock and check batch codes when it lands. If you ever receive something you believe is not genuine, send us photos and we refund you in full.</p>

        <h3>Prices that make sense</h3>
        <p>Import duty and shipping are real costs and we are not going to pretend otherwise. What we will not do is mark something up four times and call it &quot;premium&quot;. Our pricing is posted openly on every product page, and there are no surprise charges at checkout.</p>

        <h3>Help before you buy, not just after</h3>
        <p>Most returns happen because someone guessed a shade. Message us on WhatsApp with a photo in natural light before you order and we will tell you honestly which shade to pick — including telling you when we think a product is not right for you.</p>

        <h2>Delivery across Pakistan</h2>
        <p>We deliver to every city in Pakistan with cash on delivery. Lahore, Karachi and Islamabad typically arrive in 2–3 days; everywhere else is 3–5 days. Orders over {D.money(SITE.freeShippingOver)} ship free, and everything else is a flat {D.money(SITE.flatShipping)}.</p>

        <h2>Talk to us</h2>
        <p>We are a small team and we answer our own messages. WhatsApp is fastest — <a href={`https://wa.me/${SITE.whatsapp}`} target="_blank" rel="noopener">{SITE.whatsappShow}</a> — or email <a href={`mailto:${SITE.email}`}>{SITE.email}</a>. Full details are on the <a href="/contact">contact page</a>.</p>
      </div>

      <section className="section section--alt">
        <div className="container">
          <Sechead tag="" title="Start with the bestsellers" link={["View all", "/best-sellers"]} />
          <Cards products={D.FEEDS.best().slice(0, 5)} />
        </div>
      </section>
    </ShopPage>
  );
}
