import type { Metadata } from "next";
import ShopPage, { PageHead, Crumbs } from "@/components/shop/ShopPage";
import { SITE, pageMeta } from "@/lib/shop";

export const metadata: Metadata = pageMeta({
  title: `Returns & Refunds | ${SITE.name}`,
  description: `Our ${SITE.returnDays}-day return policy for unopened cosmetics, plus how faulty, damaged and incorrect items are handled.`,
  path: "/returns",
});

export default function Returns() {
  return (
    <ShopPage page="returns">
      <PageHead title="Returns & refunds" sub={`${SITE.returnDays} days to change your mind on unopened items — and no time limit on us getting it wrong.`} />
      <Crumbs items={[{ label: "Home", href: "/" }, { label: "Returns" }]} />
      <div className="container--narrow prose">
        <h2>The short version</h2>
        <ul>
          <li>Unopened, unused items in original packaging: returnable within <strong>{SITE.returnDays} days</strong> of delivery.</li>
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
        <ol style={{ display: "grid", gap: "10px", marginBottom: "16px", paddingLeft: "20px", listStyle: "decimal" }}>
          <li>Message us on WhatsApp with your order reference and a photo of the item.</li>
          <li>We confirm whether it qualifies, usually within a few hours.</li>
          <li>For approved returns we arrange collection or share a return address.</li>
          <li>Once the item reaches us, refunds are processed within <strong>3–5 working days</strong>.</li>
        </ol>

        <h2>How refunds are paid</h2>
        <p>Refunds go back by Easypaisa, JazzCash or bank transfer to an account in the name on the order. For cash on delivery orders we cannot refund in cash, so please have one of these ready.</p>

        <h2>Exchanges</h2>
        <p>Shade exchanges on unopened items are free within {SITE.returnDays} days — you only cover the delivery of the returning item. Message us and we will hold the replacement shade for you.</p>

        <div className="note"><strong>Consumer rights.</strong> Nothing in this policy limits your rights under Pakistani consumer protection law. If you believe we have got something wrong, tell us and we will look at it again properly.</div>
      </div>
    </ShopPage>
  );
}
