import type { Metadata } from "next";
import ShopPage, { PageHead, Crumbs } from "@/components/shop/ShopPage";
import { SITE, pageMeta } from "@/lib/shop";

export const metadata: Metadata = pageMeta({
  title: `Track Your Order | ${SITE.name}`,
  description: "Look up the status of your SHEGLAM PK order with your order reference and phone number.",
  path: "/track-order",
});

export default function TrackOrder() {
  return (
    <ShopPage page="track">
      <PageHead title="Track your order" sub="Enter the reference from your confirmation (it looks like SG-2601-ABCDE) and the phone number you ordered with." />
      <Crumbs items={[{ label: "Home", href: "/" }, { label: "Track order" }]} />
      <div className="container" style={{ padding: "44px 0 72px" }}>
        <div className="tracker">
          <form id="trackForm">
            <div className="field" style={{ textAlign: "left" }}>
              <label htmlFor="trackRef">Order reference</label>
              <input type="text" id="trackRef" placeholder="SG-2601-ABCDE" autoComplete="off" required />
            </div>
            <div className="field" style={{ textAlign: "left" }}>
              <label htmlFor="trackPhone">Phone number used for the order</label>
              <input type="tel" id="trackPhone" placeholder="0300 1234567" autoComplete="tel" inputMode="tel" required />
            </div>
            <button className="btn btn--primary btn--block" type="submit">Track order</button>
          </form>
          <div className="tracker__result" id="trackResult"></div>
          <p style={{ fontSize: "13.5px", color: "var(--muted)", marginTop: "22px", lineHeight: "1.7" }}>
            Lost your reference?{" "}
            <a href={`https://wa.me/${SITE.whatsapp}`} target="_blank" rel="noopener" style={{ color: "var(--rose)" }}>Message us on WhatsApp</a>{" "}
            with your name and phone number and we will find it.
          </p>
        </div>
      </div>
    </ShopPage>
  );
}
