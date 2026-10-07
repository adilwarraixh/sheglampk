import type { Metadata } from "next";
import ShopPage, { PageHead, Crumbs } from "@/components/shop/ShopPage";
import { SITE, pageMeta } from "@/lib/shop";

export const metadata: Metadata = pageMeta({
  title: `Terms & Conditions | ${SITE.name}`,
  description: "The terms that apply when you order from SHEGLAM PK.",
  path: "/terms",
});

export default function Terms() {
  return (
    <ShopPage page="terms" hideNewsletter>
      <PageHead title="Terms & conditions" sub="The terms that apply when you buy from us." />
      <Crumbs items={[{ label: "Home", href: "/" }, { label: "Terms" }]} />
      <div className="container--narrow prose">
        <p><em>Last updated: {new Date().toISOString().slice(0, 10)}</em></p>

        <h2>1. Who we are</h2>
        <p>{SITE.name} is an online retailer based in {SITE.address}, selling cosmetics to customers in Pakistan.</p>
        <div className="note">{SITE.disclaimer}</div>

        <h2>2. Orders</h2>
        <p>Placing an order is an offer to buy. A contract forms when we confirm your order. We may decline an order if an item is out of stock, if the price was listed in error, or if we cannot verify the delivery details.</p>

        <h2>3. Prices</h2>
        <p>All prices are in Pakistani Rupees and include applicable taxes. Delivery charges are shown at checkout before you confirm. We may change prices at any time, but never after your order is confirmed.</p>

        <h2>4. Payment</h2>
        <p>We accept cash on delivery only. You pay the courier in full when the parcel is handed to you; we never ask for payment in advance. If anyone contacts you claiming to be us and asks you to transfer money before delivery, it is not us — please report it.</p>

        <h2>5. Delivery</h2>
        <p>Delivery timelines on the <a href="/shipping">shipping page</a> are estimates, not guarantees. Courier delays, weather and public holidays can affect them. Risk in the goods passes to you on delivery.</p>

        <h2>6. Returns</h2>
        <p>Our <a href="/returns">returns policy</a> forms part of these terms. In short: unopened items within {SITE.returnDays} days; opened cosmetics only if faulty or incorrectly sent.</p>

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
        <p><a href={`mailto:${SITE.email}`}>{SITE.email}</a> &middot; <a href={`https://wa.me/${SITE.whatsapp}`} target="_blank" rel="noopener">{SITE.whatsappShow}</a></p>
      </div>
    </ShopPage>
  );
}
