import type { Metadata } from "next";
import ShopPage, { PageHead, Crumbs, Accordion, JsonLd } from "@/components/shop/ShopPage";
import { D, T, SITE, pageMeta } from "@/lib/shop";

type FaqGroups = { group: string; items: { q: string; a: string }[] }[];
const FAQ = D.FAQ as FaqGroups;

export const metadata: Metadata = pageMeta({
  title: `FAQs — Orders, Delivery, Returns | ${SITE.name}`,
  description: "Answers to the questions we get asked most: delivery times, cash on delivery, returns, shade matching and product authenticity.",
  path: "/faq",
});

export default function Faq() {
  return (
    <ShopPage page="faq">
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQ.flatMap((g) =>
          g.items.map((it) => ({
            "@type": "Question",
            name: it.q,
            acceptedAnswer: { "@type": "Answer", text: it.a },
          }))
        ),
      }} />
      <PageHead title="Frequently asked questions" sub="Delivery, returns, payments and product questions — answered plainly." />
      <Crumbs items={[{ label: "Home", href: "/" }, { label: "FAQs" }]} />
      <div className="container--narrow prose">
        {FAQ.map((g, i) => (
          <div key={i} className="faqgroup">
            <h2>{g.group}</h2>
            <Accordion items={g.items.map((it) => ({ q: it.q, a: T.esc(it.a) }))} />
          </div>
        ))}

        <div className="note" style={{ marginTop: "32px" }}>
          <strong>Still stuck?</strong> Message us on{" "}
          <a href={`https://wa.me/${SITE.whatsapp}`} target="_blank" rel="noopener">WhatsApp</a>{" "}
          or use the <a href="/contact">contact form</a> — a real person will get back to you.
        </div>
      </div>
    </ShopPage>
  );
}
